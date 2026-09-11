import { Platform } from "react-native";
import { apiClient } from "@/services/api/client";
import { storage } from "@/lib/storage";
import * as AppBlock from "@modules/app-block";
import type { PolicyDto, AppRuleDto, SleepDto, BlockDto } from "./queries";
import { computeEnforcementState, pauseDeadlineMillis, WARDYOU_PACKAGE } from "./enforcementLogic";

export { isWithinWindow, computeEnforcementState, pauseDeadlineMillis, WARDYOU_PACKAGE } from "./enforcementLogic";
export type { EnforcementDecision, EnforcementInput } from "./enforcementLogic";

/** "HH:MM" → minutes since midnight (the shape the native side evaluates). */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/** Windows that mean "hard block" (sleep + block-all schedules), for native
 *  re-evaluation while the app is closed. Category-specific schedules stay in
 *  the JS decision — they need the per-app category the native side lacks. */
function hardBlockWindows(
  sleep: SleepDto | null,
  blocks: BlockDto[],
): { s: number; e: number; d: number }[] {
  const out: { s: number; e: number; d: number }[] = [];
  if (sleep?.isEnabled) {
    out.push({ s: toMinutes(sleep.startTime), e: toMinutes(sleep.endTime), d: sleep.daysOfWeek });
  }
  for (const b of blocks) {
    if (b.isEnabled && b.blockAll) {
      out.push({ s: toMinutes(b.startTime), e: toMinutes(b.endTime), d: b.daysOfWeek });
    }
  }
  return out;
}

/** `{pkg: epochMs}` for temporary allows, so the native side can expire them. */
function tempAllowDeadlines(appRules: AppRuleDto[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of appRules) {
    if (!r.allowedUntil) continue;
    const at = new Date(r.allowedUntil).getTime();
    if (Number.isFinite(at)) out[r.appPackageName] = at;
  }
  return out;
}

function localDateString(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Reads the child device's real per-app foreground time (UsageStats) and
 * reports it to the server so the daily screen-time limit actually enforces
 * (server computes remaining → next `syncEnforcement` gets 0 → blockAll). Needs
 * the "Usage access" permission granted; a no-op without it. The deviceId is the
 * one `usePushRegistration` created + stored for this user. Android-only.
 */
export async function reportUsage(childUserId: string): Promise<void> {
  if (Platform.OS !== "android" || !AppBlock.hasUsageAccess()) return;
  try {
    const deviceId = await storage.getItem(`wardyou_push_device_${childUserId}`);
    if (!deviceId) return; // no registered device yet → nothing to attribute usage to
    const items = AppBlock.getUsageToday()
      .filter((i) => i.packageName !== WARDYOU_PACKAGE && i.minutes > 0)
      .map((i) => ({ appPackageName: i.packageName, usedMinutes: i.minutes }));
    if (items.length === 0) return;
    await apiClient.post("/api/v1/parental/usage-summary", {
      childUserId,
      deviceId,
      usageDate: localDateString(),
      items,
    });
  } catch {
    /* best-effort */
  }
}

export function isUsageAccessEnabled(): boolean {
  return AppBlock.hasUsageAccess();
}

export function openUsageAccessSettings(): void {
  AppBlock.openUsageAccessSettings();
}

/**
 * Pulls the current policy/rules/schedules for `childUserId` (must be the
 * caller's own id — these are the self-service parental endpoints), computes
 * the effective enforcement state locally, and pushes it into the native
 * AccessibilityService's cache. Android-only; a safe no-op elsewhere. Meant to
 * be called from the same ~60s loop as the existing heartbeat (see ChildHome).
 */
export async function syncEnforcement(childUserId: string, remainingMinutes: number): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    const [policy, appRules, sleepSchedule, blockSchedules] = await Promise.all([
      apiClient.get<PolicyDto>(`/api/v1/parental/children/${childUserId}/policy`),
      apiClient.get<AppRuleDto[]>(`/api/v1/parental/children/${childUserId}/apps`),
      apiClient.get<SleepDto>(`/api/v1/parental/children/${childUserId}/sleep-schedule`),
      apiClient.get<BlockDto[]>(`/api/v1/parental/children/${childUserId}/block-schedules`),
    ]);
    // Per-app usage today, so per-app time budgets enforce.
    const usageByPackage: Record<string, number> = {};
    for (const u of AppBlock.getUsageToday()) usageByPackage[u.packageName] = u.minutes;
    // Firewall / default-deny is the child model: block everything except what
    // the guardian allowed.
    const state = computeEnforcementState({
      policy,
      appRules,
      sleepSchedule,
      blockSchedules,
      remainingMinutes,
      firewall: true,
      usageByPackage,
    });
    // The decision above is a SNAPSHOT. On a child's phone the app is normally
    // closed, so nothing recomputes it — a sleep window would never start and a
    // temporary allow would never expire. Ship the time-dependent inputs too,
    // so the native AccessibilityService re-evaluates them against the device
    // clock on every app switch and stays a complete enforcer on its own.
    // Same reasoning as the windows/allows above, for the one hard-block cause
    // that had no native self-expiry: a timed remote pause ("pausar por
    // 30min"). Without this, the native side keeps enforcing whatever
    // `blockAll` was true/false at THIS sync forever — a closed child phone
    // would stay paused well past the guardian's intended duration, since
    // nothing else re-evaluates it (the server only lazily clears
    // `IsRemotelyPaused` the next time something queries the policy).
    const pauseUntil = pauseDeadlineMillis(policy);
    AppBlock.setEnforcementState({
      ...state,
      hardBlockWindowsJson: JSON.stringify(hardBlockWindows(sleepSchedule, blockSchedules)),
      tempAllowsJson: JSON.stringify(tempAllowDeadlines(appRules)),
      pauseUntilMillis: pauseUntil != null ? String(pauseUntil) : "0",
    });
  } catch {
    // Best-effort — the AccessibilityService just keeps enforcing whatever it
    // last cached until the next successful sync.
  }
}

/**
 * Reports the child device's installed apps to the server so the guardian sees
 * the real list (exact package names) to allow/time-limit. Best-effort,
 * Android-only. Meant to run occasionally (app open), not every tick.
 */
export async function reportInstalledApps(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    const apps = AppBlock.getInstalledApps().map((a) => ({ packageName: a.packageName, label: a.label }));
    if (apps.length === 0) return;
    await apiClient.post("/api/v1/parental/my-apps", { apps });
  } catch {
    /* best-effort */
  }
}

/**
 * One-shot full sync: report real usage, read the fresh remaining-minutes from
 * the server, recompute and apply enforcement. Used OUTSIDE the ChildHome 60s
 * loop — by the realtime `ParentalPolicyChanged` handler (guardian changed
 * something → apply in seconds) and by the headless `parental-sync` push task
 * (same, but with the app killed; caller hydrates the session store first so
 * apiClient has a token). Android-only, best-effort.
 */
export async function fullParentalSync(childUserId: string): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await reportUsage(childUserId);
    const status = await apiClient.get<{ hasPolicy: boolean; remainingMinutes?: number }>(
      "/api/v1/parental/my-status",
    );
    if (!status?.hasPolicy) return;
    await syncEnforcement(childUserId, status.remainingMinutes ?? 0);
  } catch {
    /* best-effort — the 60s loop is the fallback */
  }
}

export function isAccessibilityServiceEnabled(): boolean {
  return AppBlock.isAccessibilityServiceEnabled();
}

export function openAccessibilitySettings(): void {
  AppBlock.openAccessibilitySettings();
}
