import { create } from "zustand";
import { storage } from "@/lib/storage";

const KEY = "wardyou_onboarding_ack";

/** Which adult experience a brand-new account picked on the first-login setup
 *  screen, while it still has no family membership (server profile
 *  "onboarding"). `tutor` manages a family; `traveler` just wants to be
 *  accompanied on a trip — so it gets a trips-focused shell, no family
 *  management. Child/elder aren't stored here (they go through invite +
 *  approval, which the server-derived profile already reflects). */
export type OnboardingMode = "tutor" | "traveler";

interface OnboardingState {
  modeByUserId: Record<string, OnboardingMode>;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  acknowledge: (userId: string, mode: OnboardingMode) => Promise<void>;
}

/**
 * Tracks which user ids already went through the first-login "what is this
 * device for" onboarding, and which adult mode they chose, so they aren't
 * re-prompted on every cold start. Pure UX state — the server-derived
 * `appProfile` (child/elder/pending/onboarding) is what actually gates access,
 * so a stale or missing flag here never grants anything.
 */
export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  modeByUserId: {},
  hydrated: false,

  hydrate: async () => {
    const raw = await storage.getItem(KEY);
    let modeByUserId: Record<string, OnboardingMode> = {};
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          // Legacy shape: a plain array of acknowledged user ids (all tutors).
          for (const id of parsed) modeByUserId[id as string] = "tutor";
        } else if (parsed && typeof parsed === "object") {
          const obj = parsed as { modeByUserId?: Record<string, OnboardingMode> };
          modeByUserId = obj.modeByUserId ?? (parsed as Record<string, OnboardingMode>);
        }
      } catch {
        modeByUserId = {};
      }
    }
    set({ modeByUserId, hydrated: true });
  },

  acknowledge: async (userId, mode) => {
    const next = { ...get().modeByUserId, [userId]: mode };
    await storage.setItem(KEY, JSON.stringify({ modeByUserId: next }));
    set({ modeByUserId: next });
  },
}));
