// Operator script (launch readiness; register R-22): after changing a test Recording in Studio (publish, unpublish, archive, restore, hold, lift), poll the public
// surfaces until they agree, and report how long that took and what the host's caches said.
//
//   npm run ops:probe-visibility -- --base-url https://<site> --slug <recording-slug> --title "<working title>" --expect present|absent [--within 60] [--interval 3]
//
//   --expect present   the Recording page answers 200, archive search for the title links it, and the sitemap lists it
//   --expect absent    the page answers 404, search does not link it, and the sitemap does not list it
//   --within           seconds to keep trying (default 60); --interval seconds between rounds (default 3)
//
// GET requests to public URLs only; no credentials, nothing is changed on the site. Exit 0 = all three surfaces matched within the window (the time it took is printed),
// 1 = they did not (which ones, and the cache headers seen), 4 = bad usage. Use a TEST recording. Procedure: docs/runbooks/production-launch.md section 9.
import { cacheConcerns, evaluateObservations, linksRecording, pickCacheHeaders, type ExpectedState, type Observation } from "../modules/ops/visibilityProbe";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const baseUrl = flag("--base-url")?.replace(/\/+$/, "");
const slug = flag("--slug");
const title = flag("--title");
const expected = flag("--expect")?.toUpperCase() as ExpectedState | undefined;
const within = Number(flag("--within") ?? 60);
const interval = Number(flag("--interval") ?? 3);
if (!baseUrl || !/^https?:\/\//.test(baseUrl) || !slug || !title || (expected !== "PRESENT" && expected !== "ABSENT") || !(within > 0) || !(interval > 0)) {
  console.error('REFUSED: usage: --base-url <url> --slug <slug> --title "<title>" --expect present|absent [--within 60] [--interval 3]');
  process.exit(4);
}

async function get(pathAndQuery: string): Promise<{ status: number | null; body: string; headers: { get(name: string): string | null } | null }> {
  try {
    const response = await fetch(`${baseUrl}${pathAndQuery}`, { headers: { "Cache-Control": "no-cache" }, redirect: "follow" });
    return { status: response.status, body: await response.text(), headers: response.headers };
  } catch {
    return { status: null, body: "", headers: null };
  }
}

async function observe(): Promise<Observation[]> {
  const page = await get(`/recordings/${encodeURIComponent(slug as string)}`);
  const search = await get(`/archive?q=${encodeURIComponent(title as string)}`);
  const sitemap = await get("/sitemap.xml");
  const ok = (r: { status: number | null }) => r.status !== null && r.status < 500;
  const cache = (r: { headers: { get(name: string): string | null } | null }) => (r.headers ? pickCacheHeaders(r.headers) : {});
  return [
    { surface: "page", shown: page.status === 200, inconclusive: !(ok(page) && (page.status === 200 || page.status === 404)), status: page.status, cache: cache(page) },
    { surface: "search", shown: linksRecording(search.body, slug as string), inconclusive: !(ok(search) && search.status === 200), status: search.status, cache: cache(search) },
    { surface: "sitemap", shown: linksRecording(sitemap.body, slug as string), inconclusive: !(ok(sitemap) && sitemap.status === 200), status: sitemap.status, cache: cache(sitemap) },
  ];
}

async function main(): Promise<number> {
  const started = Date.now();
  console.log(`Probing ${baseUrl} for /recordings/${slug}: expecting it to be ${expected}, for up to ${within}s.`);
  let last: Observation[] = [];
  do {
    last = await observe();
    const evaluation = evaluateObservations(expected as ExpectedState, last);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`  t+${seconds}s  ${last.map((o) => `${o.surface}=${o.inconclusive ? "?" : o.shown ? "shown" : "hidden"}(${o.status ?? "no answer"})`).join("  ")}`);
    if (evaluation.consistent) {
      console.log(`RESULT: all three surfaces show the Recording as ${expected} (agreed after ${seconds}s).`);
      for (const c of cacheConcerns(last)) console.log(`  note: ${c}`);
      return 0;
    }
    await new Promise((resolve) => setTimeout(resolve, interval * 1000));
  } while (Date.now() - started < within * 1000);
  const evaluation = evaluateObservations(expected as ExpectedState, last);
  console.log(`RESULT: NOT consistent after ${within}s. Surfaces that disagree: ${evaluation.wrong.join(", ")}.`);
  for (const o of last) console.log(`  ${o.surface} headers: ${JSON.stringify(o.cache)}`);
  for (const c of cacheConcerns(last)) console.log(`  concern: ${c}`);
  return 1;
}

main().then((code) => process.exit(code));
