import { View, Pressable } from "react-native";
import { Text } from "./Text";

// Bitmask: bit0 = Monday … bit6 = Sunday (matches the backend DaysOfWeek).
const KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export interface DayPickerProps {
  value: number;
  onChange: (value: number) => void;
  labels: string[]; // 7 short labels, Mon→Sun
  disabled?: boolean;
}

export function DayPicker({ value, onChange, labels, disabled }: DayPickerProps) {
  return (
    <View className="flex-row justify-between">
      {KEYS.map((_, i) => {
        const bit = 1 << i;
        const on = (value & bit) !== 0;
        return (
          <Pressable
            key={i}
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => onChange(value ^ bit)}
            className={`h-9 w-9 items-center justify-center rounded-full ${on ? "bg-brand-500" : "bg-surface-alt"} active:opacity-70`}
          >
            <Text variant="caption" className={on ? "text-white font-body-semibold" : "text-ink-subtle"}>
              {labels[i]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
