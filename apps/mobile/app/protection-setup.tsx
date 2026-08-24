import { useCallback, useEffect, useState } from "react";
import { View, Platform } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { Text, Button, Card, ScreenContainer, ScreenHeader } from "@/components/ui";
import { colors } from "@/theme";
import { storage } from "@/lib/storage";
import * as AppBlock from "@modules/app-block";

export const SHIELD_SETUP_DONE_KEY = "wityu_shield_setup_done";

/**
 * One-time "harden the shield" walkthrough for the child's device. Aggressive
 * OEM battery savers (MIUI/HyperOS, EMUI, ColorOS…) kill background apps and
 * silently flip the AccessibilityService off — these manual switches are the
 * only way to keep the protection alive 24/7. Linked from the ChildHome care
 * card whenever any step looks missing.
 */
export default function ProtectionSetupScreen() {
  const { t } = useTranslation();
  const [batteryExempt, setBatteryExempt] = useState(() => AppBlock.isIgnoringBatteryOptimizations());
  const [overlayOn, setOverlayOn] = useState(() => AppBlock.canDrawOverlays());
  const [overlayDiag, setOverlayDiag] = useState(() => AppBlock.getLastOverlayResult());
  const [adminOn, setAdminOn] = useState(() => AppBlock.isDeviceAdminActive());
  const aggressiveOem = AppBlock.isAggressiveOem();

  // The system dialogs resolve outside the app — re-check whenever we regain
  // focus (simple interval; the screen is short-lived).
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const timer = setInterval(() => {
      setBatteryExempt(AppBlock.isIgnoringBatteryOptimizations());
      setOverlayOn(AppBlock.canDrawOverlays());
      setOverlayDiag(AppBlock.getLastOverlayResult());
      setAdminOn(AppBlock.isDeviceAdminActive());
    }, 1500);
    return () => clearInterval(timer);
  }, []);

  const diagOk =
    overlayDiag?.result === "a11y-overlay" ||
    overlayDiag?.result === "app-overlay" ||
    overlayDiag?.result === "fullscreen-intent";

  const finish = useCallback(() => {
    void storage.setItem(SHIELD_SETUP_DONE_KEY, "1");
    router.back();
  }, []);

  return (
    <ScreenContainer>
      <ScreenHeader title={t("shieldSetup.title")} onBack={() => router.back()} />
      <Text variant="body" color="muted" className="mt-1">
        {t("shieldSetup.subtitle")}
      </Text>

      {/* Step 0 — uninstall protection. FIRST because it's the widest hole:
          without it the child just long-presses the icon and taps "Desinstalar",
          and every other layer goes with it. */}
      <Card className="mt-4 gap-2">
        <View className="flex-row items-center gap-3">
          <View className="h-11 w-11 items-center justify-center rounded-2xl bg-brand-50">
            <Ionicons name="lock-closed" size={22} color={colors.brand[500]} />
          </View>
          <View className="flex-1">
            <Text variant="title">{t("shieldSetup.adminTitle")}</Text>
            <Text variant="caption" color="muted">
              {t("shieldSetup.adminBody")}
            </Text>
          </View>
          {adminOn ? <Ionicons name="checkmark-circle" size={24} color={colors.safe[500]} /> : null}
        </View>
        {!adminOn ? (
          <Button
            label={t("shieldSetup.open")}
            size="sm"
            variant="secondary"
            onPress={() => AppBlock.requestDeviceAdmin()}
          />
        ) : null}
      </Card>

      {/* Step 1 — battery optimization exemption (all Androids) */}
      <Card className="mt-4 gap-2">
        <View className="flex-row items-center gap-3">
          <View className="h-11 w-11 items-center justify-center rounded-2xl bg-brand-50">
            <Ionicons name="battery-charging" size={22} color={colors.brand[500]} />
          </View>
          <View className="flex-1">
            <Text variant="title">{t("shieldSetup.batteryTitle")}</Text>
            <Text variant="caption" color="muted">
              {t("shieldSetup.batteryBody")}
            </Text>
          </View>
          {batteryExempt ? <Ionicons name="checkmark-circle" size={24} color={colors.safe[500]} /> : null}
        </View>
        {!batteryExempt ? (
          <Button
            label={t("shieldSetup.open")}
            size="sm"
            variant="secondary"
            onPress={() => AppBlock.requestIgnoreBatteryOptimizations()}
          />
        ) : null}
      </Card>

      {/* Step 2 — display over other apps (the blocked-app panel's fallback
          path; on MIUI this is what makes it appear instantly and reliably) */}
      <Card className="mt-3 gap-2">
        <View className="flex-row items-center gap-3">
          <View className="h-11 w-11 items-center justify-center rounded-2xl bg-brand-50">
            <Ionicons name="albums" size={22} color={colors.brand[500]} />
          </View>
          <View className="flex-1">
            <Text variant="title">{t("shieldSetup.overlayTitle")}</Text>
            <Text variant="caption" color="muted">
              {t("shieldSetup.overlayBody")}
            </Text>
          </View>
          {overlayOn ? <Ionicons name="checkmark-circle" size={24} color={colors.safe[500]} /> : null}
        </View>
        {!overlayOn ? (
          <Button
            label={t("shieldSetup.open")}
            size="sm"
            variant="secondary"
            onPress={() => AppBlock.requestOverlayPermission()}
          />
        ) : null}
      </Card>

      {/* Step 3 — OEM autostart manager (Xiaomi/Huawei/Oppo/Vivo…) */}
      {aggressiveOem ? (
        <Card className="mt-3 gap-2">
          <View className="flex-row items-center gap-3">
            <View className="h-11 w-11 items-center justify-center rounded-2xl bg-brand-50">
              <Ionicons name="rocket-outline" size={22} color={colors.brand[500]} />
            </View>
            <View className="flex-1">
              <Text variant="title">{t("shieldSetup.autostartTitle")}</Text>
              <Text variant="caption" color="muted">
                {t("shieldSetup.autostartBody")}
              </Text>
            </View>
          </View>
          <Button
            label={t("shieldSetup.open")}
            size="sm"
            variant="secondary"
            onPress={() => AppBlock.openAutostartSettings()}
          />
        </Card>
      ) : null}

      {/* Step 3.5 — MIUI "lock in recents": the padlock is what stops "clear
          all" from killing the app. Instruction-only (no API to open it). */}
      {aggressiveOem ? (
        <Card className="mt-3 gap-2">
          <View className="flex-row items-center gap-3">
            <View className="h-11 w-11 items-center justify-center rounded-2xl bg-brand-50">
              <Ionicons name="lock-closed-outline" size={22} color={colors.brand[500]} />
            </View>
            <View className="flex-1">
              <Text variant="title">{t("shieldSetup.recentsLockTitle")}</Text>
              <Text variant="caption" color="muted">
                {t("shieldSetup.recentsLockBody")}
              </Text>
            </View>
          </View>
        </Card>
      ) : null}

      {/* Step 4 — MIUI "display pop-up windows in background" (needed for the
          blocked screen to appear over other apps) */}
      {aggressiveOem ? (
        <Card className="mt-3 gap-2">
          <View className="flex-row items-center gap-3">
            <View className="h-11 w-11 items-center justify-center rounded-2xl bg-brand-50">
              <Ionicons name="albums-outline" size={22} color={colors.brand[500]} />
            </View>
            <View className="flex-1">
              <Text variant="title">{t("shieldSetup.popupTitle")}</Text>
              <Text variant="caption" color="muted">
                {t("shieldSetup.popupBody")}
              </Text>
            </View>
          </View>
          <Button
            label={t("shieldSetup.open")}
            size="sm"
            variant="secondary"
            onPress={() => AppBlock.openAppSettings()}
          />
        </Card>
      ) : null}

      {/* Diagnostic — after the guardian opens a blocked app to test, this
          confirms the panel actually rendered (and via which path). Turns the
          test into a definitive check instead of a subjective "did it show?". */}
      {overlayDiag ? (
        <View className="mt-4 flex-row items-center gap-2 rounded-2xl bg-surface-alt px-4 py-3">
          <Ionicons
            name={diagOk ? "checkmark-circle" : "alert-circle"}
            size={20}
            color={diagOk ? colors.safe[500] : colors.danger[500]}
          />
          <Text variant="caption" color="muted" className="flex-1">
            {diagOk ? t("shieldSetup.diagOk") : t("shieldSetup.diagFail", { detail: overlayDiag.result })}
          </Text>
        </View>
      ) : null}

      <Button label={t("shieldSetup.done")} fullWidth className="mt-6" onPress={finish} />
    </ScreenContainer>
  );
}
