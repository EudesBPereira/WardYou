import { useEffect, useRef, useState } from "react";
import { Modal, View, BackHandler, Platform } from "react-native";
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
// Enough time for the fire-and-forget SOS request to leave before the device
// locks (the app keeps running in background after the lock). No longer
// covering "give the siren time to start" — AppBlock.startSiren() (Android)
// is synchronous and confirmed before this timer is even scheduled; see the
// call site below.
const LOCK_DELAY_MS = 1_200;

export interface AntifurtoAlarmOverlayProps {
  visible: boolean;
  soundEnabled: boolean;
  onDismiss: () => void;
  /** Omit when the caller already triggered the SOS itself (manual hold
   *  button) — only rush-detection needs the overlay to fire it. */
  onTriggerSos?: () => void;
  /** Rush-detection (theft) path: also lock the device like the power button —
   *  the thief can't reach banking apps without the owner's device auth.
   *  Never set for the manual SOS hold (the owner is holding the phone). */
  lockOnActivate?: boolean;
}

/**
 * Antifurto alarm (see docs/antifurto.md): full-screen, hard to dismiss
 * (Android back is swallowed), keeps the screen on, plays a siren, and fires
 * the real SOS once. With `lockOnActivate` (snatch detection) it also locks
 * the device via the accessibility service (Fase 2 "trava real", no Device
 * Admin needed) — the owner dismisses it with the device authentication
 * (biometrics, falling back to the device PIN/pattern via the OS prompt).
 *
 * On Android the siren itself is fully NATIVE (AppBlock.startSiren(), see
 * AppBlockSirenPlayer.kt) as of 2026-09-12, not expo-audio — a field report
 * found the JS/expo-audio siren silent about half the time (an unawaited
 * `setAudioModeAsync()` racing `player.play()` against the screen lock) and
 * with no defense against the physical volume-down button. The native path
 * fixes both: `startSiren()` is synchronous and does not return until the
 * siren is genuinely audible (see below), and it re-asserts STREAM_ALARM to
 * max in a loop that keeps running after the screen locks — independent of
 * this component, the RN bridge, or JS timers (which the OS can pause once
 * the Activity is backgrounded; confirmed 2026-09-12 as the cause of a
 * separate bug the same day). iOS still uses the expo-audio path below
 * (no native module there yet) with the same known limits as before.
 */
export function AntifurtoAlarmOverlay({ visible, soundEnabled, onDismiss, onTriggerSos, lockOnActivate = false }: AntifurtoAlarmOverlayProps) {
  const { t } = useTranslation();
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
      if (Platform.OS === "android") {
        AppBlock.stopSiren();
      } else {
        player.pause();
        // Back to a foreground-only audio session once the alarm is off.
        setAudioModeAsync({ shouldPlayInBackground: false }).catch(() => {});
      }
      return;
    }
    if (!sosFiredRef.current && onTriggerSos) {
      sosFiredRef.current = true;
      onTriggerSos();
    }
    Network.getNetworkStateAsync()
      .then((state) => setOffline(!(state.isConnected && state.isInternetReachable)))
      .catch(() => setOffline(false));
    if (soundEnabled) {
      if (Platform.OS === "android") {
        // Synchronous native call — by the time this returns, the siren is
        // either genuinely playing (see AppBlockSirenPlayer.kt) or it
        // definitively failed to start. Either way there is nothing left to
        // race against the lock scheduled below.
        const started = AppBlock.startSiren();
        if (!started) AppBlock.nativeLog("wardyou-antifurto", "startSiren() failed");
      } else {
        // iOS: no native siren module yet — same expo-audio path as before.
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
    }
    if (lockOnActivate && Platform.OS === "android") {
      // The siren start above is synchronous and already confirmed by now —
      // this delay is only to give the fire-and-forget SOS request time to
      // actually leave the device before the lock screen potentially
      // disrupts networking, NOT to wait for audio readiness anymore.
      lockTimerRef.current = setTimeout(() => {
        AppBlock.lockScreen();
      }, LOCK_DELAY_MS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, soundEnabled]);

  // A autenticacao do aparelho e a UNICA forma de desligar: so o dono passa por
  // ela, e o SO ja cai para PIN/padrao do aparelho se a digital falhar. Nao ha
  // PIN proprio do app (removido em 2026-09-09 — era um segredo a mais, em texto
  // puro, mais fraco que o do SO).
  useEffect(() => {
    if (visible) getBiometricSupport().then((s) => setBiometricAvailable(s.available));
  }, [visible]);

  async function unlockWithBiometric() {
    if (await authenticateBiometric(t("antifurto.biometricPrompt"))) onDismiss();
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

        <Button
          label={t("antifurto.biometricUnlock")}
          variant="secondary"
          icon="finger-print"
          onPress={unlockWithBiometric}
          disabled={!biometricAvailable}
        />
      </View>
    </Modal>
  );
}
