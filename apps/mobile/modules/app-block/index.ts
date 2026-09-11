/** No-op stub for platforms without the AccessibilityService (iOS, web).
 *  See index.android.ts for the real implementation. */
export interface EnforcementState {
  enabled: boolean;
  blockAll: boolean;
  blockedPackages: string[];
  whitelistedPackages: string[];
  hardBlockWindowsJson?: string;
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

export function isAccessibilityServiceEnabled(): boolean {
  return false;
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

export function isIgnoringBatteryOptimizations(): boolean {
  return false;
}

export function requestIgnoreBatteryOptimizations(): void {
  // no-op
}

export function isAggressiveOem(): boolean {
  return false;
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
