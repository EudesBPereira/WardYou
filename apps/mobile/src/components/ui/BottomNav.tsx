import { View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { cn } from "@/lib/cn";
import { colors } from "@/theme";
import { Text } from "./Text";

export type TabKey = "home" | "family" | "trips" | "tasks" | "sos" | "settings";

const ICONS: Record<TabKey, keyof typeof Ionicons.glyphMap> = {
  home: "home",
  family: "people",
  trips: "navigate",
  tasks: "trophy",
  sos: "warning",
  settings: "settings",
};

const ORDER: TabKey[] = ["home", "family", "trips", "sos", "settings"];

export interface BottomNavProps {
  active: TabKey;
  onChange: (key: TabKey) => void;
  labels: Record<TabKey, string>;
  /** Which tabs to render — the app profile decides (child/elder see fewer). */
  tabs?: TabKey[];
}

export function BottomNav({ active, onChange, labels, tabs = ORDER }: BottomNavProps) {
  return (
    <View className="flex-row items-stretch justify-between border-t border-border bg-surface px-2 pb-2 pt-2">
      {tabs.map((key) => {
        const isActive = key === active;
        // SOS is a normal-sized tab like every other (same icon size + touch box
        // so the tappable area always matches what you see — no raised circle
        // that shifts the hit target), just tinted danger-red so it stands out.
        const isSos = key === "sos";
        const iconColor = isSos
          ? colors.danger[500]
          : isActive
            ? colors.brand[500]
            : colors["ink-subtle"];
        const iconName = isSos
          ? "warning"
          : isActive
            ? ICONS[key]
            : (`${ICONS[key]}-outline` as keyof typeof Ionicons.glyphMap);
        return (
          <Pressable
            key={key}
            accessibilityRole={isSos ? "button" : "tab"}
            accessibilityState={isSos ? undefined : { selected: isActive }}
            accessibilityLabel={labels[key]}
            onPress={() => onChange(key)}
            className="flex-1 items-center gap-1 py-1"
          >
            <Ionicons name={iconName} size={22} color={iconColor} />
            <Text
              variant="caption"
              className={cn(
                isSos
                  ? "font-body-semibold text-danger-500"
                  : isActive
                    ? "font-body-semibold text-brand-500"
                    : "text-ink-subtle",
              )}
            >
              {labels[key]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
