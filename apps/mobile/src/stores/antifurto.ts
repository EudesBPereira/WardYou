import { create } from "zustand";
import { storage } from "@/lib/storage";

const KEY = "wityu_antifurto";

interface Persisted {
  armed: boolean;
  pin: string | null;
  soundEnabled: boolean;
}

interface AntifurtoState extends Persisted {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setArmed: (armed: boolean) => Promise<void>;
  setPin: (pin: string) => Promise<void>;
  setSoundEnabled: (enabled: boolean) => Promise<void>;
}

async function persist(state: Persisted) {
  await storage.setItem(KEY, JSON.stringify(state));
}

/**
 * "Modo Guarda" (antifurto Fase 1 — see docs/antifurto.md): armed state, the
 * dismiss PIN, and the siren toggle, persisted via SecureStore so they survive
 * app restarts. This is a device-local deterrent, not a real device lock —
 * see the doc for the platform limits that shape that decision.
 */
export const useAntifurtoStore = create<AntifurtoState>((set, get) => ({
  armed: false,
  pin: null,
  soundEnabled: true,
  hydrated: false,

  hydrate: async () => {
    const raw = await storage.getItem(KEY);
    if (!raw) {
      set({ hydrated: true });
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<Persisted>;
      set({
        armed: parsed.armed ?? false,
        pin: parsed.pin ?? null,
        soundEnabled: parsed.soundEnabled ?? true,
        hydrated: true,
      });
    } catch {
      set({ hydrated: true });
    }
  },

  setArmed: async (armed) => {
    const next = { armed, pin: get().pin, soundEnabled: get().soundEnabled };
    await persist(next);
    set({ armed });
  },

  setPin: async (pin) => {
    const next = { armed: get().armed, pin, soundEnabled: get().soundEnabled };
    await persist(next);
    set({ pin });
  },

  setSoundEnabled: async (soundEnabled) => {
    const next = { armed: get().armed, pin: get().pin, soundEnabled };
    await persist(next);
    set({ soundEnabled });
  },
}));
