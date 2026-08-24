// Web stub: there is no OS foreground-service / background-location on web, so
// these are no-ops. The hook (useTripLocationBroadcast) keeps a foreground
// watch+interval broadcast for web instead. The real implementation lives in
// tripLocationTracking.native.ts (resolved on iOS/Android).

export interface TrackingNotification {
  title: string;
  body: string;
}

export async function ensureTripLocationTracking(
  _tripIds: string[],
  _notification: TrackingNotification,
): Promise<void> {
  /* no-op on web */
}

export async function stopTripLocationTracking(): Promise<void> {
  /* no-op on web */
}

export async function resumeTripTrackingFromPush(): Promise<void> {
  /* no-op on web */
}
