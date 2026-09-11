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
 * Teto para a promessa do prompt do SO. O proprio prompt do Android expira
 * sozinho em ~30s e resolve; este limite so existe para o caso em que ele
 * NAO resolve nunca.
 *
 * Isso acontece de verdade: o `BiometricPrompt` do Android nao sobe se a
 * activity ainda nao estiver resumed, e quando ele nao sobe a promessa do
 * expo-local-authentication fica pendente para sempre. Visto em campo no
 * aparelho do responsavel (POCO, 2026-09-11): a tela "WardYou bloqueado"
 * ficou com o spinner girando sem que NENHUM BiometricPrompt aparecesse no
 * logcat -- quem chamou ficou esperando uma resposta que jamais viria.
 */
const PROMPT_TIMEOUT_MS = 60_000;

/**
 * Prompt for the user's biometric (or device credential fallback). Resolves
 * true only on a confirmed success. `promptMessage` is shown by the OS sheet.
 */
export async function authenticateBiometric(promptMessage: string): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    const LA = require("expo-local-authentication");
    const res = await Promise.race([
      LA.authenticateAsync({
        promptMessage,
        // Fall back to the device PIN/pattern if biometrics fail repeatedly, so
        // the owner is never permanently locked out of their own app.
        disableDeviceFallback: false,
        cancelLabel: undefined,
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), PROMPT_TIMEOUT_MS)),
    ]);
    // `null` = estourou o teto acima. Tratado como "nao autenticou", nunca
    // como sucesso: no pior caso o usuario tenta de novo; liberar por timeout
    // transformaria uma falha do SO em furo de seguranca.
    return !!res?.success;
  } catch {
    return false;
  }
}
