import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { Accelerometer } from "expo-sensors";

const UPDATE_INTERVAL_MS = 100;
// Resting magnitude is ~1g; a sudden grab-and-run yank spikes well above it.
// Untuned guess — docs/antifurto.md flags sensitivity as an open decision that
// needs real-device testing (this repo has none available) before shipping.
const THRESHOLD_G = 2.2;
const COOLDOWN_MS = 5_000;

/**
 * Antifurto Fase 1 (see docs/antifurto.md): while `armed`, watches the
 * accelerometer for a sudden-movement spike ("arrancada") and fires
 * `onDetected`. Foreground-only — expo-sensors doesn't run with the screen off
 * or the app backgrounded; that needs a native foreground service (Fase 2).
 */
export function useRushDetection(armed: boolean, onDetected: () => void) {
  const lastTriggerRef = useRef(0);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  useEffect(() => {
    if (!armed || Platform.OS === "web") return;
    Accelerometer.setUpdateInterval(UPDATE_INTERVAL_MS);
    const sub = Accelerometer.addListener(({ x, y, z }) => {
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      const now = Date.now();
      if (magnitude > THRESHOLD_G && now - lastTriggerRef.current > COOLDOWN_MS) {
        lastTriggerRef.current = now;
        onDetectedRef.current();
      }
    });
    return () => sub.remove();
  }, [armed]);
}
