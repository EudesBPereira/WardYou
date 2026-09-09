import { randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import { AppError } from "../lib/errors.js";
import { ROLE, STATUS } from "./familyService.js";
import { emitToUser, emitToUsers } from "../realtime.js";
import { pushToUser, pushToUsers } from "./pushService.js";
import { writeAudit, AUDIT_ACTION } from "./auditService.js";

/** Short display name for a user (for push copy). */
async function displayName(userId: string): Promise<string> {
  const u = await prisma.users.findFirst({ where: { Id: userId }, select: { FullName: true } });
  return u?.FullName ?? "Seu filho(a)";
}

const MANAGEMENT_ROLES = new Set<number>([ROLE.admin, ROLE.guardian]);
const CHILD_ROLES = new Set<number>([ROLE.child, ROLE.member]);

// ExtraTimeRequestStatus / Source (legacy domain enums).
const EXTRA_STATUS = { Pending: 1, Approved: 2, Rejected: 3, Expired: 4 } as const;
const EXTRA_STATUS_NAMES: Record<number, string> = { 1: "Pending", 2: "Approved", 3: "Rejected", 4: "Expired" };
const EXTRA_SOURCE = { ChildRequest: 0, TaskReward: 1, ManualGrant: 2 } as const;

// TaskCompletionStatus.
const COMPLETION_STATUS = { PendingApproval: 0, Approved: 1, Rejected: 2, Expired: 3 } as const;
const COMPLETION_STATUS_NAMES: Record<number, string> = { 0: "PendingApproval", 1: "Approved", 2: "Rejected", 3: "Expired" };

const PROTECTED_APP = "wardyou";

// ── Timed states (encoded — the legacy schema is frozen, no new columns) ──
// A future expiry rides inside the AppCategory varchar(40) as
// "Category|until:<epochSeconds>". Decoding happens ONLY here; clients get
// clean `allowedUntil`/`pausedUntil` ISO fields. The timed remote pause uses a
// synthetic app_rules row (PAUSE_SENTINEL) that is hidden from every listing.
const UNTIL_SEP = "|until:";
const SENTINEL_PREFIX = "__wardyou.";
const PAUSE_SENTINEL = "__wardyou.pause";

function encodeCategory(base: string | null | undefined, until: Date | null): string {
  const clean = (base ?? "Other").split(UNTIL_SEP)[0].trim().slice(0, 20) || "Other";
  return until ? `${clean}${UNTIL_SEP}${Math.floor(until.getTime() / 1000)}` : clean;
}

function decodeCategory(raw: string): { category: string; until: Date | null } {
  const idx = raw.indexOf(UNTIL_SEP);
  if (idx < 0) return { category: raw, until: null };
  const epoch = Number(raw.slice(idx + UNTIL_SEP.length));
  return {
    category: raw.slice(0, idx) || "Other",
    until: Number.isFinite(epoch) && epoch > 0 ? new Date(epoch * 1000) : null,
  };
}

/** A decoded expiry that is still in the future, else null. */
function activeUntil(raw: string, now = new Date()): Date | null {
  const { until } = decodeCategory(raw);
  return until && until > now ? until : null;
}

/**
 * Realtime + silent high-priority push so the CHILD device re-syncs its
 * enforcement immediately (app open → realtime; app killed → the headless
 * push task re-fetches policy/rules and reapplies). Call after ANY mutation
 * that changes what the child may use. Best-effort.
 */
function notifyChildPolicyChanged(childUserId: string): void {
  try {
    emitToUser(childUserId, "ParentalPolicyChanged", { childUserId });
    void pushToUser(childUserId, {
      title: "",
      body: "",
      dataOnly: true,
      data: { type: "parental-sync" },
    });
  } catch {
    /* best-effort */
  }
}

function timeToString(d: Date): string {
  return d.toISOString().slice(11, 16); // HH:mm
}
function stringToTime(hhmm: string): Date {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) throw new AppError("ValidationError", "Horário deve estar no formato HH:mm.");
  return new Date(`1970-01-01T${hhmm}:00Z`);
}
function dateOnlyToString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function ensure(id: string | undefined): string {
  if (!id) throw new AppError("Unauthorized", "Usuário não autenticado.", 401);
  return id;
}

/** Manager (admin/guardian) membership + the child membership in a shared family. */
async function requireTutorChild(tutorUserId: string, childUserId: string) {
  const managerMemberships = await prisma.family_members.findMany({
    where: { UserId: tutorUserId, Role: { in: [...MANAGEMENT_ROLES] } },
  });
  if (managerMemberships.length === 0) {
    throw new AppError("Forbidden", "O usuário autenticado não possui permissão de tutor.", 403);
  }
  const familyIds = [...new Set(managerMemberships.map((m) => m.FamilyId))];
  const child = await prisma.family_members.findFirst({
    where: { FamilyId: { in: familyIds }, UserId: childUserId, Role: { in: [...CHILD_ROLES] } },
  });
  if (!child) {
    throw new AppError("Forbidden", "A criança informada não pertence a uma família gerenciada pelo tutor.", 403);
  }
  const manager = managerMemberships.find((m) => m.FamilyId === child.FamilyId)!;
  return { manager, child };
}

async function getOrCreatePolicy(childUserId: string, managedByUserId: string) {
  const existing = await prisma.child_device_policies.findFirst({ where: { ChildUserId: childUserId } });
  if (existing) return existing;
  // Child mode should protect by default — a fresh policy comes enabled so the
  // child device starts enforcing (daily limit + prompts the Accessibility
  // permission) instead of doing nothing until the guardian flips a toggle.
  return prisma.child_device_policies.create({
    data: {
      Id: randomUUID(),
      ChildUserId: childUserId,
      ManagedByUserId: managedByUserId,
      DailyScreenTimeLimitMinutes: 120,
      IsEnabled: true,
      CreatedAt: new Date(),
    },
  });
}

interface PolicyRow {
  Id: string;
  ChildUserId: string;
  ManagedByUserId: string;
  DailyScreenTimeLimitMinutes: number;
  IsEnabled: boolean;
  BlockAppInstall: boolean;
  EntertainmentDailyLimitMinutes: number | null;
  CreatedAt: Date;
  UpdatedAt: Date | null;
  IsRemotelyPaused: boolean;
  BlockedWebsites: string | null;
}

function mapPolicy(p: PolicyRow) {
  return {
    id: p.Id,
    childUserId: p.ChildUserId,
    managedByUserId: p.ManagedByUserId,
    dailyScreenTimeLimitMinutes: p.DailyScreenTimeLimitMinutes,
    isEnabled: p.IsEnabled,
    blockAppInstall: p.BlockAppInstall,
    entertainmentDailyLimitMinutes: p.EntertainmentDailyLimitMinutes,
    isRemotelyPaused: p.IsRemotelyPaused,
    blockedWebsites: p.BlockedWebsites ? p.BlockedWebsites.split(",").filter(Boolean) : [],
    createdAt: p.CreatedAt.toISOString(),
    updatedAt: p.UpdatedAt?.toISOString() ?? null,
  };
}

/**
 * Pause state with lazy expiry: a timed pause stores its deadline in the
 * hidden PAUSE_SENTINEL rule; once it passes, the flag auto-clears here (on
 * the next read from either side) — no scheduler needed.
 */
async function resolvePause(policy: PolicyRow): Promise<{ isPaused: boolean; pausedUntil: string | null }> {
  if (!policy.IsRemotelyPaused) return { isPaused: false, pausedUntil: null };
  const sentinel = await prisma.app_rules.findFirst({
    where: { ChildDevicePolicyId: policy.Id, AppPackageName: PAUSE_SENTINEL },
  });
  if (sentinel) {
    const until = activeUntil(sentinel.AppCategory);
    if (until) return { isPaused: true, pausedUntil: until.toISOString() };
    if (decodeCategory(sentinel.AppCategory).until) {
      await prisma.child_device_policies.update({
        where: { Id: policy.Id },
        data: { IsRemotelyPaused: false, UpdatedAt: new Date() },
      });
      await prisma.app_rules.delete({ where: { Id: sentinel.Id } }).catch(() => {});
      return { isPaused: false, pausedUntil: null };
    }
  }
  return { isPaused: true, pausedUntil: null };
}

/** Policy DTO with the decoded (lazy-expired) pause state. */
async function mapPolicyFull(p: PolicyRow) {
  const pause = await resolvePause(p);
  return { ...mapPolicy(p), isRemotelyPaused: pause.isPaused, pausedUntil: pause.pausedUntil };
}

// ── Children ───────────────────────────────────────────────────────────────

export async function getChildren(userId: string) {
  const managed = await prisma.family_members.findMany({
    where: { UserId: userId, Role: { in: [...MANAGEMENT_ROLES] } },
    select: { FamilyId: true },
  });
  const familyIds = [...new Set(managed.map((m) => m.FamilyId))];
  if (familyIds.length === 0) return [];

  const children = await prisma.family_members.findMany({
    where: {
      FamilyId: { in: familyIds },
      UserId: { not: null },
      Role: { in: [...CHILD_ROLES] },
    },
    include: { users: { select: { Id: true, FullName: true, Email: true, AvatarUrl: true } } },
    orderBy: { JoinedAt: "asc" },
  });
  const filtered = children.filter((c) => c.UserId && c.UserId !== userId);
  const childUserIds = [...new Set(filtered.map((c) => c.UserId!))];
  const statuses = await prisma.child_device_statuses.findMany({ where: { ChildUserId: { in: childUserIds } } });
  const statusByUser = new Map(statuses.map((s) => [s.ChildUserId, s]));
  const connectedThreshold = Date.now() - 10 * 60_000;

  return filtered
    .map((c) => {
      const status = statusByUser.get(c.UserId!);
      return {
        memberId: c.Id,
        userId: c.UserId,
        fullName: c.users?.FullName ?? c.DisplayName,
        email: c.users?.Email ?? null,
        avatarUrl: c.users?.AvatarUrl ?? null,
        role: c.Role === ROLE.member ? "member" : "child",
        joinedAt: c.JoinedAt.toISOString(),
        isConnected: !!status && status.LastSeenAt.getTime() >= connectedThreshold,
        lastSeenAt: status?.LastSeenAt.toISOString() ?? null,
        hasUsageAccess: status?.HasUsageAccess ?? false,
        hasAccessibility: status?.HasAccessibility ?? false,
      };
    })
    .sort((a, b) => (a.fullName ?? "").localeCompare(b.fullName ?? ""));
}

// ── Policy ───────────────────────────────────────────────────────────────

export async function getPolicy(userId: string, childUserId: string) {
  if (userId === childUserId) {
    const existing = await prisma.child_device_policies.findFirst({ where: { ChildUserId: childUserId } });
    if (existing) return mapPolicyFull(existing);
    const managerId = await resolveDefaultManager(childUserId);
    return mapPolicyFull(await getOrCreatePolicy(childUserId, managerId));
  }
  const { manager } = await requireTutorChild(userId, childUserId);
  return mapPolicyFull(await getOrCreatePolicy(childUserId, manager.UserId!));
}

async function resolveDefaultManager(childUserId: string): Promise<string> {
  const childMemberships = await prisma.family_members.findMany({
    where: { UserId: childUserId, Role: { in: [...CHILD_ROLES] } },
    select: { FamilyId: true },
  });
  const familyIds = [...new Set(childMemberships.map((m) => m.FamilyId))];
  const tutor = await prisma.family_members.findFirst({
    where: { FamilyId: { in: familyIds }, UserId: { not: null }, Role: { in: [...MANAGEMENT_ROLES] } },
    orderBy: { JoinedAt: "asc" },
  });
  if (!tutor?.UserId) throw new AppError("ParentalManagerNotFound", "Nenhum tutor responsável foi encontrado.", 404);
  return tutor.UserId;
}

export interface UpsertPolicyInput {
  dailyScreenTimeLimitMinutes: number;
  isEnabled: boolean;
  blockAppInstall?: boolean;
  entertainmentDailyLimitMinutes?: number | null;
}

export async function upsertPolicy(userId: string, childUserId: string, input: UpsertPolicyInput) {
  if (input.dailyScreenTimeLimitMinutes <= 0) {
    throw new AppError("ValidationError", "O limite diário precisa ser maior que zero.");
  }
  await requireTutorChild(userId, childUserId);
  const policy = await getOrCreatePolicy(childUserId, userId);
  const updated = await prisma.child_device_policies.update({
    where: { Id: policy.Id },
    data: {
      ManagedByUserId: userId,
      DailyScreenTimeLimitMinutes: input.dailyScreenTimeLimitMinutes,
      IsEnabled: input.isEnabled,
      BlockAppInstall: input.blockAppInstall ?? policy.BlockAppInstall,
      EntertainmentDailyLimitMinutes: input.entertainmentDailyLimitMinutes ?? null,
      UpdatedAt: new Date(),
    },
  });
  emitToUser(childUserId, "PolicyUpdated", { childUserId });
  notifyChildPolicyChanged(childUserId);
  await writeAudit({ actorUserId: userId, action: "ParentalPolicyUpdated", sourceType: "Parental", targetUserId: childUserId, metadata: { dailyScreenTimeLimitMinutes: input.dailyScreenTimeLimitMinutes, isEnabled: input.isEnabled } });
  return mapPolicy(updated);
}

/** Pause/resume the child's screen now (real-time remote action). A pause may
 *  carry `durationMinutes` — it then auto-lifts when the deadline passes
 *  (deadline lives in the hidden PAUSE_SENTINEL rule; see resolvePause). */
export async function applyRemoteAction(
  userId: string,
  childUserId: string,
  action: string,
  durationMinutes?: number | null,
) {
  const normalized = action.trim().toLowerCase();
  if (normalized !== "pause" && normalized !== "resume") {
    throw new AppError("ValidationError", "Ação inválida. Use Pause ou Resume.");
  }
  await requireTutorChild(userId, childUserId);
  const policy = await getOrCreatePolicy(childUserId, userId);
  const paused = normalized === "pause";
  const now = new Date();
  const updated = await prisma.child_device_policies.update({
    where: { Id: policy.Id },
    data: {
      ManagedByUserId: userId,
      IsRemotelyPaused: paused,
      ...(paused ? { IsEnabled: true } : {}),
      UpdatedAt: now,
    },
  });

  const sentinel = await prisma.app_rules.findFirst({
    where: { ChildDevicePolicyId: policy.Id, AppPackageName: PAUSE_SENTINEL },
  });
  const until = paused && durationMinutes && durationMinutes > 0
    ? new Date(now.getTime() + durationMinutes * 60_000)
    : null;
  if (until) {
    if (sentinel) {
      await prisma.app_rules.update({
        where: { Id: sentinel.Id },
        data: { AppCategory: encodeCategory(null, until), UpdatedAt: now, UpdatedByUserId: userId },
      });
    } else {
      await prisma.app_rules.create({
        data: {
          Id: randomUUID(),
          ChildDevicePolicyId: policy.Id,
          AppPackageName: PAUSE_SENTINEL,
          AppDisplayName: PAUSE_SENTINEL,
          IsBlocked: false,
          DailyLimitMinutes: null,
          IsEmergencyAllowed: false,
          IsWhitelisted: false,
          AppCategory: encodeCategory(null, until),
          UpdatedAt: now,
          UpdatedByUserId: userId,
        },
      });
    }
  } else if (sentinel) {
    // Indefinite pause or resume: no deadline to keep around.
    await prisma.app_rules.delete({ where: { Id: sentinel.Id } }).catch(() => {});
  }

  emitToUser(childUserId, "PolicyUpdated", { childUserId, isRemotelyPaused: paused });
  notifyChildPolicyChanged(childUserId);
  return mapPolicyFull(updated);
}

function normalizeDomain(raw: string): string {
  let d = raw.trim().toLowerCase().replace("https://", "").replace("http://", "");
  const slash = d.indexOf("/");
  if (slash >= 0) d = d.slice(0, slash);
  if (d.startsWith("www.")) d = d.slice(4);
  return d;
}

/** Replace the child's blocked-website list (host-based, deduped, max 200). */
export async function upsertBlockedWebsites(userId: string, childUserId: string, domains: string[]) {
  await requireTutorChild(userId, childUserId);
  const policy = await getOrCreatePolicy(childUserId, userId);
  const clean = [...new Set((domains ?? []).map(normalizeDomain).filter((d) => d.length > 0))].slice(0, 200);
  const updated = await prisma.child_device_policies.update({
    where: { Id: policy.Id },
    data: {
      ManagedByUserId: userId,
      BlockedWebsites: clean.length === 0 ? null : clean.join(","),
      UpdatedAt: new Date(),
    },
  });
  notifyChildPolicyChanged(childUserId);
  return mapPolicy(updated);
}

/** Child device reports it's online + which OS permissions it has. */
export async function reportHeartbeat(
  userId: string,
  input: {
    hasUsageAccess: boolean;
    hasAccessibility: boolean;
    adminDisabled?: boolean;
    appVersion?: string;
    batteryLevel?: number;
  },
) {
  const existing = await prisma.child_device_statuses.findFirst({ where: { ChildUserId: userId } });
  const data = {
    LastSeenAt: new Date(),
    HasUsageAccess: input.hasUsageAccess,
    HasAccessibility: input.hasAccessibility,
    AppVersion: input.appVersion ?? existing?.AppVersion ?? null,
    ...(input.batteryLevel !== undefined ? { BatteryLevel: input.batteryLevel } : {}),
  };
  // Tamper alert: the AccessibilityService toggle flipped OFF since the last
  // heartbeat (child disabled it, or an OEM task killer did). The guardian
  // must know their shield is down — push + realtime, throttled so a flapping
  // service doesn't spam (in-memory; single container).
  if (existing?.HasAccessibility === true && !input.hasAccessibility) {
    void alertProtectionDisabled(userId);
  }
  // Uninstall protection turned off — the step that PRECEDES removing WardYou
  // entirely, so it gets its own (louder) alert rather than sharing the
  // accessibility one's throttle.
  if (input.adminDisabled) {
    void alertUninstallProtectionDisabled(userId);
  }
  if (existing) {
    await prisma.child_device_statuses.update({ where: { Id: existing.Id }, data });
  } else {
    await prisma.child_device_statuses.create({
      data: { Id: randomUUID(), ChildUserId: userId, BatteryLevel: input.batteryLevel ?? null, ...data },
    });
  }

  // Also refresh the child's presence in the family lists — the family map/
  // members derive online/offline from `family_members.LastSeenAt`, which the
  // heartbeat must bump too or the child always shows offline to the guardian.
  await prisma.family_members.updateMany({
    where: { UserId: userId, Status: STATUS.active },
    data: {
      LastSeenAt: new Date(),
      ...(input.batteryLevel !== undefined ? { BatteryLevel: input.batteryLevel } : {}),
    },
  });
}

const protectionAlertLog = new Map<string, number>();
const PROTECTION_ALERT_THROTTLE_MS = 30 * 60_000;

/**
 * The child switched off the device-admin that blocks uninstalling WardYou. The
 * device is one tap away from losing protection entirely, so this always goes
 * out (no throttle — the flag is one-shot on the device anyway).
 */
async function alertUninstallProtectionDisabled(childUserId: string) {
  try {
    const tutors = await getTutorsForChild(childUserId);
    if (tutors.length === 0) return;
    const childName = await displayName(childUserId);
    emitToUsers(tutors, "ChildProtectionChanged", { childUserId, active: false, reason: "adminDisabled" });
    pushToUsers(tutors, {
      title: "⚠️ Proteção contra desinstalação removida",
      body: `${childName} desativou a proteção do WardYou. O app pode ser desinstalado — verifique o aparelho.`,
      data: { type: "protection-off", childUserId },
      highPriority: true,
    });
    await writeAudit({
      actorUserId: childUserId,
      action: "ParentalProtectionDisabled",
      sourceType: "Parental",
      targetUserId: childUserId,
      metadata: { reason: "deviceAdminDisabled" },
    });
  } catch {
    /* best-effort — never break the heartbeat */
  }
}

async function alertProtectionDisabled(childUserId: string) {
  try {
    const policy = await prisma.child_device_policies.findFirst({ where: { ChildUserId: childUserId } });
    if (!policy?.IsEnabled) return; // no active protection → nothing to alert
    const last = protectionAlertLog.get(childUserId);
    const now = Date.now();
    if (last && now - last < PROTECTION_ALERT_THROTTLE_MS) return;
    protectionAlertLog.set(childUserId, now);

    const tutors = await getTutorsForChild(childUserId);
    if (tutors.length === 0) return;
    const childName = await displayName(childUserId);
    emitToUsers(tutors, "ChildProtectionChanged", { childUserId, active: false });
    pushToUsers(tutors, {
      title: "⚠️ Proteção desativada",
      body: `A proteção do aparelho de ${childName} foi desativada. Toque para verificar.`,
      data: { type: "protection-off", childUserId },
      highPriority: true,
    });
    await writeAudit({
      actorUserId: childUserId,
      action: "ParentalProtectionDisabled",
      sourceType: "Parental",
      targetUserId: childUserId,
    });
  } catch {
    /* best-effort — never break the heartbeat */
  }
}

/**
 * Everything the child's own device needs to render its home screen in one
 * call: today's limit vs. usage, remote pause, extra time granted/pending,
 * tonight's sleep window and how much is blocked. `hasPolicy: false` means no
 * guardian set up parental controls yet — the child app shows a neutral state.
 */
export async function getMyStatus(userId: string) {
  let policy = await prisma.child_device_policies.findFirst({ where: { ChildUserId: userId } });
  // If this user is a child in some family but no policy exists yet, create one
  // (enabled by default) so the device starts enforcing immediately instead of
  // waiting for a guardian to open the policy screen first.
  if (!policy) {
    const childMembership = await prisma.family_members.findFirst({
      where: { UserId: userId, Role: { in: [...CHILD_ROLES] }, Status: STATUS.active },
      select: { Id: true },
    });
    if (!childMembership) return { hasPolicy: false as const };
    try {
      const managerId = await resolveDefaultManager(userId);
      policy = await getOrCreatePolicy(userId, managerId);
    } catch {
      return { hasPolicy: false as const };
    }
  }

  const today = new Date(`${dateOnlyToString(new Date())}T00:00:00Z`);
  const now = new Date();

  const [usage, extra, pending, sleep, blockedApps] = await Promise.all([
    prisma.app_usage_summaries.aggregate({
      _sum: { UsedMinutes: true },
      where: { ChildUserId: userId, UsageDate: today },
    }),
    prisma.extra_time_requests.aggregate({
      _sum: { RequestedMinutes: true },
      where: { ChildUserId: userId, Status: EXTRA_STATUS.Approved, RespondedAt: { gte: today } },
    }),
    prisma.extra_time_requests.findFirst({
      where: { ChildUserId: userId, Status: EXTRA_STATUS.Pending, ExpiresAt: { gt: now } },
    }),
    prisma.sleep_schedules.findFirst({ where: { ChildDevicePolicyId: policy.Id } }),
    prisma.app_rules.count({ where: { ChildDevicePolicyId: policy.Id, IsBlocked: true } }),
  ]);

  const usedMinutesToday = usage._sum.UsedMinutes ?? 0;
  const extraMinutesToday = extra._sum.RequestedMinutes ?? 0;
  const allowance = policy.DailyScreenTimeLimitMinutes + extraMinutesToday;

  return {
    hasPolicy: true as const,
    isEnabled: policy.IsEnabled,
    isPaused: (await resolvePause(policy)).isPaused,
    dailyLimitMinutes: policy.DailyScreenTimeLimitMinutes,
    extraMinutesToday,
    usedMinutesToday,
    remainingMinutes: Math.max(0, allowance - usedMinutesToday),
    blockedAppsCount: blockedApps,
    blockedWebsitesCount: policy.BlockedWebsites ? policy.BlockedWebsites.split(",").filter(Boolean).length : 0,
    pendingExtraRequest: pending ? mapExtraTime(pending) : null,
    sleep: sleep
      ? {
          isEnabled: sleep.IsEnabled,
          startTime: timeToString(sleep.StartTime),
          endTime: timeToString(sleep.EndTime),
          daysOfWeek: sleep.DaysOfWeek,
        }
      : null,
  };
}

// ── App rules ───────────────────────────────────────────────────────────

interface AppRuleRow {
  Id: string;
  ChildDevicePolicyId: string;
  AppPackageName: string;
  AppDisplayName: string;
  IsBlocked: boolean;
  DailyLimitMinutes: number | null;
  IsEmergencyAllowed: boolean;
  IsWhitelisted: boolean;
  AppCategory: string;
  UpdatedAt: Date | null;
  UpdatedByUserId: string | null;
}

function mapRule(r: AppRuleRow, childUserId: string) {
  const { category } = decodeCategory(r.AppCategory);
  const until = activeUntil(r.AppCategory);
  return {
    id: r.Id,
    childDevicePolicyId: r.ChildDevicePolicyId,
    appPackageName: r.AppPackageName,
    appDisplayName: r.AppDisplayName,
    isBlocked: r.IsBlocked,
    dailyLimitMinutes: r.DailyLimitMinutes,
    isEmergencyAllowed: r.IsEmergencyAllowed,
    isWhitelisted: r.IsWhitelisted,
    appCategory: category,
    /** Temporary allow: usable until this instant even if not whitelisted. */
    allowedUntil: until ? until.toISOString() : null,
    /** False = the device reported it installed but no guardian decided yet. */
    configured: !!r.UpdatedByUserId && r.UpdatedByUserId !== childUserId,
    updatedAt: r.UpdatedAt?.toISOString() ?? null,
    updatedByUserId: r.UpdatedByUserId,
  };
}

export async function getAppRules(userId: string, childUserId: string) {
  let policyId: string;
  if (userId === childUserId) {
    const policy = await prisma.child_device_policies.findFirst({ where: { ChildUserId: childUserId } });
    if (!policy) throw new AppError("ParentalPolicyNotFound", "Nenhuma política parental foi encontrada.", 404);
    policyId = policy.Id;
  } else {
    const { manager } = await requireTutorChild(userId, childUserId);
    policyId = (await getOrCreatePolicy(childUserId, manager.UserId!)).Id;
  }
  const rules = await prisma.app_rules.findMany({
    where: { ChildDevicePolicyId: policyId },
    orderBy: { AppDisplayName: "asc" },
  });
  return rules
    .filter((r) => !r.AppPackageName.startsWith(SENTINEL_PREFIX))
    .map((r) => mapRule(r, childUserId));
}

export interface AppRuleInput {
  appPackageName: string;
  appDisplayName?: string;
  isBlocked: boolean;
  dailyLimitMinutes?: number | null;
  isEmergencyAllowed?: boolean;
  isWhitelisted?: boolean;
  appCategory?: string;
}

export async function upsertAppRules(userId: string, childUserId: string, rules: AppRuleInput[]) {
  const { manager } = await requireTutorChild(userId, childUserId);
  const policy = await getOrCreatePolicy(childUserId, manager.UserId!);

  for (const rule of rules) {
    if (!rule.appPackageName?.trim()) throw new AppError("ValidationError", "O pacote do app é obrigatório.");
    if (rule.dailyLimitMinutes != null && rule.dailyLimitMinutes < 0) {
      throw new AppError("ValidationError", "O limite diário por app não pode ser negativo.");
    }
    if (rule.appPackageName.toLowerCase().includes(PROTECTED_APP) && rule.isBlocked) {
      throw new AppError("ValidationError", "O WardYou nunca pode ser bloqueado.");
    }
    if (rule.isBlocked && rule.isEmergencyAllowed) {
      throw new AppError("ValidationError", "Apps marcados como emergência não podem ser bloqueados.");
    }
  }

  const existing = await prisma.app_rules.findMany({ where: { ChildDevicePolicyId: policy.Id } });
  const incoming = new Set(rules.map((r) => r.appPackageName.trim().toLowerCase()));
  // Sentinel rows (timed pause, etc.) are internal — the guardian's payload
  // never contains them, so they must survive the replace-set semantics.
  const toDelete = existing.filter(
    (e) => !incoming.has(e.AppPackageName.toLowerCase()) && !e.AppPackageName.startsWith(SENTINEL_PREFIX),
  );
  if (toDelete.length > 0) {
    await prisma.app_rules.deleteMany({ where: { Id: { in: toDelete.map((e) => e.Id) } } });
  }

  const byPackage = new Map(existing.map((e) => [e.AppPackageName.toLowerCase(), e]));
  const now = new Date();
  for (const rule of rules) {
    const pkg = rule.appPackageName.trim();
    const found = byPackage.get(pkg.toLowerCase());
    // A full-set save must not silently drop an active temporary allow — the
    // expiry rides in AppCategory, which the guardian client round-trips
    // decoded (plain category). Re-encode the surviving deadline.
    const keepUntil = found ? activeUntil(found.AppCategory, now) : null;
    const data = {
      AppDisplayName: rule.appDisplayName?.trim() || pkg,
      IsBlocked: rule.isBlocked,
      DailyLimitMinutes: rule.dailyLimitMinutes ?? null,
      IsEmergencyAllowed: rule.isEmergencyAllowed ?? false,
      IsWhitelisted: rule.isWhitelisted ?? false,
      AppCategory: encodeCategory(rule.appCategory, keepUntil),
      UpdatedAt: now,
      UpdatedByUserId: userId,
    };
    if (found) {
      await prisma.app_rules.update({ where: { Id: found.Id }, data });
    } else {
      await prisma.app_rules.create({
        data: { Id: randomUUID(), ChildDevicePolicyId: policy.Id, AppPackageName: pkg, ...data },
      });
    }
  }
  notifyChildPolicyChanged(childUserId);
  return getAppRules(userId, childUserId);
}

/**
 * Kids360-style temporary allow: let one app be used for the next N hours,
 * without touching its permanent whitelist state. `hours <= 0` clears an
 * active temporary allow. The expiry is enforced by the child device
 * (enforcementLogic) and auto-decays — no scheduler.
 */
export async function temporaryAllowApp(
  userId: string,
  childUserId: string,
  appPackageName: string,
  hours: number,
) {
  const { manager } = await requireTutorChild(userId, childUserId);
  const policy = await getOrCreatePolicy(childUserId, manager.UserId!);
  const pkg = appPackageName.trim();
  if (!pkg || pkg.startsWith(SENTINEL_PREFIX)) {
    throw new AppError("ValidationError", "Pacote de app inválido.");
  }
  const now = new Date();
  const until = hours > 0 ? new Date(now.getTime() + hours * 3_600_000) : null;

  const found = await prisma.app_rules.findFirst({
    where: { ChildDevicePolicyId: policy.Id, AppPackageName: { equals: pkg, mode: "insensitive" } },
  });
  const row = found
    ? await prisma.app_rules.update({
        where: { Id: found.Id },
        data: {
          IsBlocked: false,
          AppCategory: encodeCategory(found.AppCategory, until),
          UpdatedAt: now,
          UpdatedByUserId: userId,
        },
      })
    : await prisma.app_rules.create({
        data: {
          Id: randomUUID(),
          ChildDevicePolicyId: policy.Id,
          AppPackageName: pkg,
          AppDisplayName: pkg,
          IsBlocked: false,
          DailyLimitMinutes: null,
          IsEmergencyAllowed: false,
          IsWhitelisted: false,
          AppCategory: encodeCategory(null, until),
          UpdatedAt: now,
          UpdatedByUserId: userId,
        },
      });

  await writeAudit({
    actorUserId: userId,
    action: until ? "ParentalTemporaryAllow" : "ParentalTemporaryAllowCleared",
    sourceType: "Parental",
    targetUserId: childUserId,
    metadata: { appPackageName: pkg, hours },
  });
  notifyChildPolicyChanged(childUserId);
  return mapRule(row, childUserId);
}

/**
 * The child's own device reports its installed apps so the guardian sees the
 * real list with **exact package names**. Ensures an app_rule exists for each
 * (default: not allowed → firewall blocks it) without ever touching rules that
 * already exist — so the guardian's allow/time-limit choices are preserved.
 */
export async function reportInstalledApps(userId: string, apps: { packageName: string; label?: string }[]) {
  let policy = await prisma.child_device_policies.findFirst({ where: { ChildUserId: userId } });
  if (!policy) {
    try {
      policy = await getOrCreatePolicy(userId, await resolveDefaultManager(userId));
    } catch {
      return { added: 0 };
    }
  }
  const existing = await prisma.app_rules.findMany({
    where: { ChildDevicePolicyId: policy.Id },
    select: { AppPackageName: true },
  });
  const known = new Set(existing.map((e) => e.AppPackageName.toLowerCase()));
  const now = new Date();
  const toCreate: {
    Id: string;
    ChildDevicePolicyId: string;
    AppPackageName: string;
    AppDisplayName: string;
    IsBlocked: boolean;
    DailyLimitMinutes: number | null;
    IsEmergencyAllowed: boolean;
    IsWhitelisted: boolean;
    AppCategory: string;
    UpdatedAt: Date;
    UpdatedByUserId: string;
  }[] = [];
  for (const app of apps) {
    const pkg = app.packageName?.trim();
    if (!pkg || pkg.toLowerCase().includes(PROTECTED_APP)) continue;
    if (known.has(pkg.toLowerCase())) continue;
    known.add(pkg.toLowerCase());
    toCreate.push({
      Id: randomUUID(),
      ChildDevicePolicyId: policy.Id,
      AppPackageName: pkg,
      AppDisplayName: app.label?.trim() || pkg,
      IsBlocked: false,
      DailyLimitMinutes: null,
      IsEmergencyAllowed: false,
      IsWhitelisted: false,
      AppCategory: "Other",
      UpdatedAt: now,
      UpdatedByUserId: userId,
    });
  }
  if (toCreate.length > 0) await prisma.app_rules.createMany({ data: toCreate });
  return { added: toCreate.length };
}

// ── Extra time ──────────────────────────────────────────────────────────

interface ExtraTimeRow {
  Id: string;
  ChildUserId: string;
  RequestedToUserId: string;
  RequestedMinutes: number;
  Status: number;
  RequestedAt: Date;
  ExpiresAt: Date;
  RespondedAt: Date | null;
  RespondedByUserId: string | null;
}

function mapExtraTime(r: ExtraTimeRow) {
  return {
    id: r.Id,
    childUserId: r.ChildUserId,
    requestedToUserId: r.RequestedToUserId,
    requestedMinutes: r.RequestedMinutes,
    status: EXTRA_STATUS_NAMES[r.Status] ?? "Pending",
    requestedAt: r.RequestedAt.toISOString(),
    expiresAt: r.ExpiresAt.toISOString(),
    respondedAt: r.RespondedAt?.toISOString() ?? null,
    respondedByUserId: r.RespondedByUserId,
  };
}

export async function requestExtraTime(userId: string, childUserId: string, requestedMinutes: number) {
  if (childUserId !== userId) {
    throw new AppError("Forbidden", "Você só pode solicitar tempo extra para si mesmo.", 403);
  }
  if (requestedMinutes <= 0) throw new AppError("ValidationError", "O tempo solicitado deve ser maior que zero.");

  const policy = await prisma.child_device_policies.findFirst({ where: { ChildUserId: childUserId } });
  if (!policy) throw new AppError("ParentalPolicyNotFound", "Nenhuma política parental foi encontrada.", 404);

  const tutors = await getTutorsForChild(childUserId);
  if (tutors.length === 0) throw new AppError("ParentalManagerNotFound", "Nenhum tutor responsável foi encontrado.", 404);

  const now = new Date();
  const existing = await prisma.extra_time_requests.findFirst({
    where: { ChildUserId: childUserId, Status: EXTRA_STATUS.Pending, ExpiresAt: { gt: now } },
  });
  if (existing) return mapExtraTime(existing);

  const requestedTo = tutors.find((t) => t === policy.ManagedByUserId) ?? tutors[0];
  const created = await prisma.extra_time_requests.create({
    data: {
      Id: randomUUID(),
      ChildUserId: childUserId,
      RequestedToUserId: requestedTo,
      RequestedMinutes: requestedMinutes,
      Status: EXTRA_STATUS.Pending,
      RequestedAt: now,
      ExpiresAt: new Date(now.getTime() + 30 * 60_000),
      Source: EXTRA_SOURCE.ChildRequest,
    },
  });
  emitToUsers(tutors, "ExtraTimeRequested", { id: created.Id, childUserId, requestedMinutes });
  pushToUsers(tutors, {
    title: "Pedido de mais tempo",
    body: `${await displayName(childUserId)} pediu +${requestedMinutes} min de tela.`,
    data: { type: "extra-time", childUserId },
  });
  return mapExtraTime(created);
}

// Child asked to use a blocked app ("blocked" screen). No DB table for this in
// the frozen legacy schema — it's a nudge: push + realtime to the tutors, who
// then allow the app (or don't) on the child's apps screen. In-memory throttle
// so a kid hammering the button doesn't spam the guardian (single container).
const appAccessRequestLog = new Map<string, number>();
const APP_ACCESS_THROTTLE_MS = 5 * 60_000;

export async function requestAppAccess(userId: string, packageName: string, label?: string) {
  const tutors = await getTutorsForChild(userId);
  if (tutors.length === 0) throw new AppError("ParentalManagerNotFound", "Nenhum tutor responsável foi encontrado.", 404);

  const throttleKey = `${userId}:${packageName.toLowerCase()}`;
  const last = appAccessRequestLog.get(throttleKey);
  const now = Date.now();
  if (last && now - last < APP_ACCESS_THROTTLE_MS) return { sent: true, throttled: true };
  appAccessRequestLog.set(throttleKey, now);

  const appName = label?.trim() || packageName;
  const childName = await displayName(userId);
  emitToUsers(tutors, "AppAccessRequested", { childUserId: userId, packageName, label: appName });
  pushToUsers(tutors, {
    title: "Pedido de liberação de app",
    body: `${childName} pediu para usar ${appName}.`,
    data: { type: "app-access", childUserId: userId, packageName },
  });
  await writeAudit({
    actorUserId: userId,
    action: "ParentalAppAccessRequested",
    sourceType: "Parental",
    metadata: { packageName, label: appName },
  });
  return { sent: true, throttled: false };
}

async function getTutorsForChild(childUserId: string): Promise<string[]> {
  const childMemberships = await prisma.family_members.findMany({
    where: { UserId: childUserId, Role: { in: [...CHILD_ROLES] } },
    select: { FamilyId: true },
  });
  const familyIds = [...new Set(childMemberships.map((m) => m.FamilyId))];
  if (familyIds.length === 0) return [];
  const tutors = await prisma.family_members.findMany({
    where: { FamilyId: { in: familyIds }, UserId: { not: null }, Role: { in: [...MANAGEMENT_ROLES] } },
    orderBy: { JoinedAt: "asc" },
    select: { UserId: true },
  });
  return [...new Set(tutors.map((t) => t.UserId!).filter(Boolean))];
}

export async function getPendingExtraTime(userId: string) {
  const childIds = await getManagedChildIds(userId);
  if (childIds.length === 0) return [];
  // Expire stale pending requests first.
  await prisma.extra_time_requests.updateMany({
    where: { ChildUserId: { in: childIds }, Status: EXTRA_STATUS.Pending, ExpiresAt: { lte: new Date() } },
    data: { Status: EXTRA_STATUS.Expired, RespondedAt: new Date() },
  });
  const rows = await prisma.extra_time_requests.findMany({
    where: { ChildUserId: { in: childIds }, Status: EXTRA_STATUS.Pending },
    orderBy: { RequestedAt: "desc" },
  });
  return rows.map(mapExtraTime);
}

/**
 * Everything awaiting the guardian's decision for ONE child, in a single call:
 * extra-time requests (a real table) and "let me use this app" requests from
 * the blocked screen. The latter has no table — the schema is owned by the
 * legacy DB — so it lives in `audit_logs`: action 46 = requested, action 48 =
 * resolved. A request is pending while its newest 46 has no 48 after it. Same
 * schema-frozen trick already used for elder medication adherence.
 */
const APP_ACCESS_WINDOW_MS = 24 * 60 * 60_000;

export async function getChildPendingRequests(userId: string, childUserId: string) {
  await requireTutorChild(userId, childUserId);
  const now = new Date();

  await prisma.extra_time_requests.updateMany({
    where: { ChildUserId: childUserId, Status: EXTRA_STATUS.Pending, ExpiresAt: { lte: now } },
    data: { Status: EXTRA_STATUS.Expired, RespondedAt: now },
  });
  const extraRows = await prisma.extra_time_requests.findMany({
    where: { ChildUserId: childUserId, Status: EXTRA_STATUS.Pending },
    orderBy: { RequestedAt: "desc" },
  });

  const since = new Date(now.getTime() - APP_ACCESS_WINDOW_MS);
  const logs = await prisma.audit_logs.findMany({
    where: {
      ActorUserId: childUserId,
      Action: { in: [AUDIT_ACTION.ParentalAppAccessRequested, AUDIT_ACTION.ParentalAppAccessResolved] },
      CreatedAt: { gte: since },
    },
    orderBy: { CreatedAt: "asc" },
    select: { Action: true, CreatedAt: true, MetadataJson: true },
  });

  // Replay the log per package: a "requested" opens it, a "resolved" closes it.
  const open = new Map<string, { packageName: string; label: string; requestedAt: string }>();
  for (const row of logs) {
    const meta = (row.MetadataJson ?? {}) as { packageName?: string; label?: string };
    const pkg = meta.packageName;
    if (!pkg) continue;
    if (row.Action === AUDIT_ACTION.ParentalAppAccessRequested) {
      open.set(pkg, { packageName: pkg, label: meta.label || pkg, requestedAt: row.CreatedAt.toISOString() });
    } else {
      open.delete(pkg);
    }
  }

  return {
    extraTime: extraRows.map(mapExtraTime),
    appAccess: [...open.values()].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)),
  };
}

/**
 * Guardian answers an app-access request. Approving whitelists the app (or
 * grants a temporary window when `hours` is set — the same "liberar por N
 * horas" valve); either way the request stops being pending and the child's
 * device re-syncs within seconds.
 */
export async function decideAppAccess(
  userId: string,
  childUserId: string,
  input: { packageName: string; approve: boolean; hours?: number },
) {
  await requireTutorChild(userId, childUserId);
  const pkg = input.packageName.trim();
  if (!pkg) throw new AppError("ValidationError", "Pacote inválido.");

  if (input.approve) {
    if (input.hours && input.hours > 0) {
      await temporaryAllowApp(userId, childUserId, pkg, input.hours);
    } else {
      const { manager } = await requireTutorChild(userId, childUserId);
      const policy = await getOrCreatePolicy(childUserId, manager.UserId!);
      const rule = await prisma.app_rules.findFirst({
        where: { ChildDevicePolicyId: policy.Id, AppPackageName: pkg },
      });
      if (rule) {
        await prisma.app_rules.update({
          where: { Id: rule.Id },
          data: { IsWhitelisted: true, IsBlocked: false, UpdatedAt: new Date(), UpdatedByUserId: userId },
        });
      } else {
        await prisma.app_rules.create({
          data: {
            Id: randomUUID(),
            ChildDevicePolicyId: policy.Id,
            AppPackageName: pkg,
            AppDisplayName: pkg,
            IsBlocked: false,
            DailyLimitMinutes: null,
            IsEmergencyAllowed: false,
            IsWhitelisted: true,
            AppCategory: "Other",
            UpdatedAt: new Date(),
            UpdatedByUserId: userId,
          },
        });
      }
      notifyChildPolicyChanged(childUserId);
    }
  }

  // Closes the pending item either way (see getChildPendingRequests).
  await writeAudit({
    actorUserId: childUserId,
    action: "ParentalAppAccessResolved",
    sourceType: "Parental",
    targetUserId: childUserId,
    metadata: { packageName: pkg, approved: input.approve, byUserId: userId, hours: input.hours ?? null },
  });

  emitToUser(childUserId, "AppAccessDecided", { packageName: pkg, approved: input.approve });
  pushToUser(childUserId, {
    title: input.approve ? "App liberado" : "Pedido não aprovado",
    body: input.approve
      ? `Seus responsáveis liberaram ${pkg}.`
      : `Seus responsáveis não liberaram ${pkg} agora.`,
    data: { type: "app-access-decided", packageName: pkg },
  });
  return { ok: true };
}

async function getManagedChildIds(userId: string): Promise<string[]> {
  const managed = await prisma.family_members.findMany({
    where: { UserId: userId, Role: { in: [...MANAGEMENT_ROLES] } },
    select: { FamilyId: true },
  });
  const familyIds = [...new Set(managed.map((m) => m.FamilyId))];
  if (familyIds.length === 0) return [];
  const children = await prisma.family_members.findMany({
    where: { FamilyId: { in: familyIds }, UserId: { not: null }, Role: { in: [...CHILD_ROLES] } },
    select: { UserId: true },
  });
  return [...new Set(children.map((c) => c.UserId!).filter((id) => id && id !== userId))];
}

async function decideExtraTime(userId: string, requestId: string, status: number) {
  const request = await prisma.extra_time_requests.findFirst({ where: { Id: requestId } });
  if (!request) throw new AppError("ExtraTimeRequestNotFound", "O pedido de tempo extra não foi encontrado.", 404);
  await requireTutorChild(userId, request.ChildUserId);
  if (request.Status !== EXTRA_STATUS.Pending) {
    throw new AppError("ExtraTimeRequestAlreadyResponded", "Este pedido já foi respondido.", 409);
  }
  const now = new Date();
  if (request.ExpiresAt <= now) {
    await prisma.extra_time_requests.update({
      where: { Id: requestId },
      data: { Status: EXTRA_STATUS.Expired, RespondedAt: now },
    });
    throw new AppError("ExtraTimeRequestExpired", "O pedido de tempo extra já expirou.", 409);
  }
  const updated = await prisma.extra_time_requests.update({
    where: { Id: requestId },
    data: { Status: status, RespondedAt: now, RespondedByUserId: userId },
  });
  emitToUser(request.ChildUserId, "ExtraTimeDecided", { id: requestId, status: EXTRA_STATUS_NAMES[status] });
  pushToUser(request.ChildUserId, {
    title: status === EXTRA_STATUS.Approved ? "Tempo extra aprovado" : "Pedido recusado",
    body:
      status === EXTRA_STATUS.Approved
        ? `Você ganhou +${request.RequestedMinutes} min de tela.`
        : "Seu pedido de mais tempo foi recusado.",
    data: { type: "extra-time-decided", status: EXTRA_STATUS_NAMES[status] },
  });
  await writeAudit({ actorUserId: userId, action: status === EXTRA_STATUS.Approved ? "ExtraTimeApproved" : "ExtraTimeRejected", sourceType: "Parental", targetUserId: request.ChildUserId, metadata: { requestId, minutes: request.RequestedMinutes } });
  return mapExtraTime(updated);
}

export const approveExtraTime = (userId: string, requestId: string) =>
  decideExtraTime(userId, requestId, EXTRA_STATUS.Approved);
export const rejectExtraTime = (userId: string, requestId: string) =>
  decideExtraTime(userId, requestId, EXTRA_STATUS.Rejected);

// ── Usage summary ─────────────────────────────────────────────────────────

export interface UsageSummaryInput {
  childUserId: string;
  deviceId: string;
  usageDate: string; // YYYY-MM-DD
  items: { appPackageName: string; appDisplayName?: string; usedMinutes: number }[];
}

export async function saveUsageSummary(userId: string, input: UsageSummaryInput) {
  if (input.childUserId !== userId) {
    throw new AppError("Forbidden", "Você só pode enviar o resumo de uso do próprio usuário.", 403);
  }
  const device = await prisma.devices.findFirst({
    where: { Id: input.deviceId, UserId: userId, IsActive: true },
    select: { Id: true },
  });
  if (!device) throw new AppError("Forbidden", "O dispositivo informado não pertence ao usuário.", 403);

  for (const item of input.items) {
    if (!item.appPackageName?.trim()) throw new AppError("ValidationError", "O pacote do app é obrigatório.");
    if (item.usedMinutes < 0) throw new AppError("ValidationError", "O uso em minutos não pode ser negativo.");
  }

  const usageDate = new Date(`${input.usageDate}T00:00:00Z`);
  await prisma.app_usage_summaries.deleteMany({
    where: { ChildUserId: input.childUserId, DeviceId: input.deviceId, UsageDate: usageDate },
  });
  const now = new Date();
  if (input.items.length > 0) {
    await prisma.app_usage_summaries.createMany({
      data: input.items.map((item) => ({
        Id: randomUUID(),
        ChildUserId: input.childUserId,
        DeviceId: input.deviceId,
        UsageDate: usageDate,
        AppPackageName: item.appPackageName.trim(),
        AppDisplayName: item.appDisplayName?.trim() || item.appPackageName.trim(),
        UsedMinutes: item.usedMinutes,
        CreatedAt: now,
        UpdatedAt: now,
      })),
    });
  }
}

export async function getUsageSummary(userId: string, childUserId: string, date?: string) {
  if (userId !== childUserId) await requireTutorChild(userId, childUserId);
  const target = date ? new Date(`${date}T00:00:00Z`) : new Date(`${dateOnlyToString(new Date())}T00:00:00Z`);
  const items = await prisma.app_usage_summaries.findMany({
    where: { ChildUserId: childUserId, UsageDate: target },
    orderBy: [{ UsedMinutes: "desc" }, { AppDisplayName: "asc" }],
    select: { AppPackageName: true, AppDisplayName: true, UsedMinutes: true },
  });
  return {
    childUserId,
    usageDate: dateOnlyToString(target),
    totalMinutes: items.reduce((sum, i) => sum + i.UsedMinutes, 0),
    items: items.map((i) => ({
      appPackageName: i.AppPackageName,
      appDisplayName: i.AppDisplayName,
      usedMinutes: i.UsedMinutes,
    })),
  };
}

/** Per-day totals (filling gaps with 0) + top apps over a window of days. */
export async function getUsageOverview(userId: string, childUserId: string, days: number) {
  if (userId !== childUserId) await requireTutorChild(userId, childUserId);
  const windowDays = Math.min(Math.max(days, 1), 31);
  const today = new Date(`${dateOnlyToString(new Date())}T00:00:00Z`);
  const first = new Date(today.getTime() - (windowDays - 1) * 24 * 60 * 60_000);

  const rows = await prisma.app_usage_summaries.findMany({
    where: { ChildUserId: childUserId, UsageDate: { gte: first, lte: today } },
    select: { UsageDate: true, AppPackageName: true, AppDisplayName: true, UsedMinutes: true },
  });

  const totalsByDate = new Map<string, number>();
  for (const r of rows) {
    const k = dateOnlyToString(r.UsageDate);
    totalsByDate.set(k, (totalsByDate.get(k) ?? 0) + r.UsedMinutes);
  }
  const dayList: { date: string; totalMinutes: number }[] = [];
  for (let i = 0; i < windowDays; i++) {
    const d = dateOnlyToString(new Date(first.getTime() + i * 24 * 60 * 60_000));
    dayList.push({ date: d, totalMinutes: totalsByDate.get(d) ?? 0 });
  }

  const byApp = new Map<string, { display: string; total: number }>();
  for (const r of rows) {
    const cur = byApp.get(r.AppPackageName) ?? { display: r.AppDisplayName || r.AppPackageName, total: 0 };
    cur.total += r.UsedMinutes;
    byApp.set(r.AppPackageName, cur);
  }
  const topApps = [...byApp.entries()]
    .map(([pkg, v]) => ({ appPackageName: pkg, appDisplayName: v.display, totalMinutes: v.total }))
    .filter((a) => a.totalMinutes > 0)
    .sort((a, b) => b.totalMinutes - a.totalMinutes)
    .slice(0, 8);

  const windowTotal = dayList.reduce((s, d) => s + d.totalMinutes, 0);
  return {
    todayMinutes: totalsByDate.get(dateOnlyToString(today)) ?? 0,
    windowTotalMinutes: windowTotal,
    dailyAverageMinutes: Math.round(windowTotal / windowDays),
    days: dayList,
    topApps,
  };
}

// ── Sleep schedule ─────────────────────────────────────────────────────────

interface SleepRow {
  Id: string;
  ChildDevicePolicyId: string;
  IsEnabled: boolean;
  StartTime: Date;
  EndTime: Date;
  DaysOfWeek: number;
  UpdatedAt: Date;
}

function mapSleep(s: SleepRow) {
  return {
    id: s.Id,
    childDevicePolicyId: s.ChildDevicePolicyId,
    isEnabled: s.IsEnabled,
    startTime: timeToString(s.StartTime),
    endTime: timeToString(s.EndTime),
    daysOfWeek: s.DaysOfWeek,
    updatedAt: s.UpdatedAt.toISOString(),
  };
}

export async function getSleepSchedule(userId: string, childUserId: string) {
  if (userId !== childUserId) await requireTutorChild(userId, childUserId);
  const policy = await prisma.child_device_policies.findFirst({ where: { ChildUserId: childUserId } });
  if (!policy) throw new AppError("ParentalPolicyNotFound", "Nenhuma política parental foi encontrada.", 404);
  const schedule = await prisma.sleep_schedules.findFirst({ where: { ChildDevicePolicyId: policy.Id } });
  if (!schedule) {
    return {
      id: null,
      childDevicePolicyId: policy.Id,
      isEnabled: false,
      startTime: "21:00",
      endTime: "07:00",
      daysOfWeek: 0b0111_1111,
      updatedAt: policy.CreatedAt.toISOString(),
    };
  }
  return mapSleep(schedule);
}

export interface UpsertSleepInput {
  isEnabled: boolean;
  startTime: string;
  endTime: string;
  daysOfWeek: number;
}

export async function upsertSleepSchedule(userId: string, childUserId: string, input: UpsertSleepInput) {
  const { manager } = await requireTutorChild(userId, childUserId);
  const policy = await getOrCreatePolicy(childUserId, manager.UserId!);
  const existing = await prisma.sleep_schedules.findFirst({ where: { ChildDevicePolicyId: policy.Id } });
  const data = {
    IsEnabled: input.isEnabled,
    StartTime: stringToTime(input.startTime),
    EndTime: stringToTime(input.endTime),
    DaysOfWeek: input.daysOfWeek,
    UpdatedAt: new Date(),
  };
  const saved = existing
    ? await prisma.sleep_schedules.update({ where: { Id: existing.Id }, data })
    : await prisma.sleep_schedules.create({
        data: { Id: randomUUID(), ChildDevicePolicyId: policy.Id, ...data },
      });
  notifyChildPolicyChanged(childUserId);
  return mapSleep(saved);
}

// ── Block schedules ─────────────────────────────────────────────────────────

interface BlockRow {
  Id: string;
  ChildDevicePolicyId: string;
  Name: string;
  IsEnabled: boolean;
  StartTime: Date;
  EndTime: Date;
  DaysOfWeek: number;
  BlockAll: boolean;
  BlockGames: boolean;
  BlockSocial: boolean;
  BlockVideo: boolean;
  CreatedAt: Date;
  UpdatedAt: Date | null;
}

function mapBlock(s: BlockRow) {
  return {
    id: s.Id,
    childDevicePolicyId: s.ChildDevicePolicyId,
    name: s.Name,
    isEnabled: s.IsEnabled,
    startTime: timeToString(s.StartTime),
    endTime: timeToString(s.EndTime),
    daysOfWeek: s.DaysOfWeek,
    blockAll: s.BlockAll,
    blockGames: s.BlockGames,
    blockSocial: s.BlockSocial,
    blockVideo: s.BlockVideo,
    createdAt: s.CreatedAt.toISOString(),
    updatedAt: s.UpdatedAt?.toISOString() ?? null,
  };
}

export async function getBlockSchedules(userId: string, childUserId: string) {
  if (userId !== childUserId) await requireTutorChild(userId, childUserId);
  const policy = await prisma.child_device_policies.findFirst({ where: { ChildUserId: childUserId } });
  if (!policy) throw new AppError("ParentalPolicyNotFound", "Nenhuma política parental foi encontrada.", 404);
  const rows = await prisma.app_block_schedules.findMany({
    where: { ChildDevicePolicyId: policy.Id },
    orderBy: { Name: "asc" },
  });
  return rows.map(mapBlock);
}

export interface UpsertBlockInput {
  name: string;
  isEnabled: boolean;
  startTime: string;
  endTime: string;
  daysOfWeek: number;
  blockAll: boolean;
  blockGames: boolean;
  blockSocial: boolean;
  blockVideo: boolean;
}

export async function upsertBlockSchedule(
  userId: string,
  childUserId: string,
  scheduleId: string | null,
  input: UpsertBlockInput,
) {
  if (!input.name?.trim()) throw new AppError("ValidationError", "O nome do agendamento é obrigatório.");
  const { manager } = await requireTutorChild(userId, childUserId);
  const policy = await getOrCreatePolicy(childUserId, manager.UserId!);

  const data = {
    Name: input.name.trim(),
    IsEnabled: input.isEnabled,
    StartTime: stringToTime(input.startTime),
    EndTime: stringToTime(input.endTime),
    DaysOfWeek: input.daysOfWeek,
    BlockAll: input.blockAll,
    BlockGames: input.blockGames,
    BlockSocial: input.blockSocial,
    BlockVideo: input.blockVideo,
    UpdatedAt: new Date(),
  };

  if (scheduleId) {
    const existing = await prisma.app_block_schedules.findFirst({
      where: { Id: scheduleId, ChildDevicePolicyId: policy.Id },
    });
    if (!existing) throw new AppError("ScheduleNotFound", "Agendamento não encontrado.", 404);
    const updatedRow = await prisma.app_block_schedules.update({ where: { Id: scheduleId }, data });
    notifyChildPolicyChanged(childUserId);
    return mapBlock(updatedRow);
  }
  const count = await prisma.app_block_schedules.count({ where: { ChildDevicePolicyId: policy.Id } });
  if (count >= 5) throw new AppError("ValidationError", "Limite de 5 agendamentos por criança atingido.");
  const createdRow = await prisma.app_block_schedules.create({
    data: { Id: randomUUID(), ChildDevicePolicyId: policy.Id, CreatedAt: new Date(), ...data },
  });
  notifyChildPolicyChanged(childUserId);
  return mapBlock(createdRow);
}

export async function deleteBlockSchedule(userId: string, childUserId: string, scheduleId: string) {
  const { manager } = await requireTutorChild(userId, childUserId);
  const policy = await getOrCreatePolicy(childUserId, manager.UserId!);
  const existing = await prisma.app_block_schedules.findFirst({
    where: { Id: scheduleId, ChildDevicePolicyId: policy.Id },
  });
  if (!existing) throw new AppError("ScheduleNotFound", "Agendamento não encontrado.", 404);
  await prisma.app_block_schedules.delete({ where: { Id: scheduleId } });
  notifyChildPolicyChanged(childUserId);
}

// ── Tasks & rewards ─────────────────────────────────────────────────────────

interface TaskRow {
  Id: string;
  ChildUserId: string;
  Title: string;
  Description: string | null;
  Category: string;
  RewardMinutes: number;
  IsRecurring: boolean;
  RecurringDays: number;
  IsActive: boolean;
  CreatedAt: Date;
  UpdatedAt: Date | null;
}

function mapTask(t: TaskRow) {
  return {
    id: t.Id,
    childUserId: t.ChildUserId,
    title: t.Title,
    description: t.Description,
    category: t.Category,
    rewardMinutes: t.RewardMinutes,
    isRecurring: t.IsRecurring,
    recurringDays: t.RecurringDays,
    isActive: t.IsActive,
    createdAt: t.CreatedAt.toISOString(),
    updatedAt: t.UpdatedAt?.toISOString() ?? null,
  };
}

interface CompletionRow {
  Id: string;
  ChildTaskId: string;
  ChildUserId: string;
  Status: number;
  ChildNote: string | null;
  ParentNote: string | null;
  RewardCredited: boolean;
  CompletedAt: Date;
  ReviewedAt: Date | null;
  ReviewedByUserId: string | null;
}

function mapCompletion(c: CompletionRow, t: TaskRow) {
  return {
    id: c.Id,
    childTaskId: c.ChildTaskId,
    childUserId: c.ChildUserId,
    title: t.Title,
    category: t.Category,
    rewardMinutes: t.RewardMinutes,
    status: COMPLETION_STATUS_NAMES[c.Status] ?? "PendingApproval",
    childNote: c.ChildNote,
    parentNote: c.ParentNote,
    rewardCredited: c.RewardCredited,
    completedAt: c.CompletedAt.toISOString(),
    reviewedAt: c.ReviewedAt?.toISOString() ?? null,
    reviewedByUserId: c.ReviewedByUserId,
  };
}

async function assertManagerOfChild(managerId: string, childUserId: string) {
  const managerFamilies = await prisma.family_members.findMany({
    where: { UserId: managerId, Role: { in: [...MANAGEMENT_ROLES] } },
    select: { FamilyId: true },
  });
  const familyIds = [...new Set(managerFamilies.map((m) => m.FamilyId))];
  if (familyIds.length === 0) throw new AppError("Forbidden", "Acesso negado.", 403);
  const inFamily = await prisma.family_members.findFirst({
    where: { UserId: childUserId, FamilyId: { in: familyIds } },
    select: { Id: true },
  });
  if (!inFamily) throw new AppError("Forbidden", "Criança não pertence a uma família gerenciada por você.", 403);
}

export async function getChildTasks(userId: string, childUserId: string) {
  await assertManagerOfChild(userId, childUserId);
  const tasks = await prisma.child_tasks.findMany({
    where: { ChildUserId: childUserId },
    orderBy: { CreatedAt: "asc" },
  });
  return tasks.map(mapTask);
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  category?: string;
  rewardMinutes: number;
  isRecurring?: boolean;
  recurringDays?: number;
}

export async function createTask(userId: string, childUserId: string, input: CreateTaskInput) {
  if (!input.title?.trim()) throw new AppError("ValidationError", "O título da tarefa é obrigatório.");
  if (input.rewardMinutes <= 0) throw new AppError("ValidationError", "A recompensa deve ser maior que zero.");
  await assertManagerOfChild(userId, childUserId);
  const task = await prisma.child_tasks.create({
    data: {
      Id: randomUUID(),
      ChildUserId: childUserId,
      CreatedByUserId: userId,
      Title: input.title.trim(),
      Description: input.description?.trim() || null,
      Category: input.category?.trim() || "Other",
      RewardMinutes: input.rewardMinutes,
      IsRecurring: input.isRecurring ?? false,
      RecurringDays: input.recurringDays ?? 0,
      IsActive: true,
      CreatedAt: new Date(),
    },
  });
  // Notifica a criança de que há uma nova tarefa (realtime + push), espelhando o
  // padrão de submitCompletion/approveCompletion. Sem isto, o child só descobre a
  // tarefa ao abrir a lista manualmente (bug de campo #2).
  emitToUser(childUserId, "TaskCreated", { id: task.Id, title: task.Title, rewardMinutes: task.RewardMinutes });
  pushToUser(childUserId, {
    title: "Nova tarefa 🎯",
    body: `"${task.Title}" — conclua e ganhe +${task.RewardMinutes} min.`,
    data: { type: "task-created", taskId: task.Id },
  });
  return mapTask(task);
}

export interface UpdateTaskInput extends CreateTaskInput {
  isActive: boolean;
}

export async function updateTask(userId: string, childUserId: string, taskId: string, input: UpdateTaskInput) {
  if (!input.title?.trim()) throw new AppError("ValidationError", "O título da tarefa é obrigatório.");
  await assertManagerOfChild(userId, childUserId);
  const task = await prisma.child_tasks.findFirst({ where: { Id: taskId, ChildUserId: childUserId } });
  if (!task) throw new AppError("NotFound", "Tarefa não encontrada.", 404);
  const updated = await prisma.child_tasks.update({
    where: { Id: taskId },
    data: {
      Title: input.title.trim(),
      Description: input.description?.trim() || null,
      Category: input.category?.trim() || "Other",
      RewardMinutes: input.rewardMinutes,
      IsRecurring: input.isRecurring ?? false,
      RecurringDays: input.recurringDays ?? 0,
      IsActive: input.isActive,
      UpdatedAt: new Date(),
    },
  });
  return mapTask(updated);
}

export async function deleteTask(userId: string, childUserId: string, taskId: string) {
  await assertManagerOfChild(userId, childUserId);
  const task = await prisma.child_tasks.findFirst({ where: { Id: taskId, ChildUserId: childUserId } });
  if (!task) throw new AppError("NotFound", "Tarefa não encontrada.", 404);
  await prisma.child_tasks.delete({ where: { Id: taskId } });
}

export async function getMyTasks(userId: string) {
  const tasks = await prisma.child_tasks.findMany({ where: { ChildUserId: userId, IsActive: true } });
  const taskIds = tasks.map((t) => t.Id);
  const completions =
    taskIds.length === 0
      ? []
      : await prisma.task_completions.findMany({
          where: { ChildTaskId: { in: taskIds }, ChildUserId: userId },
          orderBy: { CompletedAt: "desc" },
        });
  const taskMap = new Map(tasks.map((t) => [t.Id, t]));
  // Return the tasks plus the latest completion status (so the child sees what's
  // available and what's pending/approved).
  return {
    tasks: tasks.map(mapTask),
    completions: completions
      .filter((c) => taskMap.has(c.ChildTaskId))
      .map((c) => mapCompletion(c, taskMap.get(c.ChildTaskId)!)),
  };
}

export async function submitCompletion(userId: string, taskId: string, childNote?: string) {
  const task = await prisma.child_tasks.findFirst({ where: { Id: taskId, ChildUserId: userId, IsActive: true } });
  if (!task) throw new AppError("NotFound", "Tarefa não encontrada ou inativa.", 404);
  const pending = await prisma.task_completions.findFirst({
    where: { ChildTaskId: taskId, ChildUserId: userId, Status: COMPLETION_STATUS.PendingApproval },
    select: { Id: true },
  });
  if (pending) throw new AppError("Conflict", "Já existe uma conclusão pendente para essa tarefa.", 409);
  const completion = await prisma.task_completions.create({
    data: {
      Id: randomUUID(),
      ChildTaskId: task.Id,
      ChildUserId: userId,
      Status: COMPLETION_STATUS.PendingApproval,
      ChildNote: childNote?.trim() || null,
      RewardCredited: false,
      CompletedAt: new Date(),
    },
  });
  const tutorsForTask = await getTutorsForChild(userId);
  emitToUsers(tutorsForTask, "TaskCompletionPending", { id: completion.Id, childUserId: userId, title: task.Title });
  pushToUsers(tutorsForTask, {
    title: "Tarefa concluída",
    body: `${await displayName(userId)} concluiu "${task.Title}" e aguarda aprovação.`,
    data: { type: "task-completion", childUserId: userId },
  });
  return mapCompletion(completion, task);
}

export async function getPendingCompletions(userId: string) {
  const childIds = await getManagedChildIds(userId);
  if (childIds.length === 0) return [];
  const pending = await prisma.task_completions.findMany({
    where: { ChildUserId: { in: childIds }, Status: COMPLETION_STATUS.PendingApproval },
    orderBy: { CompletedAt: "asc" },
  });
  const taskIds = [...new Set(pending.map((c) => c.ChildTaskId))];
  const tasks = await prisma.child_tasks.findMany({ where: { Id: { in: taskIds } } });
  const taskMap = new Map(tasks.map((t) => [t.Id, t]));
  return pending.filter((c) => taskMap.has(c.ChildTaskId)).map((c) => mapCompletion(c, taskMap.get(c.ChildTaskId)!));
}

export async function approveCompletion(userId: string, completionId: string, parentNote?: string) {
  const completion = await prisma.task_completions.findFirst({
    where: { Id: completionId, Status: COMPLETION_STATUS.PendingApproval },
  });
  if (!completion) throw new AppError("NotFound", "Conclusão não encontrada ou já revisada.", 404);
  await assertManagerOfChild(userId, completion.ChildUserId);
  const task = await prisma.child_tasks.findFirst({ where: { Id: completion.ChildTaskId } });
  if (!task) throw new AppError("NotFound", "Tarefa associada não encontrada.", 404);

  const now = new Date();
  const updated = await prisma.task_completions.update({
    where: { Id: completionId },
    data: {
      Status: COMPLETION_STATUS.Approved,
      ParentNote: parentNote?.trim() || null,
      ReviewedByUserId: userId,
      ReviewedAt: now,
      RewardCredited: true,
    },
  });
  // Auto-credit the reward as an approved extra-time grant.
  await prisma.extra_time_requests.create({
    data: {
      Id: randomUUID(),
      ChildUserId: completion.ChildUserId,
      RequestedToUserId: userId,
      RequestedMinutes: task.RewardMinutes,
      Status: EXTRA_STATUS.Approved,
      RequestedAt: now,
      ExpiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
      RespondedAt: now,
      RespondedByUserId: userId,
      Source: EXTRA_SOURCE.TaskReward,
      SourceTaskId: completion.ChildTaskId,
    },
  });
  emitToUser(completion.ChildUserId, "TaskReviewed", { id: completionId, status: "Approved", rewardMinutes: task.RewardMinutes });
  pushToUser(completion.ChildUserId, {
    title: "Tarefa aprovada",
    body: `"${task.Title}" aprovada — você ganhou +${task.RewardMinutes} min.`,
    data: { type: "task-reviewed", status: "Approved" },
  });
  return mapCompletion(updated, task);
}

export async function rejectCompletion(userId: string, completionId: string, parentNote?: string) {
  const completion = await prisma.task_completions.findFirst({
    where: { Id: completionId, Status: COMPLETION_STATUS.PendingApproval },
  });
  if (!completion) throw new AppError("NotFound", "Conclusão não encontrada ou já revisada.", 404);
  await assertManagerOfChild(userId, completion.ChildUserId);
  const task = await prisma.child_tasks.findFirst({ where: { Id: completion.ChildTaskId } });
  if (!task) throw new AppError("NotFound", "Tarefa associada não encontrada.", 404);
  const updated = await prisma.task_completions.update({
    where: { Id: completionId },
    data: {
      Status: COMPLETION_STATUS.Rejected,
      ParentNote: parentNote?.trim() || null,
      ReviewedByUserId: userId,
      ReviewedAt: new Date(),
    },
  });
  emitToUser(completion.ChildUserId, "TaskReviewed", { id: completionId, status: "Rejected" });
  pushToUser(completion.ChildUserId, {
    title: "Tarefa não aprovada",
    body: `"${task.Title}" foi recusada. Veja o retorno do responsável.`,
    data: { type: "task-reviewed", status: "Rejected" },
  });
  return mapCompletion(updated, task);
}

export async function getCompletionHistory(userId: string, childUserId: string) {
  await assertManagerOfChild(userId, childUserId);
  const completions = await prisma.task_completions.findMany({
    where: { ChildUserId: childUserId },
    orderBy: { CompletedAt: "desc" },
    take: 100,
  });
  const taskIds = [...new Set(completions.map((c) => c.ChildTaskId))];
  const tasks = await prisma.child_tasks.findMany({ where: { Id: { in: taskIds } } });
  const taskMap = new Map(tasks.map((t) => [t.Id, t]));
  return completions.filter((c) => taskMap.has(c.ChildTaskId)).map((c) => mapCompletion(c, taskMap.get(c.ChildTaskId)!));
}

export { ensure };
