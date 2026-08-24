import { View, Image } from "react-native";
import { cn } from "@/lib/cn";
import { Text } from "./Text";

type Size = "sm" | "md" | "lg";
type Status = "online" | "offline" | "alert" | null;

const sizing: Record<Size, string> = {
  sm: "h-9 w-9",
  md: "h-12 w-12",
  lg: "h-16 w-16",
};

const textVariant: Record<Size, "label" | "title" | "h2"> = {
  sm: "label",
  md: "title",
  lg: "h2",
};

const statusColor: Record<NonNullable<Status>, string> = {
  online: "bg-safe-500",
  offline: "bg-ink-subtle",
  alert: "bg-danger-500",
};

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}

const initials = getInitials;

export interface AvatarProps {
  name: string;
  uri?: string | null;
  size?: Size;
  status?: Status;
  className?: string;
}

export function Avatar({
  name,
  uri,
  size = "md",
  status = null,
  className,
}: AvatarProps) {
  return (
    <View className={cn("relative", className)}>
      {uri ? (
        <Image
          source={{ uri }}
          accessibilityLabel={name}
          className={cn("rounded-full", sizing[size])}
        />
      ) : (
        <View
          className={cn(
            "items-center justify-center rounded-full bg-brand-100",
            sizing[size],
          )}
        >
          <Text variant={textVariant[size]} color="brand">
            {initials(name)}
          </Text>
        </View>
      )}
      {status ? (
        <View
          className={cn(
            "absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-surface",
            statusColor[status],
          )}
        />
      ) : null}
    </View>
  );
}
