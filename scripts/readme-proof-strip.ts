// The README's proof strip (17 Nov, owner: "one calm, branded set" in place of the static shields under the title).
// One SVG per theme, shown with <picture> as the banner is; CSS animation only, played once and done by 2 s, stopped by
// prefers-reduced-motion; no script, no external link, no web font, so GitHub shows it in an <img>. Partner names are
// text, no logos. Every figure is read here from its record:
//   partners' status   a live run of each in the run records (the tiles on /proof count them; test/readme-glance.test.ts)
//   Claude's decisions the main run of 3 Nov (src/redesign/run.ts, as the stat strip reads it)
//   tests passing      docs/assets/test-summary.json (the last full run, `npm run test-count`)
//   verification       the latest docs/evidence/verification-*.json (`npm run verify-all`)
//   red team           docs/redteam/report.json (30 Oct, a throwaway test world)
// Written by `npm run readme:strip`; test/readme-proof-strip.test.ts redraws both and compares.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadRecord, split } from "../src/redesign/run.js";

/** "30 Oct" from an ISO time: the day a record ran. */
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export const STRIP_FILES = { light: "docs/assets/readme/proof-strip-light.svg", dark: "docs/assets/readme/proof-strip-dark.svg" } as const;
type Theme = keyof typeof STRIP_FILES;
const read = (p: string) => readFileSync(p, "utf8");

export interface StripFigures {
  decisions: number;
  tests: { passed: number; total: number; skipped: number; failed: number };
  verification: { file: string; passed: number; couldNotRun: number; failed: number };
  redteam: { attempts: number; stopped: number; caughtAfter: number; through: number; inconclusive: number; day: string };
}

/** The newest verification report in docs/evidence/ (by its date in the file name). */
export function latestVerification(): string {
  const files = readdirSync("docs/evidence").filter((f) => /^verification-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (!files.length) throw new Error("no docs/evidence/verification-*.json");
  return `docs/evidence/${files[files.length - 1]!}`;
}

export function stripFigures(): StripFigures {
  const t = JSON.parse(read("docs/assets/test-summary.json")) as { total: number; passed: number; failed: number; skipped: number };
  const file = latestVerification();
  const v = JSON.parse(read(file)) as { summary: string };
  const m = /^(\d+) checks passed, (\d+) could not run here, (\d+) failed$/.exec(v.summary);
  if (!m) throw new Error(`${file}: unexpected summary "${v.summary}"`);
  const r = JSON.parse(read("docs/redteam/report.json")) as { ran_at: string; attempts: number; blocked: number; caught_after: number; not_blocked: number; inconclusive: number };
  if (r.blocked + r.not_blocked + r.inconclusive !== r.attempts) throw new Error("the red team report's outcomes do not add up");
  return {
    decisions: split(loadRecord().record).byClaude,
    tests: { passed: t.passed, total: t.total, skipped: t.skipped, failed: t.failed },
    verification: { file, passed: Number(m[1]), couldNotRun: Number(m[2]), failed: Number(m[3]) },
    redteam: { attempts: r.attempts, stopped: r.blocked - r.caught_after, caughtAfter: r.caught_after, through: r.not_blocked, inconclusive: r.inconclusive, day: dayOf(r.ran_at) },
  };
}

/** The partners' cells: name, then status. */
export function stripPartners(f = stripFigures()): [string, string][] {
  return [["Airwallex", "sandbox"], ["Alta (formerly Metal)", "testnet"], ["Visa via Airi", "sandbox"], ["T:0", "sandbox ledger"], ["Claude", `${f.decisions} decisions, live`]];
}

/** The strip's alt text in the README: the same words the picture shows. */
export function stripAlt(f = stripFigures()): string {
  const p = stripPartners(f).map(([n, s]) => `${n} ${s}`).join("; ");
  return `From the records, test money: ${p}. ${fmt(f.tests.passed)} tests passing; ${f.verification.passed} checks passed, ${f.verification.failed} failed; ${f.redteam.stopped} of ${f.redteam.attempts} attacks stopped, ${f.redteam.caughtAfter} caught after (the red team's first run, ${f.redteam.day}, test world).`;
}

const SANS = `ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r1 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => n.toLocaleString("en-US");

// GitHub's own neutrals, one accent (blue); green only beside a word.
const PAL = {
  light: { bg: "#ffffff", card: "#f6f8fa", line: "#d1d9e0", ink: "#1f2328", ink2: "#59636e", muted: "#656d76", accent: "#0969da", track: "#dde3ea", good: "#1a7f37", warn: "#9a6700", markBg: "#0b1220", markInk: "#ffffff" },
  dark: { bg: "#0d1117", card: "#151b23", line: "#3d444d", ink: "#e6edf3", ink2: "#9198a1", muted: "#8b949e", accent: "#4493f8", track: "#262c36", good: "#3fb950", warn: "#d29922", markBg: "#f0f3f6", markInk: "#0b1220" },
} as const;

// Width of a line of text, estimated (the strip is laid out once, here; the test pins the result).
const tw = (s: string, size: number, bold = false) => [...s].reduce((w, ch) => w + (/[ il.,:;()'|!]/.test(ch) ? 0.3 : /[mwMW]/.test(ch) ? 0.85 : /[A-Z0-9]/.test(ch) ? 0.64 : 0.54), 0) * size * (bold ? 1.04 : 1);

const W = 960, H = 156, M = 14, BRAND = 140, RX0 = M + BRAND + 14, RW = W - RX0 - M, GAP = 8;

export function proofStripSvg(theme: Theme, f = stripFigures()): string {
  const c = PAL[theme];
  let n = 0;
  const delay = () => r1(0.1 + 0.08 * n++);

  // Row 1: the partners, each a chip with a status dot.
  const chips = stripPartners(f).map(([name, status]) => ({ name, status, w: 34 + Math.max(tw(name, 13.5, true), tw(status, 11.5)) }));
  const extra = (RW - chips.reduce((s, x) => s + x.w, 0) - GAP * (chips.length - 1)) / chips.length;
  if (extra < 0) throw new Error("the partners do not fit on one row");
  let x = RX0;
  const row1 = chips.map(({ name, status, w }) => {
    const cw = w + extra, out = `<g class="in" style="animation-delay:${delay()}s"><rect x="${r1(x) + 0.5}" y="${M + 0.5}" width="${r1(cw - 1)}" height="47" rx="9" fill="${c.card}" stroke="${c.line}"/>
<circle cx="${r1(x + 16)}" cy="${M + 18}" r="4" fill="${c.good}"/><text x="${r1(x + 27)}" y="${M + 23}" font-size="13.5" font-weight="600" fill="${c.ink}">${esc(name)}</text>
<text x="${r1(x + 27)}" y="${M + 39}" font-size="11.5" fill="${c.ink2}">${esc(status)}</text></g>`;
    x += cw + GAP;
    return out;
  }).join("\n");

  // Row 2: three figures, each with a bar of its parts.
  const FW = (RW - 2 * GAP) / 3, FY = M + 48 + 10, FH = H - FY - M;
  const fig = (i: number, value: string, label: string, sub: string, parts: [number, string][]) => {
    const fx = RX0 + i * (FW + GAP), bw = FW - 28, total = parts.reduce((s, [v]) => s + v, 0);
    let bx = fx + 14;
    const bars = parts.map(([v, col]) => { const w = (v / total) * bw, r = `<rect x="${r1(bx)}" y="${FY + FH - 14}" width="${r1(Math.max(w, 0))}" height="4" fill="${col}"/>`; bx += w; return r; }).join("");
    return `<g class="in" style="animation-delay:${delay()}s"><rect x="${r1(fx) + 0.5}" y="${FY + 0.5}" width="${r1(FW - 1)}" height="${FH - 1}" rx="9" fill="${c.card}" stroke="${c.line}"/>
<text x="${r1(fx + 14)}" y="${FY + 31}" fill="${c.ink}"><tspan font-size="25" font-weight="650" letter-spacing="-0.4">${esc(value)}</tspan><tspan dx="7" font-size="13" font-weight="600" fill="${c.ink2}">${esc(label)}</tspan></text>
<text x="${r1(fx + 14)}" y="${FY + 49}" font-size="11.5" fill="${c.muted}">${esc(sub)}</text>
<rect x="${r1(fx + 14)}" y="${FY + FH - 14}" width="${r1(bw)}" height="4" rx="2" fill="${c.track}"/><g class="grow">${bars}</g></g>`;
  };
  const { tests: t, verification: v, redteam: r } = f;
  const row2 = [
    fig(0, fmt(t.passed), "tests passing", `${t.failed} failed, ${t.skipped} skipped · test-summary.json`, [[t.passed, c.accent], [t.total - t.passed, c.track]]),
    fig(1, String(v.passed), "checks passed", `${v.failed} failed, ${v.couldNotRun} could not run · verify-all`, [[v.passed, c.accent], [v.couldNotRun, c.track]]),
    fig(2, `${r.stopped} of ${r.attempts}`, "attacks stopped", `${r.day} run, test world · ${r.caughtAfter} caught after`, [[r.stopped, c.accent], [r.caughtAfter, c.warn], [r.through, c.track]]),
  ].join("\n");

  // The brand: the site header's mark (docs/assets/brand/purser-mark.svg, drawn at 44 px), the name, what this is.
  const mark = `<g class="in" style="animation-delay:0s"><rect x="${M + 8}" y="${M + 12}" width="44" height="44" rx="13.2" fill="${c.markBg}"/>
<g transform="translate(${M + 8 + 10.27} ${M + 12 + 10.27}) scale(0.978)" fill="none" stroke="${c.markInk}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z"/><path d="M16 8 2 22"/><path d="M17.5 15H9"/></g>
<text x="${M + 8}" y="${M + 86}" font-size="19" font-weight="650" letter-spacing="-0.2" fill="${c.ink}">Purser</text>
<text x="${M + 8}" y="${M + 106}" font-size="11.5" fill="${c.ink2}">Proof from the records</text>
<text x="${M + 8}" y="${M + 122}" font-size="11.5" font-weight="600" fill="${c.warn}">Test money only</text></g>`;

  const desc = `${stripAlt(f)} ${f.redteam.through} attacks got through. Drawn from the records by scripts/readme-proof-strip.ts.`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">
<title id="t">Purser: proof from the records</title>
<desc id="d">${esc(desc)}</desc>
<style>
text{font-family:${SANS}}
.in{animation:in .5s cubic-bezier(.2,.7,.3,1) both}@keyframes in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.grow{transform-box:fill-box;transform-origin:left center;animation:grow .7s cubic-bezier(.2,.7,.3,1) 1.1s both}@keyframes grow{from{transform:scaleX(0)}to{transform:none}}
@media (prefers-reduced-motion:reduce){.in,.grow{animation:none}}
</style>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="14" fill="${c.bg}" stroke="${c.line}"/>
<line x1="${RX0 - 7.5}" y1="${M + 6}" x2="${RX0 - 7.5}" y2="${H - M - 6}" stroke="${c.line}"/>
${mark}
${row1}
${row2}
</svg>
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const f = stripFigures();
  for (const theme of ["light", "dark"] as const) writeFileSync(STRIP_FILES[theme], proofStripSvg(theme, f));
  console.log(`wrote ${STRIP_FILES.light} and ${STRIP_FILES.dark}`, f);
}
