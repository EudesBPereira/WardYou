import { Linking } from "react-native";
import { requireNativeModule } from "expo-modules-core";

export interface EnforcementState {
  enabled: boolean;
  blockAll: boolean;
  blockedPackages: string[];
  whitelistedPackages: string[];
  /** Sleep/block-all windows as `[{s,e,d}]` (minutes since midnight, days
   *  bitmask bit0=Mon), re-evaluated natively so they fire with the app closed. */
  hardBlockWindowsJson?: string;
  /** `{"com.pkg": epochMs}` temporary allows — expired natively, so a grant
   *  can't become permanent just because the app was never reopened. */
  tempAllowsJson?: string;
  /** Epoch ms deadline of a TIMED remote pause ("pausar por 30min"), as a
   *  string ("0" / absent = no deadline to self-expire — either not paused,
   *  or an indefinite pause that only lifts on an explicit Resume). Checked
   *  against the device clock on every accessibility event so a closed
   *  child phone doesn't stay paused past the guardian's intended duration. */
  pauseUntilMillis?: string;
  /** Domains to block inside a recognized mobile browser (address-bar text
   *  read via AccessibilityService — see AppBlockAccessibilityService.kt /
   *  AppBlockWebsiteRules.kt). Best-effort: covers Chrome, Firefox, Edge,
   *  Samsung Internet and a generic fallback for other browsers, by reading
   *  what's typed in the address bar; does NOT reach a private/incognito tab
   *  reliably (unverified on-device), an in-app webview (e.g. a link opened
   *  inside Instagram), or a browser this heuristic fails to recognize. */
  blockedWebsites?: string[];
}

export interface UsageItem {
  packageName: string;
  minutes: number;
  /** Friendly app name resolved natively (PackageManager label, same
   *  resolver as `InstalledApp.label`), falling back to a humanized guess —
   *  never the raw package. */
  label: string;
}

export interface InstalledApp {
  packageName: string;
  label: string;
}

/**
 * Three-state (plus "unknown") health of the enforcement AccessibilityService.
 *
 * `unknown` is deliberately NOT folded into "off": see the `accessibilityStatus`
 * note in AppBlockModule.kt. Announcing "protection is off" when the honest
 * answer is "I couldn't check" trains people to dismiss the warning, and then
 * it is worth nothing on the day protection really is down.
 */
export type AccessibilityStatus =
  /** Granted by the user AND actually bound/running. */
  | "running"
  /** Granted, but the enforcer is not running (crashed service) - dangerous:
   *  the OS toggle still reads "on" while nothing is being enforced. */
  | "granted_not_running"
  /** Never granted, or the user turned it off. */
  | "not_granted"
  /** Could not measure. Not a claim about protection either way. */
  | "unknown";

interface AppBlockNativeModule {
  isAccessibilityServiceEnabled(): boolean;
  /** Added 2026-09-11; absent on an older APK - see nativeLog(). */
  nativeLog?(tag: string, message: string): void;
  /** Added 2026-09-11; absent on an APK built before that - see
   *  getAccessibilityStatus() for the fallback. */
  accessibilityStatus?(): string;
  openAccessibilitySettings(): void;
  setEnforcementState(state: EnforcementState): void;
  hasUsageAccess(): boolean;
  openUsageAccessSettings(): void;
  getUsageTodayJson(): string;
  getInstalledAppsJson(): string;
  canLockScreen(): boolean;
  lockScreen(): boolean;
  /** Added 2026-09-12; absent on an APK built before that — see startSiren(). */
  startSiren?(): boolean;
  stopSiren?(): void;
  isSirenPlaying?(): boolean;
  canScheduleExactAlarms(): boolean;
  requestScheduleExactAlarm(): void;
  isIgnoringBatteryOptimizations(): boolean;
  requestIgnoreBatteryOptimizations(): void;
  isAggressiveOem(): boolean;
  openAutostartSettings(): void;
  openAppSettings(): void;
  openLocationSettings(): void;
  drainPendingRequestsJson(): string;
  lastOverlayResultJson(): string;
  canDrawOverlays(): boolean;
  requestOverlayPermission(): void;
  isDeviceAdminActive(): boolean;
  requestDeviceAdmin(): void;
  consumeAdminDisabledFlag(): boolean;
  addListener?(eventName: string, listener: () => void): { remove(): void };
}

export interface OverlayDiagnostic {
  /** "a11y-overlay" | "app-overlay" | "failed: ..." */
  result: string;
  /** epoch ms of the last attempt */
  at: number;
}

export interface PendingBlockRequest {
  type: "access" | "extra";
  packageName?: string;
  label?: string;
  minutes?: number;
}

// Only unavailable if the dev client / APK was built before this module was
// added (i.e. needs a fresh `expo prebuild` + native rebuild, not just a JS
// bundle push) — never throw for that, just behave as if disabled.
let nativeModule: AppBlockNativeModule | null = null;
try {
  nativeModule = requireNativeModule<AppBlockNativeModule>("AppBlock");
} catch {
  nativeModule = null;
}

const ACCESSIBILITY_STATUSES: AccessibilityStatus[] = [
  "running",
  "granted_not_running",
  "not_granted",
  "unknown",
];

export function getAccessibilityStatus(): AccessibilityStatus {
  try {
    // Native module missing entirely (an APK built before this module
    // existed): there is no way to look, so say exactly that.
    if (!nativeModule) return "unknown";
    if (typeof nativeModule.accessibilityStatus === "function") {
      const raw = nativeModule.accessibilityStatus();
      return (ACCESSIBILITY_STATUSES as string[]).includes(raw)
        ? (raw as AccessibilityStatus)
        : "unknown";
    }
    // APK predates accessibilityStatus: the old boolean is all we have. Its
    // `false` genuinely is ambiguous, but reporting every such device as
    // "unknown" would silence a real "turn it on" prompt, so the old meaning
    // is kept for old binaries only.
    return nativeModule.isAccessibilityServiceEnabled() ? "running" : "not_granted";
  } catch {
    return "unknown";
  }
}

/** Legacy boolean. `true` only for a service proven to be running - an
 *  unverifiable measurement reads as `false` here, so prefer
 *  getAccessibilityStatus() anywhere the answer is shown to a human or sent
 *  to the guardian. */
export function isAccessibilityServiceEnabled(): boolean {
  return getAccessibilityStatus() === "running";
}

/**
 * Escreve uma linha no logcat de forma SINCRONA, via JSI.
 *
 * Existe porque `console.warn` nao serve para medir a tarefa headless: quando
 * a Activity esta em pausa e a tarefa headless do expo-task-manager nao
 * chegou a iniciar, o JavaTimerManager do React Native suspende todos os
 * timers do JS -- promises param de resolver e qualquer instrumento que
 * dependa de `await` (o nosso storage, por exemplo) emudece exatamente no
 * momento que a gente precisa observar. Uma `Function` de modulo Expo e uma
 * chamada direta: nao passa por timer nem por fila assincrona.
 *
 * (Correcao de leitura, para o registro: o `console.log` NAO e removido neste
 * projeto -- nao ha `transform-remove-console` no babel.config.js, e linhas
 * `ReactNativeJS` aparecem no logcat normalmente. O silencio que observamos em
 * campo nao era o log sendo apagado; era o codigo depois do primeiro `await`
 * nunca chegando a rodar.)
 *
 * Best-effort: em APK antigo, iOS ou web cai no `console.warn`.
 */
export function nativeLog(tag: string, message: string): void {
  try {
    if (nativeModule && typeof nativeModule.nativeLog === "function") {
      nativeModule.nativeLog(tag, message);
      return;
    }
  } catch {
    /* cai no console abaixo */
  }
  console.warn(`${tag} ${message}`);
}

export function openAccessibilitySettings(): void {
  try {
    if (nativeModule) {
      nativeModule.openAccessibilitySettings();
      return;
    }
  } catch {
    /* fall through to the Linking fallback */
  }
  // Native module unavailable (stale APK, load failure): still land the user
  // on the right OS screen instead of a button that visibly does nothing.
  Linking.sendIntent("android.settings.ACCESSIBILITY_SETTINGS").catch(() => {
    Linking.openSettings().catch(() => {});
  });
}

export function setEnforcementState(state: EnforcementState): void {
  try {
    nativeModule?.setEnforcementState(state);
  } catch {
    /* best-effort — enforcement resumes next successful sync */
  }
}

export function hasUsageAccess(): boolean {
  try {
    return nativeModule?.hasUsageAccess() ?? false;
  } catch {
    return false;
  }
}

export function openUsageAccessSettings(): void {
  try {
    nativeModule?.openUsageAccessSettings();
  } catch {
    /* best-effort */
  }
}

/** Per-app foreground minutes since local midnight (empty if no access). */
export function getUsageToday(): UsageItem[] {
  try {
    const json = nativeModule?.getUsageTodayJson() ?? "[]";
    const parsed = JSON.parse(json) as UsageItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Launchable apps installed on this device (package + display label). */
export function getInstalledApps(): InstalledApp[] {
  try {
    const json = nativeModule?.getInstalledAppsJson() ?? "[]";
    const parsed = JSON.parse(json) as InstalledApp[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Whether the antifurto screen lock can work right now (accessibility service
 *  enabled + Android 9+). */
export function canLockScreen(): boolean {
  try {
    return nativeModule?.canLockScreen() ?? false;
  } catch {
    return false;
  }
}

/** Lock the device like the power button (owner's biometrics/PIN to unlock).
 *  Returns false when the accessibility service isn't available. */
export function lockScreen(): boolean {
  try {
    return nativeModule?.lockScreen() ?? false;
  } catch {
    return false;
  }
}

/**
 * Starts the native anti-theft siren (STREAM_ALARM, AppBlockSirenPlayer) and
 * does NOT return until MediaPlayer.prepare()+start() have actually
 * completed — see AppBlockSirenPlayer.kt for why this is synchronous and why
 * it replaced the JS/expo-audio siren (2026-09-12 field report: intermittent
 * no-sound, plus no defense against the physical volume-down button, which
 * the native side now re-asserts against in a loop that survives the screen
 * lock and the RN JS timers pausing).
 *
 * Callers that also lock the screen (see AntifurtoAlarmOverlay.tsx) MUST
 * wait for this to return before scheduling the lock — that ordering is the
 * whole fix for the intermittent "bloqueou mas não tocou" report.
 *
 * Returns false if the native module predates this function (stale APK) or
 * if MediaPlayer failed to start (e.g. missing bundled resource) — callers
 * should still proceed with the lock in that case; the siren is a secondary
 * signal, not a precondition for Fase 2's "trava real".
 */
export function startSiren(): boolean {
  try {
    return nativeModule?.startSiren?.() ?? false;
  } catch {
    return false;
  }
}

/** Stops the native siren and abandons its audio focus/foreground service.
 *  Safe to call even if the siren was never started. */
export function stopSiren(): void {
  try {
    nativeModule?.stopSiren?.();
  } catch {
    /* best-effort */
  }
}

/** True only while the native MediaPlayer is actually playing the siren. */
export function isSirenPlaying(): boolean {
  try {
    return nativeModule?.isSirenPlaying?.() ?? false;
  } catch {
    return false;
  }
}

/** Whether the watchdog's alarm can use the exact-alarm path. This is NOT a
 *  timing nicety: Android 12+ refuses a background `startForegroundService()`
 *  from a broadcast receiver unless the tick came from an exact alarm, so
 *  without this the watchdog fires but its attempt to resurrect the shield is
 *  discarded by the OS — protection stays dead after an OEM task-killer wipes
 *  the process. Measured rather than assumed, because the degradation is
 *  otherwise completely silent. Always true below Android 12 and on
 *  non-Android platforms (no such restriction to begin with). */
export function canScheduleExactAlarms(): boolean {
  try {
    // Absent native module = stale APK. Report `true` so this never invents a
    // problem the user cannot act on; the real gaps already surface elsewhere.
    return nativeModule?.canScheduleExactAlarms() ?? true;
  } catch {
    return true;
  }
}

/** Opens the system "Alarms & reminders" screen for WardYou (Android 13+ only;
 *  auto-granted before that). */
export function requestScheduleExactAlarm(): void {
  try {
    nativeModule?.requestScheduleExactAlarm();
  } catch {
    /* best-effort */
  }
}

/** Whether the app is already exempt from battery optimizations (Doze). */
export function isIgnoringBatteryOptimizations(): boolean {
  try {
    return nativeModule?.isIgnoringBatteryOptimizations() ?? false;
  } catch {
    return false;
  }
}

/** Opens the system dialog asking to exempt WardYou from battery optimizations. */
export function requestIgnoreBatteryOptimizations(): void {
  try {
    nativeModule?.requestIgnoreBatteryOptimizations();
  } catch {
    /* best-effort */
  }
}

/** Xiaomi/Huawei/Oppo/Vivo-style OEMs whose task killers need manual switches
 *  (autostart, unrestricted battery) to keep the protection alive. */
export function isAggressiveOem(): boolean {
  try {
    return nativeModule?.isAggressiveOem() ?? false;
  } catch {
    return false;
  }
}

/** Jumps to the OEM autostart manager (MIUI Security app etc.) when present. */
export function openAutostartSettings(): void {
  try {
    nativeModule?.openAutostartSettings();
  } catch {
    /* best-effort */
  }
}

/** The app's own system settings page (MIUI: "Outras permissões" → pop-up em
 *  segundo plano; bateria por app). */
export function openLocationSettings(): void {
  try {
    nativeModule?.openLocationSettings();
  } catch {
    /* best-effort */
  }
}

export function openAppSettings(): void {
  try {
    nativeModule?.openAppSettings();
  } catch {
    /* best-effort */
  }
}

/** Whether the device-admin (uninstall protection) is active. While it is,
 *  Android refuses to uninstall WardYou — closing the "long-press icon →
 *  Desinstalar" hole on the child's phone. */
export function isDeviceAdminActive(): boolean {
  try {
    return nativeModule?.isDeviceAdminActive() ?? false;
  } catch {
    return false;
  }
}

/** Opens the system "activate device administrator?" screen. */
export function requestDeviceAdmin(): void {
  try {
    nativeModule?.requestDeviceAdmin();
  } catch {
    /* best-effort */
  }
}

/** True (once) if the admin was deactivated since the last check — reported to
 *  the guardian by the heartbeat, since the app is usually closed when it
 *  happens. Consuming it clears the flag. */
export function consumeAdminDisabledFlag(): boolean {
  try {
    return nativeModule?.consumeAdminDisabledFlag() ?? false;
  } catch {
    return false;
  }
}

/** Diagnostic of the last blocked-screen overlay attempt (null if never shown).
 *  Lets the setup screen confirm the panel actually rendered on this OEM. */
export function getLastOverlayResult(): OverlayDiagnostic | null {
  try {
    const json = nativeModule?.lastOverlayResultJson() ?? "{}";
    const parsed = JSON.parse(json) as Partial<OverlayDiagnostic>;
    if (!parsed.result) return null;
    return { result: parsed.result, at: parsed.at ?? 0 };
  } catch {
    return null;
  }
}

/** Whether "display over other apps" is granted — enables the overlay fallback
 *  path for the blocked-app panel on OEMs that suppress the a11y overlay. */
export function canDrawOverlays(): boolean {
  try {
    return nativeModule?.canDrawOverlays() ?? false;
  } catch {
    return false;
  }
}

/** Opens the system "display over other apps" permission screen for WardYou. */
export function requestOverlayPermission(): void {
  try {
    nativeModule?.requestOverlayPermission();
  } catch {
    /* best-effort */
  }
}

/** Requests queued by the blocked-screen overlay (native side can't call the
 *  API — no auth session there). Returns and CLEARS the queue; the caller owns
 *  delivery from here on. */
export function drainPendingRequests(): PendingBlockRequest[] {
  try {
    const json = nativeModule?.drainPendingRequestsJson() ?? "[]";
    const parsed = JSON.parse(json) as PendingBlockRequest[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Subscribe to the native "requests queued" poke. Returns an unsubscribe. */
export function subscribeAppBlockPoke(listener: () => void): () => void {
  try {
    const sub = nativeModule?.addListener?.("onAppBlockPoke", listener);
    return () => {
      try {
        sub?.remove();
      } catch {
        /* already gone */
      }
    };
  } catch {
    return () => {};
  }
}
