import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useMocks } from "@/lib/env";
import { useSession } from "@/stores/session";
import { apiClient, ApiError } from "@/services/api/client";
import { watchPosition, type Coords, type StopWatching } from "@/services/location/locationService";
import {
  ensureTripLocationTracking,
  stopTripLocationTracking,
} from "@/services/location/tripLocationTracking";
import { useTrips } from "./queries";

const BROADCAST_INTERVAL_MS = 10_000;

/**
 * Idade maxima de um fix para ele ainda poder ser transmitido.
 *
 * Achado de QA 2026-09-11, medido no BANCO (nao deduzido): com o GPS do
 * sistema desligado durante uma viagem ativa, este broadcast continuou
 * postando a MESMA coordenada a cada 10s -- nove posts consecutivos com
 * `lat=-23.7749889 lng=-46.702075` identicos e um `CapturedAt` novo a cada
 * um. Do outro lado, o acompanhante via "Visto as" subindo junto com o
 * relogio e o membro como "online": indistinguivel de rastreamento ao vivo,
 * com a pessoa podendo estar em qualquer lugar.
 *
 * Causa: `watchPositionAsync` assina normalmente (a PERMISSAO esta
 * concedida), so para de ENTREGAR fixes quando o GPS e desligado --
 * `lastCoordsRef` fica congelado com o ultimo fix e nada nunca o limpa,
 * enquanto o timer segue republicando. O app passava a fabricar a evidencia
 * de um rastreamento que nao existe, que e o pior caso desta auditoria
 * inteira: nao e ausencia de aviso, e um falso positivo ativo.
 *
 * 60s: tolera um engasgo normal de GPS (tunel, ambiente fechado, deriva
 * indoor) sem descartar um fix legitimamente recente, e corta a republicacao
 * de uma coordenada congelada em no maximo um minuto.
 */
const MAX_FIX_AGE_MS = 60_000;

/**
 * App-level port of the MAUI TravelLocationBroadcastService: while the user is a
 * member of any active trip, share the device position with each of them — so
 * other travelers can follow this member for the whole trip.
 *
 * - **Native (iOS/Android)**: delegates to an OS foreground-service location task
 *   (`tripLocationTracking.native.ts`) that keeps reporting even when the app is
 *   backgrounded or killed — the business rule for shared trips. Mounted once in
 *   AuthGate; the task itself lives on until no active trip remains.
 * - **All platforms, app in foreground**: a `watchPosition` + 10s timer posts the
 *   freshest coordinate directly. On web it's the only mechanism; on native it's
 *   the safety net that (a) puts the FIRST pin on a brand-new trip within
 *   seconds instead of waiting for the service's first tick, and (b) keeps
 *   positions flowing while the app is open even if the OS service was killed
 *   or failed to (re)start. Duplicated posts with the service are harmless —
 *   the map always shows the latest fix.
 */
export function useTripLocationBroadcast() {
  const { t } = useTranslation();
  const status = useSession((s) => s.status);
  const qc = useQueryClient();
  const enabled = !useMocks && status === "authenticated";
  const tripsQuery = useTrips(enabled);
  const trips = tripsQuery.data ?? [];
  // Only trust the trip list once the query actually resolved. On a cold start
  // (or after a failed fetch) `data` is empty while the request is in flight —
  // acting on that would stop a foreground service that is legitimately
  // broadcasting from a previous session, and if the app is closed (or the
  // request fails) before the query settles, tracking stays dead even though
  // the trip is still active. This was exactly the "stops sending when the app
  // is closed" bug.
  const tripsKnown = tripsQuery.isSuccess;
  const activeTripIds = trips.filter((tr) => tr.status === "active").map((tr) => tr.id);
  const idsKey = activeTripIds.join(",");
  // Guarda QUANDO o fix foi observado, nao so a coordenada -- ver MAX_FIX_AGE_MS.
  const lastCoordsRef = useRef<{ coords: Coords; at: number } | null>(null);

  // --- Native: OS foreground-service tracking (survives background/kill) ---
  useEffect(() => {
    if (!enabled || Platform.OS === "web" || !tripsKnown) return;
    if (activeTripIds.length === 0) {
      stopTripLocationTracking().catch(() => {});
      return;
    }
    ensureTripLocationTracking(activeTripIds, {
      title: t("trips.tracking.notificationTitle"),
      body: t("trips.tracking.notificationBody"),
    }).catch(() => {});
    // No cleanup that stops tracking here: the service must outlive this screen
    // (and the whole app) until the trip ends. It's stopped when the active-trip
    // set becomes empty (above) or the task itself sees every trip end (410).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, tripsKnown, idsKey]);

  // --- Foreground watch + interval broadcast (all platforms) ---
  useEffect(() => {
    if (!enabled) return;
    lastCoordsRef.current = null;
    if (activeTripIds.length === 0) return;
    let cancelled = false;
    const skip = new Set<string>();
    let stopWatch: StopWatching | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;

    const post = async () => {
      const fix = lastCoordsRef.current;
      if (cancelled || !fix) return;
      // Um fix velho demais NAO e transmitido: melhor o acompanhante ver a
      // posicao parar de atualizar (e o aviso de compartilhamento aparecer)
      // do que ver um horario novo em cima de uma coordenada congelada.
      if (Date.now() - fix.at > MAX_FIX_AGE_MS) return;
      const coords = fix.coords;
      for (const tripId of activeTripIds) {
        if (skip.has(tripId)) continue;
        try {
          await apiClient.post(`/api/v1/travels/${tripId}/location`, {
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracyMeters: coords.accuracy,
            // Manda o instante REAL da observacao. Sem isto o servidor carimba
            // `now` (ver CapturedAt em routes/trips.ts), e um fix de um minuto
            // atras chegava registrado como se fosse deste segundo.
            capturedAt: new Date(fix.at).toISOString(),
          });
          qc.invalidateQueries({ queryKey: ["trips", tripId, "map"] });
        } catch (err) {
          if (err instanceof ApiError && (err.status === 403 || err.status === 410)) {
            skip.add(tripId);
            if (err.status === 410) qc.invalidateQueries({ queryKey: ["trips"] });
          }
        }
      }
    };

    const start = async () => {
      if (stopWatch || cancelled) return;
      let first = true;
      stopWatch = await watchPosition((coords) => {
        lastCoordsRef.current = { coords, at: Date.now() };
        if (first) {
          first = false;
          post();
        }
      });
      if (cancelled) {
        stopWatch?.();
        stopWatch = null;
        return;
      }
      // `watchPosition` devolve `null` quando a permissao foi negada (ou nao ha
      // geolocalizacao). Antes, o timer subia assim mesmo e ficava postando um
      // `lastCoordsRef` eternamente vazio: dez em dez segundos, para sempre,
      // sem transmitir nada e sem ninguem saber. Nao e o aviso ao usuario (esse
      // e o TripSharingStatusCard, que MEDE o estado em vez de deduzir daqui) —
      // e so parar de fingir que ha uma transmissao em curso.
      if (!stopWatch) return;
      timer = setInterval(post, BROADCAST_INTERVAL_MS);
    };

    const stop = () => {
      stopWatch?.();
      stopWatch = null;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    if (AppState.currentState === "active") start();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") start();
      else stop();
    });

    return () => {
      cancelled = true;
      stop();
      sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, idsKey]);
}
