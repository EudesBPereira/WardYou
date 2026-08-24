// WardYou design tokens — "Guardião Sereno".
// Single source of truth shared by tailwind.config.js (CommonJS require) and the
// app runtime (imported from tokens.ts). Edit colors/fonts/radii here only.

const colors = {
  // Surfaces (light, airy, low-anxiety base)
  background: "#F4F7F8",
  surface: "#FFFFFF",
  "surface-alt": "#EAF0F1",
  border: "#DCE4E7",
  overlay: "rgba(11,31,51,0.55)",

  // Text / ink on light surfaces
  ink: "#0B1F33",
  "ink-muted": "#5A6B7B",
  "ink-subtle": "#8A99A6",
  "ink-inverse": "#FFFFFF",

  // Brand — WardYou blue (matches the shipped logo/icon exactly; sampled from
  // assets/android-icon-foreground.png: #1875BE deep blue, #77CCDE sky blue).
  brand: {
    50: "#EAF6FA",
    100: "#CFEBF3",
    200: "#A3DBEA",
    300: "#77CCDE",
    400: "#3B9BC9",
    500: "#1875BE",
    600: "#135E99",
    700: "#0F4873",
    800: "#0A324F",
    900: "#051B2A",
    DEFAULT: "#1875BE",
  },

  // Safe — green = "all good" (check-in, online, OK)
  safe: {
    50: "#E7F8F0",
    100: "#C2EFDB",
    200: "#8FE0BE",
    300: "#54CD9C",
    400: "#2BBE85",
    500: "#1FB57A",
    600: "#199463",
    700: "#13724D",
    800: "#0D5138",
    900: "#073322",
    DEFAULT: "#1FB57A",
  },

  // Danger — RESERVED for SOS / emergency. Never decorative.
  danger: {
    50: "#FDECEC",
    100: "#FAD1D2",
    200: "#F4A8AA",
    300: "#EE7B7E",
    400: "#E85457",
    500: "#E5484D",
    600: "#C2363B",
    700: "#98292D",
    800: "#6E1C20",
    900: "#481113",
    DEFAULT: "#E5484D",
  },

  // Warning — amber for attention (low battery, expiring)
  warning: {
    100: "#FCEFCC",
    300: "#F6CE63",
    500: "#E9930A",
    700: "#B36E05",
    DEFAULT: "#E9930A",
  },

  // Night — deep navy for hero/immersive sections (splash, SOS backdrop)
  night: {
    400: "#13314D",
    500: "#0B1F33",
    600: "#081726",
    700: "#050F1A",
    DEFAULT: "#0B1F33",
  },
};

// Font families map to specific loaded weight files (RN has no synthetic bold).
const fontFamily = {
  display: ["Sora_600SemiBold"],
  "display-bold": ["Sora_700Bold"],
  body: ["Inter_400Regular"],
  "body-medium": ["Inter_500Medium"],
  "body-semibold": ["Inter_600SemiBold"],
  "body-bold": ["Inter_700Bold"],
  mono: ["JetBrainsMono_500Medium"],
};

const borderRadius = {
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "20px",
  "2xl": "28px",
};

module.exports = { colors, fontFamily, borderRadius };
