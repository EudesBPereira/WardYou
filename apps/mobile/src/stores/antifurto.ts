import { create } from "zustand";
import { storage } from "@/lib/storage";

const KEY = "wardyou_antifurto";

interface Persisted {
  armed: boolean;
  soundEnabled: boolean;
}

interface AntifurtoState extends Persisted {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setArmed: (armed: boolean) => Promise<void>;
  setSoundEnabled: (enabled: boolean) => Promise<void>;
}

async function persist(state: Persisted) {
  await storage.setItem(KEY, JSON.stringify(state));
}

/**
 * "Modo Guarda" (antifurto Fase 1 — see docs/antifurto.md): armed state e o
 * toggle da sirene, persistidos no SecureStore.
 *
 * O PIN proprio do app foi REMOVIDO em 2026-09-09. Ele era redundante:
 * `authenticateBiometric` usa `disableDeviceFallback: false`, entao o proprio SO
 * ja cai para o PIN/padrao do aparelho quando a digital falha. Manter um PIN do
 * app significava um segredo a mais, guardado em texto puro, mais fraco que o do
 * SO e que o usuario ainda tinha de lembrar. Chaves antigas com `pin` no JSON
 * persistido sao simplesmente ignoradas na hidratacao.
 */
export const useAntifurtoStore = create<AntifurtoState>((set, get) => ({
  armed: false,
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
        soundEnabled: parsed.soundEnabled ?? true,
        hydrated: true,
      });
    } catch {
      set({ hydrated: true });
    }
  },

  setArmed: async (armed) => {
    const next = { armed, soundEnabled: get().soundEnabled };
    await persist(next);
    set({ armed });
  },

  setSoundEnabled: async (soundEnabled) => {
    const next = { armed: get().armed, soundEnabled };
    await persist(next);
    set({ soundEnabled });
  },
}));
