import type { Config } from "tailwindcss";
import tokens from "../../packages/ui/tokens.json";

const light = tokens.color.light;

export default {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        bg: "#F3EEE3",
        "bg-2": "#EAE2D2",
        surface: light.surface,
        ink: "#17221C",
        "ink-soft": light.inkSoft,
        muted: light.inkMuted,
        border: "#E3DAC6",
        accent: light.accent,
        "accent-soft": light.accentSoft,
        "accent-ink": light.accentInk,
        clay: "#C47B4F",
        "clay-soft": "#F1E0D1",
        positive: light.positive,
        "positive-soft": light.positiveSoft,
        negative: light.negative,
        "negative-soft": light.negativeSoft,
        warning: light.warning,
        "warning-soft": light.warningSoft,
      },
      fontFamily: {
        serif: ["Iowan Old Style", "Palatino Linotype", "serif"],
        mono: ["ui-monospace", "SF Mono", "monospace"],
      },
      borderRadius: {
        card: "16px",
      },
    },
  },
  plugins: [],
} satisfies Config;
