import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

// Port of the .NET Pbkdf2PasswordHasher (WardYou.Infrastructure.Security).
// Format: `{iterations}.{base64Salt}.{base64Hash}` — SHA-512, 16-byte salt,
// 32-byte key, 100_000 iterations. Kept byte-compatible so accounts created by
// the legacy .NET API keep logging in unchanged.
const SALT_SIZE = 16;
const KEY_SIZE = 32;
const ITERATIONS = 100_000;
const DIGEST = "sha512";

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_SIZE);
  const hash = pbkdf2Sync(Buffer.from(password, "utf8"), salt, ITERATIONS, KEY_SIZE, DIGEST);
  return `${ITERATIONS}.${salt.toString("base64")}.${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(".");
  if (parts.length !== 3) return false;

  const iterations = Number.parseInt(parts[0], 10);
  if (!Number.isFinite(iterations)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[1], "base64");
    expected = Buffer.from(parts[2], "base64");
  } catch {
    return false;
  }

  const actual = pbkdf2Sync(Buffer.from(password, "utf8"), salt, iterations, expected.length, DIGEST);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
