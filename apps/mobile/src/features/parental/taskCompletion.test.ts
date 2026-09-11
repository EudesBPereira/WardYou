import { test } from "node:test";
import assert from "node:assert/strict";
import { isTaskAvailable } from "./taskCompletion.ts";
import type { TaskDto, CompletionDto } from "./queries.ts";

function task(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: "t1",
    childUserId: "c1",
    title: "Arrumar a cama",
    description: null,
    category: "Household",
    rewardMinutes: 15,
    isRecurring: false,
    isActive: true,
    ...overrides,
  };
}

function completion(overrides: Partial<CompletionDto> = {}): CompletionDto {
  return {
    id: "comp1",
    childTaskId: "t1",
    childUserId: "c1",
    title: "Arrumar a cama",
    rewardMinutes: 15,
    status: "PendingApproval",
    childNote: null,
    completedAt: new Date().toISOString(),
    reviewedAt: null,
    ...overrides,
  };
}

test("no completions at all: available", () => {
  assert.equal(isTaskAvailable(task(), []), true);
});

test("a pending completion for THIS task: not available (already submitted, awaiting review)", () => {
  assert.equal(isTaskAvailable(task(), [completion({ status: "PendingApproval" })]), false);
});

test("a pending completion for a DIFFERENT task: does not block this one", () => {
  const other = completion({ childTaskId: "other-task", status: "PendingApproval" });
  assert.equal(isTaskAvailable(task(), [other]), true);
});

test("a rejected completion: available again (rejection never blocks a retry)", () => {
  assert.equal(isTaskAvailable(task(), [completion({ status: "Rejected", reviewedAt: new Date().toISOString() })]), true);
});

// --- non-recurring: paid once, ever -------------------------------------

test("non-recurring, approved once: never available again", () => {
  const approved = completion({ status: "Approved", reviewedAt: new Date(2026, 0, 1).toISOString() });
  assert.equal(isTaskAvailable(task({ isRecurring: false }), [approved]), false);
});

test("non-recurring, approved long ago: STILL never available (bug de campo, achado de QA 2026-09-11 — a tarefa 'TesteQA' voltava a mostrar 'Concluí!' depois de aprovada e paga)", () => {
  const approvedLastYear = completion({ status: "Approved", reviewedAt: new Date(2025, 0, 1).toISOString() });
  assert.equal(isTaskAvailable(task({ isRecurring: false }), [approvedLastYear]), false);
});

// --- recurring: paid once per local calendar day ------------------------

test("recurring, approved earlier TODAY: not available again today", () => {
  const now = new Date(2026, 6, 9, 20, 0);
  const approvedThisMorning = completion({ status: "Approved", reviewedAt: new Date(2026, 6, 9, 8, 0).toISOString() });
  assert.equal(isTaskAvailable(task({ isRecurring: true }), [approvedThisMorning], now), false);
});

test("recurring, approved YESTERDAY: available again today", () => {
  const now = new Date(2026, 6, 9, 8, 0);
  const approvedYesterday = completion({ status: "Approved", reviewedAt: new Date(2026, 6, 8, 20, 0).toISOString() });
  assert.equal(isTaskAvailable(task({ isRecurring: true }), [approvedYesterday], now), true);
});
