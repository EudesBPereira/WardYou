import { create } from "zustand";
import { storage } from "@/lib/storage";

const KEY = "wardyou_app_lock_enabled";

interface AppLockState {
  /** The user turned the biometric app lock on (persisted). */
  enabled: boolean;
  /** Hydration finished (avoids a lock flash before we know the setting). */
  hydrated: boolean;
  /** Runtime: the app is currently locked and needs a biometric to proceed. */
  locked: boolean;
  hydrate: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  lock: () => void;
  unlock: () => void;
}

/**
 * WhatsApp-style biometric app lock. `enabled` is persisted; `locked` is
 * runtime state driven by AppLockGate (locks on cold start and whenever the
 * app returns from the background). The login screen is never locked — the
 * gate only arms while authenticated.
 *
 * LIGADO POR PADRAO desde 2026-09-09. Num app cujo proposito e proteger
 * crianca, o adversario mais provavel nao e um invasor remoto: e a propria
 * crianca com o telefone do responsavel na mao. Deixar isto opt-in, escondido
 * em Ajustes, significava que quase ninguem teria. Quem nao quiser, desliga —
 * e desligar pede autenticacao.
 *
 * Isto NAO substitui o `confirmSensitive` nas acoes destrutivas: o app lock so
 * re-tranca quando o app volta do background, entao nao cobre a janela em que o
 * responsavel esta com o app aberto e passa o telefone.
 */
export const useAppLock = create<AppLockState>((set) => ({
  enabled: true,
  hydrated: false,
  // Start locked so a cold start with the lock enabled prompts immediately,
  // before any authenticated screen is painted.
  locked: true,

  hydrate: async () => {
    try {
      const raw = await storage.getItem(KEY);
      // Sem valor gravado = instalacao nova ou usuario que nunca mexeu:
      // vale o padrao ligado. So `"0"` explicito desliga.
      set({ enabled: raw !== "0", hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  setEnabled: async (enabled) => {
    await storage.setItem(KEY, enabled ? "1" : "0");
    // Enabling doesn't lock the current session (the user just authenticated to
    // turn it on); it takes effect on the next background→foreground / restart.
    set({ enabled, locked: false });
  },

  lock: () => set({ locked: true }),
  unlock: () => set({ locked: false }),
}));
