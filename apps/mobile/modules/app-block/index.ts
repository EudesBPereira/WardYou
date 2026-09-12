/** No-op stub for platforms without the AccessibilityService (iOS, web).
 *  See index.android.ts for the real implementation. */
export interface EnforcementState {
  enabled: boolean;
  blockAll: boolean;
  blockedPackages: string[];
  whitelistedPackages: string[];
  hardBlockWindowsJson?: string;
  tempAllowsJson?: string;
  pauseUntilMillis?: string;
  blockedWebsites?: string[];
}

export interface UsageItem {
  packageName: string;
  minutes: number;
  label: string;
}

export interface InstalledApp {
  packageName: string;
  label: string;
}

export type AccessibilityStatus =
  | "running"
  | "granted_not_running"
  | "not_granted"
  | "unknown";

/** There is no AccessibilityService on this platform, so there is nothing to
 *  measure - "unknown" rather than a fake "off" that the protection panel
 *  would then report as a problem the user cannot possibly fix. */
export function getAccessibilityStatus(): AccessibilityStatus {
  return "unknown";
}

export function isAccessibilityServiceEnabled(): boolean {
  return false;
}

/** Sem logcat fora do Android - ver a versao android para o porque de ser
 *  sincrono. */
export function nativeLog(tag: string, message: string): void {
  console.warn(`${tag} ${message}`);
}

export function openAccessibilitySettings(): void {
  // no-op
}

export function setEnforcementState(_state: EnforcementState): void {
  // no-op
}

export function hasUsageAccess(): boolean {
  return false;
}

export function openUsageAccessSettings(): void {
  // no-op
}

export function getUsageToday(): UsageItem[] {
  return [];
}

export function getInstalledApps(): InstalledApp[] {
  return [];
}

export function canLockScreen(): boolean {
  return false;
}

export function lockScreen(): boolean {
  return false;
}

/** No native siren on this platform — see index.android.ts. Callers should
 *  keep using their own audio path (e.g. expo-audio) when this returns false. */
export function startSiren(): boolean {
  return false;
}

export function stopSiren(): void {
  // no-op
}

export function isSirenPlaying(): boolean {
  return false;
}

export function isIgnoringBatteryOptimizations(): boolean {
  return false;
}

export function requestIgnoreBatteryOptimizations(): void {
  // no-op
}

export function isAggressiveOem(): boolean {
  return false;
}

export function canScheduleExactAlarms(): boolean {
  return true;
}

export function requestScheduleExactAlarm(): void {
  // no-op
}

export interface PendingBlockRequest {
  type: "access" | "extra";
  packageName?: string;
  label?: string;
  minutes?: number;
}

export interface OverlayDiagnostic {
  result: string;
  at: number;
}

export function getLastOverlayResult(): OverlayDiagnostic | null {
  return null;
}

export function canDrawOverlays(): boolean {
  return false;
}

export function isDeviceAdminActive(): boolean {
  return false;
}

export function requestDeviceAdmin(): void {
  // no-op
}

export function consumeAdminDisabledFlag(): boolean {
  return false;
}

export function requestOverlayPermission(): void {
  // no-op
}

export function drainPendingRequests(): PendingBlockRequest[] {
  return [];
}

export function subscribeAppBlockPoke(_listener: () => void): () => void {
  return () => {};
}

export function openAutostartSettings(): void {
  // no-op
}

export function openAppSettings(): void {
  // no-op
}

export function openLocationSettings(): void {
  // no-op
}
