import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { ScreenContainer, Text } from "@/components/ui";
import { colors } from "@/theme";
import { useSession } from "@/stores/session";
import { useTranslation } from "react-i18next";
import { pendingInvite } from "./pendingInvite";
import { consumeFamilyInvite } from "./useConsumePendingInvite";

/** Landing for family invite deep links. The backend generates
 *  https://app.wardyou.com/join?familyInvite=CODE; the native scheme form is
 *  wardyou://join/CODE. Either way we stash the code and route the user to
 *  where the join actually completes: unauthenticated users go to
 *  login/register and the code is redeemed right after they sign in, via
 *  useConsumePendingInvite.
 *
 *  Achado de QA 2026-09-11 (found building the equivalent trip-invite flow,
 *  same shape here): an authenticated user landing here with the app already
 *  OPEN (warm start) never had the code redeemed — `useConsumePendingInvite`'s
 *  effect is keyed on `status` transitioning to "authenticated", which
 *  doesn't happen again for an already-logged-in session. Redeem it directly
 *  here in that case instead of only stashing it for later. */
export function JoinInviteScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ code?: string; familyInvite?: string }>();
  const status = useSession((s) => s.status);
  const code = (params.code ?? params.familyInvite ?? "").toString().trim();
  const qc = useQueryClient();

  useEffect(() => {
    if (status === "loading") return; // wait for session hydration before routing
    (async () => {
      if (status === "authenticated") {
        if (code) await pendingInvite.set(code);
        await consumeFamilyInvite(qc);
      } else if (code) {
        await pendingInvite.set(code);
      }
      router.replace(status === "authenticated" ? "/(tabs)/family" : "/(auth)/login");
    })();
  }, [status, code, qc]);

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
