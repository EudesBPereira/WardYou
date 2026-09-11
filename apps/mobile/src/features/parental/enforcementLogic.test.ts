import { test } from "node:test";
import assert from "node:assert/strict";
import { isWithinWindow, computeEnforcementState, pauseDeadlineMillis, WARDYOU_PACKAGE } from "./enforcementLogic.ts";
import type { PolicyDto, AppRuleDto, SleepDto, BlockDto } from "./queries.ts";

// --- isWithinWindow ----------------------------------------------------

test("same-day window: inside range on an allowed day", () => {
  // 2026-07-09 is a Thursday (bit index 3 → 1<<3 = 8).
  const now = new Date(2026, 6, 9, 15, 30);
  assert.equal(isWithinWindow(now, "14:00", "18:00", 0b0111_1111), true);
});

test("same-day window: outside range", () => {
  const now = new Date(2026, 6, 9, 19, 0);
  assert.equal(isWithinWindow(now, "14:00", "18:00", 0b0111_1111), false);
});

test("same-day window: inside range but day bit not set", () => {
  const now = new Date(2026, 6, 9, 15, 30); // Thursday, bit 3
  const daysWithoutThursday = 0b0111_1111 & ~(1 << 3);
  assert.equal(isWithinWindow(now, "14:00", "18:00", daysWithoutThursday), false);
});

test("overnight window: active late at night (started today)", () => {
  const now = new Date(2026, 6, 9, 23, 0); // Thursday 23:00
  assert.equal(isWithinWindow(now, "22:00", "07:00", 0b0111_1111), true);
});

test("overnight window: active early morning (continues from yesterday)", () => {
  const now = new Date(2026, 6, 9, 5, 0); // Thursday 05:00 — window started Wednesday
  assert.equal(isWithinWindow(now, "22:00", "07:00", 0b0111_1111), true);
});

test("overnight window: not active mid-afternoon", () => {
  const now = new Date(2026, 6, 9, 14, 0);
  assert.equal(isWithinWindow(now, "22:00", "07:00", 0b0111_1111), false);
});

test("overnight window: yesterday's day bit gates the early-morning tail", () => {
  const now = new Date(2026, 6, 9, 5, 0); // Thursday 05:00
  const wednesdayBit = 1 << 2;
  const daysWithoutWednesday = 0b0111_1111 & ~wednesdayBit;
  assert.equal(isWithinWindow(now, "22:00", "07:00", daysWithoutWednesday), false);
});

test("zero-length window is never active", () => {
  const now = new Date(2026, 6, 9, 12, 0);
  assert.equal(isWithinWindow(now, "10:00", "10:00", 0b0111_1111), false);
});

// --- computeEnforcementState --------------------------------------------

const now = new Date(2026, 6, 9, 15, 0); // Thursday 15:00, no schedules active

function appRule(overrides: Partial<AppRuleDto> = {}): AppRuleDto {
  return {
    id: "r1",
    appPackageName: "com.example.app",
    appDisplayName: "Example",
    isBlocked: false,
    dailyLimitMinutes: null,
    isEmergencyAllowed: false,
    isWhitelisted: false,
    appCategory: "Other",
    ...overrides,
  };
}

const disabledPolicy: PolicyDto = {
  id: "p1",
  childUserId: "child1",
  managedByUserId: "parent1",
  dailyScreenTimeLimitMinutes: 120,
  isEnabled: false,
  blockAppInstall: false,
  entertainmentDailyLimitMinutes: null,
  isRemotelyPaused: false,
  blockedWebsites: [],
};

test("policy disabled → nothing blocked, WardYou still whitelisted", () => {
  const result = computeEnforcementState(
    { policy: disabledPolicy, appRules: [], sleepSchedule: null, blockSchedules: [], remainingMinutes: 60 },
    now,
  );
  assert.deepEqual(result, { enabled: false, blockAll: false, blockedPackages: [], whitelistedPackages: [WARDYOU_PACKAGE] });
});

test("policy enabled, remote pause → blockAll regardless of schedules", () => {
  const policy: PolicyDto = { ...disabledPolicy, isEnabled: true, isRemotelyPaused: true };
  const result = computeEnforcementState(
    { policy, appRules: [], sleepSchedule: null, blockSchedules: [], remainingMinutes: 60 },
    now,
  );
  assert.equal(result.blockAll, true);
});

test("daily minutes exhausted → blockAll", () => {
  const policy: PolicyDto = { ...disabledPolicy, isEnabled: true };
  const result = computeEnforcementState(
    { policy, appRules: [], sleepSchedule: null, blockSchedules: [], remainingMinutes: 0 },
    now,
  );
  assert.equal(result.blockAll, true);
});

test("explicit blocked app rule is blocked; whitelisted app rule is exempt", () => {
  const policy: PolicyDto = { ...disabledPolicy, isEnabled: true };
  const rules = [
    appRule({ appPackageName: "com.blocked.app", isBlocked: true }),
    appRule({ appPackageName: "com.whitelisted.app", isBlocked: true, isWhitelisted: true }),
    appRule({ appPackageName: "com.allowed.app", isBlocked: false }),
  ];
  const result = computeEnforcementState(
    { policy, appRules: rules, sleepSchedule: null, blockSchedules: [], remainingMinutes: 60 },
    now,
  );
  assert.equal(result.blockAll, false);
  assert.deepEqual(result.blockedPackages, ["com.blocked.app"]);
  assert.ok(result.whitelistedPackages.includes("com.whitelisted.app"));
});

test("sleep schedule active → blockAll", () => {
  const policy: PolicyDto = { ...disabledPolicy, isEnabled: true };
  const sleepSchedule: SleepDto = { id: "s1", isEnabled: true, startTime: "14:00", endTime: "16:00", daysOfWeek: 0b0111_1111 };
  const result = computeEnforcementState(
    { policy, appRules: [], sleepSchedule, blockSchedules: [], remainingMinutes: 60 },
    now,
  );
  assert.equal(result.blockAll, true);
});

test("active block-schedule category blocks matching apps without blockAll", () => {
  const policy: PolicyDto = { ...disabledPolicy, isEnabled: true };
  const blockSchedules: BlockDto[] = [
    {
      id: "b1",
      name: "No games after school",
      isEnabled: true,
      startTime: "14:00",
      endTime: "16:00",
      daysOfWeek: 0b0111_1111,
      blockAll: false,
      blockGames: true,
      blockSocial: false,
      blockVideo: false,
    },
  ];
  const rules = [appRule({ appPackageName: "com.games.app", appCategory: "Games" }), appRule({ appPackageName: "com.other.app", appCategory: "Other" })];
  const result = computeEnforcementState(
    { policy, appRules: rules, sleepSchedule: null, blockSchedules, remainingMinutes: 60 },
    now,
  );
  assert.equal(result.blockAll, false);
  assert.deepEqual(result.blockedPackages, ["com.games.app"]);
});

// --- firewall / default-deny (child model) ---

test("firewall: blockAll baseline, only allowed apps whitelisted", () => {
  const policy: PolicyDto = { ...disabledPolicy, isEnabled: true };
  const rules = [
    appRule({ appPackageName: "com.allowed.app", isWhitelisted: true }),
    appRule({ appPackageName: "com.other.app", isWhitelisted: false }),
  ];
  const result = computeEnforcementState(
    { policy, appRules: rules, sleepSchedule: null, blockSchedules: [], remainingMinutes: 60, firewall: true },
    now,
  );
  assert.equal(result.blockAll, true); // default-deny
  assert.deepEqual(result.blockedPackages, []); // moot in firewall mode
  assert.ok(result.whitelistedPackages.includes("com.allowed.app"));
  assert.ok(!result.whitelistedPackages.includes("com.other.app"));
});

test("firewall: an allowed app over its per-app budget drops from the whitelist", () => {
  const policy: PolicyDto = { ...disabledPolicy, isEnabled: true };
  const rules = [
    appRule({ appPackageName: "com.youtube", isWhitelisted: true, dailyLimitMinutes: 30 }),
    appRule({ appPackageName: "com.books", isWhitelisted: true, dailyLimitMinutes: null }),
  ];
  const result = computeEnforcementState(
    {
      policy,
      appRules: rules,
      sleepSchedule: null,
      blockSchedules: [],
      remainingMinutes: 60,
      firewall: true,
      usageByPackage: { "com.youtube": 45 }, // over its 30-min budget
    },
    now,
  );
  assert.ok(!result.whitelistedPackages.includes("com.youtube")); // budget spent → blocked
  assert.ok(result.whitelistedPackages.includes("com.books")); // no limit → still allowed
});

// --- temporary allow (allowedUntil) + hard-block whitelist collapse -------

test("temporary allow: active deadline whitelists a non-allowed app", () => {
  const policy: PolicyDto = { ...disabledPolicy, isEnabled: true };
  const inOneHour = new Date(now.getTime() + 60 * 60_000).toISOString();
  const rules = [appRule({ appPackageName: "com.youtube", allowedUntil: inOneHour })];
  const result = computeEnforcementState(
    { policy, appRules: rules, sleepSchedule: null, blockSchedules: [], remainingMinutes: 60, firewall: true },
    now,
  );
  assert.ok(result.whitelistedPackages.includes("com.youtube"));
});

test("temporary allow: expired deadline does nothing", () => {
  const policy: PolicyDto = { ...disabledPolicy, isEnabled: true };
  const anHourAgo = new Date(now.getTime() - 60 * 60_000).toISOString();
  const rules = [appRule({ appPackageName: "com.youtube", allowedUntil: anHourAgo })];
  const result = computeEnforcementState(
    { policy, appRules: rules, sleepSchedule: null, blockSchedules: [], remainingMinutes: 60, firewall: true },
    now,
  );
  assert.ok(!result.whitelistedPackages.includes("com.youtube"));
});

test("hard block (remote pause) collapses the whitelist to WardYou only", () => {
  const policy: PolicyDto = { ...disabledPolicy, isEnabled: true, isRemotelyPaused: true };
  const rules = [appRule({ appPackageName: "com.allowed.app", isWhitelisted: true })];
  const result = computeEnforcementState(
    { policy, appRules: rules, sleepSchedule: null, blockSchedules: [], remainingMinutes: 60, firewall: true },
    now,
  );
  assert.equal(result.blockAll, true);
  // The native service lets whitelisted packages through blockAll — so the
  // pause is only real if the whitelist shrinks to WardYou.
  assert.deepEqual(result.whitelistedPackages, [WARDYOU_PACKAGE]);
});

test("temporary allow pierces a hard block (pause + liberar por 1h)", () => {
  const policy: PolicyDto = { ...disabledPolicy, isEnabled: true, isRemotelyPaused: true };
  const inOneHour = new Date(now.getTime() + 60 * 60_000).toISOString();
  const rules = [
    appRule({ appPackageName: "com.whatsapp", allowedUntil: inOneHour }),
    appRule({ appPackageName: "com.allowed.app", isWhitelisted: true }),
  ];
  const result = computeEnforcementState(
    { policy, appRules: rules, sleepSchedule: null, blockSchedules: [], remainingMinutes: 60, firewall: true },
    now,
  );
  assert.ok(result.whitelistedPackages.includes("com.whatsapp")); // guardian's explicit exception
  assert.ok(!result.whitelistedPackages.includes("com.allowed.app")); // paused like everything else
});

// --- pauseDeadlineMillis (timed-pause native self-expiry input) ---------
//
// Regression coverage for a real gap found 2026-09-11: a remote pause with a
// duration ("pausar por 30min") only auto-lifted server-side, lazily, the
// next time something queried the policy — which never happens on a closed
// child phone. Sleep windows and temporary allows already ship an absolute
// deadline to the native AccessibilityService so it can self-expire them
// against the device clock with the app closed; a timed pause had no
// equivalent. This is the pure half of the fix: enforcement.ts forwards this
// value to AppBlock.setEnforcementState as `pauseUntilMillis`.

test("pauseDeadlineMillis: no policy → null", () => {
  assert.equal(pauseDeadlineMillis(null), null);
});

test("pauseDeadlineMillis: not paused → null even with a stale pausedUntil", () => {
  const policy: PolicyDto = { ...disabledPolicy, isEnabled: true, isRemotelyPaused: false, pausedUntil: new Date(now.getTime() + 60_000).toISOString() };
  assert.equal(pauseDeadlineMillis(policy), null);
});

test("pauseDeadlineMillis: indefinite pause (no pausedUntil) → null — nothing to self-expire", () => {
  const policy: PolicyDto = { ...disabledPolicy, isEnabled: true, isRemotelyPaused: true, pausedUntil: null };
  assert.equal(pauseDeadlineMillis(policy), null);
});

test("pauseDeadlineMillis: timed pause → the deadline as epoch ms", () => {
  const until = new Date(now.getTime() + 30 * 60_000);
  const policy: PolicyDto = { ...disabledPolicy, isEnabled: true, isRemotelyPaused: true, pausedUntil: until.toISOString() };
  assert.equal(pauseDeadlineMillis(policy), until.getTime());
});

// --- whitelist collapse: only for hard-block causes native can't self-check ---
//
// Regression coverage for the other half of the 2026-09-11 timed-pause fix:
// `whitelistedPackages` is shipped verbatim to the native AccessibilityService
// (enforcement.ts) and is the ONLY thing standing between "hard-blocked" and
// "normally allowed" once native's own time check (isHardBlockActive /
// isPauseActive) says a window/deadline has passed. Collapsing it for a cause
// native can independently re-check (sleep window, schedule block-all window,
// a TIMED pause) bakes in a stale snapshot that never un-collapses on a
// closed app. Collapsing it for a cause native CANNOT re-check (an
// INDEFINITE pause, or the daily limit being exhausted — no deadline exists
// for either) is still correct and necessary.

test("timed pause (has a deadline) does NOT collapse the whitelist — native's own clock check gates it", () => {
  const until = new Date(now.getTime() + 30 * 60_000).toISOString();
  const policy: PolicyDto = { ...disabledPolicy, isEnabled: true, isRemotelyPaused: true, pausedUntil: until };
  const rules = [appRule({ appPackageName: "com.allowed.app", isWhitelisted: true })];
  const result = computeEnforcementState(
    { policy, appRules: rules, sleepSchedule: null, blockSchedules: [], remainingMinutes: 60, firewall: true },
    now,
  );
  assert.equal(result.blockAll, true); // firewall mode: still true, native gates per-package
  assert.ok(result.whitelistedPackages.includes("com.allowed.app"));
});

test("indefinite pause (no deadline) still collapses the whitelist — nothing for native to self-check", () => {
  const policy: PolicyDto = { ...disabledPolicy, isEnabled: true, isRemotelyPaused: true, pausedUntil: null };
  const rules = [appRule({ appPackageName: "com.allowed.app", isWhitelisted: true })];
  const result = computeEnforcementState(
    { policy, appRules: rules, sleepSchedule: null, blockSchedules: [], remainingMinutes: 60, firewall: true },
    now,
  );
  assert.ok(!result.whitelistedPackages.includes("com.allowed.app"));
});

test("daily limit exhausted still collapses the whitelist even during an unrelated timed pause", () => {
  const until = new Date(now.getTime() + 30 * 60_000).toISOString();
  const policy: PolicyDto = { ...disabledPolicy, isEnabled: true, isRemotelyPaused: true, pausedUntil: until };
  const rules = [appRule({ appPackageName: "com.allowed.app", isWhitelisted: true })];
  const result = computeEnforcementState(
    { policy, appRules: rules, sleepSchedule: null, blockSchedules: [], remainingMinutes: 0, firewall: true },
    now,
  );
  assert.ok(!result.whitelistedPackages.includes("com.allowed.app"));
});

test("daily limit exhausted also collapses the whitelist (except temp allows)", () => {
  const policy: PolicyDto = { ...disabledPolicy, isEnabled: true };
  const inOneHour = new Date(now.getTime() + 60 * 60_000).toISOString();
  const rules = [
    appRule({ appPackageName: "com.allowed.app", isWhitelisted: true }),
    appRule({ appPackageName: "com.duolingo", allowedUntil: inOneHour }),
  ];
  const result = computeEnforcementState(
    { policy, appRules: rules, sleepSchedule: null, blockSchedules: [], remainingMinutes: 0, firewall: true },
    now,
  );
  assert.ok(!result.whitelistedPackages.includes("com.allowed.app"));
  assert.ok(result.whitelistedPackages.includes("com.duolingo"));
});
