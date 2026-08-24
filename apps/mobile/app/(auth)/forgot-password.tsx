import { useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, ScreenHeader, Text, Button, Card } from "@/components/ui";
import { AuthField } from "@/features/auth/AuthField";
import { authApi } from "@/services/api/auth";
import { colors } from "@/theme";

export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const canSubmit = /\S+@\S+\.\S+/.test(email.trim());

  async function onSubmit() {
    if (!canSubmit || loading) return;
    setLoading(true);
    try {
      await authApi.forgotPassword(email.trim());
      setSent(true);
    } catch {
      // The endpoint never fails on unknown emails; treat errors as "sent" too
      // so we never leak whether an address exists.
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScreenContainer>
      <ScreenHeader title={t("auth.forgot.title")} onBack={() => router.back()} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {sent ? (
          <Card className="mt-6 items-center gap-3 py-8">
            <View className="h-14 w-14 items-center justify-center rounded-full bg-safe-50">
              <Ionicons name="mail-open-outline" size={28} color={colors.safe[600]} />
            </View>
            <Text variant="title" className="text-center">
              {t("auth.forgot.sentTitle")}
            </Text>
            <Text variant="body" color="muted" className="text-center">
              {t("auth.forgot.sentBody", { email: email.trim() })}
            </Text>
            <Button
              label={t("auth.forgot.backToLogin")}
              variant="secondary"
              className="mt-2"
              onPress={() => router.replace("/(auth)/login")}
            />
          </Card>
        ) : (
          <View className="mt-6 gap-5">
            <Text variant="body" color="muted">
              {t("auth.forgot.subtitle")}
            </Text>
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
              returnKeyType="go"
              onSubmitEditing={onSubmit}
            />
            <Button
              label={t("auth.forgot.action")}
              loading={loading}
              disabled={!canSubmit}
              onPress={onSubmit}
            />
          </View>
        )}
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
