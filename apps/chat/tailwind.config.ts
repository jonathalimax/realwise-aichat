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
        lime: light.lime,
        "lime-soft": light.limeSoft,
        "lime-ink": light.limeInk,
        positive: light.positive,
        negative: light.negative,
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["Iowan Old Style", "Palatino Linotype", "serif"],
      },
      borderRadius: {
        card: "16px",
      },
    },
  },
  plugins: [],
} satisfies Config;
