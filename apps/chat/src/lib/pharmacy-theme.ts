import type React from "react";

// Default pharmacy palette (mirrors packages/shared/src/branding.ts: teal / deep teal / amber).
export const PHARMACY_DEFAULT_BRANDING = {
  primaryColor: "#0F766E",
  secondaryColor: "#0B4F4A",
  tertiaryColor: "#F59E0B",
} as const;

export interface PharmacyBranding {
  primaryColor?: string | null;
  secondaryColor?: string | null;
  tertiaryColor?: string | null;
}

const HEX6 = /^#[0-9a-f]{6}$/i;

// Only a strict #RRGGBB value ever reaches a CSS variable: the colour comes from tenant-editable
// data, so anything else falls back to the default instead of being interpolated into styles.
function safeHex(value: string | null | undefined, fallback: string): string {
  return typeof value === "string" && HEX6.test(value.trim()) ? value.trim() : fallback;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

// Readable text colour over a brand colour: whichever of white / near-black has the higher WCAG contrast
// (the crossover is a relative luminance of about 0.18, so a mid-tone amber gets dark text, not white).
function readableOn(hex: string): string {
  return luminance(hex) > 0.18 ? "#09090b" : "#ffffff";
}

export function resolvePharmacyBranding(branding?: PharmacyBranding | null) {
  return {
    primary: safeHex(branding?.primaryColor, PHARMACY_DEFAULT_BRANDING.primaryColor),
    secondary: safeHex(branding?.secondaryColor, PHARMACY_DEFAULT_BRANDING.secondaryColor),
    tertiary: safeHex(branding?.tertiaryColor, PHARMACY_DEFAULT_BRANDING.tertiaryColor),
  };
}

// CSS variables consumed by the .ph-* classes in globals.css. `--tenant-accent` is also set so the
// shared Button / bubble utilities pick up the pharmacy primary colour.
export function pharmacyThemeVars(branding?: PharmacyBranding | null): React.CSSProperties {
  const { primary, secondary, tertiary } = resolvePharmacyBranding(branding);
  return {
    "--ph-primary": primary,
    "--ph-primary-fg": readableOn(primary),
    "--ph-secondary": secondary,
    "--ph-secondary-fg": readableOn(secondary),
    "--ph-tertiary": tertiary,
    "--ph-tertiary-fg": readableOn(tertiary),
    "--ph-soft": `color-mix(in srgb, ${primary} 11%, #ffffff)`,
    "--ph-soft-border": `color-mix(in srgb, ${primary} 28%, #ffffff)`,
    "--tenant-accent": primary,
  } as React.CSSProperties;
}
