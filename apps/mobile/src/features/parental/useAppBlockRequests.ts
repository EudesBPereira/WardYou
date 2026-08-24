import { useEffect } from "react";
import { Platform } from "react-native";
import { apiClient } from "@/services/api/client";
import { useSession } from "@/stores/session";
import * as AppBlock from "@modules/app-block";
import type { PendingBlockRequest } from "@modules/app-block";

// Requests that failed to POST (offline etc.) — retried on the next drain.
// Module-level so remounts don't lose them; process death loses only requests
// already taken out of the native queue in that same failed cycle.
let retryQueue: PendingBlockRequest[] = [];
let draining = false;

async function deliver(item: PendingBlockRequest, childUserId: string): Promise<void> {
  if (item.type === "access" && item.packageName) {
    await apiClient.post("/api/v1/parental/request-app-access", {
      packageName: item.packageName,
      label: item.label,
    });
  } else if (item.type === "extra" && item.minutes && item.minutes > 0) {
    await apiClient.post("/api/v1/parental/extra-time/request", {
      childUserId,
      requestedMinutes: item.minutes,
    });
  }
}

async function drain(childUserId: string): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    const items = [...retryQueue, ...AppBlock.drainPendingRequests()];
    retryQueue = [];
    for (const item of items) {
      try {
        await deliver(item, childUserId);
      } catch {
        retryQueue.push(item); // network hiccup — try again next cycle
      }
    }
  } finally {
    draining = false;
  }
}

/**
 * Delivery bridge for the native blocked-screen overlay: the overlay queues
 * "ask to unlock app X" / "ask +N min" in the module's prefs (it has no auth
 * session to call the API itself), and this hook — mounted in the root
 * AuthGate — drains the queue and POSTs with the child's session. Triggers:
 * the native poke event (instant while the JS runtime is alive, which the
 * shield FGS makes the common case), plus mount and a 60s safety interval.
 */
export function useAppBlockRequests(): void {
  const userId = useSession((s) => s.session?.userId);

  useEffect(() => {
    if (Platform.OS !== "android" || !userId) return;
    const run = () => void drain(userId);
    const unsubscribe = AppBlock.subscribeAppBlockPoke(run);
    run();
    const timer = setInterval(run, 60_000);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [userId]);
}
