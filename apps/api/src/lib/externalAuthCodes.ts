import { randomBytes } from "node:crypto";

/**
 * One-time codes bridging the server-side OAuth callback and the mobile app.
 * After a successful external login the API redirects to `wardyou://auth/callback?code=…`;
 * the app then POSTs that code to `/external/exchange` to receive the real tokens.
 * Ports `ExternalAuthCodeStore` from the legacy .NET API. In-memory + short-lived —
 * fine for a single instance; move to Redis if the API is ever scaled out.
 */

const LIFETIME_MS = 2 * 60_000;

interface Entry<T> {
  payload: T;
  expiresAt: number;
}

// AuthResponse is assembled by the route; keep this store payload-agnostic.
const codes = new Map<string, Entry<unknown>>();

function cleanup(): void {
  const now = Date.now();
  for (const [code, entry] of codes) {
    if (entry.expiresAt <= now) codes.delete(code);
  }
}

/** Issue a URL-safe one-time code holding the given payload (2-minute TTL). */
export function issueExternalAuthCode<T>(payload: T): string {
  cleanup();
  const code = randomBytes(36).toString("base64url");
  codes.set(code, { payload, expiresAt: Date.now() + LIFETIME_MS });
  return code;
}

/** Consume a code, returning its payload once (null if missing/expired). */
export function takeExternalAuthCode<T>(code: string): T | null {
  cleanup();
  if (!code) return null;
  const entry = codes.get(code);
  if (!entry || entry.expiresAt <= Date.now()) {
    codes.delete(code);
    return null;
  }
  codes.delete(code);
  return entry.payload as T;
}
