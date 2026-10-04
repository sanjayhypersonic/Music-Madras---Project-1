// Phase 6J-3A/3B — the four candidate visual directions, expressed in the SAME
// semantic roles the token foundation uses (see app/tokens.css). Phase 6J-3A used
// this as EVALUATION DATA; the product owner then approved Direction C, which
// Phase 6J-3B ships: direction C below is exactly app/tokens.css (a test prevents
// drift). A is the previous palette, kept for the record; B and D are the
// alternatives that were not chosen.
//
// Everything is derived from the official logo (public/music-madras-logo.webp,
// sampled): marigold #F1B902 (25% of the artwork), brick red #C03431, teal
// #219192, deep brown-black #2D1917, navy #1A313D, cream-yellow #F8DA62.

export interface ThemeColours {
  background: string;
  backgroundElevated: string;
  surface: string;
  border: string; // decorative divider / card edge
  borderStrong: string; // a border that identifies a control or marks state
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  link: string;
  linkHover: string;
  /** The solid fill of a primary action button and the colour of its label. */
  primaryFill: string;
  primaryOn: string;
  discovery: string;
  discoverySubtle: string;
  focus: string;
  heritage: string; // archive / preservation / identity text and indicators
  heritageSubtle: string; // tinted badge background
  heritageOnSubtle?: string; // badge text where it differs from `heritage`
  discoveryOnSubtle?: string;
}

export interface FunctionalColours {
  success: string;
  warning: string;
  error: string;
  info: string;
}

export interface VisualDirection {
  id: "A" | "B" | "C" | "D";
  name: string;
  summary: string;
  dark: ThemeColours;
  light: ThemeColours;
  functional: { dark: FunctionalColours; light: FunctionalColours };
}

// Functional colours are deliberately shared by every direction: success must
// read as success, an error as an error, whatever the brand colour is. Warning
// is a burnt orange (not the heritage marigold) so it cannot be mistaken for
// the brand; info is a calm blue.
const FUNCTIONAL = {
  dark: { success: "#5cc48a", warning: "#f2a65a", error: "#f2767d", info: "#8fa8f2" },
  light: { success: "#16703f", warning: "#8f4f00", error: "#b3261e", info: "#3a4fb0" },
};

export const VISUAL_DIRECTIONS: readonly VisualDirection[] = [
  {
    id: "A",
    name: "Previous magenta / purple",
    summary: "The previous palette (until 6J-3B): Deep Magenta #95135A, Bright Magenta #C2185B, Purple #6A3BA8, Lavender #C9B8E8 on near-black #1A1A2E.",
    dark: {
      background: "#1a1a2e",
      backgroundElevated: "#292640",
      surface: "#211f36",
      border: "rgba(201, 184, 232, 0.14)",
      borderStrong: "#c9b8e8",
      textPrimary: "#f1eef8",
      textSecondary: "#a9a3c2",
      textMuted: "#a9a3c2",
      link: "#c9b8e8",
      linkHover: "#ece3fa",
      primaryFill: "#95135a", // the gradient starts at Deep Magenta
      primaryOn: "#ffffff",
      discovery: "#c9b8e8",
      discoverySubtle: "rgba(201, 184, 232, 0.12)",
      focus: "#c9b8e8",
      heritage: "#c9b8e8",
      heritageSubtle: "rgba(201, 184, 232, 0.12)",
    },
    light: {
      background: "#faf8fb",
      backgroundElevated: "#f3eef9",
      surface: "#ffffff",
      border: "rgba(106, 59, 168, 0.16)",
      borderStrong: "#6a3ba8",
      textPrimary: "#1a1a2e",
      textSecondary: "#5b5770",
      textMuted: "#5b5770",
      link: "#6a3ba8",
      linkHover: "#95135a",
      primaryFill: "#95135a",
      primaryOn: "#ffffff",
      discovery: "#6a3ba8",
      discoverySubtle: "rgba(106, 59, 168, 0.10)",
      focus: "#6a3ba8",
      heritage: "#6a3ba8",
      heritageSubtle: "rgba(106, 59, 168, 0.10)",
    },
    functional: FUNCTIONAL,
  },
  {
    id: "B",
    name: "Black + amber",
    summary: "Warm near-black, the logo's marigold as the one accent, cream type. Amber carries identity AND interaction.",
    dark: {
      background: "#16120f",
      backgroundElevated: "#28211c",
      surface: "#1e1915",
      border: "rgba(245, 237, 224, 0.14)",
      borderStrong: "#8f8372",
      textPrimary: "#f5ede0",
      textSecondary: "#d2c8b8",
      textMuted: "#a89e8e",
      link: "#f1b902",
      linkHover: "#f8cb3a",
      primaryFill: "#f1b902",
      primaryOn: "#1a1308",
      discovery: "#f1b902",
      discoverySubtle: "rgba(241, 185, 2, 0.14)",
      focus: "#f1b902",
      heritage: "#f1b902",
      heritageSubtle: "rgba(241, 185, 2, 0.14)",
    },
    light: {
      background: "#faf6ee",
      backgroundElevated: "#f3ecdd",
      surface: "#ffffff",
      border: "rgba(31, 25, 20, 0.14)",
      borderStrong: "#7d7262",
      textPrimary: "#1f1914",
      textSecondary: "#4a4137",
      textMuted: "#675d50",
      link: "#8a5a00",
      linkHover: "#6b4500",
      primaryFill: "#f1b902",
      primaryOn: "#1a1308",
      discovery: "#8a5a00",
      discoverySubtle: "rgba(138, 90, 0, 0.10)",
      focus: "#8a5a00",
      heritage: "#8a5a00",
      heritageSubtle: "rgba(241, 185, 2, 0.2)",
    },
    functional: FUNCTIONAL,
  },
  {
    id: "C",
    name: "Black + amber + restrained digital blue",
    summary:
      "APPROVED and shipped (Phase 6J-3B). Warm near-black. Amber = heritage / archive / identity (eyebrows, archive markers, curator rules). Teal-leaning blue = discovery / links / search / focus / primary actions. Values are exactly app/tokens.css (a test prevents drift).",
    dark: {
      background: "#14110e",
      backgroundElevated: "#2a231d",
      surface: "#1d1814",
      border: "rgba(245, 237, 224, 0.22)",
      borderStrong: "#8f8372",
      textPrimary: "#f5ede0",
      textSecondary: "#d2c8b8",
      textMuted: "#a89e8e",
      link: "#6cbdd1",
      linkHover: "#9ad7e6",
      primaryFill: "#1f7f99",
      primaryOn: "#ffffff",
      discovery: "#1f7f99", // the SOLID action fill; link is its text counterpart
      discoverySubtle: "rgba(108, 189, 209, 0.14)",
      discoveryOnSubtle: "#6cbdd1",
      focus: "#6cbdd1",
      heritage: "#f1b902",
      heritageSubtle: "rgba(241, 185, 2, 0.14)",
    },
    light: {
      background: "#faf6ee",
      backgroundElevated: "#f3ecdd",
      surface: "#ffffff",
      border: "rgba(31, 25, 20, 0.24)",
      borderStrong: "#7d7262",
      textPrimary: "#1f1914",
      textSecondary: "#4a4137",
      textMuted: "#675d50",
      link: "#1b6a7f",
      linkHover: "#14515f",
      primaryFill: "#1b6a7f",
      primaryOn: "#ffffff",
      discovery: "#1b6a7f",
      discoverySubtle: "rgba(27, 106, 127, 0.1)",
      discoveryOnSubtle: "#1b6a7f",
      focus: "#1b6a7f",
      heritage: "#8a5a00",
      heritageSubtle: "rgba(241, 185, 2, 0.2)",
    },
    functional: FUNCTIONAL,
  },  {
    id: "D",
    name: "Black + blue + restrained amber",
    summary: "Cool near-black. Blue leads everything interactive and brand-facing; amber is a small heritage accent (eyebrows, archive badges).",
    dark: {
      background: "#0f131a",
      backgroundElevated: "#1f2530",
      surface: "#171c25",
      border: "rgba(238, 242, 248, 0.14)",
      borderStrong: "#7d889a",
      textPrimary: "#eef2f8",
      textSecondary: "#c5ccd8",
      textMuted: "#97a1b2",
      link: "#7db4e6",
      linkHover: "#a9cdf0",
      primaryFill: "#2f6fb3",
      primaryOn: "#ffffff",
      discovery: "#7db4e6",
      discoverySubtle: "rgba(125, 180, 230, 0.14)",
      focus: "#7db4e6",
      heritage: "#f1b902",
      heritageSubtle: "rgba(241, 185, 2, 0.14)",
    },
    light: {
      background: "#f6f8fb",
      backgroundElevated: "#edf1f7",
      surface: "#ffffff",
      border: "rgba(20, 26, 36, 0.14)",
      borderStrong: "#6b7688",
      textPrimary: "#141a24",
      textSecondary: "#3d4658",
      textMuted: "#586377",
      link: "#1d5fa6",
      linkHover: "#144a85",
      primaryFill: "#1d5fa6",
      primaryOn: "#ffffff",
      discovery: "#1d5fa6",
      discoverySubtle: "rgba(29, 95, 166, 0.10)",
      focus: "#1d5fa6",
      heritage: "#8a5a00",
      heritageSubtle: "rgba(241, 185, 2, 0.2)",
    },
    functional: FUNCTIONAL,
  },
];
