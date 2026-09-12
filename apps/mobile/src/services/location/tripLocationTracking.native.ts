import { Platform } from "react-native";
import * as Battery from "expo-battery";
import * as IntentLauncher from "expo-intent-launcher";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import Constants from "expo-constants";
import { env } from "@/lib/env";
import { storage } from "@/lib/storage";
import {
  clearTripDelivery,
  markTripFixReceived,
  markTripPostFailed,
  markTripPostOk,
  markTripTaskRan,
  markTripTrackingArmed,
} from "./tripDelivery";

/**
 * Rastro observavel da tarefa headless.
 *
 * O aparelho de teste nao e debuggable (`run-as` recusa) e nao tem root, entao
 * o storage do instrumento e ilegivel por fora; e a UI que o mostraria pode
 * estar atras do app lock. Logcat sobrou como UNICO canal de leitura com o app
 * fechado. Prefixo fixo para dar um `grep` so. `console.warn` chega no logcat
 * como `ReactNativeJS` (conferido: o babel deste projeto NAO remove console).
 */
const LOG = "[wardyou-trip]";

// Native background trip-location broadcasting. Unlike the old foreground-only
// watcher (which stopped the moment the app was backgrounded or killed), this
// runs an Android foreground-service location task so a shared trip keeps
// reporting the member's position for the whole trip — the business rule: once
// consent is granted, companions follow you until the trip ends. The task fires
// in a headless JS context when the app is killed, so it reads the token and the
// active trip list straight from SecureStore instead of in-memory state.

const TASK_NAME = "wardyou-trip-location-broadcast";
const ACTIVE_TRIPS_KEY = "wardyou_active_trip_ids";
// Must match SESSION_KEY in stores/session.ts — the persisted auth session.
const SESSION_KEY = "wardyou_session";

interface StoredSession {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  [k: string]: unknown;
}

export interface TrackingNotification {
  title: string;
  body: string;
}

async function readActiveTripIds(): Promise<string[]> {
  const raw = await storage.getItem(ACTIVE_TRIPS_KEY);
  if (!raw) return [];
  try {
    const ids = JSON.parse(raw);
    return Array.isArray(ids) ? (ids as string[]) : [];
  } catch {
    return [];
  }
}

async function writeActiveTripIds(ids: string[]): Promise<void> {
  await storage.setItem(ACTIVE_TRIPS_KEY, JSON.stringify(ids));
}

async function readSession(): Promise<StoredSession | null> {
  const raw = await storage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

/** Self-contained token refresh for the headless task (no Zustand available when
 *  the app was killed). Mirrors apiClient.doRefresh and re-persists the session. */
async function refreshSession(session: StoredSession): Promise<StoredSession | null> {
  try {
    const res = await fetch(`${env.apiBaseUrl}/api/v1/auth/refresh-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    if (!res.ok) return null;
    const auth = (await res.json()) as StoredSession;
    const next: StoredSession = {
      ...session,
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken,
      accessTokenExpiresAt: auth.accessTokenExpiresAt,
      refreshTokenExpiresAt: auth.refreshTokenExpiresAt,
    };
    await storage.setItem(SESSION_KEY, JSON.stringify(next));
    return next;
  } catch {
    return null;
  }
}

interface PostCoords {
  latitude: number;
  longitude: number;
  accuracy?: number;
  /** Instante REAL da observacao. Sem isto o servidor carimba `now` (ver
   *  CapturedAt em routes/trips.ts) -- a mesma desonestidade que corrigimos no
   *  caminho de primeiro plano e que tinha ficado de pe justamente aqui, no
   *  caminho que mais importa para "app fechado". */
  capturedAt?: number;
}

/**
 * `0` = a requisicao nem chegou a ter resposta (rede indisponivel, DNS, TLS).
 *
 * Antes isto era um `fetch` cru: se ele lancasse -- exatamente o que acontece
 * com rede de segundo plano restringida, o cenario que estamos investigando --
 * a excecao subia para fora do callback do `defineTask` e morria ali, sem log,
 * sem retentativa e sem nenhum vestigio. Distinguir "sem rede" de um status
 * HTTP e o que permite o diagnostico dizer QUAL das duas coisas aconteceu.
 */
async function postTripLocation(tripId: string, token: string, coords: PostCoords): Promise<number> {
  try {
    return await postTripLocationRaw(tripId, token, coords);
  } catch (e) {
    // Sobrevivivel E observavel: antes isto derrubava o callback inteiro em
    // silencio; depois virou silencio sobrevivivel, que e meia correcao.
    const motivo = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.warn(`${LOG} POST falhou (rede/DNS/TLS) trip=${tripId}: ${motivo}`);
    await markTripPostFailed(motivo);
    return 0;
  }
}

async function postTripLocationRaw(tripId: string, token: string, coords: PostCoords): Promise<number> {
  const res = await fetch(`${env.apiBaseUrl}/api/v1/travels/${tripId}/location`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracyMeters: coords.accuracy,
      ...(coords.capturedAt ? { capturedAt: new Date(coords.capturedAt).toISOString() } : {}),
    }),
  });
  return res.status;
}

interface LocationTaskData {
  locations?: Array<{
    coords: { latitude: number; longitude: number; accuracy: number | null };
    /** Instante da observacao, em ms epoch, como o SO reporta. */
    timestamp?: number;
  }>;
}

// Registered at module load so the OS can relaunch it headlessly. Broadcasts the
// freshest fix to every active trip; a trip that rejects (403 not sharing / 410
// ended) is dropped, and when none remain the service stops itself.
TaskManager.defineTask<LocationTaskData>(TASK_NAME, async ({ data, error }) => {
  // ANTES de qualquer guard: "o SO invocou a tarefa" e um fato diferente de
  // "o SO entregou posicao", e so separando os dois da para saber onde a
  // corrente arrebenta. A primeira versao deste instrumento gravava isto
  // depois do guard abaixo -- que no cenario investigado nunca e alcancado.
  await markTripTaskRan();
  if (error) {
    console.warn(`${LOG} tarefa invocada com erro: ${String(error)}`);
    return;
  }
  const locations = data?.locations;
  const latest = locations?.[locations.length - 1];
  if (!latest) {
    // A hipotese principal do caso de campo: invocada, sem posicao nenhuma.
    console.warn(`${LOG} tarefa invocada SEM posicao (locations vazio) — nada a enviar`);
    return;
  }
  await markTripFixReceived();

  let session = await readSession();
  if (!session) {
    await stopTripLocationTracking();
    return;
  }
  const ids = await readActiveTripIds();
  if (ids.length === 0) {
    await stopTripLocationTracking();
    return;
  }

  const coords: PostCoords = {
    latitude: latest.coords.latitude,
    longitude: latest.coords.longitude,
    accuracy: latest.coords.accuracy ?? undefined,
    capturedAt: latest.timestamp,
  };

  const stillActive: string[] = [];
  for (const tripId of ids) {
    let status = await postTripLocation(tripId, session.accessToken, coords);
    if (status === 401) {
      const refreshed = await refreshSession(session);
      if (refreshed) {
        session = refreshed;
        status = await postTripLocation(tripId, session.accessToken, coords);
      }
    }
    if (status >= 200 && status < 300) {
      await markTripPostOk();
    } else {
      console.warn(`${LOG} POST recusado trip=${tripId} status=${status}`);
      await markTripPostFailed(`HTTP ${status}`);
    }
    // Keep the trip unless the server says we can't share (403) or it ended (410).
    // Transient/network failures keep the trip for the next tick.
    if (status !== 403 && status !== 410) stillActive.push(tripId);
  }

  if (stillActive.length !== ids.length) {
    // Drop ONLY the trips the server rejected, against a FRESH read of the
    // stored list — never write back our stale snapshot. The app may have
    // registered a brand-new trip while this tick was in flight (close trip A
    // → create trip B): clobbering storage with this tick's leftover (often
    // []) erased the new trip and stopped the whole service, so the new trip
    // never got a single position until the app was reopened.
    const dropped = ids.filter((id) => !stillActive.includes(id));
    const current = await readActiveTripIds();
    const next = current.filter((id) => !dropped.includes(id));
    await writeActiveTripIds(next);
    if (next.length === 0) await stopTripLocationTracking();
  }
});

const BATTERY_OPT_ASKED_KEY = "wardyou_battery_opt_asked";

/**
 * Ask Android to exempt WardYou from battery optimization while a trip is being
 * tracked. Aggressive OEM power managers (Xiaomi/MIUI, Samsung, etc.) kill the
 * foreground location service of battery-optimized apps as soon as the user
 * swipes the app away — which showed up as "stops sending location when the
 * app is closed" even with the "Allow all the time" permission granted.
 * Prompts the system dialog at most once per install; best-effort.
 */
async function ensureBatteryOptimizationExemption(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    const optimized = await Battery.isBatteryOptimizationEnabledAsync();
    if (!optimized) return;
    if (await storage.getItem(BATTERY_OPT_ASKED_KEY)) return;
    await storage.setItem(BATTERY_OPT_ASKED_KEY, "1");
    const pkg = Constants.expoConfig?.android?.package ?? "com.wardyou.app";
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
      { data: `package:${pkg}` },
    );
  } catch {
    /* best-effort — never block tracking on this */
  }
}

async function requestPermissions(): Promise<boolean> {
  const fg = await Location.getForegroundPermissionsAsync();
  let fgGranted = fg.status === "granted";
  if (!fgGranted && fg.canAskAgain) {
    fgGranted = (await Location.requestForegroundPermissionsAsync()).status === "granted";
  }
  if (!fgGranted) return false;

  // Background ("Allow all the time") is what lets tracking survive the app being
  // killed. We still start the service without it (works while foregrounded), but
  // ask so the whole-trip rule actually holds.
  const bg = await Location.getBackgroundPermissionsAsync();
  if (bg.status !== "granted" && bg.canAskAgain) {
    await Location.requestBackgroundPermissionsAsync();
  }
  return true;
}

/**
 * Ensure the foreground-service location task is running for the given active
 * trips. Persists the trip list for the headless task and (re)starts the service
 * if needed. Call with an empty list to stop.
 */
export async function ensureTripLocationTracking(
  tripIds: string[],
  notification: TrackingNotification,
): Promise<void> {
  if (tripIds.length === 0) {
    await stopTripLocationTracking();
    return;
  }
  await writeActiveTripIds(tripIds);

  if (!(await requestPermissions())) return;
  await ensureBatteryOptimizationExemption();
  await markTripTrackingArmed();
  await startTrackingService(notification);
}

/** (Re)start the OS location task. Shared by the interactive path above and the
 *  headless push-resume path below (which must never prompt for anything). */
async function startTrackingService(notification: TrackingNotification): Promise<void> {
  // Always (re)start, even if the task is already running: startLocationUpdatesAsync
  // on a running task just swaps its options in place (the native consumer restarts
  // the fused request). An "already started? return" guard here would pin devices
  // to whatever cadence the OLD app version registered — forever.
  const start = () => Location.startLocationUpdatesAsync(TASK_NAME, {
    // High, not Balanced: with the screen off / app killed, fused "balanced"
    // fixes get throttled or skipped entirely under Doze on several OEMs, so
    // the trip heartbeat silently dies. High priority keeps the GPS pipeline
    // active for the foreground service — the battery cost is bounded by the
    // trip's lifetime, which is the business rule anyway.
    accuracy: Location.Accuracy.High,
    // Uber-style live cadence: one fix every ~10s whether moving or not.
    // Time-driven, not movement-driven (distanceInterval: 0): a stationary
    // device must keep emitting so the server's freshness window never lapses
    // and companions don't see the traveler drop "offline". Each fix is
    // delivered immediately (deferredUpdatesInterval: 0) instead of letting
    // Android batch them in the background.
    timeInterval: 10_000,
    distanceInterval: 0,
    deferredUpdatesInterval: 0,
    activityType: Location.ActivityType.Other,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: notification.title,
      notificationBody: notification.body,
      notificationColor: "#0B1F33",
    },
  });

  try {
    await start();
  } catch {
    // One retry: (re)starting can fail transiently (e.g. the OS still tearing
    // down a service stopped milliseconds ago when closing trip A → creating
    // trip B). Never leave tracking silently dead on the first hiccup.
    await new Promise((r) => setTimeout(r, 1_500));
    await start().catch(() => {});
  }
}

export async function stopTripLocationTracking(): Promise<void> {
  await writeActiveTripIds([]);
  // Sem rastreamento armado nao ha entrega a cobrar -- deixar o carimbo velho
  // faria o diagnostico acusar uma falha de algo que nao deveria estar rodando.
  await clearTripDelivery();
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(TASK_NAME);
    if (started) await Location.stopLocationUpdatesAsync(TASK_NAME);
  } catch {
    /* nothing to stop */
  }
}

interface TripListItem {
  id: string;
  isActive: boolean;
}

/**
 * Headless "resume tracking": invoked by the background push task when the
 * server notices this member stopped transmitting on a trip someone is
 * watching (silent high-priority FCM data message `type: trip-resume`).
 * Re-derives the active trip list straight from the API (the stored one may be
 * stale/empty — e.g. the OS killed the service) and restarts the location
 * service. Everything is non-interactive: no permission prompts, fixed pt-BR
 * notification copy (i18next isn't initialized in a headless context).
 */
export async function resumeTripTrackingFromPush(): Promise<void> {
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    if (fg.status !== "granted") return;

    let session = await readSession();
    if (!session) return;

    const fetchTrips = (token: string) =>
      fetch(`${env.apiBaseUrl}/api/v1/travels`, { headers: { Authorization: `Bearer ${token}` } });
    let res = await fetchTrips(session.accessToken);
    if (res.status === 401) {
      const refreshed = await refreshSession(session);
      if (!refreshed) return;
      session = refreshed;
      res = await fetchTrips(session.accessToken);
    }
    if (!res.ok) return;

    const trips = (await res.json()) as TripListItem[];
    const activeIds = trips.filter((t) => t.isActive).map((t) => t.id);
    if (activeIds.length === 0) {
      await stopTripLocationTracking();
      return;
    }
    await writeActiveTripIds(activeIds);
    await startTrackingService({
      title: "Viagem compartilhada ativa",
      body: "Compartilhando sua localização com o grupo da viagem.",
    });
  } catch {
    /* best-effort — the next nudge retries */
  }
}

/**
 * A tarefa de rastreamento de viagem esta REALMENTE rodando agora?
 *
 * Pergunta ao SO (`hasStartedLocationUpdatesAsync`), nao a um booleano que o
 * app lembrou de uma tentativa passada. A diferenca importa: `ensureTripLocation
 * Tracking` engolia a falha de `requestPermissions()` e de `startTrackingService`
 * (`.catch(() => {})` em ambos os lados), entao "tentei iniciar" nunca foi prova
 * de "esta rodando" -- e era exatamente por isso que o viajante podia estar numa
 * viagem ativa, vendo o mapa, sem transmitir posicao nenhuma.
 *
 * `null` = nao foi possivel medir. NAO e o mesmo que `false`: ver o mesmo
 * criterio em AppBlockModule.accessibilityStatus (nunca afirmar ausencia de
 * protecao sem ter verificado).
 */
export async function isTripTrackingRunning(): Promise<boolean | null> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(TASK_NAME);
  } catch {
    return null;
  }
}
