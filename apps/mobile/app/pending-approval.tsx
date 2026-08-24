import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Text, Button } from "@/components/ui";
import { colors } from "@/theme";
import { authApi } from "@/services/api/auth";

/**
 * Shown while the account has joined a family but is still waiting for an
 * admin to approve it and assign a role (child/elder/guardian/member). Before
 * this screen existed, a user in this state fell through to the full adult
 * tabs — which is exactly how a child's phone ended up looking identical to
 * the parent's. Realtime `MembershipApproved` flips this away automatically
 * (see useRealtimeSync), no manual refresh needed.
 */
export default function PendingApprovalScreen() {
  const { t } = useTranslation();
  return (
    <ScreenContainer scroll={false} contentClassName="flex-1 items-center justify-center">
      <View className="h-16 w-16 items-center justify-center rounded-full bg-brand-50">
        <Ionicons name="hourglass-outline" size={32} color={colors.brand[500]} />
      </View>
      <Text variant="h1" className="mt-5 text-center">
        {t("pendingApproval.title")}
      </Text>
      <Text variant="body" color="muted" className="mt-2 text-center">
        {t("pendingApproval.body")}
      </Text>
      <Button
        label={t("pendingApproval.logout")}
        variant="secondary"
        icon="log-out"
        className="mt-8"
        onPress={() => authApi.logout()}
      />
    </ScreenContainer>
  );
}
