// Runtime access to the design tokens (for places that can't use className:
// SVG strokes, Reanimated colors, StatusBar, native props).
// Values mirror tokens.js — the single source of truth.
import tokens from "./tokens.js";

type Tokens = {
  colors: {
    background: string;
    surface: string;
    "surface-alt": string;
    border: string;
    overlay: string;
    ink: string;
    "ink-muted": string;
    "ink-subtle": string;
    "ink-inverse": string;
    brand: Record<string, string>;
    safe: Record<string, string>;
    danger: Record<string, string>;
    warning: Record<string, string>;
    night: Record<string, string>;
  };
  fontFamily: Record<string, string[]>;
  borderRadius: Record<string, string>;
};

export const { colors, fontFamily, borderRadius } = tokens as Tokens;

// Spacing scale (4/8pt) for runtime gaps where className isn't available.
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
} as const;

export type AppColors = Tokens["colors"];
