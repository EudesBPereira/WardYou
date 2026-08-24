import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveAppProfile } from "./profileService.js";
import { ROLE } from "./familyService.js";

// Regression coverage for the 2026-07-09 bug: a user with no active family
// membership must never fall back to the full adult experience.

test("no memberships at all → onboarding", () => {
  assert.equal(deriveAppProfile([], false), "onboarding");
});

test("only a pending membership → pending", () => {
  assert.equal(deriveAppProfile([], true), "pending");
});

test("active child role wins regardless of other roles", () => {
  assert.equal(deriveAppProfile([ROLE.guardian, ROLE.child], false), "child");
});

test("active dependent role maps to child mode too", () => {
  assert.equal(deriveAppProfile([ROLE.dependent], false), "child");
});

test("elder outranks guardian/member", () => {
  assert.equal(deriveAppProfile([ROLE.member, ROLE.elder], false), "elder");
});

test("admin/guardian → guardian profile", () => {
  assert.equal(deriveAppProfile([ROLE.admin], false), "guardian");
  assert.equal(deriveAppProfile([ROLE.guardian], false), "guardian");
});

test("plain active member → member profile (not onboarding/pending)", () => {
  assert.equal(deriveAppProfile([ROLE.member], true), "member");
});
