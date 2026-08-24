import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Button, Text } from "@/components/ui";
import { GoogleGIcon } from "./GoogleGIcon";
import { authApi } from "@/services/api/auth";
import { ApiError } from "@/services/api/client";

interface Props {
  /** Surface a non-cancel error to the parent screen. */
  onError?: (message: string) => void;
}

/** "Continue with Google" — server-side OAuth flow; first sign-in auto-creates
 *  the account. Shared by the login and register screens. */
export function GoogleSignInButton({ onError }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onPress() {
    if (loading) return;
    onError?.("");
    setLoading(true);
    try {
      await authApi.googleSignIn();
      router.replace("/(tabs)");
    } catch (e) {
      // User dismissing the browser isn't an error worth showing.
      if (e instanceof ApiError && e.message === "cancelled") return;
      onError?.(e instanceof ApiError ? e.message : t("auth.errors.generic"));
    } finally {
      setLoading(false);
    }
  }

  // Rendered above the manual form: Google button first, then an "ou" divider
  // separating it from the email/password fields below.
  return (
    <View className="gap-4">
      <Button
        label={t("auth.google")}
        variant="secondary"
        leading={<GoogleGIcon size={18} />}
        loading={loading}
        onPress={onPress}
      />
      <View className="flex-row items-center gap-3">
        <View className="h-px flex-1 bg-border" />
        <Text variant="caption" color="muted">
          {t("auth.or")}
        </Text>
        <View className="h-px flex-1 bg-border" />
      </View>
    </View>
  );
}
