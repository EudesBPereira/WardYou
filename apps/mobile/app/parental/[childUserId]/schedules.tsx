import { useState } from "react";
import { View, ActivityIndicator, Pressable } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, ScreenHeader, Card, Text, Toggle, ListItem, DayPicker, InputModal } from "@/components/ui";
import { colors } from "@/theme";
import {
  useSleepSchedule,
  useSaveSleepSchedule,
  useBlockSchedules,
  useSaveBlockSchedule,
  useDeleteBlockSchedule,
  type SleepDto,
} from "@/features/parental/queries";

const ALL_DAYS = 0b0111_1111;

export default function SchedulesScreen() {
  const { t } = useTranslation();
  const { childUserId } = useLocalSearchParams<{ childUserId: string }>();
  const cid = childUserId as string;
  const dayLabels = t("parental.weekdays").split(",");

  const { data: sleep, isLoading } = useSleepSchedule(childUserId);
  const saveSleep = useSaveSleepSchedule(cid);
  const { data: blocks = [] } = useBlockSchedules(childUserId);
  const saveBlock = useSaveBlockSchedule(cid);
  const deleteBlock = useDeleteBlockSchedule(cid);

  const [timeEdit, setTimeEdit] = useState<"start" | "end" | null>(null);
  const [blockOpen, setBlockOpen] = useState(false);

  function patchSleep(patch: Partial<Omit<SleepDto, "id">>) {
    if (!sleep) return;
    saveSleep.mutate({
      isEnabled: patch.isEnabled ?? sleep.isEnabled,
      startTime: patch.startTime ?? sleep.startTime,
      endTime: patch.endTime ?? sleep.endTime,
      daysOfWeek: patch.daysOfWeek ?? sleep.daysOfWeek,
    });
  }

  function confirmTime(value: string) {
    if (!/^\d{2}:\d{2}$/.test(value)) return;
    patchSleep(timeEdit === "start" ? { startTime: value } : { endTime: value });
    setTimeEdit(null);
  }

  function addBlock(name: string) {
    if (!name.trim()) return;
    saveBlock.mutate({
      name: name.trim(),
      isEnabled: true,
      startTime: "08:00",
      endTime: "12:00",
      daysOfWeek: ALL_DAYS,
      blockAll: true,
      blockGames: false,
      blockSocial: false,
      blockVideo: false,
    });
    setBlockOpen(false);
  }

  return (
    <ScreenContainer>
      <ScreenHeader title={t("parental.menu.schedules")} subtitle={t("parental.schedules.subtitle")} onBack={() => router.back()} />

      {isLoading || !sleep ? (
        <ActivityIndicator className="mt-10" color={colors.brand[500]} />
      ) : (
        <>
          {/* Sleep schedule */}
          <Text variant="label" color="muted" className="mb-1 mt-2">
            {t("parental.schedules.sleep")}
          </Text>
          <Card className="gap-4">
            <View className="flex-row items-center justify-between">
              <View className="flex-1 pr-3">
                <Text variant="title">{t("parental.schedules.sleepEnabled")}</Text>
                <Text variant="caption" color="muted">
                  {t("parental.schedules.sleepBody")}
                </Text>
              </View>
              <Toggle value={sleep.isEnabled} onValueChange={(v) => patchSleep({ isEnabled: v })} />
            </View>
            <View className="flex-row gap-3">
              <Pressable onPress={() => setTimeEdit("start")} className="flex-1 rounded-2xl bg-surface-alt p-3 active:opacity-70">
                <Text variant="caption" color="muted">
                  {t("parental.schedules.from")}
                </Text>
                <Text variant="h2">{sleep.startTime}</Text>
              </Pressable>
              <Pressable onPress={() => setTimeEdit("end")} className="flex-1 rounded-2xl bg-surface-alt p-3 active:opacity-70">
                <Text variant="caption" color="muted">
                  {t("parental.schedules.to")}
                </Text>
                <Text variant="h2">{sleep.endTime}</Text>
              </Pressable>
            </View>
            <DayPicker value={sleep.daysOfWeek} labels={dayLabels} disabled={saveSleep.isPending} onChange={(d) => patchSleep({ daysOfWeek: d })} />
          </Card>

          {/* Block schedules */}
          <View className="mt-6 flex-row items-center justify-between">
            <Text variant="h2">{t("parental.schedules.blocks")}</Text>
            <Pressable onPress={() => setBlockOpen(true)} hitSlop={8}>
              <Text variant="label" color="brand">
                {t("parental.schedules.addBlock")}
              </Text>
            </Pressable>
          </View>

          {blocks.length === 0 ? (
            <Card className="mt-3">
              <Text variant="body" color="muted">
                {t("parental.schedules.blocksEmpty")}
              </Text>
            </Card>
          ) : (
            <Card padded={false} className="mt-3 px-4">
              {blocks.map((b, i) => (
                <View key={b.id}>
                  {i > 0 ? <View className="h-px bg-border" /> : null}
                  <ListItem
                    icon="lock-closed"
                    iconTone="warning"
                    title={b.name}
                    subtitle={`${b.startTime}–${b.endTime}`}
                    trailing={
                      <View className="flex-row items-center gap-2">
                        <Toggle
                          value={b.isEnabled}
                          onValueChange={(v) => saveBlock.mutate({ ...b, isEnabled: v })}
                        />
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t("common.delete")}
                          onPress={() => deleteBlock.mutate(b.id)}
                          className="h-9 w-9 items-center justify-center rounded-full bg-surface-alt active:opacity-70"
                        >
                          <Ionicons name="trash" size={15} color={colors.danger[500]} />
                        </Pressable>
                      </View>
                    }
                  />
                </View>
              ))}
            </Card>
          )}
        </>
      )}

      <InputModal
        visible={timeEdit !== null}
        title={t("parental.schedules.editTime")}
        subtitle="HH:mm"
        placeholder="22:00"
        initialValue={timeEdit === "start" ? sleep?.startTime : sleep?.endTime}
        confirmLabel={t("common.save")}
        autoCapitalize="none"
        onConfirm={confirmTime}
        onClose={() => setTimeEdit(null)}
      />
      <InputModal
        visible={blockOpen}
        title={t("parental.schedules.addBlock")}
        subtitle={t("parental.schedules.addBlockBody")}
        placeholder={t("parental.schedules.blockName")}
        confirmLabel={t("parental.schedules.addBlock")}
        autoCapitalize="sentences"
        loading={saveBlock.isPending}
        onConfirm={addBlock}
        onClose={() => setBlockOpen(false)}
      />
    </ScreenContainer>
  );
}
