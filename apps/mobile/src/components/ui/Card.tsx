import { View, Pressable, type ViewProps } from "react-native";
import { cn } from "@/lib/cn";

type Tone = "surface" | "brand" | "night";

const toneClass: Record<Tone, string> = {
  surface: "bg-surface border border-border",
  brand: "bg-brand-500",
  night: "bg-night-500",
};

export interface CardProps extends ViewProps {
  tone?: Tone;
  padded?: boolean;
  onPress?: () => void;
  className?: string;
}

export function Card({
  tone = "surface",
  padded = true,
  onPress,
  className,
  children,
  ...props
}: CardProps) {
  const classes = cn(
    "rounded-2xl",
    toneClass[tone],
    padded && "p-4",
    className,
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        className={cn(classes, "active:opacity-90")}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View className={classes} {...props}>
      {children}
    </View>
  );
}
