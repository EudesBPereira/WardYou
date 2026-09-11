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
// Native share sheets (`Share.share`, invite links, data export) put the app
// in the background exactly like switching away from it, so AppLockGate's
// background→foreground re-lock fires every time — turning every invite share
// into a fingerprint prompt (bug de campo #C). A share sheet isn't "leaving the
// app" the way a home-button press is: the user asked for it, it's system UI
// layered on top, and they're back in seconds. WhatsApp/Signal don't re-lock
// after their own share/camera intents either. `suppressNextRelock()` marks
// the *next* background→foreground cycle as expected so AppLockGate consumes
// it silently instead of locking; it auto-expires so a share sheet that never
// returns (or a genuine backgrounding right after) doesn't leave the app
// permanently unlockable.
const SUPPRESS_WINDOW_MS = 5 * 60_000;
let suppressUntil = 0;

/** Call right before opening a native share sheet / export flow. */
export function suppressNextRelock(): void {
  suppressUntil = Date.now() + SUPPRESS_WINDOW_MS;
}

/** Consumes (clears) the suppression and reports whether it was active. */
export function consumeRelockSuppression(): boolean {
  const active = Date.now() < suppressUntil;
  suppressUntil = 0;
  return active;
}

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
