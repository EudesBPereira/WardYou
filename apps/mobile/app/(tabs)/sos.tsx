import { useEffect, useState } from "react";
import { View, Alert, AppState, Platform } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/theme";
import {
  ScreenContainer,
  Text,
  Card,
  ListItem,
  Toggle,
  Button,
  HoldButton,
  InputModal,
} from "@/components/ui";
import { useMocks } from "@/lib/env";
import * as AppBlock from "@modules/app-block";
import { getBiometricSupport } from "@/services/auth/biometrics";
import { getCurrentPosition } from "@/services/location/locationService";
import { useMyFamilies } from "@/features/family/queries";
import { useActiveSos, useTriggerSos, useCloseSos } from "@/features/sos/queries";
import { useAntifurtoStore } from "@/stores/antifurto";
import { useRushDetection } from "@/features/sos/useRushDetection";
import { AntifurtoAlarmOverlay } from "@/features/sos/AntifurtoAlarmOverlay";

export default function SosScreen() {
  const { t } = useTranslation();
  const [sendLocation, setSendLocation] = useState(true);
  const { data: families = [] } = useMyFamilies();
  const { data: activeSos = [] } = useActiveSos();
  const trigger = useTriggerSos();
  const close = useCloseSos();

  const { armed, pin, soundEnabled, hydrated, setArmed, setPin, setSoundEnabled } = useAntifurtoStore();
  const [pinSetupOpen, setPinSetupOpen] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [alarmActive, setAlarmActive] = useState(false);
  // Whether the alarm overlay still needs to fire the SOS itself: true when
  // rush-detection opened it (nothing has posted yet), false when the manual
  // hold button opened it (already posted — avoids a duplicate SOS event).
  const [alarmShouldFireSos, setAlarmShouldFireSos] = useState(false);

  // When a biometric is enrolled, Guard Mode can arm without a PIN — the alarm
  // is dismissed by the owner's fingerprint/face (only they can pass it).
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  useEffect(() => {
    useAntifurtoStore.getState().hydrate();
    getBiometricSupport().then((s) => setBiometricAvailable(s.available));
  }, []);

  // Whether the post-snatch screen lock can actually fire (accessibility
  // service on). Re-checked when the app regains focus, since enabling it
  // happens in OS Settings. Drives the persistent warning card below —
  // an arm-time Alert alone misses users who were already armed.
  const [lockReady, setLockReady] = useState(true);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const check = () => setLockReady(AppBlock.canLockScreen());
    check();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") check();
    });
    return () => sub.remove();
  }, []);

  const active = activeSos[0];

  async function fireSos() {
    let coords: { latitude: number; longitude: number } | null = null;
    if (sendLocation) {
      coords = await getCurrentPosition();
    }
    await trigger.mutateAsync({
      familyId: families[0]?.id,
      latitude: coords?.latitude,
      longitude: coords?.longitude,
      sendLocation: sendLocation && !!coords,
    });
  }

  async function handleActivate() {
    try {
      await fireSos();
      // Abre o alarme desde que exista ALGUM jeito de desliga-lo. Antes exigia
      // `pin`, o que silenciava o alarme de quem usa so a digital.
      if (soundEnabled && (pin || biometricAvailable)) {
        setAlarmShouldFireSos(false);
        setAlarmActive(true);
      } else if (!useMocks) {
        Alert.alert(t("sos.title"), t("sos.sentConfirm"));
      }
    } catch {
      Alert.alert(t("sos.title"), t("sos.sendError"));
    }
  }

  // Antifurto Fase 1 (docs/antifurto.md): while armed, a sudden-movement spike
  // opens the full-screen alarm, which fires the SOS itself.
  //
  // NAO voltar a condicionar isto a `!!pin`. Com biometria disponivel o Modo
  // Guarda arma SEM PIN (ver handleArmToggle), entao `armed && !!pin` deixava o
  // toggle ligado na tela com a deteccao DESLIGADA — protecao que se anuncia e
  // nao existe. `armed` ja implica pin ou biometria, porque armar sem nenhum
  // dos dois e bloqueado.
  useRushDetection(armed, () => {
    setAlarmShouldFireSos(true);
    setAlarmActive(true);
  });

  function handleArmToggle(next: boolean) {
    // No PIN yet? Require setting one ONLY when there's no biometric fallback —
    // otherwise arm straight away and let the fingerprint dismiss the alarm.
    if (next && !pin && !biometricAvailable) {
      setPinSetupOpen(true);
      return;
    }
    if (next) maybePromptForLockService();
    setArmed(next);
  }

  // The post-snatch screen lock rides on the WardYou accessibility service
  // (GLOBAL_ACTION_LOCK_SCREEN). Guard Mode still arms without it (alarm +
  // SOS only), so this is an offer, not a gate.
  function maybePromptForLockService() {
    if (Platform.OS !== "android" || AppBlock.canLockScreen()) return;
    Alert.alert(t("antifurto.lockPromptTitle"), t("antifurto.lockPromptBody"), [
      { text: t("antifurto.lockPromptLater"), style: "cancel" },
      { text: t("antifurto.lockPromptEnable"), onPress: () => AppBlock.openAccessibilitySettings() },
    ]);
  }

  async function handlePinSetup(value: string) {
    if (!/^\d{4}$/.test(value)) {
      setPinError(t("antifurto.pinInvalid"));
      return;
    }
    setPinError(null);
    await setPin(value);
    await setArmed(true);
    setPinSetupOpen(false);
    maybePromptForLockService();
  }

  function handleCancel() {
    if (!active) return;
    Alert.alert(t("sos.title"), t("sos.cancelConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("sos.cancelActive"), style: "destructive", onPress: () => close.mutate(active.id) },
    ]);
  }

  return (
    <ScreenContainer tone="night">
      {/* No "SOS" heading — the tab bar + giant red button already say it. */}
      <View className="py-3">
        <Text variant="body" color="inverse" className="opacity-80">
          {t("sos.holdInstruction")}
        </Text>
      </View>

      {/* Active SOS banner */}
      {active ? (
        <Card className="mb-2 gap-3 border border-danger-500/40">
          <View className="flex-row items-center gap-2">
            <View className="h-2.5 w-2.5 rounded-full bg-danger-500" />
            <Text variant="title" color="danger">
              {t("sos.activeTitle")}
            </Text>
          </View>
          <Text variant="caption" color="muted">
            {t("sos.activeBody")}
          </Text>
          <Button
            label={t("sos.cancelActive")}
            variant="danger"
            icon="close-circle-outline"
            onPress={handleCancel}
            loading={close.isPending}
          />
        </Card>
      ) : null}

      <View className="my-8 items-center">
        <HoldButton
          onActivate={handleActivate}
          activated={!!active}
          idleLabel={t("sos.holdButton")}
          holdingLabel={t("sos.holdingButton")}
          activatedLabel={t("sos.sentButton")}
          hint={t("sos.holdHint")}
        />
      </View>

      <Text variant="label" color="inverse" className="mb-2 opacity-70">
        {t("sos.config.title")}
      </Text>
      <Card padded={false} className="px-4">
        <ListItem
          title={t("sos.config.sendLocation")}
          icon="location"
          iconTone="brand"
          trailing={<Toggle value={sendLocation} onValueChange={setSendLocation} />}
        />
        <View className="h-px bg-border" />
        <ListItem
          title={t("sos.config.soundMode")}
          icon="volume-high"
          iconTone="warning"
          trailing={<Toggle value={soundEnabled} onValueChange={setSoundEnabled} />}
        />
      </Card>

      {/* Antifurto Fase 1 — see docs/antifurto.md. A deterrent (alarm + siren),
          not a real device lock; Platform.OS check just skips the toggle on
          web, where expo-sensors' Accelerometer never fires. */}
      {Platform.OS !== "web" ? (
        <>
          <Text variant="label" color="inverse" className="mb-2 mt-6 opacity-70">
            {t("antifurto.title")}
          </Text>
          <Card padded={false} className="px-4">
            <ListItem
              title={t("antifurto.armTitle")}
              subtitle={t("antifurto.armSubtitle")}
              icon="shield-half"
              iconTone="danger"
              trailing={<Toggle value={armed && hydrated} onValueChange={handleArmToggle} disabled={!hydrated} />}
            />
            {/* Always offer PIN management — with biometric-only arming there's
                no PIN yet, but the user can still add one as a backup. */}
            <View className="h-px bg-border" />
            <ListItem
              title={pin ? t("antifurto.changePin") : t("antifurto.setPin")}
              subtitle={!pin && biometricAvailable ? t("antifurto.pinOptional") : undefined}
              icon="keypad"
              iconTone="neutral"
              onPress={() => setPinSetupOpen(true)}
            />
          </Card>

          {/* Armed but the screen lock can't fire: without the accessibility
              service the alarm still screams + SOS, but the thief keeps an
              unlocked phone. Persistent (not just the arm-time Alert) because
              users armed before the feature existed never saw that Alert. */}
          {armed && hydrated && Platform.OS === "android" && !lockReady ? (
            <Card
              onPress={() => AppBlock.openAccessibilitySettings()}
              className="mt-2 flex-row items-center gap-3 border border-warning/40"
            >
              <View className="h-12 w-12 items-center justify-center rounded-2xl bg-warning/15">
                <Ionicons name="lock-open" size={24} color={colors.warning[500]} />
              </View>
              <View className="flex-1">
                <Text variant="title">{t("antifurto.lockDisabledTitle")}</Text>
                <Text variant="caption" color="muted">
                  {t("antifurto.lockDisabledBody")}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors["ink-subtle"]} />
            </Card>
          ) : null}
        </>
      ) : null}

      <InputModal
        visible={pinSetupOpen}
        title={t("antifurto.pinSetupTitle")}
        subtitle={t("antifurto.pinSetupSubtitle")}
        placeholder="0000"
        confirmLabel={t("common.save")}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={4}
        error={pinError}
        onConfirm={handlePinSetup}
        onClose={() => {
          setPinError(null);
          setPinSetupOpen(false);
        }}
      />

      <AntifurtoAlarmOverlay
        visible={alarmActive}
        pin={pin ?? ""}
        soundEnabled={soundEnabled}
        onDismiss={() => setAlarmActive(false)}
        onTriggerSos={alarmShouldFireSos ? fireSos : undefined}
        // Lock only on the theft path — never lock the owner out right after
        // they manually held the SOS button.
        lockOnActivate={alarmShouldFireSos}
      />
    </ScreenContainer>
  );
}
