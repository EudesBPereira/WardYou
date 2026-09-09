import type { PolicyDto, AppRuleDto, SleepDto, BlockDto } from "./queries";

// Deliberately zero React Native / native-module imports in this file — it's
// pure computation, split out from enforcement.ts so it can run under a plain
// Node test runner (see enforcementLogic.test.ts) without a bundler/device.

// Must match apps/mobile/app.config.ts `android.package` — always allowed,
// on top of whatever an admin marks IsWhitelisted in app rules.
export const WARDYOU_PACKAGE = "com.wardyou.app";

export interface EnforcementDecision {
  enabled: boolean;
  blockAll: boolean;
  blockedPackages: string[];
  whitelistedPackages: string[];
}

export interface EnforcementInput {
  policy: PolicyDto | null;
  appRules: AppRuleDto[];
  sleepSchedule: SleepDto | null;
  blockSchedules: BlockDto[];
  remainingMinutes: number;
  /** Firewall / default-deny (the child model): block everything except the
   *  apps the guardian allowed (`isWhitelisted`). Default true for children. */
  firewall?: boolean;
  /** Per-package foreground minutes today, for enforcing per-app time budgets
   *  (`dailyLimitMinutes`): an allowed app over its budget stops being allowed. */
  usageByPackage?: Record<string, number>;
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// CLAUDE.md: DaysOfWeek bitmask, bit0=Mon...bit6=Sun. Date.getDay() is
// 0=Sun..6=Sat, so shift it to a Monday-indexed bit position.
function dayBit(date: Date): number {
  const mondayIndexed = (date.getDay() + 6) % 7;
  return 1 << mondayIndexed;
}

/**
 * Whether `now` (the DEVICE's own local clock — deliberately not evaluated
 * server-side, which would need a stored per-user timezone the schema doesn't
 * have) falls inside a start/end/daysOfWeek window. Handles windows that cross
 * midnight (e.g. a 22:00-07:00 sleep schedule).
 */
export function isWithinWindow(now: Date, startTime: string, endTime: string, daysOfWeek: number): boolean {
  const start = minutesOf(startTime);
  const end = minutesOf(endTime);
  if (start === end) return false;

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const todayBit = dayBit(now);

  if (start < end) {
    return (daysOfWeek & todayBit) !== 0 && nowMinutes >= start && nowMinutes < end;
  }

  // Overnight window: either it started today (and hasn't hit midnight yet)
  // or it started yesterday (by yesterday's days-of-week bit) and hasn't
  // reached its end time yet today.
  const yesterday = new Date(now.getTime() - 24 * 60 * 60_000);
  const yesterdayBit = dayBit(yesterday);
  const startedToday = (daysOfWeek & todayBit) !== 0 && nowMinutes >= start;
  const continuesFromYesterday = (daysOfWeek & yesterdayBit) !== 0 && nowMinutes < end;
  return startedToday || continuesFromYesterday;
}

/**
 * Reduces the parental policy + app rules + sleep/block schedules into "what
 * should be blocked right this second" — evaluated against the device's own
 * clock so timezone is never a concern. Note: `EntertainmentDailyLimitMinutes`
 * is NOT enforced here (no per-category usage breakdown is tracked server-side
 * yet, only a total); only the overall daily limit (`remainingMinutes <= 0`)
 * triggers a block-all.
 */
export function computeEnforcementState(input: EnforcementInput, now: Date = new Date()): EnforcementDecision {
  const { policy, appRules, sleepSchedule, blockSchedules, remainingMinutes, firewall = false, usageByPackage = {} } = input;

  if (!policy || !policy.isEnabled) {
    return { enabled: false, blockAll: false, blockedPackages: [], whitelistedPackages: [WARDYOU_PACKAGE] };
  }

  // An allowed app stops being allowed once it's over its own daily budget, so
  // the firewall starts blocking it (per-app time limit). No budget = always
  // allowed (subject to the global limit/schedules below).
  const overAppBudget = (r: AppRuleDto) =>
    r.dailyLimitMinutes != null && (usageByPackage[r.appPackageName] ?? 0) >= r.dailyLimitMinutes;
  // Temporary allow ("liberar por N horas"): usable until the deadline, no
  // matter the permanent whitelist state — and, below, it's the ONLY thing
  // that pierces a hard block, so the guardian can pause everything and still
  // hand out one app for a while.
  const tempAllowed = (r: AppRuleDto) => !!r.allowedUntil && new Date(r.allowedUntil) > now;

  const sleepActive =
    !!sleepSchedule?.isEnabled && isWithinWindow(now, sleepSchedule.startTime, sleepSchedule.endTime, sleepSchedule.daysOfWeek);

  const activeSchedules = blockSchedules.filter((s) => s.isEnabled && isWithinWindow(now, s.startTime, s.endTime, s.daysOfWeek));
  const scheduleBlockAll = activeSchedules.some((s) => s.blockAll);
  const blockedCategories = new Set<string>();
  for (const s of activeSchedules) {
    if (s.blockGames) blockedCategories.add("Games");
    if (s.blockSocial) blockedCategories.add("Social");
    if (s.blockVideo) blockedCategories.add("Video");
  }

  // Hard block (pause / sleep window / schedule / daily limit exhausted):
  // the whitelist COLLAPSES to WardYou + temporary allows. The native service
  // lets whitelisted packages through even under blockAll, so leaving the
  // regular whitelist intact here would make "pause" a no-op for every app
  // the guardian ever allowed — the old behavior, and a real hole.
  const hardBlock = policy.isRemotelyPaused || sleepActive || scheduleBlockAll || remainingMinutes <= 0;
  const whitelistedPackages = [
    WARDYOU_PACKAGE,
    ...appRules
      .filter((r) => (hardBlock ? tempAllowed(r) : (r.isWhitelisted && !overAppBudget(r)) || tempAllowed(r)))
      .map((r) => r.appPackageName),
  ];

  // Firewall (child model): default-deny — everything not allowed is blocked.
  // Otherwise the legacy blocklist: only explicitly blocked apps + the usual
  // block-all conditions above.
  const blockAll = firewall || hardBlock;

  const blockedPackages = firewall
    ? []
    : appRules
        .filter((r) => !r.isWhitelisted && !tempAllowed(r) && (r.isBlocked || blockedCategories.has(r.appCategory)))
        .map((r) => r.appPackageName);

  return { enabled: true, blockAll, blockedPackages, whitelistedPackages };
}
