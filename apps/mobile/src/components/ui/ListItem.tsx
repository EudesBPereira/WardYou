import { type ReactNode } from "react";
import { View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { cn } from "@/lib/cn";
import { colors } from "@/theme";
import { Text } from "./Text";

type IconTone = "brand" | "safe" | "danger" | "warning" | "neutral";

const iconWrap: Record<IconTone, string> = {
  brand: "bg-brand-50",
  safe: "bg-safe-50",
  danger: "bg-danger-50",
  warning: "bg-warning-100",
  neutral: "bg-surface-alt",
};

const iconHex: Record<IconTone, string> = {
  brand: colors.brand[500],
  safe: colors.safe[600],
  danger: colors.danger[500],
  warning: colors.warning[700],
  neutral: colors["ink-muted"],
};

export interface ListItemProps {
  title: string;
  subtitle?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  iconTone?: IconTone;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  showChevron?: boolean;
  className?: string;
}

export function ListItem({
  title,
  subtitle,
  icon,
  iconTone = "neutral",
  leading,
  trailing,
  onPress,
  showChevron,
  className,
}: ListItemProps) {
  const chevron = showChevron ?? (!!onPress && !trailing);

  const content = (
    <View className={cn("flex-row items-center gap-3 py-3", className)}>
      {leading ??
        (icon ? (
          <View
            className={cn(
              "h-10 w-10 items-center justify-center rounded-xl",
              iconWrap[iconTone],
            )}
          >
            <Ionicons name={icon} size={20} color={iconHex[iconTone]} />
          </View>
        ) : null)}

      <View className="flex-1">
        <Text variant="title">{title}</Text>
        {subtitle ? (
          <Text variant="caption" color="muted" className="mt-0.5">
            {subtitle}
          </Text>
        ) : null}
      </View>

      {/* O trailing PRECISA poder encolher. Sem isto, um valor longo (um
          endereco, por exemplo) toma a largura que quiser e espreme o titulo
          ate ficar mais estreito que uma palavra -- ai o texto quebra letra a
          letra. Visto em campo em 2026-09-11: "Ultimo lugar" virou
          "Ult / imo / lugar". O teto de 55% garante que o rotulo sempre fique
          legivel; conteudo curto (Badge, "42%") nao e afetado. */}
      {trailing ? (
        <View className="shrink items-end" style={{ maxWidth: "55%" }}>
          {trailing}
        </View>
      ) : null}
      {chevron ? (
        <Ionicons name="chevron-forward" size={18} color={colors["ink-subtle"]} />
      ) : null}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        className="active:opacity-60"
      >
        {content}
      </Pressable>
    );
  }
  return content;
}
