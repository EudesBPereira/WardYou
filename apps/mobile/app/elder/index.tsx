import { View, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, ScreenHeader, Card, Text, ListItem, Avatar } from "@/components/ui";
import { colors } from "@/theme";
import { useElders } from "@/features/elder/queries";

export default function EldersScreen() {
  const { t } = useTranslation();
  const { data: elders = [], isLoading } = useElders();

  return (
    <ScreenContainer>
      <ScreenHeader title={t("elder.title")} subtitle={t("elder.subtitle")} onBack={() => router.back()} />

      {isLoading ? (
        <ActivityIndicator className="mt-10" color={colors.brand[500]} />
      ) : elders.length === 0 ? (
        <Card className="mt-2 items-center gap-2 py-8">
          <Ionicons name="people-outline" size={28} color={colors["ink-subtle"]} />
          <Text variant="body" color="muted">
            {t("elder.empty")}
          </Text>
        </Card>
      ) : (
        <Card padded={false} className="mt-2 px-4">
          {elders.map((e, i) => (
            <View key={e.memberId}>
              {i > 0 ? <View className="h-px bg-border" /> : null}
              <ListItem
                leading={<Avatar name={e.fullName} uri={e.avatarUrl} />}
                title={e.fullName}
                subtitle={e.email ?? t(`roles.${e.role}`)}
                showChevron
                onPress={() => router.navigate(`/elder/${e.userId}` as never)}
              />
            </View>
          ))}
        </Card>
      )}
    </ScreenContainer>
  );
}
