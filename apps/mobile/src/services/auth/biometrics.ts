import { Platform } from "react-native";

// Thin wrapper over expo-local-authentication, loaded lazily so the web bundle
// never pulls the native module. Every call is best-effort and resolves to a
// safe default (never throws) — a device without biometrics simply reports it
// as unavailable and the app falls back to whatever it did before.

export interface BiometricSupport {
  /** Hardware present AND at least one fingerprint/face enrolled. */
  available: boolean;
  /** "fingerprint" | "face" | "iris" | "biometric" — for copy/icon choice. */
  kind: "fingerprint" | "face" | "iris" | "biometric";
}

export async function getBiometricSupport(): Promise<BiometricSupport> {
  if (Platform.OS === "web") return { available: false, kind: "biometric" };
  try {
    const LA = require("expo-local-authentication");
    const hasHardware = await LA.hasHardwareAsync();
    const enrolled = await LA.isEnrolledAsync();
    let kind: BiometricSupport["kind"] = "biometric";
    try {
      const types = await LA.supportedAuthenticationTypesAsync();
      if (types.includes(LA.AuthenticationType.FACIAL_RECOGNITION)) kind = "face";
      else if (types.includes(LA.AuthenticationType.FINGERPRINT)) kind = "fingerprint";
      else if (types.includes(LA.AuthenticationType.IRIS)) kind = "iris";
    } catch {
      /* keep the generic kind */
    }
    return { available: !!hasHardware && !!enrolled, kind };
  } catch {
    return { available: false, kind: "biometric" };
  }
}

/**
 * Whether this device can authenticate the owner AT ALL — biometrics enrolled
 * OR a screen lock (PIN/pattern/password) set. `getBiometricSupport` only
 * covers biometrics; this also catches "no fingerprint but has a lock screen",
 * which the OS prompt accepts because `disableDeviceFallback` is false.
 *
 * Usado por `confirmSensitive` para distinguir "o usuario cancelou" de "este
 * aparelho nao tem como autenticar ninguem" — no segundo caso exigir
 * autenticacao trancaria o dono para fora do proprio app.
 */
export async function hasDeviceAuth(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    const LA = require("expo-local-authentication");
    const level = await LA.getEnrolledLevelAsync();
    return level !== LA.SecurityLevel.NONE;
  } catch {
    return false;
  }
}

/**
 * Prompt for the user's biometric (or device credential fallback). Resolves
 * true only on a confirmed success. `promptMessage` is shown by the OS sheet.
 */
export async function authenticateBiometric(promptMessage: string): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    const LA = require("expo-local-authentication");
    const res = await LA.authenticateAsync({
      promptMessage,
      // Fall back to the device PIN/pattern if biometrics fail repeatedly, so
      // the owner is never permanently locked out of their own app.
      disableDeviceFallback: false,
      cancelLabel: undefined,
    });
    return !!res?.success;
  } catch {
    return false;
  }
}
