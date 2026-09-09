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
} from "@/components/ui";
import { useMocks } from "@/lib/env";
import * as AppBlock from "@modules/app-block";
import { getBiometricSupport } from "@/services/auth/biometrics";
import { confirmSensitive } from "@/services/auth/confirmSensitive";
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

  const { armed, soundEnabled, hydrated, setArmed, setSoundEnabled } = useAntifurtoStore();
  const [alarmActive, setAlarmActive] = useState(false);
  // Whether the alarm overlay still needs to fire the SOS itself: true when
  // rush-detection opened it (nothing has posted yet), false when the manual
  // hold button opened it (already posted — avoids a duplicate SOS event).
  const [alarmShouldFireSos, setAlarmShouldFireSos] = useState(false);

  // O Modo Guarda depende da autenticacao do aparelho: so o dono desliga o
  // alarme. Nao ha PIN proprio do app (removido em 2026-09-09) — o SO ja cai
  // para PIN/padrao do aparelho quando a digital falha.
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
      // Abre o alarme so se houver como desliga-lo (autenticacao do aparelho).
      if (soundEnabled && biometricAvailable) {
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
  // NAO voltar a condicionar isto a nada alem de `armed`. Ja houve um
  // `armed && !!pin` aqui que deixava o toggle ligado na tela com a deteccao
  // DESLIGADA para quem armava so com digital — protecao que se anuncia e nao
  // existe. Armar sem autenticacao do aparelho ja e bloqueado em handleArmToggle.
  useRushDetection(armed, () => {
    setAlarmShouldFireSos(true);
    setAlarmActive(true);
  });

  async function handleArmToggle(next: boolean) {
    // DESARMAR exige autenticacao: sem isso quem pega o telefone desliga o
    // antifurto antes de levar o aparelho.
    if (!next && !(await confirmSensitive(t("antifurto.confirmDisarm")))) return;
    // O alarme so se desliga com a autenticacao do aparelho (digital, e o SO ja
    // cai para PIN/padrao do proprio Android). Sem nenhuma credencial cadastrada
    // nao ha como desligar, entao nem armamos — armar seria criar um alarme que
    // o dono nao consegue calar.
    if (next && !biometricAvailable) {
      Alert.alert(t("antifurto.needsDeviceAuthTitle"), t("antifurto.needsDeviceAuthBody"));
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

      <AntifurtoAlarmOverlay
        visible={alarmActive}
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
