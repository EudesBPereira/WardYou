import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ScreenContainer, Text } from "@/components/ui";
import { colors } from "@/theme";
import { useSession } from "@/stores/session";
import { useTranslation } from "react-i18next";
import { pendingTripInvite } from "./pendingTripInvite";

/** Landing for trip invite deep links (wardyou://travel/invite/CODE — see
 *  inviteLink in apps/api/src/routes/trips.ts). Mirrors JoinInviteScreen
 *  (family): stash the code and route the user to where the join actually
 *  completes — authenticated users go to the Trips tab (the code is redeemed
 *  by useConsumePendingTripInvite), unauthenticated users go to login/register
 *  and the code is redeemed right after they sign in. */
export function JoinTripInviteScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ code?: string }>();
  const status = useSession((s) => s.status);
  const code = (params.code ?? "").toString().trim();

  useEffect(() => {
    if (status === "loading") return; // wait for session hydration before routing
    (async () => {
      if (code) await pendingTripInvite.set(code);
      router.replace(status === "authenticated" ? "/(tabs)/trips" : "/(auth)/login");
    })();
  }, [status, code]);

  return (
    <ScreenContainer>
      <View className="flex-1 items-center justify-center gap-4">
        <ActivityIndicator color={colors.brand[500]} />
        <Text variant="body" color="muted">
          {t("trips.join.title")}
        </Text>
      </View>
    </ScreenContainer>
  );
}
