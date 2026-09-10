import { useEffect } from "react";
import { AppState, Platform, Vibration } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { env, useMocks } from "@/lib/env";
import { useSession } from "@/stores/session";
import { connectRealtime, disconnectRealtime, isRealtimeConnected, type RealtimeHandlers } from "./realtimeService";
import { fullParentalSync } from "@/features/parental/enforcement";

// Long, insistent buzz (Uber-style "driver arriving") so a family SOS grabs
// attention even with the phone on the table. Android honours the full
// pattern; iOS collapses it to its fixed vibration.
const SOS_VIBRATION_PATTERN = [0, 600, 250, 600, 250, 800, 250, 800];

/**
 * Connects to the realtime server while authenticated and refreshes the
 * relevant React Query caches when the backend pushes an event, so pending
 * lists / maps stay live without manual refresh. Mount once near the app root.
 */
export function useRealtimeSync() {
  const qc = useQueryClient();
  const status = useSession((s) => s.status);
  const token = useSession((s) => s.session?.accessToken);

  useEffect(() => {
    if (useMocks || status !== "authenticated" || !token) return;

    const invalidate = (keys: string[][]) => keys.forEach((queryKey) => qc.invalidateQueries({ queryKey }));

    const handlers: RealtimeHandlers = {
      ExtraTimeRequested: () =>
        invalidate([["parental", "extra-time", "pending"], ["parental", "children"], ["parental", "requests"]]),
      // Child asked for a blocked app on the blocked screen — the pending card
      // on the guardian's screens picks it up immediately (push is the alert).
      AppAccessRequested: () =>
        invalidate([["parental", "children"], ["parental", "apps"], ["parental", "requests"]]),
      // Guardian decided elsewhere (other device) — keep the card in sync.
      AppAccessDecided: () => invalidate([["parental", "requests"], ["parental", "my-status"]]),
      // The child device's AccessibilityService flipped off (tamper/OEM kill) —
      // guardian's child detail shows the protection state from these queries.
      ChildProtectionChanged: () => invalidate([["parental", "children"]]),
      // Children get their day budget refreshed the moment a guardian decides.
      ExtraTimeDecided: () => invalidate([["parental", "extra-time", "pending"], ["parental", "my-status"]]),
      // A guardian just created a task — the child's task list refreshes live.
      TaskCreated: () => invalidate([["parental", "my-tasks"], ["parental", "my-status"]]),
      TaskCompletionPending: () => invalidate([["parental", "completions", "pending"]]),
      TaskReviewed: () => invalidate([["parental", "completions", "pending"], ["parental", "my-tasks"], ["parental", "my-status"]]),
      PolicyUpdated: () => invalidate([["parental", "policy"], ["parental", "children"], ["parental", "my-status"]]),
      // Child device: apply the guardian's change in seconds, not on the next
      // 60s tick. Android-only no-op elsewhere; fire-and-forget.
      ParentalPolicyChanged: () => {
        invalidate([["parental"]]);
        const userId = useSession.getState().session?.userId;
        if (userId) void fullParentalSync(userId);
      },
      ZoneTransition: () => invalidate([["zones"], ["family", "map"]]),
      TravelLocationUpdated: (payload) => {
        const tripId = (payload as { travelGroupId?: string } | null)?.travelGroupId;
        invalidate(tripId ? [["trips", tripId, "map"]] : [["trips"]]);
      },
      // Trip lifecycle: refreshing ["trips"] also re-runs useTripLocationBroadcast,
      // so this member's device starts/stops its own broadcasting immediately —
      // joining, closing or leaving no longer waits for the next app open.
      TravelMembersChanged: () => invalidate([["trips"]]),
      TravelClosed: () => invalidate([["trips"]]),
      SosTriggered: (payload) => {
        invalidate([["sos"], ["family", "map"]]);
        // Attention buzz only on the RECEIVING family members' phones — the
        // triggerer's own device (also in the family room) stays quiet, same
        // as the push path (the API already excludes them there).
        const triggeredBy = (payload as { userId?: string } | null)?.userId;
        const myUserId = useSession.getState().session?.userId;
        if (Platform.OS !== "web" && triggeredBy !== myUserId) {
          Vibration.vibrate(SOS_VIBRATION_PATTERN);
        }
      },
      SosUpdated: () => invalidate([["sos"]]),
      // A member's own device is likely parked on /pending-approval or the
      // full tabs with a stale role — refetching /profile/me flips it live.
      MembershipApproved: () => invalidate([["profile", "me"], ["family"]]),
      MemberRoleChanged: () => invalidate([["profile", "me"]]),
      ElderCheckedIn: () => invalidate([["elder", "check-in"], ["elder", "check-in-history"]]),
      ElderMedicationTaken: () => invalidate([["elder", "adherence"]]),
      ElderInactivityAlert: () => invalidate([["elder"]]),
      // Someone pasted an invite code and is now awaiting this admin's approval
      // — refresh the family lists so the pending request shows up live.
      FamilyJoinRequested: () => invalidate([["family"]]),
    };

    connectRealtime(env.apiBaseUrl, token, handlers);

    // RECONEXAO AO VOLTAR DO SEGUNDO PLANO.
    //
    // Sem isto, todo evento em tempo real se perdia depois que o app ia para o
    // background: o Android suspende o thread de JS, o socket morre, e as deps
    // deste efeito ([status, token, qc]) nao mudam no retorno — entao ele nunca
    // reconectava. Encontrado em QA (2026-09-09): o responsavel aprovou a
    // entrada e a tela do novo membro ficou parada em "Conta em analise" para
    // sempre, apesar de o servidor ter emitido `MembershipApproved`
    // corretamente (validado por e2e-approval-realtime.mjs, 9/9).
    //
    // Ao voltar tambem invalidamos TUDO: o socket estava morto durante o
    // periodo em background, entao qualquer evento daquela janela foi perdido e
    // reconectar sozinho nao recupera o que passou.
    const sub = AppState.addEventListener("change", (estado) => {
      if (estado !== "active") return;
      if (!isRealtimeConnected()) {
        connectRealtime(env.apiBaseUrl, token, handlers);
      }
      qc.invalidateQueries();
    });

    return () => {
      sub.remove();
      disconnectRealtime();
    };
  }, [status, token, qc]);
}
