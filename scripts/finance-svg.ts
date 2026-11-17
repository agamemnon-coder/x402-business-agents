// "Purser for the finance team, at a glance": the animated picture at the top of docs/finance-value.md (17 Nov, owner:
// "the finance story with a strong visual and crisp numbers"). One SVG for both themes (prefers-color-scheme inside it),
// CSS animation only, played once and under 2 s, stopped by prefers-reduced-motion; no script, no external link, no web
// font, so GitHub shows it in an <img>. Every figure is read here from the record docs/finance-value.md cites:
//   wrong payments        docs/evals/worst-case-summary.json (the worst-case test, docs/worst-case-ai.md)
//   Claude per invoice    docs/runs/2026-11-13-books-month.json
//   month-end with T:0    docs/runs/2026-11-14-t0-readback.json and .md
//   passkey to PAID, fee  docs/runs/2026-11-07-awx-1.md (Face ID and PAID times, fees), docs/runs/2026-11-03-main-run.md
// Written by `npm run finance:svg`; test/finance-svg.test.ts redraws it, compares, and finds each figure in the page.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

export const FINANCE_SVG = "docs/assets/finance/at-a-glance.svg";
const read = (p: string) => readFileSync(p, "utf8");

export interface FinanceFigures {
  cases: number; wrongPurser: number; wrongNoRules: number; centRefused: boolean;
  monthInvoices: number; monthPaid: number; monthUsd: string; perInvoiceUsd: string;
  t0Entries: number; t0Accounts: number; t0Differences: number;
  faceIdToPaid: string[]; feesAwx: string[]; feeMain: string; feeCeiling: string;
}

const secs = (t: string) => { const [h, m, s] = t.split(":").map(Number) as [number, number, number]; return h * 3600 + m * 60 + s; };

export function financeFigures(): FinanceFigures {
  type Run = { wrong_payments: number };
  const worst = JSON.parse(read("docs/evals/worst-case-summary.json")) as {
    cases_per_run: number; purser_script: Record<string, Run>; no_rules: Record<string, Run>; cent_after_approval: { refused: boolean; by: string };
  };
  const noRules = [...new Set(Object.values(worst.no_rules).map((r) => r.wrong_payments))];
  if (noRules.length !== 1) throw new Error(`the no-rules payer's runs differ: ${noRules.join(", ")}`);
  const month = JSON.parse(read("docs/runs/2026-11-13-books-month.json")) as { claude: { spent_micros: number }; checks: { invoices: number; paid: number; balanced: boolean } };
  if (!month.checks.balanced) throw new Error("the month's books do not balance");
  const t0 = JSON.parse(read("docs/runs/2026-11-14-t0-readback.json")) as { close_check: { agrees: boolean; expected: number; matched: number; problems: unknown[] } };
  const t0md = /(\d+) accounts, (\d+) differences/.exec(read("docs/runs/2026-11-14-t0-readback.md"));
  if (!t0md || !t0.close_check.agrees || t0.close_check.matched !== t0.close_check.expected) throw new Error("the T:0 read-back does not agree");
  const awx = read("docs/runs/2026-11-07-awx-1.md");
  const face = /^\| Face ID \(Max\) \| ([\d:.]+) \| ([\d:.]+) \|$/m.exec(awx);
  const paid = /^\| Status, fee \| PAID ([\d:.]+), EUR ([\d.]+) \| PAID ([\d:.]+), EUR ([\d.]+) \|$/m.exec(awx);
  const main = /Fee EUR (\d+\.\d\d), ceiling (\d+\.\d\d)/.exec(read("docs/runs/2026-11-03-main-run.md"));
  if (!face || !paid || !main) throw new Error("awx-1 or the main run no longer has the rows this picture reads");
  const s = (a: string, b: string) => (secs(b) - secs(a)).toFixed(1);
  return {
    cases: worst.cases_per_run,
    wrongPurser: Math.max(...Object.values(worst.purser_script).map((r) => r.wrong_payments)),
    wrongNoRules: noRules[0]!,
    centRefused: worst.cent_after_approval.refused && /hash/.test(worst.cent_after_approval.by),
    monthInvoices: month.checks.invoices, monthPaid: month.checks.paid,
    monthUsd: (month.claude.spent_micros / 1e6).toFixed(2),
    perInvoiceUsd: (month.claude.spent_micros / 1e6 / month.checks.invoices).toFixed(2),
    t0Entries: t0.close_check.matched, t0Accounts: Number(t0md[1]), t0Differences: t0.close_check.problems.length,
    faceIdToPaid: [s(face[1]!, paid[1]!), s(face[2]!, paid[3]!)],
    feesAwx: [paid[2]!, paid[4]!], feeMain: main[1]!, feeCeiling: main[2]!,
  };
}

const SANS = `system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r1 = (n: number) => Math.round(n * 100) / 100;

// GitHub's own neutrals, so the picture sits on its page in either theme; one accent (blue), status green and red only
// with an icon and a word beside them.
const LIGHT = { bg: "#ffffff", card: "#f6f8fa", line: "#d1d9e0", ink: "#1f2328", ink2: "#59636e", muted: "#656d76", accent: "#0969da", track: "#dde3ea", neutral: "#6e7781", good: "#1a7f37", bad: "#cf222e", pill: "#fff8c5", pillInk: "#3b2300", pillLine: "#d4a72c" };
const DARK = { bg: "#0d1117", card: "#151b23", line: "#3d444d", ink: "#e6edf3", ink2: "#9198a1", muted: "#8b949e", accent: "#4493f8", track: "#262c36", neutral: "#8b949e", good: "#3fb950", bad: "#f85149", pill: "#2e2a1a", pillInk: "#e3b341", pillLine: "#6b5414" };
type Pal = typeof LIGHT;
const ROLES = Object.keys(LIGHT) as (keyof Pal)[];
const rules = (p: Pal) => ROLES.map((k) => `.f-${k}{fill:${p[k]}}.s-${k}{stroke:${p[k]}}`).join("");

const W = 960, M = 22, GAP = 16, TW = (W - 2 * M - 2 * GAP) / 3, TH = 186, TOP = 78;
const COL = (i: number) => M + (i % 3) * (TW + GAP), ROW = (i: number) => TOP + Math.floor(i / 3) * (TH + GAP);
const H = TOP + 2 * TH + GAP + 40;

const check = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="7" class="f-good"/><path d="M${x - 3.2} ${y + 0.2}l2.2 2.3 4.2-4.6" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
const cross = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="7" class="f-bad"/><path d="M${x - 2.6} ${y - 2.6}l5.2 5.2M${x + 2.6} ${y - 2.6}l-5.2 5.2" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>`;
const text = (x: number, y: number, cls: string, size: number, body: string, extra = "") => `<text x="${r1(x)}" y="${r1(y)}" class="${cls}" font-size="${size}"${extra}>${body}</text>`;

export function financeSvg(f = financeFigures()): string {
  const P = 20, IW = TW - 2 * P;
  const tile = (i: number, label: string, value: string, body: string, source: string) => {
    const x = COL(i), y = ROW(i);
    return `<g transform="translate(${r1(x)} ${y})"><g class="tile t${i}">
<rect x="0.5" y="0.5" width="${r1(TW - 1)}" height="${TH - 1}" rx="10" class="f-card s-line"/>
${text(P, 30, "f-ink2 b", 13.5, esc(label))}
${value}
${body}
${text(P, TH - 16, "f-muted", 11, esc(source))}
</g></g>`;
  };
  const big = (v: string, unit = "", after = "") => `<text x="${P}" y="80" class="f-ink v" font-size="44">${v}${unit ? `<tspan font-size="22" dx="6" class="f-ink2 u">${unit}</tspan>` : ""}${after}</text>`;
  const pre = (u: string, v: string) => `<text x="${P}" y="80" class="f-ink v" font-size="44"><tspan font-size="22" class="f-ink2 u">${u}</tspan><tspan dx="6">${v}</tspan></text>`;

  // 1. Wrong payments: the no-rules payer's bar, Purser's none.
  const barW = IW - 92;
  const t1 = tile(0, "Wrong payments, worst-case test", big(String(f.wrongPurser), "", `<tspan font-size="15" dx="10" class="f-ink2 u">vs ${f.wrongNoRules} for a payer with no rules</tspan>`),
    `${text(P, 112, "f-ink2", 12, "No rules")}<rect x="${P + 64}" y="103" width="${r1(barW)}" height="10" rx="3" class="f-neutral grow"/>${text(P + 64 + barW + 8, 112, "f-ink b", 12, String(f.wrongNoRules))}
${text(P, 134, "f-ink2", 12, "Purser")}<rect x="${P + 64}" y="125" width="2" height="10" rx="1" class="f-accent"/>${text(P + 72, 134, "f-ink b", 12, String(f.wrongPurser))}`,
    `${f.cases} test cases, offline · worst-case-ai.md`);

  // 2. Claude per invoice: the month's invoices as squares, paid filled, sent to a person outlined.
  const sq = 9.4, sg = (IW - f.monthInvoices * sq) / (f.monthInvoices - 1);
  const squares = Array.from({ length: f.monthInvoices }, (_, k) => k < f.monthPaid
    ? `<rect x="${r1(P + k * (sq + sg))}" y="104" width="${sq}" height="${sq}" rx="2" class="f-accent sq" style="animation-delay:${r1(0.55 + k * 0.035)}s"/>`
    : `<rect x="${r1(P + k * (sq + sg) + 0.75)}" y="104.75" width="${sq - 1.5}" height="${sq - 1.5}" rx="2" fill="none" class="s-accent sq" stroke-width="1.5" style="animation-delay:${r1(0.55 + k * 0.035)}s"/>`).join("");
  const t2 = tile(1, "Claude cost per invoice", pre("USD", f.perInvoiceUsd),
    `${squares}${text(P, 134, "f-ink2", 12, `${f.monthInvoices} test PDFs: ${f.monthPaid} paid, ${f.monthInvoices - f.monthPaid} sent to a person`)}${text(P, 151, "f-ink2", 12, `a month: USD ${f.monthUsd} in all, books balanced`)}`,
    "runs/2026-11-13-books-month.json");

  // 3. Month-end with T:0.
  const t3 = tile(2, "Month-end, checked against T:0", big(String(f.t0Entries), "journal entries"),
    `${check(P + 7, 109)}${text(P + 20, 114, "f-ink b", 14, `${f.t0Differences} differences`)}${text(P, 136, "f-ink2", 12, `${f.t0Accounts} accounts read back from T:0's ledger agree`)}${text(P, 153, "f-ink2", 12, "T:0's sandbox, read back on 14 Nov")}`,
    "runs/2026-11-14-t0-readback.md");

  // 4. Passkey to PAID: a line drawn from Face ID to PAID.
  const lx0 = P + 6, lx1 = P + IW - 6;
  const t4 = tile(3, "The CFO's passkey to PAID", big(f.faceIdToPaid[0]!, "s"),
    `<line x1="${lx0}" y1="108" x2="${lx1}" y2="108" class="s-track" stroke-width="2"/><line x1="${lx0}" y1="108" x2="${lx1}" y2="108" class="s-accent draw" stroke-width="2" pathLength="1" stroke-dasharray="1 1"/>
<circle cx="${lx0}" cy="108" r="5" class="f-accent"/><circle cx="${lx1}" cy="108" r="5" class="f-good pop"/>
${text(P, 129, "f-ink2", 12, "Face ID")}${text(P + IW, 129, "f-ink b", 12, "PAID", ` text-anchor="end"`)}${text(P, 151, "f-ink2", 12, `${f.faceIdToPaid[0]} s and ${f.faceIdToPaid[1]} s; settlement simulated`)}`,
    "Airwallex sandbox · runs/2026-11-07-awx-1.md");

  // 5. One cent changed: refused.
  const t5 = tile(4, "One cent changed after the CFO signs", big("1", "cent", `<tspan font-size="22" dx="10" class="f-bad u">→ refused</tspan>`),
    `${check(P + 7, 109)}${text(P + 20, 113, "f-ink2", 12, "CFO's passkey signs the terms' SHA-256")}
${cross(P + 7, 133)}${text(P + 20, 137, "f-ink2", 12, "Changed terms: hash no longer matches")}`,
    f.centRefused ? "worst-case test: refused on the signed hash" : "NOT REFUSED");

  // 6. SWIFT fee: a meter, the fee against the reserve.
  const ceil = Number(f.feeCeiling), fee = Number(f.feesAwx[0]), mw = IW;
  const t6 = tile(5, "SWIFT fee, Airwallex sandbox", pre("EUR", f.feesAwx[0]!),
    `<rect x="${P}" y="102" width="${mw}" height="8" rx="4" class="f-track"/><rect x="${P}" y="102" width="${r1((fee / ceil) * mw)}" height="8" rx="4" class="f-accent grow"/>
${text(P, 128, "f-ink2", 12, `known after sending; EUR ${f.feeCeiling} reserved`)}${text(P, 148, "f-ink2", 12, `EUR ${f.feeMain} on 3 Nov, ${f.feesAwx[0]} twice on 7 Nov`)}`,
    "runs/2026-11-03-main-run.md, awx-1");

  const desc = `Six figures from Purser's records, test money in sandboxes. Wrong payments in the worst-case test: ${f.wrongPurser}, against ${f.wrongNoRules} for a payer with no rules, over ${f.cases} test cases. Claude's cost per invoice: about USD ${f.perInvoiceUsd}, a month of ${f.monthInvoices} test PDFs costing USD ${f.monthUsd} in all. Month-end: ${f.t0Entries} journal entries read back from T:0's sandbox ledger, ${f.t0Accounts} accounts, ${f.t0Differences} differences. From the CFO's passkey (Face ID) to PAID: ${f.faceIdToPaid[0]} s and ${f.faceIdToPaid[1]} s in the Airwallex sandbox, settlement simulated. One cent changed after the CFO signs: refused on the signed hash. SWIFT fee in the Airwallex sandbox: EUR ${f.feeMain} on 3 November, EUR ${f.feesAwx[0]} twice on 7 November; known only after sending, so EUR ${f.feeCeiling} is reserved.`;
  const pillW = 148;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">
<title id="t">Purser for the finance team, at a glance</title>
<desc id="d">${esc(desc)}</desc>
<style>
text{font-family:${SANS}}.b{font-weight:600}.v{font-weight:650;letter-spacing:-0.02em}.u{font-weight:500;letter-spacing:0}
${rules(LIGHT)}
@media (prefers-color-scheme:dark){${rules(DARK)}}
.tile{animation:in .55s cubic-bezier(.2,.7,.3,1) both}
${[0, 1, 2, 3, 4, 5].map((i) => `.t${i}{animation-delay:${r1(0.05 + i * 0.1)}s}`).join("")}
@keyframes in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.grow{transform-box:fill-box;transform-origin:left center;animation:grow .9s cubic-bezier(.2,.7,.3,1) .6s both}
@keyframes grow{from{transform:scaleX(0)}to{transform:none}}
.sq{animation:sq .3s ease-out both}@keyframes sq{from{opacity:0}to{opacity:1}}
.draw{stroke-dashoffset:1;animation:draw .8s ease-in-out .75s forwards}@keyframes draw{to{stroke-dashoffset:0}}
.pop{transform-box:fill-box;transform-origin:center;animation:pop .3s ease-out 1.5s both}@keyframes pop{from{opacity:0;transform:scale(.4)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.tile,.grow,.sq,.draw,.pop{animation:none}.draw{stroke-dashoffset:0}}
</style>
<rect width="${W}" height="${H}" rx="12" class="f-bg"/>
${text(M, 38, "f-ink b", 22, "Purser for the finance team, at a glance")}
${text(M, 62, "f-ink2", 13.5, "Supplier invoices in; checked, paid inside the CFO's limits, booked. Each figure from its record.")}
<rect x="${W - M - pillW + 0.5}" y="20.5" width="${pillW - 1}" height="25" rx="12.5" class="f-pill s-pillLine"/>
${text(W - M - pillW / 2, 37.5, "f-pillInk b", 12, "Test money · sandbox", ` text-anchor="middle"`)}
${[t1, t2, t3, t4, t5, t6].join("\n")}
${text(M, H - 15, "f-muted", 11, "Drawn from docs/evals and docs/runs by scripts/finance-svg.ts · test data, no real money moved")}
</svg>
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const svg = financeSvg();
  mkdirSync("docs/assets/finance", { recursive: true });
  writeFileSync(FINANCE_SVG, svg);
  console.log(`wrote ${FINANCE_SVG} (${Buffer.byteLength(svg)} bytes)`, financeFigures());
}
