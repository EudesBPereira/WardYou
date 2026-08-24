import { create } from "zustand";
import { storage } from "@/lib/storage";
import type { AuthResponse } from "@/services/api/types";

const SESSION_KEY = "wityu_session";

export interface Session {
  userId: string;
  fullName: string;
  email: string;
  avatarUrl?: string | null;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}

type Status = "loading" | "authenticated" | "unauthenticated";

interface SessionState {
  status: Status;
  session: Session | null;
  hydrate: () => Promise<void>;
  reloadFromStorage: () => Promise<Session | null>;
  setSession: (auth: AuthResponse) => Promise<void>;
  updateTokens: (accessToken: string, refreshToken: string, accessTokenExpiresAt: string, refreshTokenExpiresAt: string) => Promise<void>;
  setAvatarUrl: (avatarUrl: string | null) => Promise<void>;
  clear: () => Promise<void>;
}

function fromAuth(auth: AuthResponse): Session {
  return {
    userId: auth.userId,
    fullName: auth.fullName,
    email: auth.email,
    avatarUrl: auth.avatarUrl ?? null,
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken,
    accessTokenExpiresAt: auth.accessTokenExpiresAt,
    refreshTokenExpiresAt: auth.refreshTokenExpiresAt,
  };
}

export const useSession = create<SessionState>((set, get) => ({
  status: "loading",
  session: null,

  hydrate: async () => {
    const raw = await storage.getItem(SESSION_KEY);
    if (!raw) {
      set({ status: "unauthenticated", session: null });
      return;
    }
    try {
      const session = JSON.parse(raw) as Session;
      set({ status: "authenticated", session });
    } catch {
      await storage.removeItem(SESSION_KEY);
      set({ status: "unauthenticated", session: null });
    }
  },

  /** Re-read the persisted session from storage (which a headless background
   *  task may have rotated tokens into) and adopt it if its refresh token
   *  differs from what's in memory. Returns the freshest session, or null. */
  reloadFromStorage: async () => {
    const raw = await storage.getItem(SESSION_KEY);
    if (!raw) return null;
    try {
      const stored = JSON.parse(raw) as Session;
      const current = get().session;
      if (!current || stored.refreshToken !== current.refreshToken) {
        set({ status: "authenticated", session: stored });
      }
      return stored;
    } catch {
      return null;
    }
  },

  setSession: async (auth) => {
    const session = fromAuth(auth);
    await storage.setItem(SESSION_KEY, JSON.stringify(session));
    set({ status: "authenticated", session });
  },

  updateTokens: async (accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt) => {
    const current = get().session;
    if (!current) return;
    const session: Session = {
      ...current,
      accessToken,
      refreshToken,
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
    };
    await storage.setItem(SESSION_KEY, JSON.stringify(session));
    set({ session });
  },

  setAvatarUrl: async (avatarUrl) => {
    const current = get().session;
    if (!current) return;
    const session: Session = { ...current, avatarUrl };
    await storage.setItem(SESSION_KEY, JSON.stringify(session));
    set({ session });
  },

  clear: async () => {
    await storage.removeItem(SESSION_KEY);
    set({ status: "unauthenticated", session: null });
  },
}));

/** Read the current access token outside React (for the HTTP client). */
export function getAccessToken(): string | null {
  return useSession.getState().session?.accessToken ?? null;
}
