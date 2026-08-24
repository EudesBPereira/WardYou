// Web stub — there is no headless push task on web. The real implementation
// (silent FCM data message → restart trip location tracking) lives in
// pushBackgroundTask.native.ts.

export function registerPushBackgroundTask(): void {
  /* no-op on web */
}
