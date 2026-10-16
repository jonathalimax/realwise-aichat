"use client";

import { useEffect } from "react";
import { hexToTriplet, tint } from "../../lib/color";
import type { Branding } from "../../lib/pharmacy-api";

const OWNED_VARS = [
  "--brand-primary",
  "--brand-secondary",
  "--brand-tertiary",
  "--brand-soft",
  "--accent",
  "--accent-soft",
  "--accent-ink",
  "--secondary",
  "--tertiary",
];

/**
 * Applies a business's brand colours app-wide as CSS variables (generic: any niche can use it).
 *  - always writes --brand-primary/secondary/tertiary/soft (hex) for `bg-brand` style utilities,
 *  - when the business has custom colours or `restyle` is set (pharmacy), also re-points the legacy Tailwind
 *    tokens (--accent, --secondary, --tertiary, ...) so every existing primitive follows the brand,
 *  - `shadcnUi` switches the neutral zinc palette on (<html data-ui="shadcn">).
 */
export function BrandingApplier({
  branding,
  restyle,
  shadcnUi,
}: {
  branding: Branding | null | undefined;
  restyle: boolean;
  shadcnUi: boolean;
}) {
  useEffect(() => {
    const root = document.documentElement;
    if (shadcnUi) root.setAttribute("data-ui", "shadcn");
    else root.removeAttribute("data-ui");
    return () => root.removeAttribute("data-ui");
  }, [shadcnUi]);

  useEffect(() => {
    const root = document.documentElement;
    if (!branding) return;
    const { primaryColor: p, secondaryColor: s, tertiaryColor: t } = branding;
    root.style.setProperty("--brand-primary", p);
    root.style.setProperty("--brand-secondary", s);
    root.style.setProperty("--brand-tertiary", t);
    root.style.setProperty("--brand-soft", tint(p, 0.12));
    if (restyle) {
      const set = (name: string, hex: string) => {
        const triplet = hexToTriplet(hex);
        if (triplet) root.style.setProperty(name, triplet);
      };
      set("--accent", p);
      set("--accent-soft", tint(p, 0.12));
      set("--accent-ink", s);
      set("--secondary", s);
      set("--tertiary", t);
    }
    return () => {
      for (const v of OWNED_VARS) root.style.removeProperty(v);
    };
  }, [branding?.primaryColor, branding?.secondaryColor, branding?.tertiaryColor, restyle]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
