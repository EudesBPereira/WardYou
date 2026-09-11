import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveFamilySosRecipients, type FamilySosMember } from "./sos.js";

// Regression coverage for the finding of 2026-09-11: the "Receber SOS"
// (SosReceive) consent was fully decorative — pushToUsers() fanned an SOS out
// to every active family member regardless of it. resolveFamilySosRecipients
// is the pure decision now sitting between "who's in the family" and "who
// actually gets paged", so it carries direct unit coverage: this is
// life-safety routing logic, not a cosmetic preference.

const ROLE = { admin: 0, guardian: 1, member: 2, child: 3, elder: 4, dependent: 5 };

function member(userId: string, role: number): FamilySosMember {
  return { userId, role };
}

test("an opted-in member receives the alert", () => {
  const members = [member("triggerer", ROLE.member), member("bob", ROLE.member)];
  const { recipientIds, suppressedIds, flooredIds } = resolveFamilySosRecipients(
    "triggerer",
    members,
    new Set(["bob"]),
  );
  assert.deepEqual(recipientIds, ["bob"]);
  assert.deepEqual(suppressedIds, []);
  assert.deepEqual(flooredIds, []);
});

test("an opted-out adult peer is suppressed when the triggerer is not a dependent", () => {
  const members = [member("triggerer", ROLE.member), member("bob", ROLE.member)];
  const { recipientIds, suppressedIds } = resolveFamilySosRecipients("triggerer", members, new Set());
  assert.deepEqual(recipientIds, []);
  assert.deepEqual(suppressedIds, ["bob"]);
});

test("the triggerer is never included as their own recipient", () => {
  const members = [member("triggerer", ROLE.member)];
  const { recipientIds, suppressedIds, flooredIds } = resolveFamilySosRecipients(
    "triggerer",
    members,
    new Set(["triggerer"]), // even if somehow opted in
  );
  assert.deepEqual(recipientIds, []);
  assert.deepEqual(suppressedIds, []);
  assert.deepEqual(flooredIds, []);
});

// The floor: a guardian/admin must always hear about a dependent's SOS.

test("floor: an opted-out guardian still receives a child's SOS", () => {
  const members = [member("kid", ROLE.child), member("mom", ROLE.guardian)];
  const { recipientIds, flooredIds, suppressedIds } = resolveFamilySosRecipients("kid", members, new Set());
  assert.deepEqual(recipientIds, ["mom"]);
  assert.deepEqual(flooredIds, ["mom"]);
  assert.deepEqual(suppressedIds, []);
});

test("floor: an opted-out admin still receives an elder dependent's SOS", () => {
  const members = [member("grandpa", ROLE.elder), member("admin", ROLE.admin)];
  const { recipientIds, flooredIds } = resolveFamilySosRecipients("grandpa", members, new Set());
  assert.deepEqual(recipientIds, ["admin"]);
  assert.deepEqual(flooredIds, ["admin"]);
});

test("floor: a generic 'dependent' role trigger also floors guardians", () => {
  const members = [member("ward", ROLE.dependent), member("guardian1", ROLE.guardian)];
  const { recipientIds, flooredIds } = resolveFamilySosRecipients("ward", members, new Set());
  assert.deepEqual(recipientIds, ["guardian1"]);
  assert.deepEqual(flooredIds, ["guardian1"]);
});

test("floor does NOT extend to a plain member receiver, only admin/guardian", () => {
  const members = [member("kid", ROLE.child), member("sibling", ROLE.member)];
  const { recipientIds, suppressedIds, flooredIds } = resolveFamilySosRecipients("kid", members, new Set());
  assert.deepEqual(recipientIds, []);
  assert.deepEqual(suppressedIds, ["sibling"]);
  assert.deepEqual(flooredIds, []);
});

test("floor does NOT apply when the triggerer is a peer admin/guardian/member (not a dependent)", () => {
  const members = [member("dad", ROLE.guardian), member("mom", ROLE.guardian)];
  const { recipientIds, suppressedIds, flooredIds } = resolveFamilySosRecipients("dad", members, new Set());
  assert.deepEqual(recipientIds, []);
  assert.deepEqual(suppressedIds, ["mom"]);
  assert.deepEqual(flooredIds, []);
});

test("opting in makes the floor moot but doesn't hide it as suppressed or double up", () => {
  const members = [member("kid", ROLE.child), member("mom", ROLE.guardian)];
  const { recipientIds, flooredIds, suppressedIds } = resolveFamilySosRecipients(
    "kid",
    members,
    new Set(["mom"]),
  );
  assert.deepEqual(recipientIds, ["mom"]);
  assert.deepEqual(flooredIds, []); // opt-in satisfied it before the floor was even checked
  assert.deepEqual(suppressedIds, []);
});

test("a full family: opted-in peer, opted-out peer, and a floored guardian all resolve correctly", () => {
  const members = [
    member("kid", ROLE.child),
    member("mom", ROLE.guardian), // opted out, but floored
    member("aunt", ROLE.member), // opted in
    member("uncle", ROLE.member), // opted out, not floored (not admin/guardian)
  ];
  const { recipientIds, suppressedIds, flooredIds } = resolveFamilySosRecipients(
    "kid",
    members,
    new Set(["aunt"]),
  );
  assert.deepEqual(new Set(recipientIds), new Set(["mom", "aunt"]));
  assert.deepEqual(suppressedIds, ["uncle"]);
  assert.deepEqual(flooredIds, ["mom"]);
});
