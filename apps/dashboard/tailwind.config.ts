import type { Config } from "tailwindcss";
import tokens from "../../packages/ui/tokens.json";

export default {
  content: ["./src/**/*.{ts,tsx}"],
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
        // Per-business brand colours (hex, set at runtime by BrandingApplier). Generic: any niche can use them.
        brand: "var(--brand-primary)",
        "brand-2": "var(--brand-secondary)",
        "brand-3": "var(--brand-tertiary)",
        "brand-soft": "var(--brand-soft)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["Iowan Old Style", "Palatino Linotype", "serif"],
        mono: ["ui-monospace", "SF Mono", "monospace"],
      },
      borderRadius: {
        card: tokens.radius.card,
        cardLarge: tokens.radius.cardLarge,
        pill: tokens.radius.pill,
        input: tokens.radius.input,
        chip: tokens.radius.chip,
      },
      boxShadow: {
        card: tokens.elevation.card,
        popover: tokens.elevation.popover,
      },
    },
  },
  plugins: [],
} satisfies Config;
