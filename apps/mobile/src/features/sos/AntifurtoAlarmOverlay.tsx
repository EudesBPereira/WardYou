import { useEffect, useRef, useState } from "react";
import { Modal, View, TextInput, BackHandler, Platform } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import * as Network from "expo-network";
import * as Linking from "expo-linking";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useAudioPlayer, setAudioModeAsync } from "expo-audio";
import * as AppBlock from "@modules/app-block";
import { Text, Button } from "@/components/ui";
import { getBiometricSupport, authenticateBiometric } from "@/services/auth/biometrics";

const SIREN_SOUND = require("../../../assets/sounds/siren.wav");
const KEEP_AWAKE_TAG = "wardyou-antifurto";
// Enough time for the siren to start and the SOS request to leave before the
// device locks (the app keeps running in background after the lock).
const LOCK_DELAY_MS = 1_200;

export interface AntifurtoAlarmOverlayProps {
  visible: boolean;
  pin: string;
  soundEnabled: boolean;
  onDismiss: () => void;
  /** Omit when the caller already triggered the SOS itself (manual hold
   *  button) — only rush-detection needs the overlay to fire it. */
  onTriggerSos?: () => void;
  /** Rush-detection (theft) path: also lock the device like the power button —
   *  the thief can't reach banking apps without the owner's biometrics/PIN.
   *  Never set for the manual SOS hold (the owner is holding the phone). */
  lockOnActivate?: boolean;
}

/**
 * Antifurto alarm (see docs/antifurto.md): full-screen, hard to dismiss
 * (Android back is swallowed), keeps the screen on, plays a siren, and fires
 * the real SOS once. With `lockOnActivate` (snatch detection) it also locks
 * the device via the accessibility service (Fase 2 "trava real", no Device
 * Admin needed) — the siren keeps playing behind the lockscreen because the
 * audio session is set to background mode (Spotify-style), and the owner
 * dismisses it after unlocking with their own biometrics/PIN.
 */
export function AntifurtoAlarmOverlay({ visible, pin, soundEnabled, onDismiss, onTriggerSos, lockOnActivate = false }: AntifurtoAlarmOverlayProps) {
  const { t } = useTranslation();
  const [pinInput, setPinInput] = useState("");
  const [error, setError] = useState(false);
  const [offline, setOffline] = useState(false);
  const player = useAudioPlayer(SIREN_SOUND);
  const sosFiredRef = useRef(false);
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "android" || !visible) return undefined;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, [visible]);

  useEffect(() => {
    if (visible) {
      activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    } else {
      deactivateKeepAwake(KEEP_AWAKE_TAG);
    }
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      sosFiredRef.current = false;
      if (lockTimerRef.current) {
        clearTimeout(lockTimerRef.current);
        lockTimerRef.current = null;
      }
      player.pause();
      // Back to a foreground-only audio session once the alarm is off.
      setAudioModeAsync({ shouldPlayInBackground: false }).catch(() => {});
      return;
    }
    setPinInput("");
    setError(false);
    if (!sosFiredRef.current && onTriggerSos) {
      sosFiredRef.current = true;
      onTriggerSos();
    }
    Network.getNetworkStateAsync()
      .then((state) => setOffline(!(state.isConnected && state.isInternetReachable)))
      .catch(() => setOffline(false));
    if (soundEnabled) {
      // Background-capable session BEFORE play, so the siren survives the
      // screen lock below (and the thief pocketing the phone). No
      // setActiveForLockScreen on purpose: lockscreen media controls would
      // hand the thief a pause button.
      setAudioModeAsync({
        shouldPlayInBackground: true,
        playsInSilentMode: true,
        interruptionMode: "doNotMix",
      }).catch(() => {});
      player.loop = true;
      player.volume = 1;
      player.play();
    }
    if (lockOnActivate && Platform.OS === "android") {
      lockTimerRef.current = setTimeout(() => {
        AppBlock.lockScreen();
      }, LOCK_DELAY_MS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, soundEnabled]);

  // The owner's biometric is proof enough — only they can pass it — so it
  // dismisses the alarm without the PIN. Available regardless of the app-lock
  // setting (it's just "is a fingerprint/face enrolled on this device").
  useEffect(() => {
    if (visible) getBiometricSupport().then((s) => setBiometricAvailable(s.available));
  }, [visible]);

  async function unlockWithBiometric() {
    if (await authenticateBiometric(t("antifurto.biometricPrompt"))) onDismiss();
  }

  function submitPin(value: string) {
    if (value === pin) {
      onDismiss();
    } else {
      setError(true);
      setPinInput("");
    }
  }

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={() => {}}>
      <View className="flex-1 items-center justify-center gap-6 bg-danger-500 px-6">
        <Ionicons name="alert-circle" size={64} color="#FFFFFF" />
        <Text variant="h1" color="inverse" className="text-center">
          {t("antifurto.alarmTitle")}
        </Text>
        <Text variant="body" color="inverse" className="text-center opacity-90">
          {t("antifurto.alarmBody")}
        </Text>

        {offline ? (
          <View className="w-full gap-2 rounded-2xl bg-black/20 p-4">
            <Text variant="body-strong" color="inverse">
              {t("antifurto.offlineTitle")}
            </Text>
            <Text variant="caption" color="inverse" className="opacity-90">
              {t("antifurto.offlineBody")}
            </Text>
            <Button label={t("antifurto.openSettings")} variant="secondary" onPress={() => Linking.openSettings()} />
          </View>
        ) : null}

        {/* So mostra o campo de PIN quando existe um PIN. Com biometria o Modo
            Guarda arma sem PIN, e um campo que nunca aceita nada e pior que
            campo nenhum: parece que o dono esqueceu a senha do proprio alarme. */}
        {pin ? (
          <View className="w-full gap-2">
            <Text variant="label" color="inverse">
              {t("antifurto.pinPrompt")}
            </Text>
            <TextInput
              value={pinInput}
              onChangeText={(v) => {
                setError(false);
                const digits = v.replace(/\D/g, "").slice(0, 4);
                setPinInput(digits);
                if (digits.length === 4) submitPin(digits);
              }}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={4}
              autoFocus={!biometricAvailable}
              className="h-14 rounded-xl bg-white px-4 text-center text-2xl text-ink"
            />
            {error ? (
              <Text variant="caption" color="inverse">
                {t("antifurto.pinError")}
              </Text>
            ) : null}
          </View>
        ) : null}

        {biometricAvailable ? (
          <Button
            label={t("antifurto.biometricUnlock")}
            variant="secondary"
            icon="finger-print"
            onPress={unlockWithBiometric}
          />
        ) : null}
      </View>
    </Modal>
  );
}
