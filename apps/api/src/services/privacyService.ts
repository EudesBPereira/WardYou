import { prisma } from "../db.js";
import { AppError } from "../lib/errors.js";
import { writeAudit } from "./auditService.js";

const STATUS_DISABLED = 2;

export async function getSummary(userId: string) {
  const [devices, locationEvents, userConsents, familyConsents, sosEvents, memberships, auditLogs, tasks] =
    await Promise.all([
      prisma.devices.count({ where: { UserId: userId } }),
      prisma.location_events.count({ where: { UserId: userId } }),
      prisma.user_consents.count({ where: { UserId: userId } }),
      prisma.family_consents.count({ where: { UserId: userId } }),
      prisma.sos_events.count({ where: { TriggeredByUserId: userId } }),
      prisma.family_members.count({ where: { UserId: userId } }),
      prisma.audit_logs.count({ where: { ActorUserId: userId } }),
      prisma.child_tasks.count({ where: { ChildUserId: userId } }),
    ]);
  return { devices, locationEvents, userConsents, familyConsents, sosEvents, familyMemberships: memberships, auditLogs, tasks };
}

/** Personal data export (no password hashes / tokens). */
export async function exportData(userId: string) {
  const user = await prisma.users.findFirst({ where: { Id: userId } });
  if (!user) throw new AppError("UserNotFound", "Usuário não encontrado.", 404);

  const [devices, consents, memberships, locations, sos] = await Promise.all([
    prisma.devices.findMany({ where: { UserId: userId }, select: { Id: true, DeviceName: true, Platform: true, RegisteredAt: true, LastSeenAt: true, IsActive: true } }),
    prisma.user_consents.findMany({ where: { UserId: userId }, select: { Type: true, Version: true, GrantedAt: true, RevokedAt: true, IsActive: true } }),
    prisma.family_members.findMany({ where: { UserId: userId }, select: { FamilyId: true, Role: true, Status: true, JoinedAt: true } }),
    prisma.location_events.findMany({ where: { UserId: userId }, orderBy: { ReceivedAt: "desc" }, take: 200, select: { Latitude: true, Longitude: true, CapturedAt: true, SourceType: true } }),
    prisma.sos_events.findMany({ where: { TriggeredByUserId: userId }, select: { Id: true, Status: true, TriggeredAt: true, ClosedAt: true } }),
  ]);

  await writeAudit({ actorUserId: userId, action: "UserDataExportRequested", sourceType: "Privacy", targetUserId: userId });

  return {
    exportedAt: new Date().toISOString(),
    profile: {
      id: user.Id,
      fullName: user.FullName,
      email: user.Email,
      phoneNumber: user.PhoneNumber ?? null,
      createdAt: user.CreatedAt?.toISOString() ?? null,
    },
    devices: devices.map((d) => ({ ...d, RegisteredAt: d.RegisteredAt.toISOString(), LastSeenAt: d.LastSeenAt?.toISOString() ?? null })),
    consents: consents.map((c) => ({ ...c, GrantedAt: c.GrantedAt.toISOString(), RevokedAt: c.RevokedAt?.toISOString() ?? null })),
    familyMemberships: memberships.map((m) => ({ ...m, JoinedAt: m.JoinedAt.toISOString() })),
    recentLocations: locations.map((l) => ({ ...l, CapturedAt: l.CapturedAt.toISOString() })),
    sosEvents: sos.map((s) => ({ ...s, TriggeredAt: s.TriggeredAt.toISOString(), ClosedAt: s.ClosedAt?.toISOString() ?? null })),
  };
}

/** Records a deletion request (the actual erasure is an ops/manual process). */
export async function requestAccountDeletion(userId: string) {
  await writeAudit({ actorUserId: userId, action: "AccountDeletionRequested", sourceType: "Privacy", targetUserId: userId });
  return { requested: true, requestedAt: new Date().toISOString() };
}

/** Revoke every active consent where the user is the subject (user + family level). */
export async function revokeAllConsents(userId: string) {
  const now = new Date();
  const [u, f] = await Promise.all([
    prisma.user_consents.updateMany({ where: { UserId: userId, IsActive: true }, data: { IsActive: false, RevokedAt: now } }),
    prisma.family_consents.updateMany({ where: { UserId: userId, IsActive: true }, data: { IsActive: false, RevokedAt: now } }),
  ]);
  await writeAudit({ actorUserId: userId, action: "AllConsentsRevoked", sourceType: "Privacy", targetUserId: userId, metadata: { userConsents: u.count, familyConsents: f.count } });
  return { revokedUserConsents: u.count, revokedFamilyConsents: f.count };
}

export { STATUS_DISABLED };
