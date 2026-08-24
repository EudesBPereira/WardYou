import { useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { Link, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { ScreenContainer, Logo, Text, Button } from "@/components/ui";
import { AuthField } from "@/features/auth/AuthField";
import { GoogleSignInButton } from "@/features/auth/GoogleSignInButton";
import { authApi } from "@/services/api/auth";
import { ApiError } from "@/services/api/client";

export default function RegisterScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canSubmit =
    fullName.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length >= 6 &&
    confirmPassword.length > 0;

  async function onSubmit() {
    if (!canSubmit || loading) return;
    setError(null);
    if (password !== confirmPassword) {
      setError(t("auth.errors.passwordMismatch"));
      return;
    }
    setLoading(true);
    try {
      await authApi.register({
        fullName: fullName.trim(),
        email: email.trim(),
        password,
        confirmPassword,
      });
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
        <View className="items-center gap-3 pt-8">
          <Logo size={64} />
          <Text variant="h1">{t("auth.register.title")}</Text>
          <Text variant="body" color="muted" className="text-center">
            {t("auth.register.subtitle")}
          </Text>
        </View>

        <View className="mt-7 gap-4">
          <GoogleSignInButton onError={(m) => setError(m || null)} />

          <AuthField
            label={t("auth.fields.fullName")}
            icon="person-outline"
            value={fullName}
            onChangeText={setFullName}
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
            placeholder={t("auth.placeholders.fullName")}
          />
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
          />
          <AuthField
            label={t("auth.fields.password")}
            icon="lock-closed-outline"
            secure
            value={password}
            onChangeText={setPassword}
            autoCapitalize="none"
            textContentType="newPassword"
            placeholder={t("auth.placeholders.passwordNew")}
          />
          <AuthField
            label={t("auth.fields.confirmPassword")}
            icon="lock-closed-outline"
            secure
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            autoCapitalize="none"
            textContentType="newPassword"
            placeholder={t("auth.placeholders.confirmPassword")}
            returnKeyType="go"
            onSubmitEditing={onSubmit}
            error={error}
          />

          <Button
            label={t("auth.register.action")}
            loading={loading}
            disabled={!canSubmit}
            onPress={onSubmit}
            className="mt-2"
          />
        </View>

        <View className="mt-8 flex-row items-center justify-center gap-1">
          <Text variant="body" color="muted">
            {t("auth.register.hasAccount")}
          </Text>
          <Link href="/(auth)/login" replace>
            <Text variant="body-strong" color="brand">
              {t("auth.register.signIn")}
            </Text>
          </Link>
        </View>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
