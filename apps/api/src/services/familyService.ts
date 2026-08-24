import { randomInt, randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import { AppError } from "../lib/errors.js";
import { writeAudit } from "./auditService.js";
import { emitToUser, emitToUsers } from "../realtime.js";
import { pushToUser, pushToUsers } from "./pushService.js";

// Family member enums (ints in the DB, legacy EF values).
export const ROLE = { admin: 0, guardian: 1, member: 2, child: 3, elder: 4, dependent: 5 } as const;
export const ROLE_NAMES: Record<number, keyof typeof ROLE> = {
  0: "admin",
  1: "guardian",
  2: "member",
  3: "child",
  4: "elder",
  5: "dependent",
};
export const STATUS = { pendingInvite: 0, active: 1, disabled: 2 } as const;
export const LINK_TYPE = { accountLinked: 1, managedProfile: 2, pendingInvite: 3 } as const;

const ONLINE_WINDOW_MS = 5 * 60_000;
const LOW_BATTERY = 15;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const INVITE_BASE_URL = "https://app.wityu.com/join";

export function presence(lastSeenAt: Date | null, battery: number | null): "online" | "offline" | "alert" {
  if (battery !== null && battery <= LOW_BATTERY) return "alert";
  if (lastSeenAt && Date.now() - lastSeenAt.getTime() <= ONLINE_WINDOW_MS) return "online";
  return "offline";
}

export function roleToInt(role?: string): number {
  if (!role) return ROLE.member;
  const key = role.toLowerCase() as keyof typeof ROLE;
  return key in ROLE ? ROLE[key] : ROLE.member;
}

interface MemberRow {
  Id: string;
  FamilyId: string;
  UserId: string | null;
  Role: number;
  Status: number;
  DisplayName: string;
  Age: number | null;
  RelationshipLabel: string | null;
  BatteryLevel: number | null;
  LastLocationLabel: string | null;
  LastSeenAt: Date | null;
  users?: { FullName: string; AvatarUrl?: string | null } | null;
}

export function mapMember(m: MemberRow) {
  return {
    id: m.Id,
    familyId: m.FamilyId,
    userId: m.UserId,
    displayName: m.DisplayName?.trim() || m.users?.FullName || "Membro",
    avatarUrl: m.users?.AvatarUrl ?? null,
    role: ROLE_NAMES[m.Role] ?? "member",
    // Presence (online/offline/alert) for the UI, plus the membership state so
    // the app can surface pending invites awaiting approval.
    status: presence(m.LastSeenAt, m.BatteryLevel),
    membershipStatus: m.Status === STATUS.pendingInvite ? "pending" : "active",
    age: m.Age,
    relationshipLabel: m.RelationshipLabel,
    batteryLevel: m.BatteryLevel,
    lastLocationLabel: m.LastLocationLabel,
    lastSeenAt: m.LastSeenAt?.toISOString() ?? null,
  };
}

function randomCode(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

async function uniqueFamilyInviteCode(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = randomCode(8);
    const taken = await prisma.families.findFirst({ where: { InviteCode: code }, select: { Id: true } });
    if (!taken) return code;
  }
  throw new AppError("CodeGenerationFailed", "Não foi possível gerar um código de convite.", 500);
}

async function uniqueInvitationCode(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = randomCode(10);
    const taken = await prisma.family_invites.findFirst({ where: { InviteCode: code }, select: { Id: true } });
    if (!taken) return code;
  }
  throw new AppError("CodeGenerationFailed", "Não foi possível gerar um código de convite.", 500);
}

function inviteLink(code: string): string {
  return `${INVITE_BASE_URL}?familyInvite=${encodeURIComponent(code)}`;
}

async function requireUser(userId: string) {
  const user = await prisma.users.findFirst({ where: { Id: userId } });
  if (!user || !user.IsActive) throw new AppError("Unauthorized", "Usuário não autenticado.", 401);
  return user;
}

/** Active (non-disabled) membership of the user in the family, or 404/403. */
async function requireAdmin(familyId: string, userId: string) {
  const membership = await prisma.family_members.findFirst({
    where: { FamilyId: familyId, UserId: userId, Status: { not: STATUS.disabled } },
  });
  if (!membership) throw new AppError("FamilyNotFound", "Família não encontrada para o usuário.", 404);
  if (membership.Status !== STATUS.active) {
    throw new AppError("FamilyAccessPending", "Sua entrada nesta família ainda precisa ser aprovada.", 403);
  }
  if (membership.Role !== ROLE.admin) {
    throw new AppError("Forbidden", "Apenas administradores podem executar esta ação.", 403);
  }
  return membership;
}

async function familyWithMembers(familyId: string) {
  const family = await prisma.families.findFirst({
    where: { Id: familyId },
    include: {
      family_members: {
        where: { Status: { not: STATUS.disabled } },
        orderBy: { JoinedAt: "asc" },
        include: { users: { select: { FullName: true, AvatarUrl: true } } },
      },
    },
  });
  if (!family) throw new AppError("FamilyNotFound", "Família não encontrada.", 404);
  return {
    id: family.Id,
    name: family.Name,
    description: family.Description,
    inviteCode: family.InviteCode,
    createdAt: family.CreatedAt.toISOString(),
    updatedAt: family.UpdatedAt?.toISOString() ?? null,
    members: family.family_members.map(mapMember),
  };
}

export async function createFamily(userId: string, input: { name: string; description?: string }) {
  const user = await requireUser(userId);
  if (!input.name?.trim()) throw new AppError("ValidationError", "Nome da família é obrigatório.");

  const familyId = randomUUID();
  const now = new Date();
  await prisma.families.create({
    data: {
      Id: familyId,
      Name: input.name.trim(),
      Description: input.description?.trim() || null,
      InviteCode: await uniqueFamilyInviteCode(),
      CreatedAt: now,
      family_members: {
        create: {
          Id: randomUUID(),
          UserId: user.Id,
          Role: ROLE.admin,
          Status: STATUS.active,
          LinkType: LINK_TYPE.accountLinked,
          DisplayName: user.FullName,
          RelationshipLabel: "Administrador da família",
          JoinedAt: now,
          LastSeenAt: now,
        },
      },
    },
  });
  await writeAudit({ actorUserId: user.Id, action: "FamilyCreated", sourceType: "Family", familyId, metadata: { name: input.name.trim() } });
  return familyWithMembers(familyId);
}

export async function listMyFamilies(userId: string) {
  const memberships = await prisma.family_members.findMany({
    where: { UserId: userId, Status: { not: STATUS.disabled } },
    include: {
      families: {
        include: { _count: { select: { family_members: { where: { Status: { not: STATUS.disabled } } } } } },
      },
    },
  });
  return memberships
    .map((m) => ({
      id: m.families.Id,
      name: m.families.Name,
      description: m.families.Description,
      inviteCode: m.families.InviteCode,
      createdAt: m.families.CreatedAt.toISOString(),
      updatedAt: m.families.UpdatedAt?.toISOString() ?? null,
      memberCount: m.families._count.family_members,
      myRole: ROLE_NAMES[m.Role] ?? "member",
      myStatus: m.Status,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getFamily(userId: string, familyId: string) {
  const membership = await prisma.family_members.findFirst({
    where: { FamilyId: familyId, UserId: userId, Status: { not: STATUS.disabled } },
    select: { Id: true },
  });
  if (!membership) throw new AppError("FamilyNotFound", "Família não encontrada para o usuário.", 404);
  return familyWithMembers(familyId);
}

/** Reuse the latest active, unused, unexpired invite or create one. */
export async function getOrCreateInvite(userId: string, familyId: string, email?: string) {
  await requireAdmin(familyId, userId);
  const existing = await prisma.family_invites.findFirst({
    where: { FamilyId: familyId, IsActive: true, IsUsed: false, ExpiresAt: { gt: new Date() } },
    orderBy: { ExpiresAt: "desc" },
  });
  const invite = existing ?? (await createInviteRow(userId, familyId, email));
  return {
    id: invite.Id,
    familyId: invite.FamilyId,
    email: invite.Email?.trim() || null,
    inviteCode: invite.InviteCode,
    inviteLink: inviteLink(invite.InviteCode),
    expiresAt: invite.ExpiresAt.toISOString(),
    isActive: invite.IsActive,
    isUsed: invite.IsUsed,
  };
}

async function createInviteRow(userId: string, familyId: string, email?: string, expiresInHours = 72) {
  const now = new Date();
  return prisma.family_invites.create({
    data: {
      Id: randomUUID(),
      FamilyId: familyId,
      CreatedByUserId: userId,
      Email: email?.trim().toLowerCase() || "",
      InviteCode: await uniqueInvitationCode(),
      CreatedAt: now,
      ExpiresAt: new Date(now.getTime() + expiresInHours * 60 * 60_000),
      IsActive: true,
      IsUsed: false,
    },
  });
}

export async function joinFamily(userId: string, inviteCode: string, role?: string) {
  const user = await requireUser(userId);
  if (!inviteCode?.trim()) throw new AppError("ValidationError", "Informe um código de convite válido.");

  const requestedRole = roleToInt(role);
  // A self-service join may only declare a dependent/member role — management
  // roles (admin/guardian) must be granted by an existing admin, never
  // self-claimed via an invite code.
  if (requestedRole === ROLE.admin || requestedRole === ROLE.guardian) {
    throw new AppError("ValidationError", "Este papel só pode ser concedido por um administrador.", 400);
  }
  const code = inviteCode.trim().toUpperCase();

  // Resolve by generated invite (family_invites) first, then by the family's
  // permanent invite code. Generated invites are single-use + expiring.
  let familyId: string | null = null;
  const invite = await prisma.family_invites.findFirst({ where: { InviteCode: code, IsActive: true } });
  if (invite) {
    if (invite.IsUsed || invite.ExpiresAt <= new Date()) {
      throw new AppError("InvalidInvitation", "O convite informado está expirado ou já foi utilizado.", 400);
    }
    if (invite.Email && invite.Email.toLowerCase() !== user.Email.toLowerCase()) {
      throw new AppError("InvalidInvitation", "O convite informado não pertence a este usuário.", 403);
    }
    familyId = invite.FamilyId;
  } else {
    const family = await prisma.families.findFirst({ where: { InviteCode: code }, select: { Id: true } });
    if (!family) throw new AppError("FamilyNotFound", "Nenhuma família foi encontrada para o código informado.", 404);
    familyId = family.Id;
  }

  const existing = await prisma.family_members.findFirst({ where: { FamilyId: familyId, UserId: user.Id } });
  if (existing && existing.Status !== STATUS.disabled) {
    throw new AppError("AlreadyFamilyMember", "O usuário já participa desta família.", 409);
  }

  const now = new Date();
  const memberData = {
    Role: requestedRole,
    Status: STATUS.pendingInvite,
    LinkType: LINK_TYPE.pendingInvite,
    DisplayName: user.FullName,
    JoinedAt: now,
  };

  let member;
  if (existing) {
    member = await prisma.family_members.update({ where: { Id: existing.Id }, data: memberData });
  } else {
    member = await prisma.family_members.create({
      data: { Id: randomUUID(), FamilyId: familyId, UserId: user.Id, ...memberData },
    });
  }

  if (invite) {
    await prisma.family_invites.update({
      where: { Id: invite.Id },
      data: { IsUsed: true, IsActive: false, UsedAt: now },
    });
  }

  // Notify the family's admins/guardians in real time so the pending request
  // surfaces immediately (Home banner + Família tab) instead of only on their
  // next manual refresh. (Real OS push when the app is closed still needs FCM,
  // which isn't wired server-side yet.)
  const managers = await prisma.family_members.findMany({
    where: {
      FamilyId: familyId,
      Status: STATUS.active,
      Role: { in: [ROLE.admin, ROLE.guardian] },
      UserId: { not: null },
    },
    select: { UserId: true },
  });
  const managerIds = managers.map((m) => m.UserId!).filter(Boolean);
  emitToUsers(managerIds, "FamilyJoinRequested", { familyId, memberId: member.Id, displayName: user.FullName });
  // OS push (works with the app closed) in addition to the in-app realtime.
  pushToUsers(managerIds, {
    title: "Novo pedido de entrada",
    body: `${user.FullName} pediu para entrar na sua família.`,
    data: { type: "family-join", familyId },
  });

  return mapMember(member);
}

async function memberForAdmin(familyId: string, memberId: string, adminUserId: string) {
  await requireAdmin(familyId, adminUserId);
  const member = await prisma.family_members.findFirst({
    where: { FamilyId: familyId, Id: memberId, Status: { not: STATUS.disabled } },
    include: { users: { select: { FullName: true, AvatarUrl: true } } },
  });
  if (!member) throw new AppError("FamilyMemberNotFound", "Membro da família não encontrado.", 404);
  return member;
}

/**
 * Approve a pending join request (admin only). The admin may set the member's
 * role at approval time — this is the moment the app experience for that
 * person is decided (child mode, elder mode, guardian, member).
 */
export async function approveMember(adminUserId: string, familyId: string, memberId: string, role?: string) {
  const member = await memberForAdmin(familyId, memberId, adminUserId);
  if (!member.UserId) {
    throw new AppError("ValidationError", "Perfis gerenciados sem conta vinculada não precisam de aprovação.", 400);
  }
  const requestedRole = role !== undefined ? roleToInt(role) : undefined;
  if (requestedRole === ROLE.admin) {
    throw new AppError("ValidationError", "Não é possível aprovar um membro como administrador.", 400);
  }
  const updated = await prisma.family_members.update({
    where: { Id: member.Id },
    data: {
      Status: STATUS.active,
      LinkType: LINK_TYPE.accountLinked,
      LastSeenAt: member.LastSeenAt ?? new Date(),
      ...(requestedRole !== undefined ? { Role: requestedRole } : {}),
    },
    include: { users: { select: { FullName: true, AvatarUrl: true } } },
  });
  // The approved member's own device is likely sitting on the "pending approval"
  // screen (or the onboarding one) — nudge it to refetch /profile/me so it flips
  // into the right mode immediately instead of waiting for a restart.
  if (updated.UserId) {
    emitToUser(updated.UserId, "MembershipApproved", { familyId });
    pushToUser(updated.UserId, {
      title: "Entrada aprovada",
      body: "Você já faz parte da família no WardYou.",
      data: { type: "membership-approved", familyId },
    });
  }
  return mapMember(updated);
}

/**
 * Change an active member's role (admin only). Guards the last admin so a
 * family can never end up without one; promoting a second admin is allowed
 * (e.g. both parents managing the family).
 */
export async function setMemberRole(adminUserId: string, familyId: string, memberId: string, role: string) {
  const member = await memberForAdmin(familyId, memberId, adminUserId);
  if (member.Status !== STATUS.active) {
    throw new AppError("ValidationError", "Aprove o membro antes de alterar o papel.", 400);
  }
  const newRole = roleToInt(role);
  if (member.Role === ROLE.admin && newRole !== ROLE.admin) {
    const otherAdmins = await prisma.family_members.count({
      where: { FamilyId: familyId, Role: ROLE.admin, Status: STATUS.active, Id: { not: member.Id } },
    });
    if (otherAdmins === 0) {
      throw new AppError("Conflict", "A família precisa de ao menos um administrador.", 409);
    }
  }
  const updated = await prisma.family_members.update({
    where: { Id: member.Id },
    data: { Role: newRole },
    include: { users: { select: { FullName: true, AvatarUrl: true } } },
  });
  if (updated.UserId) emitToUser(updated.UserId, "MemberRoleChanged", { familyId });
  return mapMember(updated);
}

/**
 * Guardian/admin sets (or clears) a member's profile photo — children and
 * elders rarely set their own, and the guardian's screens are where the face
 * actually matters (map pins, member lists). Same validation as the
 * self-service avatar: https URL or a small data URI, size-capped.
 */
const MAX_AVATAR_LENGTH = 400_000;

export async function setMemberAvatar(
  actorUserId: string,
  familyId: string,
  memberId: string,
  avatarUrl: string | null,
) {
  const actor = await prisma.family_members.findFirst({
    where: { FamilyId: familyId, UserId: actorUserId, Status: STATUS.active },
  });
  if (!actor || (actor.Role !== ROLE.admin && actor.Role !== ROLE.guardian)) {
    throw new AppError("Forbidden", "Apenas responsáveis podem alterar a foto de um membro.", 403);
  }
  const member = await prisma.family_members.findFirst({ where: { Id: memberId, FamilyId: familyId } });
  if (!member) throw new AppError("MemberNotFound", "Membro não encontrado.", 404);
  if (!member.UserId) {
    throw new AppError("ValidationError", "Este membro ainda não tem uma conta vinculada.", 400);
  }

  let value: string | null = null;
  if (avatarUrl) {
    const trimmed = avatarUrl.trim();
    const ok = /^https:\/\//i.test(trimmed) || /^data:image\/(png|jpe?g|webp);base64,/i.test(trimmed);
    if (!ok) throw new AppError("InvalidAvatar", "Formato de imagem inválido.", 400);
    if (trimmed.length > MAX_AVATAR_LENGTH) throw new AppError("AvatarTooLarge", "A imagem é muito grande.", 413);
    value = trimmed;
  }

  await prisma.users.update({ where: { Id: member.UserId }, data: { AvatarUrl: value } });
  const updated = await prisma.family_members.findFirst({
    where: { Id: member.Id },
    include: { users: { select: { FullName: true, AvatarUrl: true } } },
  });
  emitToUser(member.UserId, "ProfileUpdated", { familyId });
  await writeAudit({
    actorUserId,
    action: "ParentalPolicyUpdated",
    sourceType: "Family",
    targetUserId: member.UserId,
    familyId,
    metadata: { change: "memberAvatar", cleared: value === null },
  });
  return updated ? mapMember(updated) : null;
}

/** Reject a pending join request — soft-disable the membership (admin only). */
export async function rejectMember(adminUserId: string, familyId: string, memberId: string) {
  const member = await memberForAdmin(familyId, memberId, adminUserId);
  const updated = await prisma.family_members.update({
    where: { Id: member.Id },
    data: { Status: STATUS.disabled },
    include: { users: { select: { FullName: true, AvatarUrl: true } } },
  });
  return mapMember(updated);
}
