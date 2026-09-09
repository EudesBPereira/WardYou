import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ScreenContainer, Text } from "@/components/ui";
import { colors } from "@/theme";
import { useSession } from "@/stores/session";
import { useTranslation } from "react-i18next";
import { pendingInvite } from "./pendingInvite";

/** Landing for family invite deep links. The backend generates
 *  https://app.wardyou.com/join?familyInvite=CODE; the native scheme form is
 *  wardyou://join/CODE. Either way we stash the code and route the user to where
 *  the join actually completes: authenticated users go to the Family tab (the
 *  code is redeemed by useConsumePendingInvite), unauthenticated users go to
 *  login/register and the code is redeemed right after they sign in. */
export function JoinInviteScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ code?: string; familyInvite?: string }>();
  const status = useSession((s) => s.status);
  const code = (params.code ?? params.familyInvite ?? "").toString().trim();

  useEffect(() => {
    if (status === "loading") return; // wait for session hydration before routing
    (async () => {
      if (code) await pendingInvite.set(code);
      router.replace(status === "authenticated" ? "/(tabs)/family" : "/(auth)/login");
    })();
  }, [status, code]);

  return (
    <ScreenContainer>
      <View className="flex-1 items-center justify-center gap-4">
        <ActivityIndicator color={colors.brand[500]} />
        <Text variant="body" color="muted">
          {t("family.join.title")}
        </Text>
      </View>
    </ScreenContainer>
  );
}
