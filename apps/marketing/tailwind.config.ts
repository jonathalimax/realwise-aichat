import type { Config } from "tailwindcss";
import tokens from "../../packages/ui/tokens.json";

const light = tokens.color.light;

export default {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        bg: light.bg,
        "bg-2": light.bgCanvasInset,
        surface: light.surface,
        ink: light.ink,
        "ink-soft": light.inkSoft,
        muted: light.inkMuted,
        border: light.border,
        accent: light.accent,
        "accent-soft": light.accentSoft,
        "accent-ink": light.accentInk,
        lime: light.lime,
        "lime-soft": light.limeSoft,
        "lime-ink": light.limeInk,
        positive: light.positive,
        "positive-soft": light.positiveSoft,
        negative: light.negative,
        "negative-soft": light.negativeSoft,
        warning: light.warning,
        "warning-soft": light.warningSoft,
        secondary: light.secondary,
        "secondary-soft": light.secondarySoft,
        "secondary-ink": light.secondaryInk,
        tertiary: light.tertiary,
        "tertiary-soft": light.tertiarySoft,
        "tertiary-ink": light.tertiaryInk,
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
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
