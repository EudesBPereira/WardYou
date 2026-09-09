import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { apiClient, ApiError } from "./client";
import { env, useMocks } from "@/lib/env";
import { useSession } from "@/stores/session";
import type {
  AuthResponse,
  LoginRequest,
  RegisterRequest,
  RegisterDeviceRequest,
} from "./types";

/** Build a fake session for the web/offline preview when no API is configured. */
function mockAuth(email: string, fullName?: string): AuthResponse {
  const now = Date.now();
  const name = fullName ?? email.split("@")[0].replace(/^\w/, (c) => c.toUpperCase());
  return {
    userId: "mock-user",
    fullName: name,
    email,
    accessToken: "mock-access-token",
    refreshToken: "mock-refresh-token",
    accessTokenExpiresAt: new Date(now + 15 * 60_000).toISOString(),
    refreshTokenExpiresAt: new Date(now + 30 * 24 * 60 * 60_000).toISOString(),
    avatarUrl: null,
  };
}

export const authApi = {
  async login(req: LoginRequest): Promise<AuthResponse> {
    const auth = useMocks
      ? mockAuth(req.email)
      : await apiClient.post<AuthResponse>("/api/v1/auth/login", req, false);
    await useSession.getState().setSession(auth);
    return auth;
  },

  async register(req: RegisterRequest): Promise<AuthResponse> {
    const auth = useMocks
      ? mockAuth(req.email, req.fullName)
      : await apiClient.post<AuthResponse>("/api/v1/auth/register", req, false);
    await useSession.getState().setSession(auth);
    return auth;
  },

  /**
   * Google Sign-In (server-side auth-code flow). Opens the API's /external/google/start
   * in an auth session; the API bounces through Google and redirects back to
   * `wardyou://auth/callback?code=…`, which we exchange for real tokens. First sign-in
   * auto-creates the account server-side.
   */
  async googleSignIn(): Promise<AuthResponse> {
    if (useMocks) {
      const auth = mockAuth("usuario.google@wardyou.com", "Usuário Google");
      await useSession.getState().setSession(auth);
      return auth;
    }

    const redirectUrl = "wardyou://auth/callback";
    const startUrl = `${env.apiBaseUrl.replace(/\/+$/, "")}/api/v1/auth/external/google/start`;
    const result = await WebBrowser.openAuthSessionAsync(startUrl, redirectUrl);

    if (result.type === "cancel" || result.type === "dismiss") {
      throw new ApiError(0, "cancelled");
    }
    if (result.type !== "success" || !result.url) {
      throw new ApiError(0, "Falha na autenticação com o Google.");
    }

    const { queryParams } = Linking.parse(result.url);
    const code = queryParams?.code as string | undefined;
    const error = queryParams?.error as string | undefined;
    if (error || !code) {
      throw new ApiError(0, "Falha na autenticação com o Google.");
    }

    const auth = await apiClient.post<AuthResponse>("/api/v1/auth/external/exchange", { code }, false);
    await useSession.getState().setSession(auth);
    return auth;
  },

  /** Request a password-reset email. Always resolves (the API never reveals
   *  whether the address exists); the reset itself happens on the web page the
   *  emailed link opens. */
  async forgotPassword(email: string): Promise<void> {
    if (useMocks) return;
    await apiClient.post("/api/v1/auth/forgot-password", { email }, false);
  },

  async logout(): Promise<void> {
    const refreshToken = useSession.getState().session?.refreshToken;
    try {
      if (!useMocks && refreshToken) {
        await apiClient.post("/api/v1/auth/logout", { refreshToken });
      }
    } finally {
      await useSession.getState().clear();
    }
  },

  registerDevice(req: RegisterDeviceRequest) {
    return apiClient.post<{ deviceId: string }>("/api/v1/auth/register-device", req);
  },
};
