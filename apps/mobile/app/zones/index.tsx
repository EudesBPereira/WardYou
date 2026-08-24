import { useState } from "react";
import { View, ActivityIndicator, Pressable, Alert } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, ScreenHeader, Card, Text, ListItem, InputModal } from "@/components/ui";
import { colors } from "@/theme";
import { useMyFamilies } from "@/features/family/queries";
import { useZones, useCreateZone } from "@/features/zones/queries";
import { getCurrentPosition } from "@/services/location/locationService";

const DEFAULT_RADIUS = 200;

export default function ZonesScreen() {
  const { t } = useTranslation();
  const { data: families = [] } = useMyFamilies();
  const familyId = families[0]?.id;
  const { data: zones = [], isLoading } = useZones(familyId);
  const createZone = useCreateZone();
  const [createOpen, setCreateOpen] = useState(false);

  async function handleCreate(name: string) {
    if (!familyId) return;
    try {
      const coords = (await getCurrentPosition()) ?? { latitude: -23.5505, longitude: -46.6333 };
      const created = await createZone.mutateAsync({
        familyId,
        name,
        latitude: coords.latitude,
        longitude: coords.longitude,
        radiusMeters: DEFAULT_RADIUS,
      });
      setCreateOpen(false);
      router.navigate(`/zones/${created.id}` as never);
    } catch {
      Alert.alert(t("zones.title"), t("common.genericError"));
    }
  }

  return (
    <ScreenContainer>
      <ScreenHeader
        title={t("zones.title")}
        subtitle={t("zones.subtitle")}
        onBack={() => router.back()}
        action={
          familyId ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("common.add")}
              onPress={() => setCreateOpen(true)}
              className="h-10 w-10 items-center justify-center rounded-full bg-brand-50 active:opacity-70"
            >
              <Ionicons name="add" size={22} color={colors.brand[500]} />
            </Pressable>
          ) : undefined
        }
      />

      {!familyId ? (
        <Card className="mt-2">
          <Text variant="body" color="muted">
            {t("zones.needFamily")}
          </Text>
        </Card>
      ) : isLoading ? (
        <ActivityIndicator className="mt-10" color={colors.brand[500]} />
      ) : zones.length === 0 ? (
        <Card className="mt-2 items-center gap-2 py-8">
          <Ionicons name="map-outline" size={28} color={colors["ink-subtle"]} />
          <Text variant="body" color="muted">
            {t("zones.empty")}
          </Text>
        </Card>
      ) : (
        <Card padded={false} className="mt-2 px-4">
          {zones.map((z, i) => (
            <View key={z.id}>
              {i > 0 ? <View className="h-px bg-border" /> : null}
              <ListItem
                icon="location"
                iconTone="safe"
                title={z.name}
                subtitle={`${t("zones.radius", { m: z.radiusMeters })}${z.memberUserIds.length > 0 ? ` · ${t("zones.membersCount", { n: z.memberUserIds.length })}` : ""}`}
                showChevron
                onPress={() => router.navigate(`/zones/${z.id}` as never)}
              />
            </View>
          ))}
        </Card>
      )}

      <InputModal
        visible={createOpen}
        title={t("zones.create.title")}
        subtitle={t("zones.create.subtitle")}
        placeholder={t("zones.create.placeholder")}
        confirmLabel={t("zones.add")}
        autoCapitalize="words"
        loading={createZone.isPending}
        onConfirm={handleCreate}
        onClose={() => setCreateOpen(false)}
      />
    </ScreenContainer>
  );
}
