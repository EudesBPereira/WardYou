import { useState } from "react";
import { View, ActivityIndicator, Pressable, TextInput, Alert } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, ScreenHeader, Card, Text, ListItem, Button, Badge, DayPicker } from "@/components/ui";
import { colors } from "@/theme";
import {
  useMedications,
  useSaveMedications,
  useCheckInStatus,
  useCheckInHistory,
  useAdherence,
  useElders,
  type MedicationDto,
  type MedicationInput,
} from "@/features/elder/queries";

const ALL_DAYS = 0b0111_1111;

interface Form {
  index: number | null; // null = new
  name: string;
  dosage: string;
  times: string[];
  daysOfWeek: number;
  timeDraft: string;
}

const blankForm: Form = { index: null, name: "", dosage: "", times: [], daysOfWeek: ALL_DAYS, timeDraft: "" };

export default function ElderDetailScreen() {
  const { t } = useTranslation();
  const { elderUserId } = useLocalSearchParams<{ elderUserId: string }>();
  const cid = elderUserId as string;
  const dayLabels = t("parental.weekdays").split(",");
  const { data: meds = [], isLoading } = useMedications(elderUserId);
  const { data: checkIn } = useCheckInStatus(elderUserId);
  const { data: history = [] } = useCheckInHistory(elderUserId);
  const { data: adherence = [] } = useAdherence(elderUserId);
  const { data: elders = [] } = useElders();
  const save = useSaveMedications(cid);
  const [form, setForm] = useState<Form | null>(null);

  const elderInfo = elders.find((e) => e.userId === elderUserId);
  const lastSeen = elderInfo?.lastSeenAt
    ? new Date(elderInfo.lastSeenAt).toLocaleString([], { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : null;

  const lastCheckIn = checkIn?.lastCheckInAt
    ? new Date(checkIn.lastCheckInAt).toLocaleString([], { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : null;

  // Today's expected doses vs confirmed ones ("tomei") — quick adherence view.
  const dosesToday = meds
    .filter((m) => m.isActive)
    .flatMap((m) =>
      m.times.map((time) => ({
        key: `${m.id}-${time}`,
        label: `${time} ${m.name}`,
        taken: adherence.some((a) => a.medicationId === m.id && a.time === time),
      })),
    )
    .sort((a, b) => a.label.localeCompare(b.label));

  // One entry per day, newest first (a day may have several check-ins).
  const historyDays = [...new Set(history.map((h) => new Date(h).toLocaleDateString([], { day: "2-digit", month: "2-digit" })))];

  const toInput = (m: MedicationDto): MedicationInput => ({ name: m.name, dosage: m.dosage ?? undefined, times: m.times, daysOfWeek: m.daysOfWeek });

  function openNew() {
    setForm({ ...blankForm });
  }
  function openEdit(m: MedicationDto, index: number) {
    setForm({ index, name: m.name, dosage: m.dosage ?? "", times: [...m.times], daysOfWeek: m.daysOfWeek, timeDraft: "" });
  }
  function addTime() {
    if (!form) return;
    const v = form.timeDraft.trim();
    if (!/^\d{2}:\d{2}$/.test(v)) {
      Alert.alert(t("elder.med.times"), "HH:mm");
      return;
    }
    if (form.times.includes(v)) { setForm({ ...form, timeDraft: "" }); return; }
    setForm({ ...form, times: [...form.times, v].sort(), timeDraft: "" });
  }
  function submit() {
    if (!form || !form.name.trim()) return;
    const entry: MedicationInput = {
      name: form.name.trim(),
      dosage: form.dosage.trim() || undefined,
      times: form.times,
      daysOfWeek: form.daysOfWeek,
    };
    const list = meds.map(toInput);
    if (form.index === null) list.push(entry);
    else list[form.index] = entry;
    save.mutate(list, { onSuccess: () => setForm(null) });
  }
  function remove(index: number) {
    save.mutate(meds.filter((_, i) => i !== index).map(toInput));
  }

  const inputClass = "rounded-2xl bg-surface-alt px-4 py-3 text-ink font-body";

  return (
    <ScreenContainer>
      <ScreenHeader
        title={t("elder.medications")}
        subtitle={t("elder.med.subtitle")}
        onBack={() => router.back()}
        action={
          form ? undefined : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("common.add")}
              onPress={openNew}
              className="h-10 w-10 items-center justify-center rounded-full bg-brand-50 active:opacity-70"
            >
              <Ionicons name="add" size={22} color={colors.brand[500]} />
            </Pressable>
          )
        }
      />

      {/* Daily check-in status */}
      {!form ? (
        <Card
          className={`mt-2 flex-row items-center gap-3 ${checkIn?.checkedInToday ? "border border-safe-500/30" : "border border-warning-500/30"}`}
        >
          <View
            className={`h-11 w-11 items-center justify-center rounded-2xl ${checkIn?.checkedInToday ? "bg-safe-50" : "bg-warning-100"}`}
          >
            <Ionicons
              name={checkIn?.checkedInToday ? "checkmark-circle" : "time-outline"}
              size={22}
              color={checkIn?.checkedInToday ? colors.safe[600] : colors.warning[700]}
            />
          </View>
          <View className="flex-1">
            <Text variant="title">
              {checkIn?.checkedInToday ? t("elder.checkIn.doneToday") : t("elder.checkIn.notYetToday")}
            </Text>
            <Text variant="caption" color="muted">
              {lastCheckIn ? t("elder.checkIn.lastAt", { time: lastCheckIn }) : t("elder.checkIn.never")}
            </Text>
          </View>
        </Card>
      ) : null}

      {/* Device presence: battery + last seen (data was always in the DTO —
          now finally visible to the caregiver). */}
      {!form && elderInfo ? (
        <Card className="mt-2 flex-row items-center gap-3">
          <View className="h-11 w-11 items-center justify-center rounded-2xl bg-brand-50">
            <Ionicons
              name={
                elderInfo.batteryLevel != null && elderInfo.batteryLevel <= 20
                  ? "battery-dead"
                  : "phone-portrait-outline"
              }
              size={22}
              color={
                elderInfo.batteryLevel != null && elderInfo.batteryLevel <= 20
                  ? colors.danger[500]
                  : colors.brand[500]
              }
            />
          </View>
          <View className="flex-1">
            <Text variant="title">
              {elderInfo.batteryLevel != null
                ? t("elder.device.battery", { pct: elderInfo.batteryLevel })
                : t("elder.device.noBattery")}
            </Text>
            <Text variant="caption" color="muted">
              {lastSeen ? t("elder.device.lastSeen", { time: lastSeen }) : t("elder.device.neverSeen")}
            </Text>
          </View>
        </Card>
      ) : null}

      {/* Today's medication adherence */}
      {!form && dosesToday.length > 0 ? (
        <Card className="mt-2 gap-2">
          <Text variant="title">{t("elder.adherence.title")}</Text>
          <View className="flex-row flex-wrap gap-2">
            {dosesToday.map((d) => (
              <View
                key={d.key}
                className={`flex-row items-center gap-1 rounded-full px-3 py-1.5 ${d.taken ? "bg-safe-50" : "bg-surface-alt"}`}
              >
                <Ionicons
                  name={d.taken ? "checkmark-circle" : "ellipse-outline"}
                  size={14}
                  color={d.taken ? colors.safe[600] : colors["ink-subtle"]}
                />
                <Text variant="caption" color={d.taken ? "safe" : "muted"}>
                  {d.label}
                </Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      {/* Check-in history (last 7 days) */}
      {!form && historyDays.length > 0 ? (
        <Card className="mt-2 gap-2">
          <Text variant="title">{t("elder.checkIn.historyTitle")}</Text>
          <View className="flex-row flex-wrap gap-2">
            {historyDays.map((d) => (
              <View key={d} className="flex-row items-center gap-1 rounded-full bg-safe-50 px-3 py-1.5">
                <Ionicons name="checkmark" size={13} color={colors.safe[600]} />
                <Text variant="caption" color="safe">
                  {d}
                </Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      {/* Editor */}
      {form ? (
        <Card className="mt-2 gap-3">
          <Text variant="title">{form.index === null ? t("elder.med.new") : t("elder.med.edit")}</Text>
          <TextInput
            className={inputClass}
            placeholder={t("elder.namePlaceholder")}
            placeholderTextColor={colors["ink-subtle"]}
            value={form.name}
            onChangeText={(v) => setForm({ ...form, name: v })}
          />
          <TextInput
            className={inputClass}
            placeholder={t("elder.med.dosage")}
            placeholderTextColor={colors["ink-subtle"]}
            value={form.dosage}
            onChangeText={(v) => setForm({ ...form, dosage: v })}
          />

          {/* Times */}
          <Text variant="label" color="muted">
            {t("elder.med.times")}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {form.times.map((tm) => (
              <Pressable key={tm} onPress={() => setForm({ ...form, times: form.times.filter((x) => x !== tm) })}>
                <Badge label={`${tm}  ✕`} tone="brand" />
              </Pressable>
            ))}
            {form.times.length === 0 ? (
              <Text variant="caption" color="subtle">
                {t("elder.med.noTimesYet")}
              </Text>
            ) : null}
          </View>
          <View className="flex-row gap-2">
            <TextInput
              className={`${inputClass} flex-1`}
              placeholder="08:00"
              placeholderTextColor={colors["ink-subtle"]}
              value={form.timeDraft}
              onChangeText={(v) => setForm({ ...form, timeDraft: v })}
              keyboardType="numbers-and-punctuation"
            />
            <Button label={t("elder.med.addTime")} size="sm" fullWidth={false} onPress={addTime} />
          </View>

          {/* Days */}
          <Text variant="label" color="muted">
            {t("elder.med.days")}
          </Text>
          <DayPicker value={form.daysOfWeek} labels={dayLabels} onChange={(d) => setForm({ ...form, daysOfWeek: d })} />

          <View className="mt-1 flex-row gap-3">
            <Button label={t("common.cancel")} variant="secondary" onPress={() => setForm(null)} />
            <Button label={t("common.save")} loading={save.isPending} disabled={!form.name.trim()} onPress={submit} />
          </View>
        </Card>
      ) : isLoading ? (
        <ActivityIndicator className="mt-10" color={colors.brand[500]} />
      ) : meds.length === 0 ? (
        <Card className="mt-2 items-center gap-2 py-8">
          <Ionicons name="medkit-outline" size={28} color={colors["ink-subtle"]} />
          <Text variant="body" color="muted">
            {t("elder.noMeds")}
          </Text>
        </Card>
      ) : (
        <Card padded={false} className="mt-2 px-4">
          {meds.map((m, i) => (
            <View key={m.id}>
              {i > 0 ? <View className="h-px bg-border" /> : null}
              <ListItem
                icon="medkit"
                iconTone="brand"
                title={m.dosage ? `${m.name} · ${m.dosage}` : m.name}
                subtitle={m.times.join(" · ") || t("elder.noTimes")}
                onPress={() => openEdit(m, i)}
                trailing={
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("common.delete")}
                    onPress={() => remove(i)}
                    className="h-9 w-9 items-center justify-center rounded-full bg-surface-alt active:opacity-70"
                  >
                    <Ionicons name="trash" size={15} color={colors.danger[500]} />
                  </Pressable>
                }
              />
            </View>
          ))}
        </Card>
      )}
    </ScreenContainer>
  );
}
