import { useState } from "react";
import { View, ActivityIndicator, Pressable, Alert } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, ScreenHeader, Card, Text, Toggle, ListItem, Avatar, Button, InputModal } from "@/components/ui";
import { colors } from "@/theme";
import { useMyFamilies, useFamilyMembers } from "@/features/family/queries";
import { useZones, useUpdateZone, useDeleteZone, type ZoneDto } from "@/features/zones/queries";

const RADIUS_STEP = 50;
const RADIUS_MIN = 50;
const RADIUS_MAX = 20000;

export default function ZoneEditScreen() {
  const { t } = useTranslation();
  const { zoneId } = useLocalSearchParams<{ zoneId: string }>();
  const { data: families = [] } = useMyFamilies();
  const familyId = families[0]?.id;
  const { data: zones = [], isLoading } = useZones(familyId);
  const { data: allMembers = [] } = useFamilyMembers();
  const update = useUpdateZone();
  const del = useDeleteZone();
  const [nameOpen, setNameOpen] = useState(false);

  const zone = zones.find((z) => z.id === zoneId) as ZoneDto | undefined;
  const members = allMembers.filter((m) => m.familyId === zone?.familyId && m.userId);

  function save(patch: Partial<Pick<ZoneDto, "name" | "radiusMeters" | "notifyOnEntry" | "notifyOnExit" | "memberUserIds">>) {
    if (!zone) return;
    update.mutate({
      zoneId: zone.id,
      familyId: zone.familyId,
      name: patch.name ?? zone.name,
      latitude: zone.latitude,
      longitude: zone.longitude,
      radiusMeters: patch.radiusMeters ?? zone.radiusMeters,
      notifyOnEntry: patch.notifyOnEntry ?? zone.notifyOnEntry,
      notifyOnExit: patch.notifyOnExit ?? zone.notifyOnExit,
      memberUserIds: patch.memberUserIds ?? zone.memberUserIds,
    });
  }

  function toggleMember(userId: string) {
    if (!zone) return;
    const set = new Set(zone.memberUserIds);
    set.has(userId) ? set.delete(userId) : set.add(userId);
    save({ memberUserIds: [...set] });
  }

  function confirmDelete() {
    if (!zone) return;
    Alert.alert(zone.name, t("zones.deleteConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("zones.delete"),
        style: "destructive",
        onPress: () => del.mutate(zone.id, { onSuccess: () => router.back() }),
      },
    ]);
  }

  return (
    <ScreenContainer>
      <ScreenHeader title={zone?.name ?? t("zones.title")} subtitle={t("zones.edit.subtitle")} onBack={() => router.back()} />

      {isLoading || !zone ? (
        <ActivityIndicator className="mt-10" color={colors.brand[500]} />
      ) : (
        <>
          {/* Name */}
          <Card onPress={() => setNameOpen(true)} className="mt-2 flex-row items-center justify-between">
            <View>
              <Text variant="caption" color="muted">
                {t("zones.edit.name")}
              </Text>
              <Text variant="title">{zone.name}</Text>
            </View>
            <Ionicons name="create-outline" size={20} color={colors["ink-subtle"]} />
          </Card>

          {/* Radius */}
          <Card className="mt-4">
            <Text variant="title">{t("zones.edit.radius")}</Text>
            <View className="mt-2 flex-row items-center justify-between">
              <Pressable
                accessibilityRole="button"
                disabled={update.isPending || zone.radiusMeters <= RADIUS_MIN}
                onPress={() => save({ radiusMeters: Math.max(RADIUS_MIN, zone.radiusMeters - RADIUS_STEP) })}
                className="h-11 w-11 items-center justify-center rounded-2xl bg-surface-alt active:opacity-70"
              >
                <Ionicons name="remove" size={22} color={colors.ink} />
              </Pressable>
              <Text variant="h2">{t("zones.radius", { m: zone.radiusMeters })}</Text>
              <Pressable
                accessibilityRole="button"
                disabled={update.isPending || zone.radiusMeters >= RADIUS_MAX}
                onPress={() => save({ radiusMeters: Math.min(RADIUS_MAX, zone.radiusMeters + RADIUS_STEP) })}
                className="h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 active:opacity-70"
              >
                <Ionicons name="add" size={22} color={colors.brand[500]} />
              </Pressable>
            </View>
          </Card>

          {/* Notifications */}
          <Card padded={false} className="mt-4 px-4">
            <View className="flex-row items-center justify-between py-3.5">
              <Text variant="body">{t("zones.edit.notifyEntry")}</Text>
              <Toggle value={zone.notifyOnEntry} onValueChange={(v) => save({ notifyOnEntry: v })} />
            </View>
            <View className="h-px bg-border" />
            <View className="flex-row items-center justify-between py-3.5">
              <Text variant="body">{t("zones.edit.notifyExit")}</Text>
              <Toggle value={zone.notifyOnExit} onValueChange={(v) => save({ notifyOnExit: v })} />
            </View>
          </Card>

          {/* Members */}
          <Text variant="label" color="muted" className="mb-1 mt-6">
            {t("zones.edit.members")}
          </Text>
          <Text variant="caption" color="subtle" className="mb-2">
            {t("zones.edit.membersBody")}
          </Text>
          {members.length === 0 ? (
            <Card>
              <Text variant="body" color="muted">
                {t("zones.edit.noMembers")}
              </Text>
            </Card>
          ) : (
            <Card padded={false} className="px-4">
              {members.map((m, i) => {
                const on = zone.memberUserIds.includes(m.userId as string);
                return (
                  <View key={m.id}>
                    {i > 0 ? <View className="h-px bg-border" /> : null}
                    <ListItem
                      leading={<Avatar name={m.name} uri={m.avatarUrl} />}
                      title={m.name}
                      trailing={<Toggle value={on} onValueChange={() => toggleMember(m.userId as string)} />}
                    />
                  </View>
                );
              })}
            </Card>
          )}

          <Button label={t("zones.delete")} variant="danger" icon="trash" className="mt-6" onPress={confirmDelete} loading={del.isPending} />
        </>
      )}

      <InputModal
        visible={nameOpen}
        title={t("zones.edit.name")}
        confirmLabel={t("common.save")}
        initialValue={zone?.name}
        autoCapitalize="words"
        loading={update.isPending}
        onConfirm={(v) => {
          if (v.trim()) save({ name: v.trim() });
          setNameOpen(false);
        }}
        onClose={() => setNameOpen(false)}
      />
    </ScreenContainer>
  );
}
