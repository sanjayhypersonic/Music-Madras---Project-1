// Phase 6J-3A — WCAG 2.x contrast maths, shared by the visual-direction
// evaluation script and the token tests so both use one implementation.

export type Rgb = readonly [number, number, number];

export function parseColor(value: string): { rgb: Rgb; alpha: number } {
  const v = value.trim().toLowerCase();
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { rgb: [n(0), n(2), n(4)], alpha: h.length === 8 ? n(6) / 255 : 1 };
  }
  const rgba = v.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)$/);
  if (rgba) return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha: rgba[4] === undefined ? 1 : Number(rgba[4]) };
  throw new Error(`Unsupported colour: ${value}`);
}

/** Flattens a (possibly translucent) colour over an opaque backdrop. */
export function composite(foreground: string, backdrop: string): Rgb {
  const f = parseColor(foreground);
  const b = parseColor(backdrop);
  return [0, 1, 2].map((i) => Math.round(f.rgb[i] * f.alpha + b.rgb[i] * (1 - f.alpha))) as unknown as Rgb;
}

export function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between a foreground and an OPAQUE background (a translucent foreground is flattened first). */
export function contrastRatio(foreground: string, background: string): number {
  const bg = parseColor(background).rgb;
  const fg = composite(foreground, background);
  const [hi, lo] = [relativeLuminance(fg), relativeLuminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

export const WCAG_AA_TEXT = 4.5;
export const WCAG_AA_LARGE_TEXT = 3;
export const WCAG_AA_NON_TEXT = 3;