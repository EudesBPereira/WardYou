import { prisma } from "../db.js";
import { AppError } from "../lib/errors.js";
import { ROLE, ROLE_NAMES, STATUS } from "./familyService.js";

export type AppProfile = "child" | "elder" | "guardian" | "member" | "pending" | "onboarding";

/**
 * The single app serves every family role; this derives which experience the
 * client should render. Priority: any active `child`/`dependent` membership
 * forces child mode (the most restricted always wins, so a child added to a
 * second family as "member" stays locked down), then `elder`, then management
 * roles, then plain member. A user with **no active membership** never falls
 * back to the full adult experience: `pending` (joined a family, waiting on
 * an admin to approve + assign a role) and `onboarding` (brand-new account,
 * hasn't joined/created any family yet) render locked-down placeholder
 * screens instead — otherwise a freshly registered child account looks
 * identical to the parent's until someone remembers to approve it.
 */
export function deriveAppProfile(activeRoles: number[], hasPendingMembership: boolean): AppProfile {
  if (activeRoles.includes(ROLE.child) || activeRoles.includes(ROLE.dependent)) return "child";
  if (activeRoles.includes(ROLE.elder)) return "elder";
  if (activeRoles.includes(ROLE.admin) || activeRoles.includes(ROLE.guardian)) return "guardian";
  if (activeRoles.includes(ROLE.member)) return "member";
  if (hasPendingMembership) return "pending";
  return "onboarding";
}

// Cap on a stored avatar. Photos are downscaled client-side to a small square
// and sent as a data URI (no blob storage yet), so a valid one is only tens of
// KB; this ceiling (~400KB) rejects an accidental full-resolution upload that
// would bloat the users row and every /map response that echoes it back.
const MAX_AVATAR_LENGTH = 400_000;

/**
 * Set (or clear, with null) the caller's profile photo. Accepts an https URL or
 * a small `data:image/...` URI produced by the client after downscaling —
 * stored straight into users.AvatarUrl (the same column Google sign-in fills).
 */
export async function updateMyAvatar(userId: string, avatarUrl: string | null) {
  const user = await prisma.users.findFirst({ where: { Id: userId } });
  if (!user || !user.IsActive) throw new AppError("Unauthorized", "Usuário não autenticado.", 401);

  let value: string | null = null;
  if (avatarUrl) {
    const trimmed = avatarUrl.trim();
    const ok = /^https:\/\//i.test(trimmed) || /^data:image\/(png|jpe?g|webp);base64,/i.test(trimmed);
    if (!ok) throw new AppError("InvalidAvatar", "Formato de imagem inválido.", 400);
    if (trimmed.length > MAX_AVATAR_LENGTH) {
      throw new AppError("AvatarTooLarge", "A imagem é muito grande.", 413);
    }
    value = trimmed;
  }

  await prisma.users.update({ where: { Id: userId }, data: { AvatarUrl: value } });
  return { avatarUrl: value };
}

export async function getMyProfile(userId: string) {
  const user = await prisma.users.findFirst({ where: { Id: userId } });
  if (!user || !user.IsActive) throw new AppError("Unauthorized", "Usuário não autenticado.", 401);

  const memberships = await prisma.family_members.findMany({
    where: { UserId: userId, Status: { not: STATUS.disabled } },
    include: { families: { select: { Name: true } } },
    orderBy: { JoinedAt: "asc" },
  });

  const activeRoles = memberships.filter((m) => m.Status === STATUS.active).map((m) => m.Role);
  const hasPendingMembership = memberships.some((m) => m.Status === STATUS.pendingInvite);

  return {
    userId: user.Id,
    fullName: user.FullName,
    email: user.Email,
    avatarUrl: user.AvatarUrl ?? null,
    appProfile: deriveAppProfile(activeRoles, hasPendingMembership),
    families: memberships.map((m) => ({
      familyId: m.FamilyId,
      familyName: m.families?.Name ?? "",
      role: ROLE_NAMES[m.Role] ?? "member",
      membershipStatus: m.Status === STATUS.pendingInvite ? "pending" : "active",
    })),
  };
}
