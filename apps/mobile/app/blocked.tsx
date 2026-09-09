import { useState } from "react";
import { View, Pressable, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { Text, Button } from "@/components/ui";
import { colors } from "@/theme";
import { useRequestAppAccess, useRequestExtraTime } from "@/features/parental/childQueries";

const EXTRA_TIME_OPTIONS = [15, 30, 60];

/**
 * Full-screen "this app is blocked" explainer, opened by the native
 * AccessibilityService via the `wardyou://blocked?pkg=…&label=…` deep link the
 * moment it kicks a blocked app to Home. Turns a silent kick into a moment the
 * child understands — and can act on: ask the guardian to allow the app, or
 * ask for more screen time (both land as pushes on the guardian's phone).
 */
export default function BlockedScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ pkg?: string; label?: string }>();
  const pkg = typeof params.pkg === "string" ? params.pkg : "";
  const label = typeof params.label === "string" && params.label ? params.label : pkg;

  const requestAccess = useRequestAppAccess();
  const requestExtra = useRequestExtraTime();
  const [accessSent, setAccessSent] = useState(false);
  const [extraSent, setExtraSent] = useState(false);
  const [showExtraOptions, setShowExtraOptions] = useState(false);

  function askAccess() {
    if (!pkg || accessSent) return;
    requestAccess.mutate({ packageName: pkg, label }, { onSuccess: () => setAccessSent(true) });
  }

  function askExtra(minutes: number) {
    requestExtra.mutate(minutes, {
      onSuccess: () => {
        setExtraSent(true);
        setShowExtraOptions(false);
      },
    });
  }

  return (
    <View className="flex-1 items-center justify-center bg-background px-6">
      <View className="h-24 w-24 items-center justify-center rounded-full bg-brand-50">
        <Ionicons name="shield" size={52} color={colors.brand[500]} />
      </View>

      <Text variant="h1" className="mt-6 text-center">
        {t("blocked.title")}
      </Text>
      <Text variant="body" color="muted" className="mt-2 text-center">
        {t("blocked.body", { app: label })}
      </Text>

      <View className="mt-8 w-full gap-3">
        {accessSent ? (
          <View className="flex-row items-center justify-center gap-2 rounded-2xl bg-safe-50 px-4 py-4">
            <Ionicons name="checkmark-circle" size={20} color={colors.safe[500]} />
            <Text variant="title" color="safe">
              {t("blocked.accessSent")}
            </Text>
          </View>
        ) : (
          <Button
            label={t("blocked.askAccess")}
            icon="lock-open-outline"
            fullWidth
            loading={requestAccess.isPending}
            disabled={!pkg || requestAccess.isPending}
            onPress={askAccess}
          />
        )}

        {extraSent ? (
          <View className="flex-row items-center justify-center gap-2 rounded-2xl bg-safe-50 px-4 py-4">
            <Ionicons name="checkmark-circle" size={20} color={colors.safe[500]} />
            <Text variant="title" color="safe">
              {t("blocked.extraSent")}
            </Text>
          </View>
        ) : showExtraOptions ? (
          <View className="flex-row gap-3">
            {EXTRA_TIME_OPTIONS.map((min) => (
              <Pressable
                key={min}
                accessibilityRole="button"
                disabled={requestExtra.isPending}
                onPress={() => askExtra(min)}
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
        ) : (
          <Button
            label={t("blocked.askTime")}
            icon="time-outline"
            variant="secondary"
            fullWidth
            onPress={() => setShowExtraOptions(true)}
          />
        )}
        {requestExtra.isPending ? <ActivityIndicator color={colors.brand[500]} /> : null}

        <Button label={t("blocked.goHome")} variant="ghost" fullWidth onPress={() => router.replace("/")} />
      </View>
    </View>
  );
}
