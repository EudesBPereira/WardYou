import { useCallback, useEffect, useState } from "react";
import { View, ActivityIndicator, AppState, Alert, Linking, Platform } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, ScreenHeader, Card, Text, Toggle } from "@/components/ui";
import { colors } from "@/theme";
import { useMyDevices, useCreateDevice, useUpdateDevice, useRegisterPushToken } from "@/features/devices/queries";
import { registerForPush, getPushPermissionStatus, pushSupported, type PushPermissionStatus } from "@/services/push/pushService";

function thisPlatform(): string {
  switch (Platform.OS) {
    case "ios": return "iOS";
    case "android": return "Android";
    case "macos": return "MacCatalyst";
    default: return "Windows";
  }
}

/**
 * Notifications screen (formerly "Meus dispositivos"). Refocused on the two
 * things that actually matter for one phone: (1) enabling push alerts (SOS,
 * family, parental) — which registers this device + its push token; and (2) the
 * device-level location precision (exact vs approximate on the map). The legacy
 * multi-device management (rename/remove/register) was dropped: the single
 * device record for this phone is created transparently when needed.
 */
export default function NotificationsScreen() {
  const { t, i18n } = useTranslation();
  const { data: devices = [], isLoading } = useMyDevices();
  const create = useCreateDevice();
  const update = useUpdateDevice();
  const registerToken = useRegisterPushToken();
  const [pushStatus, setPushStatus] = useState<PushPermissionStatus | null>(null);
  const [pushBusy, setPushBusy] = useState(false);

  const device = devices[0];

  const refreshPush = useCallback(() => {
    getPushPermissionStatus().then(setPushStatus).catch(() => {});
  }, []);
  useEffect(() => {
    refreshPush();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") refreshPush();
    });
    return () => sub.remove();
  }, [refreshPush]);

  async function enablePush() {
    if (!pushSupported) {
      Alert.alert(t("notifications.title"), t("notifications.webUnsupported"));
      return;
    }
    setPushBusy(true);
    try {
      const token = await registerForPush();
      setPushStatus(await getPushPermissionStatus());
      if (!token) {
        // Permission refused → guide to system settings to re-enable.
        Alert.alert(t("notifications.title"), t("notifications.denied"), [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("consent.permission.openSettings"), onPress: () => Linking.openSettings() },
        ]);
        return;
      }
      let deviceId = device?.id;
      if (!deviceId) {
        const created = await create.mutateAsync({ deviceName: `${thisPlatform()} ${t("devices.thisDevice")}`, platform: thisPlatform() });
        deviceId = created.id;
      }
      await registerToken.mutateAsync({ deviceId, pushToken: token, pushLanguage: i18n.language });
      Alert.alert(t("notifications.title"), t("notifications.enabled"));
    } catch {
      Alert.alert(t("notifications.title"), t("common.genericError"));
    } finally {
      setPushBusy(false);
    }
  }

  async function setPrecise(value: boolean) {
    if (device) {
      update.mutate({ id: device.id, deviceName: device.deviceName, sharePreciseLocation: value, isActive: device.isActive });
    } else {
      // No device yet → create one for this phone carrying the chosen precision.
      create.mutate({ deviceName: `${thisPlatform()} ${t("devices.thisDevice")}`, platform: thisPlatform(), sharePreciseLocation: value });
    }
  }

  const granted = pushStatus === "granted";

  return (
    <ScreenContainer>
      <ScreenHeader title={t("notifications.title")} subtitle={t("notifications.subtitle")} onBack={() => router.back()} />

      {/* Push status / enable */}
      <Card
        tone={granted ? "surface" : "brand"}
        onPress={granted ? undefined : enablePush}
        className="mt-2 flex-row items-center gap-3"
      >
        <View className={`h-11 w-11 items-center justify-center rounded-2xl ${granted ? "bg-safe-50" : "bg-white/15"}`}>
          <Ionicons name={granted ? "notifications" : "notifications-outline"} size={22} color={granted ? colors.safe[600] : "#FFFFFF"} />
        </View>
        <View className="flex-1">
          <Text variant="title" color={granted ? "default" : "inverse"}>
            {granted ? t("notifications.enabledTitle") : t("notifications.enableTitle")}
          </Text>
          <Text variant="caption" color={granted ? "muted" : "inverse"} className={granted ? "" : "opacity-90"}>
            {granted ? t("notifications.enabledBody") : t("notifications.enableBody")}
          </Text>
        </View>
        {pushBusy ? (
          <ActivityIndicator color={granted ? colors.brand[500] : "#FFFFFF"} />
        ) : granted ? (
          <Ionicons name="checkmark-circle" size={22} color={colors.safe[600]} />
        ) : (
          <Ionicons name="chevron-forward" size={18} color="#FFFFFF" />
        )}
      </Card>

      {/* Location precision for this phone */}
      {isLoading ? (
        <ActivityIndicator className="mt-8" color={colors.brand[500]} />
      ) : (
        <Card className="mt-4">
          <View className="flex-row items-center gap-3">
            <View className="flex-1">
              <Text variant="title">{t("notifications.precise.title")}</Text>
              <Text variant="caption" color="muted" className="mt-0.5">
                {t("notifications.precise.body")}
              </Text>
            </View>
            <Toggle
              value={device?.sharePreciseLocation ?? true}
              onValueChange={setPrecise}
              accessibilityLabel={t("notifications.precise.title")}
            />
          </View>
        </Card>
      )}

      <Text variant="caption" color="subtle" className="mt-3">
        {t("notifications.note")}
      </Text>
    </ScreenContainer>
  );
}
