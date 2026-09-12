import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useSession } from "@/stores/session";
import { apiClient } from "@/services/api/client";
import { pendingTripInvite } from "./pendingTripInvite";

/**
 * The actual redemption, extracted so it can run from TWO places:
 *
 *  1. `useConsumePendingTripInvite` below (mounted once in the root AuthGate)
 *     — the cold-start / just-logged-in case, triggered by `status`
 *     transitioning to "authenticated".
 *  2. `JoinTripInviteScreen` directly — the WARM case: the app is already
 *     open and authenticated when the deep link arrives, so `status` never
 *     changes and (1)'s effect never re-fires. Achado de QA 2026-09-11: with
 *     only (1), tapping the invite link while the app was already open
 *     landed on the Trips tab but never actually redeemed the code — the
 *     exact same gap exists in the family invite flow (useConsumePendingInvite),
 *     which this mirrors bug-for-bug; both now call their shared function from
 *     both places.
 *
 * Best-effort: invalid/expired codes are dropped silently — the user can
 * still join manually via "Entrar com código" on the Trips screen.
 */
export async function consumeTripInvite(qc: QueryClient): Promise<void> {
  const code = await pendingTripInvite.get();
  if (!code) return;
  // Clear before the request so a failure can't loop-retry every render.
  await pendingTripInvite.clear();
  try {
    // ATENCAO ao mexer nestes tres: sao os MESMOS valores fixos que
    // useJoinTrip manda no caminho manual ("Entrar com codigo"), e o
    // servidor tambem assume `true` por padrao (ver o schema Zod de
    // POST /travels/invites/:code/accept). Ou seja: hoje ninguem -- nem
    // quem cria, nem quem entra -- chega a ESCOLHER compartilhar
    // localizacao/bateria nem receber SOS de companheiros de viagem;
    // simplesmente acontece. Isso foi levantado como decisao de produto
    // em aberto (2026-09-11), junto com a revogacao de consentimento
    // familiar. A armadilha: mudar so o default do SERVIDOR para `false`
    // NAO muda nada, porque os dois caminhos do cliente mandam `true`
    // explicito e sobrescrevem o default. Quem for implementar a decisao
    // precisa mexer nos TRES lugares (aqui, useJoinTrip, e o servidor).
    await apiClient.post(`/api/v1/travels/invites/${encodeURIComponent(code.trim().toUpperCase())}/accept`, {
      shareLiveLocation: true,
      shareBatteryStatus: true,
      receiveSosAlerts: true,
    });
    qc.invalidateQueries({ queryKey: ["trips"] });
  } catch {
    /* invalid/expired/already-a-member — nothing actionable to show here */
  }
}

/** Cold-start / just-logged-in path — see consumeTripInvite() above for the
 *  warm-app path and the full picture. Mounted once in the root AuthGate,
 *  alongside useConsumePendingInvite (family). */
export function useConsumePendingTripInvite() {
  const status = useSession((s) => s.status);
  const qc = useQueryClient();

  useEffect(() => {
    if (status !== "authenticated") return;
    void consumeTripInvite(qc);
  }, [status, qc]);
}
