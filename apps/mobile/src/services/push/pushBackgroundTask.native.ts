import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { resumeTripTrackingFromPush } from "@/services/location/tripLocationTracking";
import { fullParentalSync } from "@/features/parental/enforcement";
import { useSession } from "@/stores/session";

// Headless handler for silent FCM data messages (no notification block). The
// server sends `{ type: "trip-resume" }` when this member has an active trip
// someone is watching but their device stopped transmitting — the task
// restarts the location service without any user interaction, even with the
// app killed. Runs in the same headless JS context as the location task.

const TASK_NAME = "wardyou-push-background";

/** The payload shape varies across expo-notifications versions/platforms —
 *  hunt for our `type` field wherever the FCM data ended up. */
function extractType(raw: unknown): string | null {
  const seen = new Set<unknown>();
  const walk = (node: unknown, depth: number): string | null => {
    if (!node || typeof node !== "object" || depth > 4 || seen.has(node)) return null;
    seen.add(node);
    const obj = node as Record<string, unknown>;
    if (typeof obj.type === "string") return obj.type;
    // Some paths deliver the FCM data JSON-encoded under `body`/`dataString`.
    for (const key of ["body", "dataString"]) {
      const v = obj[key];
      if (typeof v === "string" && v.startsWith("{")) {
        try {
          const t = walk(JSON.parse(v), depth + 1);
          if (t) return t;
        } catch {
          /* not JSON */
        }
      }
    }
    for (const v of Object.values(obj)) {
      const t = walk(v, depth + 1);
      if (t) return t;
    }
    return null;
  };
  return walk(raw, 0);
}

TaskManager.defineTask(TASK_NAME, async ({ data, error }) => {
  if (error) return;
  const type = extractType(data);
  if (type === "trip-resume") {
    await resumeTripTrackingFromPush();
  } else if (type === "parental-sync") {
    // Guardian changed the policy/rules: re-sync enforcement NOW, even with
    // the app killed. In headless the session store starts empty — hydrate it
    // from SecureStore so apiClient has the access token.
    try {
      await useSession.getState().hydrate();
      const userId = useSession.getState().session?.userId;
      if (userId) await fullParentalSync(userId);
    } catch {
      /* best-effort — the 60s loop catches up next app open */
    }
  }
});

/** Register the headless push task (call once at app start; idempotent). */
export function registerPushBackgroundTask(): void {
  Notifications.registerTaskAsync(TASK_NAME).catch(() => {
    /* push not available on this build — fine */
  });
}
