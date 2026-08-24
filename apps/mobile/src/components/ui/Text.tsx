import { Text as RNText, type TextProps as RNTextProps } from "react-native";
import { cn } from "@/lib/cn";

export type TextVariant =
  | "display" // hero numbers / splash
  | "h1"
  | "h2"
  | "title"
  | "body"
  | "body-strong"
  | "label"
  | "caption"
  | "mono"; // data, timestamps, codes

export type TextColor =
  | "default"
  | "muted"
  | "subtle"
  | "inverse"
  | "brand"
  | "safe"
  | "danger";

const variantClass: Record<TextVariant, string> = {
  display: "font-display-bold text-5xl leading-tight",
  h1: "font-display-bold text-3xl leading-tight",
  h2: "font-display text-2xl leading-snug",
  title: "font-body-semibold text-lg leading-snug",
  body: "font-body text-base leading-relaxed",
  "body-strong": "font-body-semibold text-base leading-relaxed",
  label: "font-body-medium text-sm leading-normal",
  caption: "font-body text-xs leading-normal",
  mono: "font-mono text-sm leading-normal",
};

const colorClass: Record<TextColor, string> = {
  default: "text-ink",
  muted: "text-ink-muted",
  subtle: "text-ink-subtle",
  inverse: "text-ink-inverse",
  brand: "text-brand-500",
  safe: "text-safe-600",
  danger: "text-danger-500",
};

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  color?: TextColor;
  className?: string;
}

export function Text({
  variant = "body",
  color = "default",
  className,
  ...props
}: TextProps) {
  return (
    <RNText
      className={cn(variantClass[variant], colorClass[color], className)}
      {...props}
    />
  );
}
