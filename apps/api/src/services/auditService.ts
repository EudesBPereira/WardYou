import { randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import { AppError } from "../lib/errors.js";

// AuditAction / AuditSourceType (legacy domain enums).
export const AUDIT_ACTION = {
  SosTriggered: 5,
  SosAcknowledged: 6,
  SosClosed: 7,
  ConsentGranted: 9,
  ConsentRevoked: 10,
  FamilyInviteCreated: 11,
  FamilyInviteAccepted: 12,
  ExtraTimeRequested: 18,
  ExtraTimeApproved: 19,
  ExtraTimeRejected: 20,
  ParentalPolicyUpdated: 22,
  UserRegistered: 25,
  UserLoggedIn: 26,
  UserLoggedOut: 27,
  DeviceRegistered: 28,
  DeviceRemoved: 30,
  FamilyCreated: 31,
  AccountDeletionRequested: 34,
  UserDataExportRequested: 35,
  AllConsentsRevoked: 36,
  // App-level actions added by the Node API (above the legacy enum range).
  PasswordResetRequested: 40,
  PasswordReset: 41,
  ElderCheckIn: 42,
  ParentalTemporaryAllow: 43,
  ParentalTemporaryAllowCleared: 44,
  ElderMedicationTaken: 45,
  ParentalAppAccessRequested: 46,
  ParentalProtectionDisabled: 47,
  ParentalAppAccessResolved: 48,
} as const;
export type AuditActionName = keyof typeof AUDIT_ACTION;
const ACTION_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(AUDIT_ACTION).map(([k, v]) => [v, k]),
);

export const AUDIT_SOURCE = {
  Auth: 1,
  Family: 2,
  Consent: 3,
  Location: 4,
  Sos: 5,
  Travel: 6,
  Parental: 7,
  Device: 8,
  Command: 9,
  Privacy: 10,
  Elder: 11,
} as const;
export type AuditSourceName = keyof typeof AUDIT_SOURCE;

export interface WriteAuditInput {
  actorUserId: string;
  action: AuditActionName;
  sourceType: AuditSourceName;
  targetUserId?: string | null;
  familyId?: string | null;
  deviceId?: string | null;
  metadata?: Record<string, unknown>;
}

/** Best-effort audit write — never throws (auditing must not break the action). */
export async function writeAudit(input: WriteAuditInput): Promise<void> {
  try {
    await prisma.audit_logs.create({
      data: {
        Id: randomUUID(),
        ActorUserId: input.actorUserId,
        TargetUserId: input.targetUserId ?? null,
        Action: AUDIT_ACTION[input.action],
        SourceType: AUDIT_SOURCE[input.sourceType],
        FamilyId: input.familyId ?? null,
        DeviceId: input.deviceId ?? null,
        CreatedAt: new Date(),
        MetadataJson: input.metadata ? (input.metadata as object) : undefined,
      },
    });
  } catch {
    /* swallow */
  }
}

interface AuditRow {
  Id: string;
  ActorUserId: string;
  TargetUserId: string | null;
  Action: number;
  SourceType: number;
  FamilyId: string | null;
  DeviceId: string | null;
  CreatedAt: Date;
  MetadataJson: unknown;
}
const SOURCE_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(AUDIT_SOURCE).map(([k, v]) => [v, k]),
);

function mapLog(l: AuditRow) {
  return {
    id: l.Id,
    actorUserId: l.ActorUserId,
    targetUserId: l.TargetUserId,
    action: ACTION_NAMES[l.Action] ?? String(l.Action),
    sourceType: SOURCE_NAMES[l.SourceType] ?? String(l.SourceType),
    familyId: l.FamilyId,
    deviceId: l.DeviceId,
    createdAt: l.CreatedAt.toISOString(),
    metadata: l.MetadataJson ?? null,
  };
}

interface Query {
  page?: number;
  pageSize?: number;
}
function paging(q: Query) {
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 20));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

/** Events where the user is the *target* (who accessed my data). */
export async function getMyDataAccess(userId: string, q: Query) {
  const { page, pageSize, skip } = paging(q);
  const where = { TargetUserId: userId };
  const [items, total] = await Promise.all([
    prisma.audit_logs.findMany({ where, orderBy: { CreatedAt: "desc" }, skip, take: pageSize }),
    prisma.audit_logs.count({ where }),
  ]);
  return { items: items.map(mapLog), page, pageSize, total };
}

/** The user's own actions. */
export async function getActions(userId: string, q: Query) {
  const { page, pageSize, skip } = paging(q);
  const where = { ActorUserId: userId };
  const [items, total] = await Promise.all([
    prisma.audit_logs.findMany({ where, orderBy: { CreatedAt: "desc" }, skip, take: pageSize }),
    prisma.audit_logs.count({ where }),
  ]);
  return { items: items.map(mapLog), page, pageSize, total };
}

export async function getById(userId: string, auditLogId: string) {
  const log = await prisma.audit_logs.findFirst({ where: { Id: auditLogId } });
  if (!log) throw new AppError("AuditLogNotFound", "Registro de auditoria não encontrado.", 404);
  if (log.ActorUserId !== userId && log.TargetUserId !== userId) {
    throw new AppError("Forbidden", "Você não tem acesso a este registro.", 403);
  }
  return mapLog(log);
}
