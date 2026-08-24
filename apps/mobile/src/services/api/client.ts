import { env } from "@/lib/env";
import { useSession, getAccessToken } from "@/stores/session";
import type { AuthResponse } from "./types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  auth?: boolean;
  signal?: AbortSignal;
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshWith(refreshToken: string): Promise<AuthResponse | "invalid" | "error"> {
  try {
    const res = await fetch(`${env.apiBaseUrl}/api/v1/auth/refresh-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (res.ok) return (await res.json()) as AuthResponse;
    // 4xx = the token is genuinely rejected; 5xx/other = transient.
    return res.status >= 400 && res.status < 500 ? "invalid" : "error";
  } catch {
    return "error"; // network failure — never a reason to log out
  }
}

async function doRefresh(): Promise<boolean> {
  // Start from the FRESHEST stored token: a headless background task (trip FGS,
  // parental/trip push) may have rotated it in storage while our in-memory copy
  // went stale. Using the stale one would 401 and log the user out mid-session.
  const stored = await useSession.getState().reloadFromStorage();
  const refreshToken = stored?.refreshToken ?? useSession.getState().session?.refreshToken;
  if (!refreshToken) return false;

  let result = await refreshWith(refreshToken);

  // If it was rejected, a concurrent refresher may have JUST rotated the token
  // in storage — adopt that and try once more before giving up.
  if (result === "invalid") {
    const latest = await useSession.getState().reloadFromStorage();
    if (latest && latest.refreshToken !== refreshToken) {
      result = await refreshWith(latest.refreshToken);
    }
  }

  if (result === "invalid") {
    await useSession.getState().clear();
    return false;
  }
  if (result === "error") return false; // keep the session; retry on the next call

  await useSession.getState().updateTokens(
    result.accessToken,
    result.refreshToken,
    result.accessTokenExpiresAt,
    result.refreshTokenExpiresAt,
  );
  return true;
}

/** Refresh once, sharing a single in-flight request across concurrent 401s. */
function refreshTokens(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function send<T>(path: string, options: RequestOptions, retrying = false): Promise<T> {
  const { method = "GET", body, auth = true, signal } = options;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${env.apiBaseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  if (res.status === 401 && auth && !retrying) {
    const ok = await refreshTokens();
    if (ok) return send<T>(path, options, true);
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      message = (data?.message as string) ?? (data?.title as string) ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const apiClient = {
  get: <T>(path: string, signal?: AbortSignal) => send<T>(path, { method: "GET", signal }),
  post: <T>(path: string, body?: unknown, auth = true) => send<T>(path, { method: "POST", body, auth }),
  put: <T>(path: string, body?: unknown) => send<T>(path, { method: "PUT", body }),
  del: <T>(path: string) => send<T>(path, { method: "DELETE" }),
};
