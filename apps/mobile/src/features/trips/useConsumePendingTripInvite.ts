import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/stores/session";
import { apiClient } from "@/services/api/client";
import { pendingTripInvite } from "./pendingTripInvite";

/** Once a session exists, redeem any trip invite code stashed by the
 *  wardyou://travel/invite/CODE deep link (see pendingTripInvite) and refresh
 *  the trips list so the new membership shows. Mounted once in the root
 *  AuthGate, alongside useConsumePendingInvite (family). Best-effort:
 *  invalid/expired codes are dropped silently — the user can still join
 *  manually via "Entrar com código" on the Trips screen. */
export function useConsumePendingTripInvite() {
  const status = useSession((s) => s.status);
  const qc = useQueryClient();

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    (async () => {
      const code = await pendingTripInvite.get();
      if (!code || cancelled) return;
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
    })();
    return () => {
      cancelled = true;
    };
  }, [status, qc]);
}
