import { View, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, ScreenHeader, Card, Text } from "@/components/ui";
import { colors } from "@/theme";
import { useUsageOverview } from "@/features/parental/queries";

function fmt(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function UsageScreen() {
  const { t } = useTranslation();
  const { childUserId } = useLocalSearchParams<{ childUserId: string }>();
  const { data, isLoading } = useUsageOverview(childUserId, 7);

  const maxDay = data ? Math.max(1, ...data.days.map((d) => d.totalMinutes)) : 1;

  return (
    <ScreenContainer>
      <ScreenHeader title={t("parental.menu.usage")} subtitle={t("parental.usage.subtitle")} onBack={() => router.back()} />

      {isLoading || !data ? (
        <ActivityIndicator className="mt-10" color={colors.brand[500]} />
      ) : (
        <>
          <View className="mt-2 flex-row gap-3">
            <Card className="flex-1 items-center gap-1">
              <Text variant="caption" color="muted">
                {t("parental.usage.today")}
              </Text>
              <Text variant="h2">{fmt(data.todayMinutes)}</Text>
            </Card>
            <Card className="flex-1 items-center gap-1">
              <Text variant="caption" color="muted">
                {t("parental.usage.average")}
              </Text>
              <Text variant="h2">{fmt(data.dailyAverageMinutes)}</Text>
            </Card>
          </View>

          {/* 7-day bars */}
          <Text variant="label" color="muted" className="mb-2 mt-6">
            {t("parental.usage.last7")}
          </Text>
          <Card className="gap-2">
            {data.days.map((d) => (
              <View key={d.date} className="flex-row items-center gap-2">
                <Text variant="caption" color="muted" className="w-12">
                  {d.date.slice(5)}
                </Text>
                <View className="h-3 flex-1 overflow-hidden rounded-full bg-surface-alt">
                  <View
                    className="h-3 rounded-full bg-brand-500"
                    style={{ width: `${Math.round((d.totalMinutes / maxDay) * 100)}%` }}
                  />
                </View>
                <Text variant="caption" color="muted" className="w-12 text-right">
                  {fmt(d.totalMinutes)}
                </Text>
              </View>
            ))}
          </Card>

          {/* Top apps */}
          <Text variant="label" color="muted" className="mb-2 mt-6">
            {t("parental.usage.topApps")}
          </Text>
          {data.topApps.length === 0 ? (
            <Card className="items-center gap-2 py-8">
              <Ionicons name="stats-chart-outline" size={26} color={colors["ink-subtle"]} />
              <Text variant="body" color="muted">
                {t("parental.usage.empty")}
              </Text>
            </Card>
          ) : (
            <Card padded={false} className="px-4">
              {data.topApps.map((a, i) => (
                <View key={a.appPackageName} className="flex-row items-center justify-between py-3">
                  {i > 0 ? null : null}
                  <Text variant="body" numberOfLines={1} className="flex-1 pr-3">
                    {a.appDisplayName}
                  </Text>
                  <Text variant="mono" color="subtle">
                    {fmt(a.totalMinutes)}
                  </Text>
                </View>
              ))}
            </Card>
          )}
        </>
      )}
    </ScreenContainer>
  );
}
