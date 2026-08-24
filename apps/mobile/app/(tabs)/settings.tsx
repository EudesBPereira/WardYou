import { useEffect, useState } from "react";
import { View, Alert, Platform } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import {
  ScreenContainer,
  ScreenHeader,
  Card,
  Text,
  ListItem,
  Button,
  Badge,
  Avatar,
  Select,
  Toggle,
} from "@/components/ui";
import { colors } from "@/theme";
import { mockUser } from "@/lib/mockData";
import { setLanguage, SUPPORTED_LANGUAGES, type AppLanguage } from "@/i18n";
import { useSession } from "@/stores/session";
import { useAppLock } from "@/stores/appLock";
import { getBiometricSupport, authenticateBiometric } from "@/services/auth/biometrics";
import { authApi } from "@/services/api/auth";
import { useMyProfile } from "@/features/profile/queries";
import { ProfileButton } from "@/components/ProfileButton";

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const current = i18n.language as AppLanguage;
  const session = useSession((s) => s.session);
  const profileName = session?.fullName ?? mockUser.name;
  const profileEmail = session?.email ?? mockUser.email;
  const { data: profile } = useMyProfile();
  const appProfile = profile?.appProfile ?? "member";

  // Children see only language + logout; elders keep their own sharing
  // controls; management entries (parental, elder care, zones) are for adults.
  const isChild = appProfile === "child";
  const isElder = appProfile === "elder";
  const showManagement = appProfile === "guardian";
  const showSharing = !isChild;

  // Biometric app lock (WhatsApp-style): only offered when the device actually
  // has an enrolled fingerprint/face. Turning it on requires a live biometric.
  const lockEnabled = useAppLock((s) => s.enabled);
  const setLockEnabled = useAppLock((s) => s.setEnabled);
  const [bio, setBio] = useState<{ available: boolean; kind: string }>({ available: false, kind: "biometric" });
  useEffect(() => {
    getBiometricSupport().then(setBio);
  }, []);

  async function toggleAppLock(next: boolean) {
    // Confirm the owner is present before either enabling OR disabling.
    const ok = await authenticateBiometric(t("appLock.confirm"));
    if (!ok) return;
    await setLockEnabled(next);
  }

  return (
    <ScreenContainer>
      <ScreenHeader
        title={t("settings.title")}
        subtitle={t("settings.subtitle")}
        action={<ProfileButton />}
      />

      {/* Profile */}
      <Card onPress={() => router.navigate("/profile" as never)} className="mt-2 flex-row items-center gap-3">
        <Avatar
          name={profileName}
          uri={profile?.avatarUrl ?? session?.avatarUrl ?? null}
          size="lg"
          status="online"
        />
        <View className="flex-1">
          <Text variant="title">{profileName}</Text>
          <Text variant="caption" color="muted">
            {profileEmail}
          </Text>
          <Text variant="caption" color="brand" className="mt-0.5">
            {t("settings.profileAction")}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors["ink-subtle"]} />
      </Card>

      {/* Premium (adults only) */}
      {!isChild ? (
        <Card
          tone="brand"
          onPress={() => Alert.alert(t("common.comingSoon"), t("common.comingSoonBody"))}
          className="mt-4 flex-row items-center gap-3"
        >
          <View className="h-11 w-11 items-center justify-center rounded-2xl bg-white/15">
            <Ionicons name="star" size={22} color="#FFFFFF" />
          </View>
          <View className="flex-1">
            <Text variant="title" color="inverse">
              {t("settings.premium")}
            </Text>
            <Text variant="caption" color="inverse" className="opacity-90">
              {t("settings.seePlans")}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#FFFFFF" />
        </Card>
      ) : null}

      {/* Protection & sharing — filtered by profile */}
      {showSharing ? (
        <Card padded={false} className="mt-4 px-4">
          {showManagement ? (
            <>
              <ListItem title={t("settings.safetyZones")} icon="map" iconTone="safe" onPress={() => router.navigate("/zones" as never)} />
              <View className="h-px bg-border" />
              <ListItem title={t("settings.usageRestrictions")} icon="time" iconTone="warning" onPress={() => router.navigate("/parental" as never)} />
              <View className="h-px bg-border" />
              <ListItem title={t("settings.elderCare")} icon="heart" iconTone="danger" onPress={() => router.navigate("/elder" as never)} />
              <View className="h-px bg-border" />
            </>
          ) : null}
          <ListItem title={t("settings.locationSharing")} icon="location" iconTone="brand" onPress={() => router.navigate("/consents" as never)} />
          {!isElder ? (
            <>
              <View className="h-px bg-border" />
              <ListItem title={t("settings.notifications")} icon="notifications" iconTone="brand" onPress={() => router.navigate("/notifications" as never)} />
              <View className="h-px bg-border" />
              <ListItem title={t("settings.privacy")} icon="lock-closed" iconTone="neutral" onPress={() => router.navigate("/privacy" as never)} />
            </>
          ) : null}
        </Card>
      ) : null}

      {/* Biometric app lock (WhatsApp-style). Only shown when the device has an
          enrolled biometric. */}
      {Platform.OS !== "web" && bio.available ? (
        <>
          <Text variant="label" color="muted" className="mb-2 mt-6">
            {t("appLock.section")}
          </Text>
          <Card padded={false} className="px-4">
            <ListItem
              title={t("appLock.settingTitle")}
              subtitle={t("appLock.settingBody")}
              icon="finger-print"
              iconTone="brand"
              trailing={<Toggle value={lockEnabled} onValueChange={toggleAppLock} />}
            />
          </Card>
        </>
      ) : null}

      {/* Language — defaults to the device language detected on install;
          the dropdown lets the user override it. */}
      <View className="mt-6">
        <Select
          label={t("settings.language")}
          sheetTitle={t("settings.language")}
          value={current}
          options={SUPPORTED_LANGUAGES.map((lang) => ({ value: lang, label: t(`language.${lang}`) }))}
          onChange={(lang) => setLanguage(lang)}
        />
      </View>

      {/* Logout */}
      <Button
        label={t("settings.logout")}
        variant="secondary"
        icon="log-out"
        className="mt-6"
        onPress={() => authApi.logout()}
      />

      {/* Dev-only shortcut to the component gallery (hidden in release builds) */}
      {__DEV__ ? (
        <View className="mt-3 items-center">
          <Badge label="Kitchen sink → /kitchen-sink" tone="neutral" />
        </View>
      ) : null}
    </ScreenContainer>
  );
}
