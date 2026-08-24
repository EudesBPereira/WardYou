import { Platform } from "react-native";

export interface Coords {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

// Fallback coordinate (São Paulo) so web screens always render a map/position
// even without a real GPS fix.
const FALLBACK: Coords = { latitude: -23.5505, longitude: -46.6333 };

/** Ask for foreground location permission only when not already granted —
 *  re-requesting on every read causes visible status-bar churn on some OEMs. */
async function ensureNativePermission(): Promise<boolean> {
  const Location = require("expo-location");
  const current = await Location.getForegroundPermissionsAsync();
  if (current.status === "granted") return true;
  if (!current.canAskAgain) return false;
  const asked = await Location.requestForegroundPermissionsAsync();
  return asked.status === "granted";
}

/**
 * Cross-platform current position.
 * - Native: expo-location (asks permission once, real GPS).
 * - Web: browser geolocation if available, else a mock coordinate.
 */
export async function getCurrentPosition(): Promise<Coords | null> {
  if (Platform.OS === "web") {
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (p) =>
            resolve({
              latitude: p.coords.latitude,
              longitude: p.coords.longitude,
              accuracy: p.coords.accuracy,
            }),
          () => resolve(FALLBACK),
          { timeout: 5000 },
        );
      });
    }
    return FALLBACK;
  }

  // Lazily required so the web bundle never pulls the native-only path.
  const Location = require("expo-location");
  if (!(await ensureNativePermission())) return null;
  const pos = await Location.getCurrentPositionAsync({});
  return {
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
    accuracy: pos.coords.accuracy ?? undefined,
  };
}

/**
 * Device battery percentage (0-100), or null when unavailable/on web. The
 * family screens' "Bateria" column was always "—" because nothing ever read
 * it — expo-battery was installed but unused.
 */
export async function getBatteryPercent(): Promise<number | null> {
  if (Platform.OS === "web") return null;
  try {
    const Battery = require("expo-battery");
    const level = await Battery.getBatteryLevelAsync();
    if (typeof level !== "number" || level < 0) return null;
    return Math.round(level * 100);
  } catch {
    return null;
  }
}

/**
 * Short human-readable place for a coordinate ("Rua X · Bairro"), used for the
 * "Último lugar" column. Best-effort: reverse geocoding needs network and is
 * rate-limited by the OS, so a failure just means no label this round.
 */
export async function reverseGeocodeLabel(coords: Coords): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    const Location = require("expo-location");
    const results = await Location.reverseGeocodeAsync({
      latitude: coords.latitude,
      longitude: coords.longitude,
    });
    const first = results?.[0];
    if (!first) return null;
    // Prefer street + district; fall back to whatever the provider returned.
    const street = [first.street, first.streetNumber].filter(Boolean).join(", ");
    const area = first.district || first.subregion || first.city || null;
    const label = [street || null, area].filter(Boolean).join(" · ");
    return label ? label.slice(0, 120) : null;
  } catch {
    return null;
  }
}

export type LocationPermissionLevel = "always" | "foreground" | "denied";

/** Current location permission level without prompting (for reflecting state). */
export async function getLocationPermissionLevel(): Promise<LocationPermissionLevel> {
  if (Platform.OS === "web") {
    return typeof navigator !== "undefined" && navigator.geolocation ? "always" : "denied";
  }
  const Location = require("expo-location");
  const fg = await Location.getForegroundPermissionsAsync();
  if (fg.status !== "granted") return "denied";
  const bg = await Location.getBackgroundPermissionsAsync();
  return bg.status === "granted" ? "always" : "foreground";
}

/**
 * Request "allow all the time" location: foreground first, then background.
 * On Android 11+ the background grant is a separate OS prompt (often routed to
 * settings). Returns the level actually obtained.
 */
export async function requestLocationAlwaysPermission(): Promise<LocationPermissionLevel> {
  if (Platform.OS === "web") {
    return typeof navigator !== "undefined" && navigator.geolocation ? "always" : "denied";
  }
  const Location = require("expo-location");
  const fg = await Location.getForegroundPermissionsAsync();
  let fgGranted = fg.status === "granted";
  if (!fgGranted && fg.canAskAgain) {
    fgGranted = (await Location.requestForegroundPermissionsAsync()).status === "granted";
  }
  if (!fgGranted) return "denied";

  const bg = await Location.getBackgroundPermissionsAsync();
  let bgGranted = bg.status === "granted";
  if (!bgGranted && bg.canAskAgain) {
    bgGranted = (await Location.requestBackgroundPermissionsAsync()).status === "granted";
  }
  return bgGranted ? "always" : "foreground";
}

export type StopWatching = () => void;

/**
 * Continuous position watch. One steady subscription keeps the OS location
 * indicator on (instead of blinking every time a one-shot fix powers the GPS
 * up and down) and delivers fresher coords for live trip sharing.
 * Returns a stop function; `onCoords` fires on every update.
 */
export async function watchPosition(onCoords: (coords: Coords) => void): Promise<StopWatching | null> {
  if (Platform.OS === "web") {
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      const id = navigator.geolocation.watchPosition(
        (p) =>
          onCoords({
            latitude: p.coords.latitude,
            longitude: p.coords.longitude,
            accuracy: p.coords.accuracy,
          }),
        () => onCoords(FALLBACK),
        { enableHighAccuracy: false, maximumAge: 15_000 },
      );
      return () => navigator.geolocation.clearWatch(id);
    }
    onCoords(FALLBACK);
    return null;
  }

  const Location = require("expo-location");
  if (!(await ensureNativePermission())) return null;
  // Live-sharing cadence (only consumer is the trip broadcast): fresh fix
  // every ~5s while the app is foregrounded, so the 10s post timer never
  // ships a stale coordinate.
  const sub = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.High,
      timeInterval: 5_000,
      distanceInterval: 0,
    },
    (pos: { coords: { latitude: number; longitude: number; accuracy: number | null } }) =>
      onCoords({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? undefined,
      }),
  );
  return () => sub.remove();
}
