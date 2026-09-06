import { View, ActivityIndicator, Alert, Share, Platform } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, ScreenHeader, Card, Text, Button, ListItem } from "@/components/ui";
import { colors } from "@/theme";
import {
  usePrivacySummary,
  useMyActions,
  useExportData,
  useRevokeAllConsents,
  useRequestDeletion,
} from "@/features/privacy/queries";

export default function PrivacyScreen() {
  const { t } = useTranslation();
  const { data: summary, isLoading } = usePrivacySummary();
  const { data: actions } = useMyActions();
  const exportData = useExportData();
  const revokeAll = useRevokeAllConsents();
  const requestDeletion = useRequestDeletion();

  async function handleExport() {
    try {
      const data = await exportData.mutateAsync();
      const json = JSON.stringify(data, null, 2);
      if (Platform.OS === "web") {
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `wardyou-data-export-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        URL.revokeObjectURL(url);
        Alert.alert(t("privacy.export"), t("privacy.exportReady"));
      } else {
        await Share.share({ message: json });
      }
    } catch {
      Alert.alert(t("privacy.title"), t("common.genericError"));
    }
  }

  function handleRevokeAll() {
    Alert.alert(t("privacy.revokeAll"), t("privacy.revokeConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("privacy.revokeAll"),
        style: "destructive",
        onPress: async () => {
          const r = await revokeAll.mutateAsync();
          Alert.alert(t("privacy.revokeAll"), t("privacy.revokeDone", { n: r.revokedUserConsents + r.revokedFamilyConsents }));
        },
      },
    ]);
  }

  function handleDeletion() {
    Alert.alert(t("privacy.delete"), t("privacy.deleteConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("privacy.delete"),
        style: "destructive",
        onPress: async () => {
          await requestDeletion.mutateAsync();
          Alert.alert(t("privacy.delete"), t("privacy.deleteDone"));
        },
      },
    ]);
  }

  const counts: { key: "devices" | "locationEvents" | "userConsents" | "sosEvents"; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: "devices", icon: "phone-portrait" },
    { key: "locationEvents", icon: "location" },
    { key: "userConsents", icon: "shield-checkmark" },
    { key: "sosEvents", icon: "warning" },
  ];

  return (
    <ScreenContainer>
      <ScreenHeader title={t("privacy.title")} subtitle={t("privacy.subtitle")} onBack={() => router.back()} />

      {isLoading || !summary ? (
        <ActivityIndicator className="mt-10" color={colors.brand[500]} />
      ) : (
        <>
          {/* Data summary */}
          <Text variant="label" color="muted" className="mb-2 mt-2">
            {t("privacy.dataSummary")}
          </Text>
          <View className="flex-row flex-wrap justify-between gap-y-3">
            {counts.map((c) => (
              <Card key={c.key} className="w-[48%] flex-row items-center gap-3">
                <View className="h-10 w-10 items-center justify-center rounded-2xl bg-brand-50">
                  <Ionicons name={c.icon} size={20} color={colors.brand[500]} />
                </View>
                <View>
                  <Text variant="h2">{summary[c.key]}</Text>
                  <Text variant="caption" color="muted">
                    {t(`privacy.count.${c.key}`)}
                  </Text>
                </View>
              </Card>
            ))}
          </View>

          {/* Actions */}
          <Card padded={false} className="mt-6 px-4">
            <ListItem title={t("privacy.export")} subtitle={t("privacy.exportBody")} icon="download" iconTone="brand" onPress={handleExport} />
            <View className="h-px bg-border" />
            <ListItem title={t("privacy.revokeAll")} subtitle={t("privacy.revokeBody")} icon="hand-left" iconTone="warning" onPress={handleRevokeAll} />
          </Card>

          {/* Recent activity */}
          <Text variant="label" color="muted" className="mb-2 mt-6">
            {t("privacy.recentActivity")}
          </Text>
          {!actions || actions.items.length === 0 ? (
            <Card>
              <Text variant="body" color="muted">
                {t("privacy.noActivity")}
              </Text>
            </Card>
          ) : (
            <Card padded={false} className="px-4">
              {actions.items.slice(0, 15).map((a, i) => (
                <View key={a.id}>
                  {i > 0 ? <View className="h-px bg-border" /> : null}
                  <View className="py-3">
                    <Text variant="body">{t(`audit.action.${a.action}`, { defaultValue: a.action })}</Text>
                    <Text variant="caption" color="subtle">
                      {new Date(a.createdAt).toLocaleString()}
                    </Text>
                  </View>
                </View>
              ))}
            </Card>
          )}

          <Button label={t("privacy.delete")} variant="danger" icon="trash" className="mt-6" loading={requestDeletion.isPending} onPress={handleDeletion} />
          <Text variant="caption" color="subtle" className="mb-4 mt-2">
            {t("privacy.deleteNote")}
          </Text>
        </>
      )}
    </ScreenContainer>
  );
}
