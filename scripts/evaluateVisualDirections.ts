// Prints the measured WCAG contrast of every candidate visual direction
// (modules/design/visualDirections.ts) as Markdown. Pure computation: no
// database, no network, no files written.   npm run design:evaluate

import { evaluateDirection, failures } from "../modules/design/evaluateDirection";
import { VISUAL_DIRECTIONS } from "../modules/design/visualDirections";

for (const direction of VISUAL_DIRECTIONS) {
  const evaluation = evaluateDirection(direction);
  console.log(`\n## Direction ${direction.id} — ${direction.name}\n`);
  for (const theme of ["dark", "light"] as const) {
    console.log(`### ${theme} mode\n`);
    console.log("| Check | Ratio | Needs | Result |\n|---|---:|---:|---|");
    for (const c of evaluation[theme]) console.log(`| ${c.label} | ${c.ratio.toFixed(2)} | ${c.threshold} | ${c.pass ? "pass" : c.advisory ? "advisory" : "**FAIL**"} |`);
    console.log("");
  }
  const failed = failures(evaluation);
  console.log(failed.length === 0 ? "No AA failures." : `AA failures (${failed.length}): ${failed.map((f) => `${f.theme}: ${f.check.label} (${f.check.ratio.toFixed(2)})`).join("; ")}`);
}
