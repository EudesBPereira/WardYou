import { Platform } from "react-native";

/**
 * Registers for push and returns the **raw device (FCM) token** — our own API
 * sends notifications directly via the FCM HTTP v1 API (see apps/api/src/lib/
 * fcm.ts), so we need the FCM registration token, not an Expo push token.
 *
 * - Web: unsupported → null.
 * - Native: requests permission, sets up the Android channels (a general one
 *   and a high-importance `wardyou_sos` one that can wake the device), then
 *   fetches the device token. Requires `expo-notifications` + a Firebase-
 *   configured build (google-services.json); loaded lazily so the web bundle
 *   never pulls native-only code. Any failure resolves to null (never throws).
 */
export async function registerForPush(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    const Notifications = require("expo-notifications");
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (status !== "granted") {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== "granted") return null;

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Geral",
        importance: Notifications.AndroidImportance?.DEFAULT ?? 3,
      });
      // SOS: max importance so it alerts even in Do-Not-Disturb-ish conditions.
      // Kept only for pushes from an API that predates the v2 channel below —
      // Android channel settings are IMMUTABLE after creation, so the stronger
      // vibration required a brand-new channel id, not an edit to this one.
      await Notifications.setNotificationChannelAsync("wardyou_sos", {
        name: "Alertas SOS",
        importance: Notifications.AndroidImportance?.MAX ?? 5,
        sound: "default",
        vibrationPattern: [0, 250, 250, 250],
        bypassDnd: true,
      });
      // v2: long, insistent vibration (Uber-style) so a family SOS physically
      // grabs attention. The API sends SOS pushes to this channel id.
      await Notifications.setNotificationChannelAsync("wardyou_sos_v2", {
        name: "Alertas SOS",
        importance: Notifications.AndroidImportance?.MAX ?? 5,
        sound: "default",
        vibrationPattern: [0, 600, 250, 600, 250, 800, 250, 800],
        bypassDnd: true,
      });
    }

    const token = await Notifications.getDevicePushTokenAsync();
    return typeof token?.data === "string" ? token.data : null;
  } catch {
    // expo-notifications unavailable / not a Firebase build.
    return null;
  }
}

export type PushPermissionStatus = "granted" | "denied" | "undetermined" | "unsupported";

/** Current notification permission without prompting (for reflecting state). */
export async function getPushPermissionStatus(): Promise<PushPermissionStatus> {
  if (Platform.OS === "web") return "unsupported";
  try {
    const Notifications = require("expo-notifications");
    const { status } = await Notifications.getPermissionsAsync();
    if (status === "granted") return "granted";
    if (status === "denied") return "denied";
    return "undetermined";
  } catch {
    return "unsupported";
  }
}

/** Whether push can work on this platform (web cannot). */
export const pushSupported = Platform.OS !== "web";
