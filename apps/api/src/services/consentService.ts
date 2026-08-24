import { randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import { AppError } from "../lib/errors.js";
import { ROLE, STATUS } from "./familyService.js";
import { writeAudit } from "./auditService.js";
import { pushToUsers } from "./pushService.js";

// ConsentType (legacy domain enum). Names are what the mobile client speaks.
export const CONSENT_TYPE = {
  LocationSharing: 1,
  LiveLocation: 2,
  DataAccess: 3,
  Notifications: 4,
  DeviceStatus: 5,
  BatteryStatus: 6,
  PreciseLocation: 7,
  SosReceive: 8,
} as const;
export type ConsentTypeName = keyof typeof CONSENT_TYPE;
const CONSENT_TYPE_NAMES: Record<number, ConsentTypeName> = Object.fromEntries(
  Object.entries(CONSENT_TYPE).map(([k, v]) => [v, k as ConsentTypeName]),
) as Record<number, ConsentTypeName>;

const MANAGEMENT_ROLES = new Set<number>([ROLE.admin, ROLE.guardian]);
const STATUS_DISABLED = 2;

function resolveType(type: string): number {
  // Accept the enum name ("LocationSharing") or its numeric value.
  if (type in CONSENT_TYPE) return CONSENT_TYPE[type as ConsentTypeName];
  const n = Number(type);
  if (CONSENT_TYPE_NAMES[n]) return n;
  throw new AppError("ValidationError", "Tipo de consentimento inválido.", 400);
}

interface ConsentRow {
  Id: string;
  Type: number;
  Version: string;
  AllowedFromHour: number | null;
  AllowedToHour: number | null;
  GrantedAt: Date;
  RevokedAt: Date | null;
  IsActive: boolean;
}

function mapConsent(c: ConsentRow & { UserId?: string; GrantedByUserId?: string }) {
  return {
    id: c.Id,
    type: CONSENT_TYPE_NAMES[c.Type] ?? "DataAccess",
    version: c.Version,
    allowedFromHour: c.AllowedFromHour,
    allowedToHour: c.AllowedToHour,
    grantedAt: c.GrantedAt.toISOString(),
    revokedAt: c.RevokedAt?.toISOString() ?? null,
    isActive: c.IsActive,
    ...(c.UserId ? { userId: c.UserId } : {}),
    ...(c.GrantedByUserId ? { grantedByUserId: c.GrantedByUserId } : {}),
  };
}

function validate(version: string | undefined, from?: number | null, to?: number | null) {
  if (!version?.trim()) throw new AppError("ValidationError", "A versão do consentimento é obrigatória.");
  for (const h of [from, to]) {
    if (h !== undefined && h !== null && (h < 0 || h > 23)) {
      throw new AppError("ValidationError", "As horas permitidas devem estar entre 0 e 23.");
    }
  }
}

export interface AcceptConsentInput {
  version: string;
  allowedFromHour?: number | null;
  allowedToHour?: number | null;
}

/**
 * Tell the *other* guardians/admins in this user's families that they turned
 * their own location sharing on/off.
 *
 * Why it's a push and not just a UI state: when someone stops sharing, the map
 * simply goes quiet for them — from a co-parent's side that is indistinguishable
 * from a dead battery, a crash, or a bug. Announcing it makes the silence
 * *explained* instead of alarming. Guardians only (the people accountable for
 * the family), never the person who flipped it, and best-effort like every other
 * push — a delivery failure must not fail the consent change itself.
 */
async function notifyLocationSharingChange(userId: string, enabled: boolean): Promise<void> {
  try {
    const memberships = await prisma.family_members.findMany({
      where: { UserId: userId, Status: STATUS.active },
      select: { FamilyId: true },
    });
    const familyIds = [...new Set(memberships.map((m) => m.FamilyId))];
    if (familyIds.length === 0) return;

    const managers = await prisma.family_members.findMany({
      where: {
        FamilyId: { in: familyIds },
        Status: STATUS.active,
        Role: { in: [ROLE.admin, ROLE.guardian] },
        UserId: { not: null },
      },
      select: { UserId: true },
    });
    const recipients = managers
      .map((m) => m.UserId as string)
      .filter((id) => id && id !== userId);
    if (recipients.length === 0) return;

    const user = await prisma.users.findFirst({ where: { Id: userId }, select: { FullName: true } });
    const name = user?.FullName ?? "Um familiar";

    await pushToUsers(recipients, {
      title: enabled ? "Localização reativada" : "Localização desativada",
      body: enabled
        ? `${name} voltou a compartilhar a localização.`
        : `A localização de ${name} foi desativada.`,
      data: { type: "location-sharing", userId, enabled: String(enabled) },
    });
  } catch {
    /* best-effort: never break the consent change over a notification */
  }
}

export async function getMyConsents(userId: string) {
  const rows = await prisma.user_consents.findMany({
    where: { UserId: userId },
    orderBy: { GrantedAt: "desc" },
  });
  return rows.map(mapConsent);
}

export async function accept(userId: string, type: string, input: AcceptConsentInput, ip?: string) {
  validate(input.version, input.allowedFromHour, input.allowedToHour);
  const domainType = resolveType(type);
  const now = new Date();

  await prisma.user_consents.updateMany({
    where: { UserId: userId, Type: domainType, IsActive: true },
    data: { IsActive: false, RevokedAt: now },
  });

  const consent = await prisma.user_consents.create({
    data: {
      Id: randomUUID(),
      UserId: userId,
      Type: domainType,
      Version: input.version.trim(),
      IpAddress: ip?.slice(0, 64) ?? null,
      AllowedFromHour: input.allowedFromHour ?? null,
      AllowedToHour: input.allowedToHour ?? null,
      CreatedAt: now,
      GrantedAt: now,
      IsActive: true,
    },
  });
  await writeAudit({ actorUserId: userId, action: "ConsentGranted", sourceType: "Consent", targetUserId: userId, metadata: { type } });
  if (domainType === CONSENT_TYPE.LocationSharing) await notifyLocationSharingChange(userId, true);
  return mapConsent(consent);
}

export async function revoke(userId: string, type: string) {
  const domainType = resolveType(type);
  const active = await prisma.user_consents.findMany({
    where: { UserId: userId, Type: domainType, IsActive: true },
    orderBy: { GrantedAt: "desc" },
  });
  if (active.length === 0) {
    throw new AppError("ConsentNotFound", "Nenhum consentimento ativo foi encontrado para este tipo.", 404);
  }
  await prisma.user_consents.updateMany({
    where: { UserId: userId, Type: domainType, IsActive: true },
    data: { IsActive: false, RevokedAt: new Date() },
  });
  await writeAudit({ actorUserId: userId, action: "ConsentRevoked", sourceType: "Consent", targetUserId: userId, metadata: { type } });
  if (domainType === CONSENT_TYPE.LocationSharing) await notifyLocationSharingChange(userId, false);
  return mapConsent({ ...active[0], IsActive: false, RevokedAt: new Date() });
}

async function requireMembership(familyId: string, userId: string, management: boolean) {
  const m = await prisma.family_members.findFirst({
    where: { FamilyId: familyId, UserId: userId, Status: { not: STATUS_DISABLED } },
  });
  if (!m) throw new AppError("FamilyNotFound", "Família não encontrada para o usuário.", 404);
  if (management && !MANAGEMENT_ROLES.has(m.Role)) {
    throw new AppError("InsufficientRole", "Apenas administradores ou responsáveis podem gerenciar consentimentos.", 403);
  }
  return m;
}

export async function getFamilyConsents(userId: string, familyId: string) {
  await requireMembership(familyId, userId, false);
  const rows = await prisma.family_consents.findMany({
    where: { FamilyId: familyId },
    orderBy: { GrantedAt: "desc" },
  });
  return rows.map(mapConsent);
}

export interface GrantFamilyConsentInput extends AcceptConsentInput {
  type: string;
}

export async function grantFamilyConsent(
  grantedByUserId: string,
  familyId: string,
  targetUserId: string,
  input: GrantFamilyConsentInput,
  ip?: string,
) {
  await requireMembership(familyId, grantedByUserId, true);
  validate(input.version, input.allowedFromHour, input.allowedToHour);

  const exists = await prisma.family_members.findFirst({
    where: { FamilyId: familyId, UserId: targetUserId },
    select: { Id: true },
  });
  if (!exists) throw new AppError("FamilyMemberNotFound", "O usuário informado não pertence a esta família.", 404);

  const domainType = resolveType(input.type);
  const now = new Date();

  await prisma.family_consents.updateMany({
    where: { FamilyId: familyId, UserId: targetUserId, Type: domainType, IsActive: true },
    data: { IsActive: false, RevokedAt: now },
  });

  const consent = await prisma.family_consents.create({
    data: {
      Id: randomUUID(),
      FamilyId: familyId,
      UserId: targetUserId,
      GrantedByUserId: grantedByUserId,
      Type: domainType,
      Version: input.version.trim(),
      IpAddress: ip?.slice(0, 64) ?? null,
      AllowedFromHour: input.allowedFromHour ?? null,
      AllowedToHour: input.allowedToHour ?? null,
      CreatedAt: now,
      GrantedAt: now,
      IsActive: true,
    },
  });
  await writeAudit({ actorUserId: grantedByUserId, action: "ConsentGranted", sourceType: "Consent", targetUserId, familyId, metadata: { type: input.type, scope: "family" } });
  return mapConsent(consent);
}

/** True when the family has an active LocationSharing/BatteryStatus consent for
 *  the member, respecting the optional allowed-hour window. Used by the map. */
export async function hasActiveFamilyConsent(familyId: string, userId: string, type: ConsentTypeName) {
  const consent = await prisma.family_consents.findFirst({
    where: { FamilyId: familyId, UserId: userId, Type: CONSENT_TYPE[type], IsActive: true },
    orderBy: { GrantedAt: "desc" },
  });
  if (!consent) return false;
  return isAllowedNow(consent.AllowedFromHour, consent.AllowedToHour);
}

/** True when the subject has an active user-level consent of this type. */
export async function hasActiveUserConsent(userId: string, type: ConsentTypeName) {
  const consent = await prisma.user_consents.findFirst({
    where: { UserId: userId, Type: CONSENT_TYPE[type], IsActive: true },
    orderBy: { GrantedAt: "desc" },
  });
  if (!consent) return false;
  return isAllowedNow(consent.AllowedFromHour, consent.AllowedToHour);
}

function isAllowedNow(from: number | null, to: number | null): boolean {
  if (from === null || to === null || from === to) return true;
  const hour = new Date().getUTCHours();
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}
