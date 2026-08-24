import { View } from "react-native";
import { cn } from "@/lib/cn";
import { Text } from "./Text";

type Tone = "neutral" | "brand" | "safe" | "danger" | "warning";

const containerClass: Record<Tone, string> = {
  neutral: "bg-surface-alt",
  brand: "bg-brand-50",
  safe: "bg-safe-50",
  danger: "bg-danger-50",
  warning: "bg-warning-100",
};

const textClass: Record<Tone, string> = {
  neutral: "text-ink-muted",
  brand: "text-brand-600",
  safe: "text-safe-700",
  danger: "text-danger-600",
  warning: "text-warning-700",
};

export interface BadgeProps {
  label: string;
  tone?: Tone;
  className?: string;
}

export function Badge({ label, tone = "neutral", className }: BadgeProps) {
  return (
    <View
      className={cn(
        "self-start rounded-full px-2.5 py-1",
        containerClass[tone],
        className,
      )}
    >
      <Text variant="caption" className={cn("font-body-semibold", textClass[tone])}>
        {label}
      </Text>
    </View>
  );
}
