// Music Madras — in-browser visual audit (Phase 6J-3B). Paste into the browser
// console (or run through a browser tool) on any rendered Museum or Studio page.
// It reports, for the current theme and viewport:
//   - every visible text element whose colour against its REAL rendered background
//     (alpha-composited through its ancestors) is below WCAG AA (4.5:1, or 3:1 for
//     large text), plus input placeholders;
//   - horizontal page overflow against the DEVICE width (the page must never scroll sideways);
//   - interactive elements with a touch target smaller than 24x24 CSS px (WCAG 2.2).
// It reads the page only; it changes nothing.
(() => {
  // CSS transitions are frozen while a tab is hidden, which makes a theme switch read as a half-way colour; measure the settled state.
  const settle = document.createElement("style");
  settle.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}";
  document.head.appendChild(settle);
  const parse = (value) => {
    const m = value.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
  };
  const over = (top, under) => ({
    r: top.r * top.a + under.r * (1 - top.a),
    g: top.g * top.a + under.g * (1 - top.a),
    b: top.b * top.a + under.b * (1 - top.a),
    a: 1,
  });
  const lum = ({ r, g, b }) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const background = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a === 1) break;
      }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    const root = parse(getComputedStyle(document.documentElement).backgroundColor);
    if (root && root.a === 1) base = root;
    return layers.reduceRight((under, layer) => over(layer, under), base);
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0;
  };
  const describe = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/)[0] : ""} "${(el.textContent || el.value || "").trim().slice(0, 32)}"`;

  const contrastFailures = [];
  let checked = 0;
  for (const el of document.body.querySelectorAll("*")) {
    if (["SCRIPT", "STYLE", "NEXTJS-PORTAL", "NEXT-ROUTE-ANNOUNCER", "svg", "path"].includes(el.tagName) || !visible(el)) continue;
    const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!hasOwnText) continue;
    const cs = getComputedStyle(el);
    const bg = background(el);
    const fgRaw = parse(cs.color);
    if (!fgRaw) continue;
    const fg = over(fgRaw, bg);
    const size = parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    const r = ratio(fg, bg);
    checked++;
    if (r < need) contrastFailures.push({ el: describe(el), ratio: Math.round(r * 100) / 100, need });
  }
  const placeholderFailures = [];
  for (const el of document.querySelectorAll("input[placeholder], textarea[placeholder]")) {
    if (!visible(el)) continue;
    const bg = background(el);
    const fgRaw = parse(getComputedStyle(el, "::placeholder").color);
    if (!fgRaw) continue;
    const r = ratio(over(fgRaw, bg), bg);
    checked++;
    if (r < 4.5) placeholderFailures.push({ el: describe(el), ratio: Math.round(r * 100) / 100, need: 4.5 });
  }
  const smallTargets = [...document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, summary")]
    .filter(visible)
    .filter((el) => {
      // an inline link inside a sentence is exempt (WCAG 2.5.8)
      if (el.tagName === "A" && getComputedStyle(el).display === "inline") return false;
      const r = el.getBoundingClientRect();
      return r.width < 24 || r.height < 24;
    })
    .map(describe);
  const de = document.documentElement;
  settle.remove();
  // On a phone the browser widens the layout viewport to fit wide content, so innerWidth can lie; the device width is the truth.
  const deviceWidth = Math.min(innerWidth, screen.width || innerWidth);
  return {
    url: location.pathname + location.search,
    theme: de.getAttribute("data-theme") || "dark",
    viewport: deviceWidth,
    textChecked: checked,
    contrastFailures: contrastFailures.concat(placeholderFailures),
    horizontalOverflow: de.scrollWidth > deviceWidth + 1 ? { scrollWidth: de.scrollWidth, deviceWidth } : false,
    smallTouchTargets: smallTargets,
  };
})();
