// Colour helpers for applying per-business branding as CSS variables.

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** "#0F766E" -> "15 118 110" (the space separated triplet the Tailwind tokens use). */
export function hexToTriplet(hex: string): string | null {
  const rgb = hexToRgb(hex);
  return rgb ? rgb.join(" ") : null;
}

/** Blend `hex` over white at `amount` (0..1): used for soft backgrounds like badges and active menu items. */
export function tint(hex: string, amount: number): string {
  const rgb = hexToRgb(hex) ?? [15, 118, 110];
  const mix = rgb.map((c) => Math.round(c * amount + 255 * (1 - amount)));
  return `#${mix.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** Readable text colour (black/white) on top of `hex` (WCAG relative luminance). */
export function readableOn(hex: string): "#ffffff" | "#09090b" {
  const rgb = hexToRgb(hex) ?? [0, 0, 0];
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  // Highest-contrast choice: the black/white crossover sits at a relative luminance of ~0.18 (amber gets dark text).
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.18 ? "#09090b" : "#ffffff";
}
