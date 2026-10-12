import type { Config } from "tailwindcss";
import tokens from "../../packages/ui/tokens.json";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  // light-by-default: chat is embedded in a business's brand context; dark infra stays wired for a future toggle
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        "bg-2": "rgb(var(--bg-2) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        "ink-soft": "rgb(var(--ink-soft) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-soft": "rgb(var(--accent-soft) / <alpha-value>)",
        "accent-ink": "rgb(var(--accent-ink) / <alpha-value>)",
        lime: "rgb(var(--lime) / <alpha-value>)",
        "lime-soft": "rgb(var(--lime-soft) / <alpha-value>)",
        "lime-ink": "rgb(var(--lime-ink) / <alpha-value>)",
        positive: "rgb(var(--positive) / <alpha-value>)",
        "positive-soft": "rgb(var(--positive-soft) / <alpha-value>)",
        negative: "rgb(var(--negative) / <alpha-value>)",
        "negative-soft": "rgb(var(--negative-soft) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
        "warning-soft": "rgb(var(--warning-soft) / <alpha-value>)",
        secondary: "rgb(var(--secondary) / <alpha-value>)",
        "secondary-soft": "rgb(var(--secondary-soft) / <alpha-value>)",
        "secondary-ink": "rgb(var(--secondary-ink) / <alpha-value>)",
        tertiary: "rgb(var(--tertiary) / <alpha-value>)",
        "tertiary-soft": "rgb(var(--tertiary-soft) / <alpha-value>)",
        "tertiary-ink": "rgb(var(--tertiary-ink) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["Iowan Old Style", "Palatino Linotype", "serif"],
      },
      borderRadius: {
        card: tokens.radius.card,
        pill: tokens.radius.pill,
        input: tokens.radius.input,
      },
      boxShadow: {
        card: tokens.elevation.card,
      },
    },
  },
  plugins: [],
} satisfies Config;
