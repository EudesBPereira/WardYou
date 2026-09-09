import { useEffect } from "react";
import { Platform } from "react-native";
import { router } from "expo-router";
import i18next from "i18next";
import { useMocks } from "@/lib/env";
import { storage } from "@/lib/storage";
import { apiClient } from "@/services/api/client";
import { useSession } from "@/stores/session";
import type { DeviceDto } from "@/features/devices/queries";
import { registerForPush, pushSupported } from "./pushService";
import { registerPushBackgroundTask } from "./pushBackgroundTask";

function deviceLabel(): string {
  try {
    const Device = require("expo-device");
    return Device.deviceName || Device.modelName || "Meu aparelho";
  } catch {
    return "Meu aparelho";
  }
}

/** Route a tapped notification to the relevant screen based on its `data.type`. */
function handleNotificationData(data: Record<string, unknown> | undefined) {
  const type = typeof data?.type === "string" ? data.type : "";
  try {
    if (type === "family-join" || type === "membership-approved") router.navigate("/family" as never);
    else if (type === "sos") router.navigate("/sos" as never);
    else if (type === "extra-time" || type === "task-completion") router.navigate("/parental" as never);
    else if (type === "task-created") router.navigate("/tasks" as never);
    else if (type === "extra-time-decided" || type === "task-reviewed") router.navigate("/(tabs)" as never);
  } catch {
    /* navigation best-effort */
  }
}

/**
 * While authenticated, ensures this install has a device row, obtains the FCM
 * token and registers it (`PUT /devices/push-token`) so the server can push to
 * it. Also wires the foreground display + tap-to-navigate handlers. All
 * best-effort — a failure never blocks the app. Mount once near the app root.
 */
export function usePushRegistration() {
  const status = useSession((s) => s.status);
  const userId = useSession((s) => s.session?.userId);

  // Foreground display + tap handlers (set up once).
  useEffect(() => {
    if (useMocks || !pushSupported) return undefined;
    // Headless handler for silent data pushes (e.g. "trip-resume" restarts the
    // location service with the app killed). Idempotent.
    registerPushBackgroundTask();
    let sub: { remove: () => void } | undefined;
    try {
      const Notifications = require("expo-notifications");
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
      sub = Notifications.addNotificationResponseReceivedListener((response: unknown) => {
        const data = (response as { notification?: { request?: { content?: { data?: Record<string, unknown> } } } })
          ?.notification?.request?.content?.data;
        handleNotificationData(data);
      });
    } catch {
      /* expo-notifications unavailable */
    }
    return () => sub?.remove();
  }, []);

  // Token registration (re-runs when the signed-in user changes).
  useEffect(() => {
    if (useMocks || !pushSupported || status !== "authenticated" || !userId) return;
    let cancelled = false;
    (async () => {
      const token = await registerForPush();
      if (cancelled || !token) return;

      const key = `wardyou_push_device_${userId}`;
      let deviceId = await storage.getItem(key);
      if (!deviceId) {
        const device = await apiClient.post<DeviceDto>("/api/v1/devices", {
          deviceName: deviceLabel(),
          platform: Platform.OS,
        });
        deviceId = device.id;
        await storage.setItem(key, deviceId);
      }

      try {
        await apiClient.put("/api/v1/devices/push-token", {
          deviceId,
          pushToken: token,
          pushLanguage: i18next.language,
        });
      } catch {
        // The device row was likely removed server-side — forget it so the
        // next launch recreates one instead of failing forever.
        await storage.removeItem(key);
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [status, userId]);
}
