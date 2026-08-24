import { useMemo, useState } from "react";
import { View, Pressable } from "react-native";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/theme";
import { cn } from "@/lib/cn";
import { Text } from "./Text";

export interface DateRange {
  start: Date | null;
  end: Date | null;
}

export interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  /** BCP-47 tag for localized month/weekday labels (e.g. "pt", "en"). */
  locale?: string;
  /** Earliest selectable day (defaults to today — no trips in the past). */
  minDate?: Date;
  disabled?: boolean;
}

// Week starts on Monday to match the app's DayPicker convention.
const WEEK_OPTS = { weekStartsOn: 1 as const };

/** Month-grid range calendar built on primitives (no native module) so it runs
 *  identically on web and Android. Tap a day to set the start; tap a later day
 *  to set the end; tapping again (or an earlier day) restarts the range. */
export function DateRangePicker({ value, onChange, locale, minDate, disabled }: DateRangePickerProps) {
  const min = startOfDay(minDate ?? new Date());
  const [cursor, setCursor] = useState<Date>(startOfMonth(value.start ?? new Date()));

  const weeks = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(cursor), WEEK_OPTS);
    const gridEnd = endOfWeek(endOfMonth(cursor), WEEK_OPTS);
    const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
    const rows: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));
    return rows;
  }, [cursor]);

  const monthLabel = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(cursor);
  const weekdays = useMemo(() => {
    const base = startOfWeek(new Date(), WEEK_OPTS);
    const fmt = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
    return Array.from({ length: 7 }, (_, i) => fmt.format(addDays(base, i)));
  }, [locale]);

  function pick(day: Date) {
    if (disabled) return;
    const d = startOfDay(day);
    const { start, end } = value;
    if (!start || end || isBefore(d, start)) {
      onChange({ start: d, end: null });
    } else {
      onChange({ start, end: d });
    }
  }

  return (
    <View className="rounded-xl border border-border bg-surface p-3">
      {/* Month navigation */}
      <View className="flex-row items-center justify-between px-1 pb-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          hitSlop={8}
          disabled={disabled}
          onPress={() => setCursor(addMonths(cursor, -1))}
          className="h-8 w-8 items-center justify-center rounded-full active:bg-surface-alt"
        >
          <Ionicons name="chevron-back" size={18} color={colors.ink} />
        </Pressable>
        <Text variant="body-strong" className="capitalize">
          {monthLabel}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          hitSlop={8}
          disabled={disabled}
          onPress={() => setCursor(addMonths(cursor, 1))}
          className="h-8 w-8 items-center justify-center rounded-full active:bg-surface-alt"
        >
          <Ionicons name="chevron-forward" size={18} color={colors.ink} />
        </Pressable>
      </View>

      {/* Weekday headers */}
      <View className="flex-row">
        {weekdays.map((w, i) => (
          <View key={i} className="flex-1 items-center py-1">
            <Text variant="caption" color="subtle" className="uppercase">
              {w}
            </Text>
          </View>
        ))}
      </View>

      {/* Day grid */}
      {weeks.map((week, wi) => (
        <View key={wi} className="flex-row">
          {week.map((day) => {
            const inMonth = isSameMonth(day, cursor);
            const isPast = isBefore(day, min);
            const dayDisabled = disabled || !inMonth || isPast;
            const isStart = !!value.start && isSameDay(day, value.start);
            const isEnd = !!value.end && isSameDay(day, value.end);
            const inRange =
              !!value.start && !!value.end && isAfter(day, value.start) && isBefore(day, value.end);
            const selected = isStart || isEnd;
            return (
              <View key={day.toISOString()} className="flex-1 items-center py-0.5">
                <Pressable
                  accessibilityRole="button"
                  disabled={dayDisabled}
                  onPress={() => pick(day)}
                  className={cn(
                    "h-9 w-9 items-center justify-center rounded-full",
                    selected ? "bg-brand-500" : inRange ? "bg-brand-50" : "",
                  )}
                >
                  <Text
                    variant="caption"
                    className={cn(
                      selected
                        ? "text-white font-body-semibold"
                        : inRange
                          ? "text-brand-600"
                          : dayDisabled
                            ? "text-ink-subtle opacity-40"
                            : "text-ink",
                    )}
                  >
                    {day.getDate()}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}
