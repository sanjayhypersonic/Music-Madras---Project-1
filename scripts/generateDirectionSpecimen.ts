// Writes docs/visual-system/directions-specimen.html — a single static page that
// shows the four candidate visual directions (modules/design/visualDirections.ts)
// side by side, each in dark and light, using the official logo UNMODIFIED.
// It is a palette specimen for the product-owner decision, generated from the one
// source of truth so it cannot disagree with the evaluation. It is not part of
// the site, uses no catalogue data, and touches no database.
//   npm run design:specimen

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { evaluateDirection, failures } from "../modules/design/evaluateDirection";
import { VISUAL_DIRECTIONS, type FunctionalColours, type ThemeColours } from "../modules/design/visualDirections";

function cssVars(theme: ThemeColours, functional: FunctionalColours): string {
  const tint = (hex: string) => `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")}, 0.14)`;
  return [
    `--bg:${theme.background}`, `--raised:${theme.backgroundElevated}`, `--surface:${theme.surface}`, `--border:${theme.border}`, `--border-strong:${theme.borderStrong}`,
    `--text:${theme.textPrimary}`, `--text-2:${theme.textSecondary}`, `--muted:${theme.textMuted}`, `--link:${theme.link}`, `--link-hover:${theme.linkHover}`,
    `--primary:${theme.primaryFill}`, `--on-primary:${theme.primaryOn}`, `--discovery:${theme.discovery}`, `--discovery-subtle:${theme.discoverySubtle}`,
    `--focus:${theme.focus}`, `--heritage:${theme.heritage}`, `--heritage-subtle:${theme.heritageSubtle}`,
    ...(["success", "warning", "error", "info"] as const).flatMap((k) => [`--${k}:${functional[k]}`, `--${k}-subtle:${tint(functional[k])}`]),
  ].join(";");
}

const STATUS = ["success", "warning", "error", "info"] as const;

// The approved logo, embedded ONCE and byte-for-byte so the specimen is self-contained (no recolouring, resizing or re-encoding).
const LOGO_DATA_URI = `data:image/webp;base64,${readFileSync(path.resolve(__dirname, "../public/music-madras-logo.webp")).toString("base64")}`;

function panel(themeName: "dark" | "light", theme: ThemeColours, functional: FunctionalColours): string {
  return `
  <div class="panel" style="${cssVars(theme, functional)}">
    <p class="panel-label">${themeName} mode</p>
    <div class="museum">
      <div class="museum-head"><span class="logo" role="img" aria-label="Music Madras"></span><nav><a href="#">Archive</a><a href="#">Collections</a><a href="#">Learning</a></nav></div>
      <p class="eyebrow">The Music Madras archive</p>
      <h3 class="serif">Preserving Chennai’s Musical Heritage</h3>
      <p class="lede">Music Madras documents and preserves Chennai’s Western Classical Music tradition.</p>
      <div class="row"><button class="primary">Explore the Archive</button><button class="outline">Secondary action</button></div>
      <div class="card">
        <div class="thumb"></div>
        <p class="card-title serif">Entity title</p>
        <p class="meta">Recording · metadata in muted text</p>
        <div class="row"><span class="badge heritage">Archive</span><span class="badge discovery">Discovery</span><a href="#">A link in running text</a></div>
      </div>
      <input class="field" placeholder="Search the archive (placeholder)" aria-label="Search" />
    </div>
    <div class="studio">
      <p class="studio-title">Studio</p>
      <table><thead><tr><th>Item</th><th>State</th></tr></thead><tbody>
        ${STATUS.map((s) => `<tr><td>Row — ${s}</td><td><span class="badge ${s}">${s}</span></td></tr>`).join("")}
      </tbody></table>
      <label class="label">Field label<input class="field focus" value="Focused field" aria-label="Focused field" /></label>
      <div class="row"><button class="primary">Save</button><button class="outline">Cancel</button></div>
    </div>
  </div>`;
}

const sections = VISUAL_DIRECTIONS.map((direction) => {
  const evaluation = evaluateDirection(direction);
  const failed = failures(evaluation).length;
  const worstText = (theme: "dark" | "light") => Math.min(...evaluation[theme].filter((c) => c.threshold === 4.5).map((c) => c.ratio)).toFixed(2);
  return `
<section>
  <h2>Direction ${direction.id} — ${direction.name}</h2>
  <p class="summary">${direction.summary}</p>
  <p class="summary">WCAG AA: ${failed === 0 ? "every checked pairing passes" : `${failed} failures`} · lowest text ratio dark ${worstText("dark")}:1, light ${worstText("light")}:1.</p>
  <div class="panels">${panel("dark", direction.dark, direction.functional.dark)}${panel("light", direction.light, direction.functional.light)}</div>
</section>`;
}).join("\n");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Music Madras — visual direction specimen</title>
<style>
  body{margin:0;padding:2rem 1.25rem 4rem;font-family:Inter,system-ui,sans-serif;background:#ece9e4;color:#1d1a17}
  h1{font-size:1.5rem;margin:0 0 .5rem} h2{font-size:1.2rem;margin:2.5rem 0 .25rem} .summary{margin:.15rem 0;font-size:.9rem;color:#4a443d;max-width:60rem}
  .note{max-width:60rem;font-size:.9rem;background:#fff;border:1px solid #cfc9bf;border-radius:.5rem;padding:.75rem 1rem}
  .panels{display:grid;grid-template-columns:repeat(auto-fit,minmax(21rem,1fr));gap:1rem;margin-top:1rem}
  .panel{background:var(--bg);color:var(--text);border-radius:.75rem;padding:1.25rem;border:1px solid var(--border);display:grid;gap:1.25rem}
  .panel-label{margin:0;font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
  .museum-head{display:flex;align-items:center;gap:1rem;border-bottom:1px solid var(--border);padding-bottom:.6rem}
  .logo{display:block;width:40px;height:40px;border-radius:50%;background:url(${LOGO_DATA_URI}) center/contain no-repeat} .museum-head nav{display:flex;gap:1rem;font-size:.85rem;font-weight:600}
  a{color:var(--link)} a:hover{color:var(--link-hover)} .serif{font-family:Georgia,"Times New Roman",serif}
  .eyebrow{margin:.9rem 0 .25rem;font-size:.75rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--heritage)}
  h3{margin:.1rem 0 .4rem;font-size:1.6rem;line-height:1.2;color:var(--text)} .lede{margin:0 0 .9rem;color:var(--text-2);font-size:.95rem}
  .row{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;margin:.6rem 0}
  button{font:inherit;font-weight:600;font-size:.9rem;border-radius:999px;padding:.5rem 1.1rem;cursor:pointer}
  .primary{background:var(--primary);color:var(--on-primary);border:1px solid transparent} .outline{background:transparent;color:var(--link);border:1px solid var(--border-strong)}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:1rem;padding:.75rem;margin:.9rem 0}
  .thumb{aspect-ratio:16/9;background:var(--raised);border-radius:.6rem;margin-bottom:.6rem} .card-title{margin:0;font-size:1rem;color:var(--text)} .meta{margin:.2rem 0 .4rem;font-size:.85rem;color:var(--muted)}
  .badge{display:inline-block;font-size:.7rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;border-radius:999px;padding:.2rem .6rem}
  .badge.heritage{background:var(--heritage-subtle);color:var(--heritage)} .badge.discovery{background:var(--discovery-subtle);color:var(--discovery)}
  ${STATUS.map((s) => `.badge.${s}{background:var(--${s}-subtle);color:var(--${s})}`).join(" ")}
  .field{width:100%;box-sizing:border-box;font:inherit;font-size:.9rem;padding:.55rem .9rem;border-radius:999px;border:1px solid var(--border-strong);background:var(--surface);color:var(--text)}
  .field::placeholder{color:var(--muted)} .field.focus{outline:2px solid var(--focus);outline-offset:3px;border-radius:.4rem}
  .studio{background:var(--surface);border:1px solid var(--border);border-radius:.5rem;padding:1rem}
  .studio-title{margin:0 0 .5rem;font-size:.75rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
  table{width:100%;border-collapse:collapse;font-size:.85rem;margin-bottom:.9rem} th{text-align:left;color:var(--text-2);font-weight:600} td,th{padding:.4rem .3rem;border-bottom:1px solid var(--border)}
  .label{display:grid;gap:.3rem;font-size:.85rem;color:var(--text-2)} .label .field{border-radius:.4rem}
</style></head><body>
<h1>Music Madras — visual direction specimen</h1>
<p class="note">Palette specimens for the product-owner decision (Phase 6J-3A), generated from <code>modules/design/visualDirections.ts</code> by <code>npm run design:specimen</code>.
They show roles (surfaces, text, links, buttons, badges, status colours, focus) — not product pages, and no catalogue data. The logo is the approved asset, unmodified.
Direction A is what ships today; B, C and D are proposals whose exact values are open to adjustment once a direction is chosen.
Headings use Georgia here only so this file is self-contained; the site uses Playfair Display and Inter.</p>
${sections}
</body></html>
`;

const target = path.resolve(__dirname, "../docs/visual-system/directions-specimen.html");
mkdirSync(path.dirname(target), { recursive: true });
writeFileSync(target, html, "utf8");
console.log(`Wrote ${path.relative(path.resolve(__dirname, ".."), target)} (${html.length} bytes)`);
