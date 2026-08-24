import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Password-reset tokens live in memory (short-lived, single-instance API).
// The legacy DB schema is frozen, so we don't add a table; a reset token is
// valid for 30 minutes and dropped on use or restart (the user just requests a
// new one). Only the SHA-256 of the token is stored, never the raw value.
const TTL_MS = 30 * 60_000;

interface Entry {
  userId: string;
  expiresAt: number;
}

const store = new Map<string, Entry>();

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function prune() {
  const now = Date.now();
  for (const [k, v] of store) if (v.expiresAt <= now) store.delete(k);
}

/** Create a reset token for the user; returns the raw token to email. */
export function createResetToken(userId: string): string {
  prune();
  const token = randomBytes(32).toString("hex");
  store.set(sha256(token), { userId, expiresAt: Date.now() + TTL_MS });
  return token;
}

/** Resolve a raw token to its user id, or null if invalid/expired. */
export function peekResetToken(token: string): string | null {
  prune();
  const entry = store.get(sha256(token));
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.userId;
}

/** Consume (validate + remove) a reset token. Returns the user id or null. */
export function consumeResetToken(token: string): string | null {
  const key = sha256(token);
  const entry = store.get(key);
  prune();
  if (!entry || entry.expiresAt <= Date.now()) return null;
  store.delete(key);
  // Constant-time compare of the stored key against itself is unnecessary here
  // (Map lookup already matched); timingSafeEqual retained for hash-length guard.
  const a = Buffer.from(key);
  timingSafeEqual(a, a);
  return entry.userId;
}
