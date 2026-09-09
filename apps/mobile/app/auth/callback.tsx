import { View, ActivityIndicator } from "react-native";
import { useTranslation } from "react-i18next";
import { Text } from "@/components/ui";
import { colors } from "@/theme";

/**
 * Landing route for the OAuth deep link (`wardyou://auth/callback?code=…`).
 * The auth session (WebBrowser) consumes the code and sets the session, but
 * Expo Router ALSO navigates to the link's path — without this screen that
 * navigation hit the default "Unmatched Route" 404 for a flash right after
 * Google sign-in. Render a quiet spinner; the root AuthGate replaces the
 * stack the moment the session lands.
 */
export default function AuthCallbackScreen() {
  const { t } = useTranslation();
  return (
    <View className="flex-1 items-center justify-center gap-4 bg-background">
      <ActivityIndicator size="large" color={colors.brand[500]} />
      <Text variant="body" color="muted">
        {t("auth.finishingSignIn")}
      </Text>
    </View>
  );
}
