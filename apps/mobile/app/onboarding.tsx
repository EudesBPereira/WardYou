import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Text, Card, Button, Logo, InputModal } from "@/components/ui";
import { colors } from "@/theme";
import { useMyProfile } from "@/features/profile/queries";
import { useJoinFamily } from "@/features/family/queries";
import { useOnboardingStore } from "@/stores/onboarding";
import { authApi } from "@/services/api/auth";

type DependentChoice = "child" | "elder";

/**
 * First-login setup: a brand-new account (no family membership yet) must
 * declare what this device/person is before it can do anything, instead of
 * silently defaulting to the full adult experience. Tutors go straight into
 * the app (they'll create/join a family from the Family tab); a
 * child/elder pastes the invite code they were given and lands on the
 * "awaiting approval" screen until a responsible adult approves them with
 * the matching role.
 */
export default function OnboardingScreen() {
  const { t } = useTranslation();
  const { data: profile } = useMyProfile();
  const join = useJoinFamily();
  const acknowledge = useOnboardingStore((s) => s.acknowledge);
  const [dependentChoice, setDependentChoice] = useState<DependentChoice | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  async function chooseTutor() {
    if (!profile) return;
    await acknowledge(profile.userId, "tutor");
    router.replace("/(tabs)");
  }

  async function chooseTraveler() {
    if (!profile) return;
    await acknowledge(profile.userId, "traveler");
    router.replace("/(tabs)");
  }

  async function handleJoin(code: string) {
    setJoinError(null);
    try {
      // Pass the declared role so the admin doesn't have to guess who this is.
      await join.mutateAsync({ inviteCode: code.trim().toUpperCase(), role: dependentChoice ?? undefined });
      setDependentChoice(null);
      // AuthGate reacts to the new "pending" profile and routes to /pending-approval.
    } catch {
      setJoinError(t("family.join.invalid"));
    }
  }

  return (
    <ScreenContainer>
      <View className="items-center gap-3 pt-10">
        <Logo size={56} />
        <Text variant="h1" className="text-center">
          {t("onboarding.title")}
        </Text>
        <Text variant="body" color="muted" className="text-center">
          {t("onboarding.subtitle")}
        </Text>
      </View>

      <View className="mt-8 gap-3">
        <Card onPress={chooseTutor} className="flex-row items-center gap-3">
          <View className="h-12 w-12 items-center justify-center rounded-2xl bg-brand-50">
            <Ionicons name="shield-checkmark" size={24} color={colors.brand[500]} />
          </View>
          <View className="flex-1">
            <Text variant="title">{t("onboarding.roleTutor")}</Text>
            <Text variant="caption" color="muted">
              {t("onboarding.roleTutorBody")}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors["ink-subtle"]} />
        </Card>

        <Card
          onPress={() => {
            setJoinError(null);
            setDependentChoice("child");
          }}
          className="flex-row items-center gap-3"
        >
          <View className="h-12 w-12 items-center justify-center rounded-2xl bg-safe-50">
            <Ionicons name="happy" size={24} color={colors.safe[600]} />
          </View>
          <View className="flex-1">
            <Text variant="title">{t("onboarding.roleChild")}</Text>
            <Text variant="caption" color="muted">
              {t("onboarding.roleChildBody")}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors["ink-subtle"]} />
        </Card>

        <Card
          onPress={() => {
            setJoinError(null);
            setDependentChoice("elder");
          }}
          className="flex-row items-center gap-3"
        >
          <View className="h-12 w-12 items-center justify-center rounded-2xl bg-danger-50">
            <Ionicons name="heart" size={24} color={colors.danger[500]} />
          </View>
          <View className="flex-1">
            <Text variant="title">{t("onboarding.roleElder")}</Text>
            <Text variant="caption" color="muted">
              {t("onboarding.roleElderBody")}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors["ink-subtle"]} />
        </Card>

        <Card onPress={chooseTraveler} className="flex-row items-center gap-3">
          <View className="h-12 w-12 items-center justify-center rounded-2xl bg-warning-100">
            <Ionicons name="navigate" size={24} color={colors.warning[700]} />
          </View>
          <View className="flex-1">
            <Text variant="title">{t("onboarding.roleTraveler")}</Text>
            <Text variant="caption" color="muted">
              {t("onboarding.roleTravelerBody")}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors["ink-subtle"]} />
        </Card>
      </View>

      <Button label={t("settings.logout")} variant="ghost" className="mt-8" onPress={() => authApi.logout()} />

      <InputModal
        visible={dependentChoice !== null}
        title={t("onboarding.codeTitle")}
        subtitle={dependentChoice === "elder" ? t("onboarding.codeSubtitleElder") : t("onboarding.codeSubtitleChild")}
        placeholder={t("onboarding.codePlaceholder")}
        confirmLabel={t("onboarding.codeAction")}
        autoCapitalize="characters"
        loading={join.isPending}
        error={joinError}
        onConfirm={handleJoin}
        onClose={() => setDependentChoice(null)}
      />
    </ScreenContainer>
  );
}
