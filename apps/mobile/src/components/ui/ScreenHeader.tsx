import { type ReactNode } from "react";
import { View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { cn } from "@/lib/cn";
import { colors } from "@/theme";
import { Text } from "./Text";

export interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  action?: ReactNode;
  className?: string;
}

export function ScreenHeader({
  title,
  subtitle,
  onBack,
  action,
  className,
}: ScreenHeaderProps) {
  return (
    <View className={cn("flex-row items-center gap-3 py-3", className)}>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          hitSlop={8}
          className="h-10 w-10 items-center justify-center rounded-full bg-surface active:bg-surface-alt"
        >
          <Ionicons name="chevron-back" size={22} color={colors.ink} />
        </Pressable>
      ) : null}

      <View className="flex-1">
        <Text variant="h1">{title}</Text>
        {subtitle ? (
          <Text variant="body" color="muted" className="mt-1">
            {subtitle}
          </Text>
        ) : null}
      </View>

      {action}
    </View>
  );
}
