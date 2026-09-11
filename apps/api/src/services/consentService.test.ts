import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSosOptIns } from "./consentService.js";

// Regression coverage for the finding of 2026-09-11: "Receber SOS" (SosReceive)
// is the one consent type in this file that must default to GRANTED, not
// denied, when a user has never touched it — the opposite of every other
// consent here (LocationSharing, BatteryStatus, ...). resolveSosOptIns is the
// pure decision whoReceivesFamilySos delegates to; this is what stands between
// "nobody ever opened the consent screen" and a silent SOS.

function row(userId: string, isActive: boolean, grantedAt: string) {
  return { UserId: userId, IsActive: isActive, GrantedAt: new Date(grantedAt) };
}

test("a user with no SosReceive row at all defaults to opted in", () => {
  const result = resolveSosOptIns(["alice"], []);
  assert.equal(result.has("alice"), true);
});

test("a user with only an active accept row is opted in", () => {
  const rows = [row("alice", true, "2026-09-01T00:00:00Z")];
  assert.equal(resolveSosOptIns(["alice"], rows).has("alice"), true);
});

test("a user whose latest row is an explicit revoke is opted out", () => {
  const rows = [row("alice", false, "2026-09-01T00:00:00Z")];
  assert.equal(resolveSosOptIns(["alice"], rows).has("alice"), false);
});

test("only the LATEST row counts: accept after a prior revoke opts back in", () => {
  const rows = [
    row("alice", false, "2026-09-01T00:00:00Z"), // revoked first
    row("alice", true, "2026-09-05T00:00:00Z"), // then re-accepted, later
  ];
  assert.equal(resolveSosOptIns(["alice"], rows).has("alice"), true);
});

test("only the LATEST row counts: revoke after a prior accept opts back out", () => {
  const rows = [
    row("alice", true, "2026-09-01T00:00:00Z"),
    row("alice", false, "2026-09-05T00:00:00Z"), // later revoke wins
  ];
  assert.equal(resolveSosOptIns(["alice"], rows).has("alice"), false);
});

test("row order in the input doesn't matter — sorted by GrantedAt internally", () => {
  const rows = [
    row("alice", true, "2026-09-05T00:00:00Z"), // latest, listed first here
    row("alice", false, "2026-09-01T00:00:00Z"),
  ];
  assert.equal(resolveSosOptIns(["alice"], rows).has("alice"), true);
});

test("resolves independently per user in a batch, absent users still default on", () => {
  const rows = [row("bob", false, "2026-09-01T00:00:00Z")];
  const result = resolveSosOptIns(["alice", "bob", "carol"], rows);
  assert.equal(result.has("alice"), true); // no row → default on
  assert.equal(result.has("bob"), false); // explicit revoke → off
  assert.equal(result.has("carol"), true); // no row → default on
});

test("empty candidate list returns an empty set", () => {
  assert.deepEqual(resolveSosOptIns([], []), new Set());
});
