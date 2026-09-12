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

/**
 * A tarefa de rastreamento esta REALMENTE rodando agora? `null` = nao da para
 * medir (aqui, na web, ela nem existe). Ver a versao nativa para o porque de
 * isto ser uma medicao do SO e nao um booleano lembrado.
 */
export async function isTripTrackingRunning(): Promise<boolean | null> {
  return null;
}
