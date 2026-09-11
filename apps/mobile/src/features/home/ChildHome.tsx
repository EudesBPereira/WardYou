import { useEffect, useState } from "react";
import { View, Pressable, Modal, ActivityIndicator, Platform } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Card, Text, Button } from "@/components/ui";
import { ProfileButton } from "@/components/ProfileButton";
import { colors } from "@/theme";
import { useMocks } from "@/lib/env";
import { useSession } from "@/stores/session";
import { getCurrentPosition } from "@/services/location/locationService";
import { useReportLocation } from "@/features/family/queries";
import {
  useMyParentalStatus,
  useRequestExtraTime,
  useMyTasks,
  useHeartbeat,
} from "@/features/parental/childQueries";
import {
  syncEnforcement,
  reportUsage,
  reportInstalledApps,
  isAccessibilityServiceEnabled,
  isUsageAccessEnabled,
} from "@/features/parental/enforcement";
import {
  isIgnoringBatteryOptimizations,
  isAggressiveOem,
  getUsageToday,
  canDrawOverlays,
  isDeviceAdminActive,
} from "@modules/app-block";
import { WARDYOU_PACKAGE } from "@/features/parental/enforcementLogic";
import { isTaskAvailable } from "@/features/parental/taskCompletion";
import { storage } from "@/lib/storage";
import { SHIELD_SETUP_DONE_KEY } from "../../../app/protection-setup";
import { ProtectionStatusCard } from "@/features/protection/ProtectionStatusCard";

const EXTRA_TIME_OPTIONS = [15, 30, 60];
const HEARTBEAT_INTERVAL_MS = 60_000;

function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

/** Home screen rendered when the signed-in user is a child: time budget of the
 *  day, remote-pause state, extra-time requests and the shortcut to earn more
 *  screen time via tasks. Management features are never shown here. */
export function ChildHome() {
  const { t } = useTranslation();
  const session = useSession((s) => s.session);
  const { data: status, isLoading } = useMyParentalStatus();
  const { data: myTasks } = useMyTasks();
  const requestExtra = useRequestExtraTime();
  const heartbeat = useHeartbeat();
  const reportLocation = useReportLocation();
  const [askOpen, setAskOpen] = useState(false);
  const [accessibilityEnabled, setAccessibilityEnabled] = useState(true);
  const [usageAccessEnabled, setUsageAccessEnabled] = useState(true);
  // "Harden the shield" care card: aggressive OEMs (MIUI etc.) kill the
  // protection in background unless battery/autostart are manually exempted.
  const [batteryExempt, setBatteryExempt] = useState(true);
  const [overlayOn, setOverlayOn] = useState(true);
  const [adminOn, setAdminOn] = useState(true);
  const [shieldSetupDone, setShieldSetupDone] = useState(true);
  // Live local screen-time (UsageStats) so the progress bar climbs as the
  // phone is used — without waiting for the report→server→refetch round trip.
  const [localUsedMinutes, setLocalUsedMinutes] = useState(0);

  const hasLimits = status?.hasPolicy && status.isEnabled;
  const remaining = status?.remainingMinutes ?? 0;

  // Presence + location ping so guardians see the child online and on the map,
  // plus the real enforcement sync: recompute what should be blocked right now
  // (locally, in this device's own time zone) and push it to the
  // AccessibilityService cache. All best-effort; repeats while the app is open.
  useEffect(() => {
    if (useMocks) return;
    const userId = session?.userId;
    let ticks = 0;
    function tick() {
      heartbeat.mutate();
      setAccessibilityEnabled(isAccessibilityServiceEnabled());
      setUsageAccessEnabled(isUsageAccessEnabled());
      setBatteryExempt(Platform.OS !== "android" || isIgnoringBatteryOptimizations());
      setOverlayOn(Platform.OS !== "android" || canDrawOverlays());
      setAdminOn(Platform.OS !== "android" || isDeviceAdminActive());
      if (Platform.OS === "android") {
        // Same filter as reportUsage — WardYou itself doesn't consume the budget.
        setLocalUsedMinutes(
          getUsageToday()
            .filter((u) => u.packageName !== WARDYOU_PACKAGE)
            .reduce((sum, u) => sum + u.minutes, 0),
        );
      }
      if (userId) {
        // Report real usage first so the server's remaining time is fresh, then
        // push the enforcement decision to the AccessibilityService.
        reportUsage(userId).finally(() => syncEnforcement(userId, remaining));
      }
      // Newly installed apps show up for the guardian within ~15 min while the
      // child keeps the app open — not only on the next cold open.
      if (ticks > 0 && ticks % 15 === 0) reportInstalledApps();
      ticks += 1;
    }
    tick();
    // Report installed apps once on open so the guardian's list stays current.
    reportInstalledApps();
    const timer = setInterval(tick, HEARTBEAT_INTERVAL_MS);
    getCurrentPosition().then((coords) => {
      if (!coords) return;
      reportLocation.mutate({
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracyMeters: coords.accuracy,
      });
    });
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.userId, remaining]);

  // One-time "shield hardening" flag (autostart etc. aren't OS-checkable — the
  // walkthrough screen sets this when the user finishes it).
  useEffect(() => {
    if (Platform.OS !== "android" || !isAggressiveOem()) return;
    setShieldSetupDone(false);
    void storage.getItem(SHIELD_SETUP_DONE_KEY).then((v) => setShieldSetupDone(v === "1"));
  }, []);

  const allowance = (status?.dailyLimitMinutes ?? 0) + (status?.extraMinutesToday ?? 0);
  // Best of both: server-confirmed usage vs. what UsageStats says right now —
  // the local read updates every tick, so the bar climbs live while the server
  // number catches up on the next report/refetch cycle.
  const used = Math.max(status?.usedMinutesToday ?? 0, localUsedMinutes);
  const usedPct = allowance > 0 ? Math.min(100, Math.round((used / allowance) * 100)) : 0;
  // Header countdown consistent with the live bar (server `remaining` still
  // drives enforcement in syncEnforcement — this is display only).
  const displayRemaining = Math.min(remaining, Math.max(0, allowance - used));

  // Achado de QA 2026-09-11: sem o filtro `isTaskAvailable`, este card contava
  // uma tarefa ja aprovada e paga como "disponivel para ganhar" -- o card
  // "Ganhe mais tempo" continuava anunciando os mesmos minutos depois de a
  // tarefa (unica, nao recorrente) ja ter sido creditada, mesmo com
  // app/(tabs)/tasks.tsx corretamente escondendo o botao "Concluí!" pra ela.
  // Mesma regra usada la, extraida pra src/features/parental/taskCompletion.ts
  // depois de aparecer duplicada (torto) nos dois lugares.
  const allTasks = myTasks?.tasks ?? [];
  const completions = myTasks?.completions ?? [];
  const activeTasks = allTasks.filter((task) => isTaskAvailable(task, completions));
  const earnableMinutes = activeTasks.reduce((sum, task) => sum + task.rewardMinutes, 0);

  function askExtraTime(minutes: number) {
    requestExtra.mutate(minutes, { onSettled: () => setAskOpen(false) });
  }

  return (
    <ScreenContainer>
      <View className="flex-row items-center justify-between py-2">
        <View className="flex-1">
          <Text variant="h1">WardYou</Text>
        </View>
        <ProfileButton />
      </View>

      {isLoading ? <ActivityIndicator className="mt-8" color={colors.brand[500]} /> : null}

      {/* Paused by guardians */}
      {status?.isPaused ? (
        <Card className="mt-2 flex-row items-center gap-3 border border-danger-500/30">
          <View className="h-12 w-12 items-center justify-center rounded-2xl bg-danger-50">
            <Ionicons name="pause-circle" size={26} color={colors.danger[500]} />
          </View>
          <View className="flex-1">
            <Text variant="title">{t("childHome.pausedTitle")}</Text>
            <Text variant="caption" color="muted">
              {t("childHome.pausedBody")}
            </Text>
          </View>
        </Card>
      ) : null}

      {/* Painel unico de estado da protecao.
          Substitui a fila de cards que apareciam UM DE CADA VEZ (acessibilidade
          -> depois uso -> depois blindagem). Aquele desenho escondia o tamanho
          da tarefa: resolvia-se um, parecia ter acabado, e no dia seguinte
          aparecia outro. Agora tudo que falta e listado junto, com contagem, e
          inclui sinais que ninguem verificava — GPS desligado no sistema,
          permissao de localizacao negada e push bloqueado. */}
      <ProtectionStatusCard modoCrianca />

      {/* Blindagem contra OEM. Condicao reduzida a `!shieldSetupDone` porque o
          ProtectionStatusCard acima ja cobre admin, bateria e sobreposicao —
          manter os tres aqui faria dois paineis dizerem a mesma coisa. O que
          sobra e exclusivo desta tela: o autostart da MIUI e afins, que o
          Android NAO permite consultar, entao so um "ja fiz" manual resolve. */}
      {Platform.OS === "android" && accessibilityEnabled && usageAccessEnabled && !shieldSetupDone ? (
        <Card
          onPress={() => router.push("/protection-setup")}
          className="mt-2 flex-row items-center gap-3 border border-brand-500/30"
        >
          <View className="h-12 w-12 items-center justify-center rounded-2xl bg-brand-50">
            <Ionicons name="shield-checkmark" size={24} color={colors.brand[500]} />
          </View>
          <View className="flex-1">
            <Text variant="title">{t("childHome.shieldCareTitle")}</Text>
            <Text variant="caption" color="muted">
              {t("childHome.shieldCareBody")}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors["ink-subtle"]} />
        </Card>
      ) : null}

      {/* Time budget of the day */}
      {status && !status.hasPolicy ? (
        <Card tone="brand" className="mt-2 gap-1">
          <Text variant="title" color="inverse">
            {t("childHome.noPolicyTitle")}
          </Text>
          <Text variant="caption" color="inverse" className="opacity-90">
            {t("childHome.noPolicyBody")}
          </Text>
        </Card>
      ) : null}

      {hasLimits ? (
        <Card className="mt-2 gap-3">
          <View className="flex-row items-center justify-between">
            <Text variant="title">{t("childHome.timeTitle")}</Text>
            <Text variant="h2" color={displayRemaining <= 15 ? "danger" : "brand"}>
              {formatMinutes(displayRemaining)}
            </Text>
          </View>
          <View className="h-3 overflow-hidden rounded-full bg-surface-alt">
            <View
              className={`h-3 rounded-full ${usedPct >= 90 ? "bg-danger-500" : "bg-brand-500"}`}
              style={{ width: `${usedPct}%` }}
            />
          </View>
          <Text variant="caption" color="muted">
            {t("childHome.timeDetail", {
              used: formatMinutes(used),
              total: formatMinutes(allowance),
            })}
            {status?.extraMinutesToday ? ` · ${t("childHome.extraToday", { min: status.extraMinutesToday })}` : ""}
          </Text>

          {status?.pendingExtraRequest ? (
            <View className="flex-row items-center gap-2 rounded-2xl bg-surface-alt px-3 py-2.5">
              <Ionicons name="hourglass" size={18} color={colors["ink-muted"]} />
              <Text variant="caption" color="muted" className="flex-1">
                {t("childHome.pendingRequest", { min: status.pendingExtraRequest.requestedMinutes })}
              </Text>
            </View>
          ) : (
            <Button
              label={t("childHome.askMoreTime")}
              icon="add-circle-outline"
              variant="secondary"
              onPress={() => setAskOpen(true)}
            />
          )}
        </Card>
      ) : null}

      {/* Sleep window */}
      {hasLimits && status?.sleep?.isEnabled ? (
        <Card className="mt-4 flex-row items-center gap-3">
          <View className="h-11 w-11 items-center justify-center rounded-2xl bg-surface-alt">
            <Ionicons name="moon" size={22} color={colors.ink} />
          </View>
          <View className="flex-1">
            <Text variant="title">{t("childHome.sleepTitle")}</Text>
            <Text variant="caption" color="muted">
              {t("childHome.sleepBody", { from: status.sleep.startTime, to: status.sleep.endTime })}
            </Text>
          </View>
        </Card>
      ) : null}

      {/* Earn more time via tasks */}
      <Card tone="brand" onPress={() => router.navigate("/tasks" as never)} className="mt-4 flex-row items-center gap-3">
        <View className="h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
          <Ionicons name="trophy" size={24} color="#FFFFFF" />
        </View>
        <View className="flex-1">
          <Text variant="title" color="inverse">
            {t("childHome.tasksTitle")}
          </Text>
          <Text variant="caption" color="inverse" className="opacity-90">
            {activeTasks.length > 0
              ? t("childHome.tasksBody", { count: activeTasks.length, min: earnableMinutes })
              : t("childHome.tasksEmpty")}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#FFFFFF" />
      </Card>

      {/* SOS */}
      <Card onPress={() => router.navigate("/sos" as never)} className="mt-4 flex-row items-center gap-3">
        <View className="h-12 w-12 items-center justify-center rounded-2xl bg-danger-50">
          <Ionicons name="warning" size={24} color={colors.danger[500]} />
        </View>
        <View className="flex-1">
          <Text variant="title">{t("childHome.sosTitle")}</Text>
          <Text variant="caption" color="muted">
            {t("childHome.sosBody")}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors["ink-subtle"]} />
      </Card>

      {/* Ask-for-time modal */}
      <Modal visible={askOpen} transparent animationType="fade" onRequestClose={() => setAskOpen(false)}>
        <Pressable className="flex-1 items-center justify-center bg-overlay px-6" onPress={() => setAskOpen(false)}>
          <Pressable className="w-full rounded-3xl bg-surface p-5" onPress={() => {}}>
            <Text variant="title">{t("childHome.askMoreTime")}</Text>
            <Text variant="caption" color="muted" className="mt-1">
              {t("childHome.askSubtitle")}
            </Text>
            <View className="mt-4 flex-row gap-3">
              {EXTRA_TIME_OPTIONS.map((min) => (
                <Pressable
                  key={min}
                  accessibilityRole="button"
                  disabled={requestExtra.isPending}
                  onPress={() => askExtraTime(min)}
                  className="flex-1 items-center rounded-2xl bg-brand-50 py-4 active:opacity-70"
                >
                  <Text variant="h2" color="brand">
                    {min}
                  </Text>
                  <Text variant="caption" color="muted">
                    min
                  </Text>
                </Pressable>
              ))}
            </View>
            {requestExtra.isPending ? <ActivityIndicator className="mt-3" color={colors.brand[500]} /> : null}
          </Pressable>
        </Pressable>
      </Modal>
    </ScreenContainer>
  );
}
