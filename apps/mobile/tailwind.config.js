const { colors, fontFamily, borderRadius } = require("./src/theme/tokens.js");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  // Manual (class) strategy so NativeWind doesn't throw on web when the color
  // scheme is set; the app is light-first and never adds the `dark` class.
  darkMode: "class",
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors,
      fontFamily,
      borderRadius,
    },
  },
  plugins: [],
};
