import { View, Pressable, Alert, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import {
  ScreenContainer,
  ScreenHeader,
  Card,
  Avatar,
  Badge,
  Button,
  Text,
  Toggle,
} from "@/components/ui";
import { colors } from "@/theme";
import { useSession } from "@/stores/session";
import { useMyProfile, useUpdateAvatar } from "@/features/profile/queries";
import { pickAvatarDataUri } from "@/features/profile/pickAvatar";
import { useConsents, useSetConsent } from "@/features/consent/queries";
import { authApi } from "@/services/api/auth";

export default function ProfileScreen() {
  const { t } = useTranslation();
  const session = useSession((s) => s.session);
  const { data: profile } = useMyProfile();
  const updateAvatar = useUpdateAvatar();

  // The same user-level LocationSharing consent that gates the family map — so
  // this switch and the Consents screen can never disagree.
  const { data: consents = [], isLoading: consentsLoading } = useConsents();
  const setConsent = useSetConsent();
  const locationOn = consents.some((c) => c.type === "LocationSharing" && c.isActive);

  const name = profile?.fullName ?? session?.fullName ?? "";
  const email = profile?.email ?? session?.email ?? "";
  const avatarUrl = profile?.avatarUrl ?? session?.avatarUrl ?? null;
  const appProfile = profile?.appProfile ?? "member";
  const families = profile?.families ?? [];

  async function pickAndUpload() {
    try {
      const dataUri = await pickAvatarDataUri();
      if (!dataUri) return; // cancelled or permission denied
      await updateAvatar.mutateAsync(dataUri);
    } catch {
      Alert.alert(t("profile.photoTitle"), t("profile.photoError"));
    }
  }

  function onAvatarPress() {
    if (updateAvatar.isPending) return;
    if (!avatarUrl) {
      pickAndUpload();
      return;
    }
    Alert.alert(t("profile.photoTitle"), undefined, [
      { text: t("profile.changePhoto"), onPress: pickAndUpload },
      {
        text: t("profile.removePhoto"),
        style: "destructive",
        onPress: () =>
          updateAvatar
            .mutateAsync(null)
            .catch(() => Alert.alert(t("profile.photoTitle"), t("profile.photoError"))),
      },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  }

  return (
    <ScreenContainer>
      <ScreenHeader title={t("profile.title")} onBack={() => router.back()} />

      {/* Identity */}
      <View className="items-center gap-3 py-4">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("profile.changePhoto")}
          onPress={onAvatarPress}
          className="relative active:opacity-80"
        >
          <Avatar name={name} uri={avatarUrl} size="lg" />
          <View className="absolute -bottom-0.5 -right-0.5 h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-brand-500">
            {updateAvatar.isPending ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons name="camera" size={14} color="#FFFFFF" />
            )}
          </View>
        </Pressable>
        <View className="items-center gap-1">
          <Text variant="h2">{name}</Text>
          <Text variant="body" color="muted">
            {email}
          </Text>
        </View>
        <Badge label={t(`profile.roles.${appProfile}`)} tone="brand" />
      </View>

      {/* Location sharing — the user's own kill switch. Flipping it notifies the
          other guardians server-side, so the map going quiet is explained. */}
      <Text variant="h2" className="mt-4">
        {t("profile.privacy")}
      </Text>
      <Card className="mt-3 flex-row items-center gap-3">
        <View
          className={`h-10 w-10 items-center justify-center rounded-2xl ${
            locationOn ? "bg-brand-50" : "bg-surface-alt"
          }`}
        >
          <Ionicons
            name={locationOn ? "location" : "location-outline"}
            size={20}
            color={locationOn ? colors.brand[500] : colors["ink-muted"]}
          />
        </View>
        <View className="flex-1">
          <Text variant="title">{t("profile.locationSharing")}</Text>
          <Text variant="caption" color="muted">
            {locationOn ? t("profile.locationSharingOn") : t("profile.locationSharingOff")}
          </Text>
        </View>
        <Toggle
          value={locationOn}
          disabled={consentsLoading}
          onValueChange={(v) => setConsent.mutate({ type: "LocationSharing", active: v })}
        />
      </Card>

      {/* Families */}
      <Text variant="h2" className="mt-6">
        {t("profile.families")}
      </Text>
      <Card className="mt-3 gap-3">
        {families.length === 0 ? (
          <Text variant="body" color="muted">
            {t("profile.noFamilies")}
          </Text>
        ) : (
          families.map((f, i) => (
            <View
              key={f.familyId}
              className={`flex-row items-center gap-3 ${i > 0 ? "border-t border-border pt-3" : ""}`}
            >
              <View className="h-10 w-10 items-center justify-center rounded-2xl bg-brand-50">
                <Ionicons name="people" size={20} color={colors.brand[500]} />
              </View>
              <View className="flex-1">
                <Text variant="title">{f.familyName}</Text>
                <Text variant="caption" color="muted">
                  {/* Achado de QA 2026-09-11: aparecia o valor cru do enum
                      ("child", em ingles, minusculo) direto na tela — o mesmo
                      namespace ja usado pelo badge de appProfile no topo desta
                      tela cobre os 6 papeis de FamilyRole (profile.roles.*). */}
                  {t(`profile.roles.${f.role}`)}
                </Text>
              </View>
              <Badge
                label={t(`profile.memberStatus.${f.membershipStatus}`)}
                tone={f.membershipStatus === "active" ? "safe" : "warning"}
              />
            </View>
          ))
        )}
      </Card>

      <Button
        label={t("profile.logout")}
        variant="secondary"
        icon="log-out-outline"
        className="mt-8"
        onPress={() => authApi.logout()}
      />
    </ScreenContainer>
  );
}
