import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/stores/session";
import { apiClient } from "@/services/api/client";
import { pendingInvite } from "./pendingInvite";

/** Once a session exists, redeem any invite code stashed by the /join deep link
 *  (see pendingInvite) and refresh the family lists so the new membership shows.
 *  Mounted once in the root AuthGate. Best-effort: invalid/expired codes are
 *  dropped silently — the user can still join manually from the Family screen. */
export function useConsumePendingInvite() {
  const status = useSession((s) => s.status);
  const qc = useQueryClient();

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    (async () => {
      const code = await pendingInvite.get();
      if (!code || cancelled) return;
      // Clear before the request so a failure can't loop-retry every render.
      await pendingInvite.clear();
      try {
        await apiClient.post("/api/v1/families/join", { inviteCode: code.trim().toUpperCase() });
        qc.invalidateQueries({ queryKey: ["family"] });
      } catch {
        /* invalid/expired/already-a-member — nothing actionable to show here */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, qc]);
}
