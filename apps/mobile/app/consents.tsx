import { useCallback, useEffect, useState } from "react";
import { View, ActivityIndicator, Pressable, AppState, Alert, Linking, Platform } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, ScreenHeader, Card, Text, Toggle, Avatar } from "@/components/ui";
import { colors } from "@/theme";
import {
  getLocationPermissionLevel,
  requestLocationAlwaysPermission,
  type LocationPermissionLevel,
} from "@/services/location/locationService";
import { useConsents, useSetConsent, useFamilyConsents, useGrantFamilyConsent, CONSENT_TYPES, type ConsentTypeName } from "@/features/consent/queries";
import { useMyFamilies, useFamilyMembers } from "@/features/family/queries";
import { confirmSensitive } from "@/services/auth/confirmSensitive";

function FamilyPermissions() {
  const { t } = useTranslation();
  const { data: families = [] } = useMyFamilies();
  const managed = families.find((f) => f.myRole === "admin" || f.myRole === "guardian");
  const { data: members = [] } = useFamilyMembers();
  const { data: famConsents = [] } = useFamilyConsents(managed?.id);
  const grant = useGrantFamilyConsent(managed?.id ?? "");

  if (!managed) return null;
  const others = members.filter((m) => m.familyId === managed.id && m.userId && m.membershipStatus === "active");
  if (others.length === 0) return null;

  const has = (userId: string, type: ConsentTypeName) =>
    famConsents.some((c) => c.userId === userId && c.type === type && c.isActive);

  const PERMS: ConsentTypeName[] = ["LocationSharing", "BatteryStatus"];

  return (
    <View className="mt-7">
      <Text variant="h2">{t("consent.family.title")}</Text>
      <Text variant="caption" color="muted" className="mb-3 mt-0.5">
        {t("consent.family.subtitle")}
      </Text>
      <Card padded={false} className="px-4">
        {others.map((m, i) => (
          <View key={m.id}>
            {i > 0 ? <View className="h-px bg-border" /> : null}
            <View className="flex-row items-center gap-3 py-3">
              <Avatar name={m.name} uri={m.avatarUrl} />
              <View className="flex-1">
                <Text variant="title">{m.name}</Text>
                <View className="mt-1 flex-row gap-2">
                  {PERMS.map((type) => {
                    const granted = has(m.userId as string, type);
                    return (
                      <Pressable
                        key={type}
                        accessibilityRole="button"
                        disabled={granted || grant.isPending}
                        onPress={() => grant.mutate({ userId: m.userId as string, type })}
                        className={`flex-row items-center gap-1 rounded-full px-3 py-1.5 ${granted ? "bg-safe-50" : "bg-surface-alt active:opacity-70"}`}
                      >
                        <Ionicons
                          name={granted ? "checkmark-circle" : "add-circle-outline"}
                          size={14}
                          color={granted ? colors.safe[600] : colors["ink-subtle"]}
                        />
                        <Text variant="caption" className={granted ? "text-safe-600" : "text-ink-subtle"}>
                          {t(`consent.types.${type}.title`)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </View>
          </View>
        ))}
      </Card>
    </View>
  );
}

export default function ConsentsScreen() {
  const { t } = useTranslation();
  const { data: consents = [], isLoading } = useConsents();
  const setConsent = useSetConsent();
  const [locationPerm, setLocationPerm] = useState<LocationPermissionLevel | null>(null);

  const isActive = (type: ConsentTypeName) => consents.some((c) => c.type === type && c.isActive);

  // Reflect the real OS location permission — refreshed when returning from the
  // system settings/permission dialog so the warning below stays accurate.
  const refreshPerm = useCallback(() => {
    getLocationPermissionLevel().then(setLocationPerm).catch(() => {});
  }, []);
  useEffect(() => {
    refreshPerm();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") refreshPerm();
    });
    return () => sub.remove();
  }, [refreshPerm]);

  // Enabling location sharing must also secure the OS "allow all the time"
  // permission — without it the family can't actually see the position (and
  // background/closed-app sharing won't work). If the OS grant is refused we
  // don't flip the consent on.
  async function onToggle(type: ConsentTypeName, active: boolean) {
    // REVOGAR consentimento tira a familia de vista — exige autenticacao.
    // Conceder nao pede nada: e a acao que aumenta protecao.
    if (!active && !(await confirmSensitive(t("consent.confirmRevoke")))) return;
    if (type === "LocationSharing" && active && Platform.OS !== "web") {
      const level = await requestLocationAlwaysPermission();
      setLocationPerm(level);
      if (level === "denied") {
        Alert.alert(
          t("consent.permission.deniedTitle"),
          t("consent.permission.deniedBody"),
          [
            { text: t("common.cancel"), style: "cancel" },
            { text: t("consent.permission.openSettings"), onPress: () => Linking.openSettings() },
          ],
        );
        return;
      }
    }
    setConsent.mutate({ type, active });
  }

  // Consent is on but the OS permission isn't "all the time" → actionable hint.
  async function fixPermission() {
    const level = await requestLocationAlwaysPermission();
    setLocationPerm(level);
    if (level !== "always") Linking.openSettings();
  }

  const locationWarning =
    isActive("LocationSharing") && locationPerm && locationPerm !== "always"
      ? locationPerm === "denied"
        ? t("consent.permission.denied")
        : t("consent.permission.foregroundOnly")
      : null;

  return (
    <ScreenContainer>
      <ScreenHeader
        title={t("consent.title")}
        subtitle={t("consent.subtitle")}
        onBack={() => router.back()}
      />

      {isLoading ? (
        <ActivityIndicator className="mt-10" color={colors.brand[500]} />
      ) : (
        <Card padded={false} className="mt-2 px-4">
          {CONSENT_TYPES.map((type, idx) => (
            <View key={type}>
              {idx > 0 ? <View className="h-px bg-border" /> : null}
              <View className="flex-row items-center gap-3 py-3.5">
                <View className="flex-1">
                  <Text variant="title">{t(`consent.types.${type}.title`)}</Text>
                  <Text variant="caption" color="muted" className="mt-0.5">
                    {t(`consent.types.${type}.body`)}
                  </Text>
                  {type === "LocationSharing" && locationWarning ? (
                    <Pressable
                      onPress={fixPermission}
                      accessibilityRole="button"
                      className="mt-1.5 flex-row items-center gap-1 active:opacity-70"
                    >
                      <Ionicons name="warning-outline" size={13} color={colors.warning[700]} />
                      <Text variant="caption" className="flex-1 text-warning-700">
                        {locationWarning}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
                <Toggle
                  value={isActive(type)}
                  onValueChange={(active) => onToggle(type, active)}
                  accessibilityLabel={t(`consent.types.${type}.title`)}
                />
              </View>
            </View>
          ))}
        </Card>
      )}

      <Text variant="caption" color="subtle" className="mt-3">
        {t("consent.note")}
      </Text>

      <FamilyPermissions />

      {/* Bottom breathing room so the last card clears the system nav bar. */}
      <View className="h-10" />
    </ScreenContainer>
  );
}
