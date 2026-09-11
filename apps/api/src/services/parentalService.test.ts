import { test } from "node:test";
import assert from "node:assert/strict";
import { isTaskAlreadyCredited, normalizeDomain } from "./parentalService.js";

// Regression coverage for bug de campo #1 (2026-09-11): a non-recurring task
// kept showing "Concluí!" after being approved. The child resubmitted it, the
// guardian approved again, and each round-trip minted another RewardMinutes
// extra-time grant — a 15min task turned into +30min, +45min... of real
// screen time with no guardrail. `isTaskAlreadyCredited` is the pure decision
// `submitCompletion` now consults before allowing a new completion row.

test("non-recurring task with no prior approval is payable", () => {
  assert.equal(isTaskAlreadyCredited(false, []), false);
});

test("non-recurring task already approved once blocks forever (the field bug)", () => {
  const approvedAt = new Date("2026-09-10T12:00:00Z");
  assert.equal(isTaskAlreadyCredited(false, [approvedAt]), true);
});

test("non-recurring task blocks even long after the original approval", () => {
  const approvedLastMonth = new Date("2026-08-01T12:00:00Z");
  const now = new Date("2026-09-11T15:00:00Z");
  assert.equal(isTaskAlreadyCredited(false, [approvedLastMonth], now), true);
});

test("recurring task with no prior approval is payable", () => {
  assert.equal(isTaskAlreadyCredited(true, []), false);
});

test("recurring task already approved earlier the same local day blocks a second credit", () => {
  // America/Sao_Paulo (default ELDER_TZ) is UTC-3, so 13:00 UTC is 10:00 local.
  const approvedThisMorning = new Date("2026-09-11T13:00:00Z");
  const now = new Date("2026-09-11T20:00:00Z"); // 17:00 local, same day
  assert.equal(isTaskAlreadyCredited(true, [approvedThisMorning], now), true);
});

test("recurring task approved yesterday is payable again today", () => {
  const approvedYesterday = new Date("2026-09-10T13:00:00Z"); // 10:00 local on the 10th
  const now = new Date("2026-09-11T13:00:00Z"); // 10:00 local on the 11th
  assert.equal(isTaskAlreadyCredited(true, [approvedYesterday], now), false);
});

// Regression coverage for bug de campo #8 (2026-09-11): the blocked-websites
// list accepted "qatestblock. com" (a stray internal space) and stored it
// verbatim — a rule that can never match a real hostname, so the site stayed
// reachable while the guardian believed it was blocked.

test("normalizeDomain strips an internal space around a dot", () => {
  assert.equal(normalizeDomain("qatestblock. com"), "qatestblock.com");
});

test("normalizeDomain strips scheme, path and www", () => {
  assert.equal(normalizeDomain("https://www.Example.com/path?x=1"), "example.com");
});

test("normalizeDomain rejects a single-label non-hostname", () => {
  assert.equal(normalizeDomain("not a domain"), null);
});

test("normalizeDomain rejects an empty string", () => {
  assert.equal(normalizeDomain(""), null);
});

test("normalizeDomain accepts a plain hostname unchanged (case-folded)", () => {
  assert.equal(normalizeDomain("Sub.Example.CO"), "sub.example.co");
});
