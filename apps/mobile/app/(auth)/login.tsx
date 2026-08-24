import { useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { Link, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { ScreenContainer, Logo, Text, Button } from "@/components/ui";
import { AuthField } from "@/features/auth/AuthField";
import { GoogleSignInButton } from "@/features/auth/GoogleSignInButton";
import { authApi } from "@/services/api/auth";
import { ApiError } from "@/services/api/client";

export default function LoginScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canSubmit = email.trim().length > 0 && password.length > 0;

  async function onSubmit() {
    if (!canSubmit || loading) return;
    setError(null);
    setLoading(true);
    try {
      await authApi.login({ email: email.trim(), password });
      router.replace("/(tabs)");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("auth.errors.generic"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScreenContainer>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View className="items-center gap-3 pt-10">
          <Logo size={72} />
          <Text variant="h1">{t("auth.login.title")}</Text>
          <Text variant="body" color="muted" className="text-center">
            {t("auth.login.subtitle")}
          </Text>
        </View>

        <View className="mt-8 gap-4">
          <GoogleSignInButton onError={(m) => setError(m || null)} />

          <AuthField
            label={t("auth.fields.email")}
            icon="mail-outline"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            placeholder={t("auth.placeholders.email")}
            returnKeyType="next"
          />
          <AuthField
            label={t("auth.fields.password")}
            icon="lock-closed-outline"
            secure
            value={password}
            onChangeText={setPassword}
            autoCapitalize="none"
            textContentType="password"
            placeholder={t("auth.placeholders.password")}
            returnKeyType="go"
            onSubmitEditing={onSubmit}
            error={error}
          />

          <Button
            label={t("auth.login.action")}
            loading={loading}
            disabled={!canSubmit}
            onPress={onSubmit}
            className="mt-2"
          />

          <Text
            variant="label"
            color="brand"
            className="mt-1 text-center"
            onPress={() => router.push("/(auth)/forgot-password" as never)}
          >
            {t("auth.login.forgotPassword")}
          </Text>
        </View>

        <View className="mt-8 flex-row items-center justify-center gap-1">
          <Text variant="body" color="muted">
            {t("auth.login.noAccount")}
          </Text>
          <Link href="/(auth)/register" replace>
            <Text variant="body-strong" color="brand">
              {t("auth.login.signUp")}
            </Text>
          </Link>
        </View>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
