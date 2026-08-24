import { useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "./Text";
import { Button } from "./Button";
import { colors } from "@/theme";

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
}

export interface SelectProps<T extends string = string> {
  /** Small label rendered above the field. */
  label?: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  /** Title of the options sheet; falls back to `label`. */
  sheetTitle?: string;
  className?: string;
}

/** Dropdown field: shows the current option and opens a bottom sheet with the
 *  choices — the cross-platform stand-in for a native picker. */
export function Select<T extends string = string>({
  label,
  value,
  options,
  onChange,
  sheetTitle,
  className = "",
}: SelectProps<T>) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);

  return (
    <View className={className}>
      {label ? (
        <Text variant="label" color="muted" className="mb-2">
          {label}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label ?? sheetTitle}
        onPress={() => setOpen(true)}
        className="flex-row items-center justify-between rounded-2xl bg-surface px-4 py-3.5 active:opacity-70"
      >
        <Text variant="title">{current?.label ?? value}</Text>
        <Ionicons name="chevron-down" size={18} color={colors["ink-subtle"]} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 justify-end bg-overlay" onPress={() => setOpen(false)}>
          <Pressable
            className="rounded-t-3xl bg-surface px-5 pt-5"
            style={{ paddingBottom: insets.bottom + 24 }}
            onPress={() => {}}
          >
            <View className="mb-4 h-1 w-10 self-center rounded-full bg-border" />
            <Text variant="h2">{sheetTitle ?? label}</Text>

            <View className="mt-4 gap-2">
              {options.map((option) => {
                const selected = option.value === value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    onPress={() => {
                      setOpen(false);
                      if (!selected) onChange(option.value);
                    }}
                    className={`flex-row items-center gap-3 rounded-2xl px-4 py-3.5 active:opacity-70 ${
                      selected ? "bg-brand-50" : "bg-surface-alt"
                    }`}
                  >
                    <Text variant="title" color={selected ? "brand" : undefined} className="flex-1">
                      {option.label}
                    </Text>
                    {selected ? (
                      <Ionicons name="checkmark-circle" size={22} color={colors.brand[500]} />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>

            <Button label={t("common.cancel")} variant="ghost" className="mt-3" onPress={() => setOpen(false)} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
