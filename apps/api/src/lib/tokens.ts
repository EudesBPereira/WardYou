import { createHash, randomBytes } from "node:crypto";
import { env } from "../env.js";

// Port of JwtTokenService's refresh-token helpers. The access token itself is
// signed via @fastify/jwt in the route (HS256, iss/aud from env).

/** 64 random bytes, base64 — matches GenerateRefreshToken(). */
export function generateRefreshToken(): string {
  return randomBytes(64).toString("base64");
}

/** SHA-256 hex (UPPERCASE) — matches .NET Convert.ToHexString, so refresh
 *  tokens minted by the legacy API still resolve against the stored hash. */
export function hashRefreshToken(refreshToken: string): string {
  return createHash("sha256").update(Buffer.from(refreshToken, "utf8")).digest("hex").toUpperCase();
}

export function accessTokenExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + env.ACCESS_TOKEN_MINUTES * 60_000);
}

export function refreshTokenExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + env.REFRESH_TOKEN_DAYS * 24 * 60 * 60_000);
}
