import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { differenceInCalendarDays, endOfDay, isSameDay, startOfDay } from "date-fns";
import { colors } from "@/theme";
import { cn } from "@/lib/cn";
import { Text, Button, DateRangePicker, type DateRange } from "@/components/ui";
import type { CreateTripRequest, TripType } from "@/services/api/types";

const DURATIONS = [1, 3, 6, 12, 24]; // hours — quick-tracking presets only

export interface CreateTripModalProps {
  visible: boolean;
  loading?: boolean;
  /** Preset for the "quick tracking" entry (temporary trip, short duration). */
  quick?: boolean;
  onConfirm: (req: CreateTripRequest) => void;
  onClose: () => void;
}

/** Create-trip sheet. A real trip spans dates, so it uses a calendar range
 *  (start/end days); "quick tracking" is the only mode that keeps the short
 *  hour presets. The backend stores StartsAt/EndsAt and auto-closes. */
export function CreateTripModal({ visible, loading = false, quick = false, onConfirm, onClose }: CreateTripModalProps) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const [type, setType] = useState<TripType>(quick ? "temporary" : "group");
  const [hours, setHours] = useState(quick ? 1 : 3);
  const [range, setRange] = useState<DateRange>({ start: startOfDay(new Date()), end: null });

  useEffect(() => {
    if (visible) {
      setName(quick ? t("trips.quick.defaultName") : "");
      setType(quick ? "temporary" : "group");
      setHours(quick ? 1 : 3);
      setRange({ start: startOfDay(new Date()), end: null });
    }
  }, [visible, quick, t]);

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { day: "2-digit", month: "short" }),
    [i18n.language],
  );

  // Period summary shown under the calendar (trip mode).
  const periodSummary = (() => {
    if (!range.start) return t("trips.createModal.pickStart");
    if (!range.end) return `${dateFmt.format(range.start)} · ${t("trips.createModal.pickEnd")}`;
    const days = differenceInCalendarDays(range.end, range.start) + 1;
    return `${dateFmt.format(range.start)} → ${dateFmt.format(range.end)} · ${t("trips.createModal.days", { n: days })}`;
  })();

  const canConfirm = !!name.trim() && (quick || !!range.start);

  function confirm() {
    if (!canConfirm) return;
    if (quick) {
      const endsAt = new Date(Date.now() + hours * 60 * 60_000).toISOString();
      onConfirm({ name: name.trim(), type, endsAt });
      return;
    }
    // Trip: start at the beginning of the first day (or now, if it starts
    // today) and end at the close of the last day, so the period is inclusive.
    const start = range.start!;
    const now = new Date();
    const startsAt = isSameDay(start, now) ? now : startOfDay(start);
    const endsAt = endOfDay(range.end ?? start);
    onConfirm({ name: name.trim(), type, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() });
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-overlay" onPress={loading ? undefined : onClose}>
        <Pressable
          className="rounded-t-3xl bg-surface px-5 pt-5"
          style={{ paddingBottom: insets.bottom + 24 }}
          onPress={() => {}}
        >
          <View className="mb-4 h-1 w-10 self-center rounded-full bg-border" />
          <ScrollView
            className="max-h-[560px]"
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
          <Text variant="h2">{quick ? t("trips.quick.title") : t("trips.create")}</Text>
          <Text variant="body" color="muted" className="mt-1">
            {quick ? t("trips.quick.subtitle") : t("trips.createModal.subtitle")}
          </Text>

          {/* Name */}
          <Text variant="label" className="mt-5">{t("trips.createModal.name")}</Text>
          <View className="mt-2 h-12 justify-center rounded-lg border border-border bg-surface px-3">
            <TextInput
              className="font-body text-base text-ink"
              placeholderTextColor={colors["ink-subtle"]}
              placeholder={t("trips.createModal.placeholder")}
              value={name}
              onChangeText={setName}
              autoCapitalize="sentences"
              editable={!loading}
            />
          </View>

          {/* Period — hour presets for quick tracking, a date range for trips */}
          {quick ? (
            <>
              <Text variant="label" className="mt-4">{t("trips.createModal.duration")}</Text>
              <View className="mt-2 flex-row flex-wrap gap-2">
                {DURATIONS.map((h) => (
                  <Pressable
                    key={h}
                    onPress={() => setHours(h)}
                    disabled={loading}
                    className={cn(
                      "rounded-full border px-4 py-2",
                      hours === h ? "border-brand-500 bg-brand-50" : "border-border bg-surface",
                    )}
                  >
                    <Text variant="caption" color={hours === h ? "brand" : "muted"}>{`${h}h`}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : (
            <>
              <Text variant="label" className="mt-4">{t("trips.createModal.period")}</Text>
              <View className="mt-2">
                <DateRangePicker
                  value={range}
                  onChange={setRange}
                  locale={i18n.language}
                  disabled={loading}
                />
              </View>
              <Text variant="caption" color="muted" className="mt-2 text-center">
                {periodSummary}
              </Text>
            </>
          )}

          <View className="mt-6 gap-2">
            <Button
              label={quick ? t("trips.quick.start") : t("trips.create")}
              loading={loading}
              disabled={!canConfirm}
              onPress={confirm}
            />
            <Button label={t("common.cancel")} variant="ghost" onPress={onClose} disabled={loading} />
          </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
