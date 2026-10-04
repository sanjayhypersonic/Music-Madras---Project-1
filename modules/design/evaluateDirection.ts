import { composite, contrastRatio, WCAG_AA_NON_TEXT, WCAG_AA_TEXT } from "./contrast";
import type { FunctionalColours, ThemeColours, VisualDirection } from "./visualDirections";

// Phase 6J-3A — turns a candidate direction into measured contrast ratios for
// the representative role combinations the brief lists (text, links, buttons,
// borders, badges, focus, functional colours; dark and light). Pure; the CLI
// wrapper is scripts/evaluateVisualDirections.ts.

export interface Check {
  /** A short, human-readable description of the pairing. */
  label: string;
  ratio: number;
  /** The WCAG threshold that applies: 4.5 for text, 3 for non-text indicators. */
  threshold: number;
  pass: boolean;
  /** Informational: reported, but not an AA requirement (see the note on the check). */
  advisory?: boolean;
}

function check(label: string, ratio: number, threshold: number, advisory = false): Check {
  return { label, ratio: Math.round(ratio * 100) / 100, threshold, pass: ratio >= threshold, ...(advisory ? { advisory: true } : {}) };
}

function rgbToCss(rgb: readonly number[]): string {
  return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** The lowest ratio of `foreground` over each of the given backgrounds. */
function worst(foreground: string, backgrounds: readonly string[]): number {
  return Math.min(...backgrounds.map((b) => contrastRatio(foreground, b)));
}

export function evaluateTheme(theme: ThemeColours, functional: FunctionalColours): Check[] {
  const surfaces = [theme.background, theme.surface, theme.backgroundElevated];
  const checks: Check[] = [
    check("Primary text on background / surface / elevated", worst(theme.textPrimary, surfaces), WCAG_AA_TEXT),
    check("Secondary text on background / surface / elevated", worst(theme.textSecondary, surfaces), WCAG_AA_TEXT),
    check("Muted text and placeholders on background / surface / elevated", worst(theme.textMuted, surfaces), WCAG_AA_TEXT),
    check("Link on background / surface / elevated", worst(theme.link, surfaces), WCAG_AA_TEXT),
    check("Link hover on background / surface / elevated", worst(theme.linkHover, surfaces), WCAG_AA_TEXT),
    check("Primary button label on its fill", contrastRatio(theme.primaryOn, theme.primaryFill), WCAG_AA_TEXT),
    // WCAG 1.4.11 does not require a button fill to contrast with the page when its label does (the label identifies it);\n    // reported because a low value means the button leans on its label and shape alone.\n    check("Primary button fill against the page (advisory)", worst(theme.primaryFill, [theme.background, theme.surface]), WCAG_AA_NON_TEXT, true),
    check("Control border (inputs, outline buttons) on background / surface", worst(theme.borderStrong, [theme.background, theme.surface]), WCAG_AA_NON_TEXT),
    check("Focus ring on background / surface / elevated", worst(theme.focus, surfaces), WCAG_AA_NON_TEXT),
  ];

  const heritageBadgeBg = rgbToCss(composite(theme.heritageSubtle, theme.surface));
  const discoveryBadgeBg = rgbToCss(composite(theme.discoverySubtle, theme.surface));
  checks.push(
    check("Heritage text on page surfaces", worst(theme.heritage, surfaces), WCAG_AA_TEXT),
    check("Heritage badge text on its tinted background", contrastRatio(theme.heritageOnSubtle ?? theme.heritage, heritageBadgeBg), WCAG_AA_TEXT),
    check("Discovery badge text on its tinted background", contrastRatio(theme.discoveryOnSubtle ?? theme.discovery, discoveryBadgeBg), WCAG_AA_TEXT)
  );

  for (const [name, colour] of Object.entries(functional)) {
    const tint = rgbToCss(composite(withAlpha(colour, 0.14), theme.surface));
    checks.push(
      check(`${name} text on background / surface / elevated`, worst(colour, surfaces), WCAG_AA_TEXT),
      check(`${name} text on its tinted background`, contrastRatio(colour, tint), WCAG_AA_TEXT)
    );
  }
  return checks;
}

function withAlpha(hex: string, alpha: number): string {
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return `rgba(${n(1)}, ${n(3)}, ${n(5)}, ${alpha})`;
}

export interface DirectionEvaluation {
  direction: VisualDirection;
  dark: Check[];
  light: Check[];
}

export function evaluateDirection(direction: VisualDirection): DirectionEvaluation {
  return {
    direction,
    dark: evaluateTheme(direction.dark, direction.functional.dark),
    light: evaluateTheme(direction.light, direction.functional.light),
  };
}

export function failures(evaluation: DirectionEvaluation): { theme: "dark" | "light"; check: Check }[] {
  return (["dark", "light"] as const).flatMap((theme) => evaluation[theme].filter((c) => !c.pass && !c.advisory).map((c) => ({ theme, check: c })));
}
