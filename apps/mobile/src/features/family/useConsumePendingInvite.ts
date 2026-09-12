import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useSession } from "@/stores/session";
import { apiClient } from "@/services/api/client";
import { pendingInvite } from "./pendingInvite";

/**
 * The actual redemption, extracted so it can run from TWO places:
 *
 *  1. `useConsumePendingInvite` below (mounted once in the root AuthGate) —
 *     the cold-start / just-logged-in case, triggered by `status`
 *     transitioning to "authenticated".
 *  2. `JoinInviteScreen` directly — the WARM case: the app is already open
 *     and authenticated when the deep link arrives, so `status` never
 *     changes and (1)'s effect never re-fires. Achado de QA 2026-09-11
 *     (found while building the equivalent trip-invite flow, confirmed
 *     on-device there and by code inspection here — same shape, same gap):
 *     with only (1), tapping an invite link while the app was already open
 *     would stash the code but never actually redeem it.
 *
 * Best-effort: invalid/expired codes are dropped silently — the user can
 * still join manually from the Family screen.
 */
export async function consumeFamilyInvite(qc: QueryClient): Promise<void> {
  const code = await pendingInvite.get();
  if (!code) return;
  // Clear before the request so a failure can't loop-retry every render.
  await pendingInvite.clear();
  try {
    await apiClient.post("/api/v1/families/join", { inviteCode: code.trim().toUpperCase() });
    qc.invalidateQueries({ queryKey: ["family"] });
  } catch {
    /* invalid/expired/already-a-member — nothing actionable to show here */
  }
}

/** Cold-start / just-logged-in path — see consumeFamilyInvite() above for the
 *  warm-app path and the full picture. Mounted once in the root AuthGate. */
export function useConsumePendingInvite() {
  const status = useSession((s) => s.status);
  const qc = useQueryClient();

  useEffect(() => {
    if (status !== "authenticated") return;
    void consumeFamilyInvite(qc);
  }, [status, qc]);
}
