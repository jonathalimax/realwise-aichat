// Brand colours (all niches). Stored on Business.primaryColor / secondaryColor / tertiaryColor
// (nullable). Consumers apply them as CSS variables and fall back to the niche default when unset.

import type { NicheKey } from "./permissions";

export interface Branding {
  primaryColor: string;
  secondaryColor: string;
  tertiaryColor: string;
}

export const PHARMACY_DEFAULT_BRANDING: Branding = {
  primaryColor: "#0F766E",
  secondaryColor: "#0B4F4A",
  tertiaryColor: "#F59E0B",
};

// Real estate / dealership keep the existing app accent (tokens.json) as the default.
export const SALES_DEFAULT_BRANDING: Branding = {
  primaryColor: "#15803D",
  secondaryColor: "#FF6348",
  tertiaryColor: "#7C6FF0",
};

export function defaultBrandingForNiche(niche: NicheKey): Branding {
  switch (niche) {
    case "farmacia":
      return PHARMACY_DEFAULT_BRANDING;
    case "imobiliaria":
    case "concessionaria":
      return SALES_DEFAULT_BRANDING;
    default: {
      const _never: never = niche;
      return _never;
    }
  }
}

const HEX = /^#[0-9a-fA-F]{6}$/;
export function isValidHexColor(v: unknown): v is string {
  return typeof v === "string" && HEX.test(v);
}

/** Resolve stored (nullable / possibly invalid) colours against the niche default. */
export function resolveBranding(
  niche: NicheKey,
  stored: { primaryColor?: string | null; secondaryColor?: string | null; tertiaryColor?: string | null; brandColor?: string | null },
): Branding {
  const d = defaultBrandingForNiche(niche);
  return {
    primaryColor: isValidHexColor(stored.primaryColor) ? stored.primaryColor : isValidHexColor(stored.brandColor) ? stored.brandColor : d.primaryColor,
    secondaryColor: isValidHexColor(stored.secondaryColor) ? stored.secondaryColor : d.secondaryColor,
    tertiaryColor: isValidHexColor(stored.tertiaryColor) ? stored.tertiaryColor : d.tertiaryColor,
  };
}
