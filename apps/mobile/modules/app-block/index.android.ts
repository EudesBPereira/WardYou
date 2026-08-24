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
}

export interface UsageItem {
  packageName: string;
  minutes: number;
}

export interface InstalledApp {
  packageName: string;
  label: string;
}

interface AppBlockNativeModule {
  isAccessibilityServiceEnabled(): boolean;
  openAccessibilitySettings(): void;
  setEnforcementState(state: EnforcementState): void;
  hasUsageAccess(): boolean;
  openUsageAccessSettings(): void;
  getUsageTodayJson(): string;
  getInstalledAppsJson(): string;
  canLockScreen(): boolean;
  lockScreen(): boolean;
  isIgnoringBatteryOptimizations(): boolean;
  requestIgnoreBatteryOptimizations(): void;
  isAggressiveOem(): boolean;
  openAutostartSettings(): void;
  openAppSettings(): void;
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

export function isAccessibilityServiceEnabled(): boolean {
  try {
    return nativeModule?.isAccessibilityServiceEnabled() ?? false;
  } catch {
    return false;
  }
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
