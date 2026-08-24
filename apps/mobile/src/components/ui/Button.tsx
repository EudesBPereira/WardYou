import type { ReactNode } from "react";
import { Pressable, ActivityIndicator, View, type PressableProps } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { cn } from "@/lib/cn";
import { Text } from "./Text";

type Variant = "primary" | "safe" | "danger" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg";

const container: Record<Variant, string> = {
  primary: "bg-brand-500 active:bg-brand-600",
  safe: "bg-safe-500 active:bg-safe-600",
  danger: "bg-danger-500 active:bg-danger-600",
  secondary: "bg-surface border border-border active:bg-surface-alt",
  ghost: "bg-transparent active:bg-surface-alt",
};

const labelColor: Record<Variant, "inverse" | "default" | "brand"> = {
  primary: "inverse",
  safe: "inverse",
  danger: "inverse",
  secondary: "default",
  ghost: "brand",
};

const sizing: Record<Size, string> = {
  sm: "h-11 px-4 rounded-md", // 44pt min touch target
  md: "h-12 px-5 rounded-lg",
  lg: "h-14 px-6 rounded-xl",
};

const iconSize: Record<Size, number> = { sm: 16, md: 18, lg: 20 };
const iconColorHex: Record<Variant, string> = {
  primary: "#FFFFFF",
  safe: "#FFFFFF",
  danger: "#FFFFFF",
  secondary: "#0B1F33",
  ghost: "#1875BE",
};

export interface ButtonProps extends Omit<PressableProps, "children"> {
  label: string;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Custom leading element (e.g. a multicolor brand logo). Takes precedence
   *  over `icon` when both are set. */
  leading?: ReactNode;
  fullWidth?: boolean;
  className?: string;
}

export function Button({
  label,
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  leading,
  fullWidth = true,
  disabled,
  className,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: loading }}
      disabled={isDisabled}
      className={cn(
        "flex-row items-center justify-center gap-2",
        sizing[size],
        container[variant],
        fullWidth ? "w-full" : "self-start",
        isDisabled && "opacity-50",
        className,
      )}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={iconColorHex[variant]} />
      ) : (
        <View className="min-w-0 shrink flex-row items-center gap-2">
          {leading ? (
            leading
          ) : icon ? (
            <Ionicons
              name={icon}
              size={iconSize[size]}
              color={iconColorHex[variant]}
            />
          ) : null}
          <Text
            variant="body-strong"
            color={labelColor[variant]}
            numberOfLines={1}
            className="shrink text-center"
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
