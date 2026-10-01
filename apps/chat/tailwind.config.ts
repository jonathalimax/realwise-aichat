import type { Config } from "tailwindcss";
import tokens from "../../packages/ui/tokens.json";

const light = tokens.color.light;
const dark = tokens.color.dark;

export default {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        bg: light.bg,
        surface: light.surface,
        ink: light.ink,
        "ink-soft": light.inkSoft,
        border: light.border,
        accent: light.accent,
        "accent-soft": light.accentSoft,
        "accent-ink": light.accentInk,
        positive: light.positive,
        negative: light.negative,
      },
      fontFamily: {
        serif: ["Iowan Old Style", "Palatino Linotype", "serif"],
      },
      borderRadius: {
        card: "16px",
      },
    },
  },
  plugins: [],
} satisfies Config;
