import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { ScreenContainer, Text } from "@/components/ui";
import { colors } from "@/theme";
import { useSession } from "@/stores/session";
import { useTranslation } from "react-i18next";
import { pendingTripInvite } from "./pendingTripInvite";
import { consumeTripInvite } from "./useConsumePendingTripInvite";

/** Landing for trip invite deep links (wardyou://travel/invite/CODE — see
 *  inviteLink in apps/api/src/routes/trips.ts). Mirrors JoinInviteScreen
 *  (family): stash the code and route the user to where the join actually
 *  completes — unauthenticated users go to login/register and the code is
 *  redeemed right after they sign in, via useConsumePendingTripInvite.
 *
 *  Achado de QA 2026-09-11: an authenticated user is different — landing here
 *  with the app already OPEN (warm start, tapped the link while using
 *  WardYou) means `useConsumePendingTripInvite`'s effect (keyed on `status`
 *  going to "authenticated") never fires again, since `status` was already
 *  "authenticated" and doesn't change. Confirmed on-device: the app correctly
 *  navigated to the Trips tab but the code was never actually redeemed.
 *  Redeem it directly here in that case instead of only stashing it. */
export function JoinTripInviteScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ code?: string }>();
  const status = useSession((s) => s.status);
  const code = (params.code ?? "").toString().trim();
  const qc = useQueryClient();

  useEffect(() => {
    if (status === "loading") return; // wait for session hydration before routing
    (async () => {
      if (status === "authenticated") {
        if (code) await pendingTripInvite.set(code);
        await consumeTripInvite(qc);
      } else if (code) {
        await pendingTripInvite.set(code);
      }
      router.replace(status === "authenticated" ? "/(tabs)/trips" : "/(auth)/login");
    })();
  }, [status, code, qc]);

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
