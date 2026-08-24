import { randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import { AppError } from "../lib/errors.js";
import { ROLE } from "./familyService.js";
import { writeAudit, AUDIT_ACTION } from "./auditService.js";
import { emitToUsers } from "../realtime.js";
import { pushToUsers } from "./pushService.js";
import { localDayStartUtc } from "../lib/localTime.js";

const MANAGEMENT_ROLES = new Set<number>([ROLE.admin, ROLE.guardian]);
const ELDER_ROLES = new Set<number>([ROLE.elder, ROLE.member]);

interface MedicationRow {
  Id: string;
  ElderUserId: string;
  Name: string;
  Dosage: string | null;
  Times: string;
  DaysOfWeek: number;
  IsActive: boolean;
}

function mapMedication(m: MedicationRow) {
  return {
    id: m.Id,
    elderUserId: m.ElderUserId,
    name: m.Name,
    dosage: m.Dosage,
    times: m.Times ? m.Times.split(",").map((t) => t.trim()).filter(Boolean) : [],
    daysOfWeek: m.DaysOfWeek,
    isActive: m.IsActive,
  };
}

async function ensureManages(tutorUserId: string, elderUserId: string) {
  const managed = await prisma.family_members.findMany({
    where: { UserId: tutorUserId, Role: { in: [...MANAGEMENT_ROLES] } },
    select: { FamilyId: true },
  });
  const familyIds = [...new Set(managed.map((m) => m.FamilyId))];
  if (familyIds.length === 0) {
    throw new AppError("Forbidden", "Apenas responsáveis podem gerenciar lembretes de medicação.", 403);
  }
  const shares = await prisma.family_members.findFirst({
    where: { UserId: elderUserId, FamilyId: { in: familyIds } },
    select: { Id: true },
  });
  if (!shares) {
    throw new AppError("Forbidden", "Este membro não pertence a uma família que você gerencia.", 403);
  }
}

/** Members the caller manages who can have elder care (role elder/member). */
export async function getElders(userId: string) {
  const managed = await prisma.family_members.findMany({
    where: { UserId: userId, Role: { in: [...MANAGEMENT_ROLES] } },
    select: { FamilyId: true },
  });
  const familyIds = [...new Set(managed.map((m) => m.FamilyId))];
  if (familyIds.length === 0) return [];
  const elders = await prisma.family_members.findMany({
    where: { FamilyId: { in: familyIds }, UserId: { not: null }, Role: { in: [...ELDER_ROLES] } },
    include: { users: { select: { FullName: true, Email: true, AvatarUrl: true } } },
    orderBy: { JoinedAt: "asc" },
  });
  return elders
    .filter((e) => e.UserId && e.UserId !== userId)
    .map((e) => ({
      memberId: e.Id,
      userId: e.UserId,
      fullName: e.users?.FullName ?? e.DisplayName,
      email: e.users?.Email ?? null,
      avatarUrl: e.users?.AvatarUrl ?? null,
      role: e.Role === ROLE.member ? "member" : "elder",
      batteryLevel: e.BatteryLevel,
      lastSeenAt: e.LastSeenAt?.toISOString() ?? null,
    }));
}

export async function getMedications(userId: string, elderUserId: string) {
  if (userId !== elderUserId) await ensureManages(userId, elderUserId);
  const items = await prisma.medication_reminders.findMany({
    where: { ElderUserId: elderUserId },
    orderBy: { Name: "asc" },
  });
  return items.map(mapMedication);
}

export const getMyMedications = (userId: string) => getMedications(userId, userId);

export interface MedicationInput {
  name: string;
  dosage?: string;
  times: string[];
  daysOfWeek: number;
}

export async function upsertMedications(userId: string, elderUserId: string, medications: MedicationInput[]) {
  await ensureManages(userId, elderUserId);
  await prisma.medication_reminders.deleteMany({ where: { ElderUserId: elderUserId } });
  const now = new Date();
  const valid = medications.filter((m) => m.name?.trim());
  if (valid.length > 0) {
    await prisma.medication_reminders.createMany({
      data: valid.map((m) => ({
        Id: randomUUID(),
        ElderUserId: elderUserId,
        ManagedByUserId: userId,
        Name: m.name.trim(),
        Dosage: m.dosage?.trim() || null,
        Times: [...new Set((m.times ?? []).map((t) => t.trim()).filter(Boolean))].join(","),
        DaysOfWeek: m.daysOfWeek,
        IsActive: true,
        CreatedAt: now,
      })),
    });
  }
  return getMedications(userId, elderUserId);
}

// ── Daily check-in ──────────────────────────────────────────────────────────
// No dedicated table for this (schema is introspected/frozen from the old
// .NET app — see CLAUDE.md); reuses the existing audit_logs infra instead of
// adding a new table, the same way forgot-password avoided a schema change.

export async function getManagerUserIds(elderUserId: string): Promise<string[]> {
  const elderMemberships = await prisma.family_members.findMany({
    where: { UserId: elderUserId, Role: { in: [...ELDER_ROLES] } },
    select: { FamilyId: true },
  });
  const familyIds = [...new Set(elderMemberships.map((m) => m.FamilyId))];
  if (familyIds.length === 0) return [];
  const managers = await prisma.family_members.findMany({
    where: { FamilyId: { in: familyIds }, UserId: { not: null }, Role: { in: [...MANAGEMENT_ROLES] } },
    select: { UserId: true },
  });
  return [...new Set(managers.map((m) => m.UserId!).filter(Boolean))];
}

async function checkInStatusFor(elderUserId: string) {
  const last = await prisma.audit_logs.findFirst({
    where: { ActorUserId: elderUserId, Action: AUDIT_ACTION.ElderCheckIn },
    orderBy: { CreatedAt: "desc" },
  });
  // Family-local midnight (not UTC): a 22h BRT check-in must still count as
  // "today", and must not leak into tomorrow at 21h.
  const startOfToday = localDayStartUtc();
  return {
    lastCheckInAt: last?.CreatedAt.toISOString() ?? null,
    checkedInToday: !!last && last.CreatedAt >= startOfToday,
  };
}

/** The elder confirms they're okay today. Notifies whoever manages them —
 *  realtime for open apps AND an OS push, so the caregiver actually hears it. */
export async function checkIn(elderUserId: string, note?: string) {
  await writeAudit({
    actorUserId: elderUserId,
    targetUserId: elderUserId,
    action: "ElderCheckIn",
    sourceType: "Elder",
    metadata: note ? { note } : undefined,
  });
  const managerIds = await getManagerUserIds(elderUserId);
  emitToUsers(managerIds, "ElderCheckedIn", { elderUserId });
  const elder = await prisma.users.findFirst({ where: { Id: elderUserId }, select: { FullName: true } });
  void pushToUsers(managerIds, {
    title: "💚 Check-in recebido",
    body: `${elder?.FullName ?? "Seu familiar"} confirmou que está bem hoje.`,
    data: { type: "elder-check-in", elderUserId },
  });
  return checkInStatusFor(elderUserId);
}

export const getMyCheckInStatus = (elderUserId: string) => checkInStatusFor(elderUserId);

export async function getCheckInStatus(userId: string, elderUserId: string) {
  if (userId !== elderUserId) await ensureManages(userId, elderUserId);
  return checkInStatusFor(elderUserId);
}

/** Check-in history (one entry per check-in, newest first) for the last N days. */
export async function getCheckInHistory(userId: string, elderUserId: string, days = 7) {
  if (userId !== elderUserId) await ensureManages(userId, elderUserId);
  const since = new Date(localDayStartUtc().getTime() - (days - 1) * 24 * 60 * 60_000);
  const rows = await prisma.audit_logs.findMany({
    where: { ActorUserId: elderUserId, Action: AUDIT_ACTION.ElderCheckIn, CreatedAt: { gte: since } },
    orderBy: { CreatedAt: "desc" },
    select: { CreatedAt: true },
  });
  return rows.map((r) => r.CreatedAt.toISOString());
}

// ── Medication adherence ("tomei o remédio") ────────────────────────────────
// Same frozen-schema strategy as the check-in: each confirmed dose is an
// audit_logs row (Action=ElderMedicationTaken) with {medicationId, time} in
// MetadataJson — no new table.

interface AdherenceEntry {
  medicationId: string;
  time: string;
  takenAt: string;
}

async function adherenceTodayFor(elderUserId: string): Promise<AdherenceEntry[]> {
  const rows = await prisma.audit_logs.findMany({
    where: {
      ActorUserId: elderUserId,
      Action: AUDIT_ACTION.ElderMedicationTaken,
      CreatedAt: { gte: localDayStartUtc() },
    },
    orderBy: { CreatedAt: "asc" },
    select: { CreatedAt: true, MetadataJson: true },
  });
  const entries: AdherenceEntry[] = [];
  for (const r of rows) {
    const meta = r.MetadataJson as { medicationId?: string; time?: string } | null;
    if (meta?.medicationId && typeof meta.time === "string") {
      entries.push({ medicationId: meta.medicationId, time: meta.time, takenAt: r.CreatedAt.toISOString() });
    }
  }
  return entries;
}

/** The elder confirms one dose ("tomei"). Idempotent per (med, time, day). */
export async function markMedicationTaken(elderUserId: string, medicationId: string, time: string) {
  if (!/^\d{2}:\d{2}$/.test(time)) {
    throw new AppError("ValidationError", "Horário deve estar no formato HH:mm.");
  }
  const med = await prisma.medication_reminders.findFirst({
    where: { Id: medicationId, ElderUserId: elderUserId },
  });
  if (!med) throw new AppError("MedicationNotFound", "Medicação não encontrada.", 404);

  const today = await adherenceTodayFor(elderUserId);
  if (!today.some((e) => e.medicationId === medicationId && e.time === time)) {
    await writeAudit({
      actorUserId: elderUserId,
      targetUserId: elderUserId,
      action: "ElderMedicationTaken",
      sourceType: "Elder",
      metadata: { medicationId, time, name: med.Name },
    });
    const managerIds = await getManagerUserIds(elderUserId);
    emitToUsers(managerIds, "ElderMedicationTaken", { elderUserId, medicationId, time });
  }
  return adherenceTodayFor(elderUserId);
}

export async function getTodayAdherence(userId: string, elderUserId: string) {
  if (userId !== elderUserId) await ensureManages(userId, elderUserId);
  return adherenceTodayFor(elderUserId);
}
