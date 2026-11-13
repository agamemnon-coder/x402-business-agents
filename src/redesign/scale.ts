// The scale of what ran (the owner, 13 Nov: "looks nice but feels small; we have 6,000+ tests and many runs"): one band
// of big count-up figures at the top of /proof and in Home's "On record" section. Every figure is computed here, when
// the pages are built, from files in this repository; none is typed by hand. Each says what it counts and links to
// where it can be checked. Test money only: the sandbox, the testnet and the test card are said in the labels.
//
// 1. Tests passing: the last full run's summary (docs/assets/test-summary.json, written by `npm run readme-draft --
//    --tests <vitest json>`), with the commit it ran on.
// 2. Live runs: /runs' own count (src/redesign/runs.ts isLive: no rehearsal, control test or partial run).
// 3. Airwallex sandbox API calls: the sum of the call logs the run records keep (an endpoint's count, a log's total, a
//    purchase's own count); a record without a call log adds nothing, so this is a floor.
// 4. Metal testnet transactions: distinct transaction hashes linked to Metal's testnet explorer from the run records and
//    run logs (docs/runs, docs/demo).
// 5. Claude calls on record: distinct Anthropic request ids (req_011…) in the run and eval records under docs/.
// 6. Refusals on record: audit rows of a refusal, a decline, a rejection or a fraud stop in the run records, each row
//    counted once (by its hash, or its event, time and subject).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { liveRunCount } from "./runs.js";
import { REPO_BLOB } from "./metalStory.js";
import { esc, icon } from "./ui.js";

const ROOT = new URL("../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, ROOT), "utf8");
const json = (p: string): unknown => { try { return JSON.parse(read(p)); } catch { return null; } };
/** Every file under a folder of the repository, by its path from the root, whose name matches. */
function filesIn(dir: string, re: RegExp): string[] {
  let names: string[];
  try { names = readdirSync(new URL(`${dir}/`, ROOT)); } catch { return []; }
  return names.flatMap((n) => {
    const p = `${dir}/${n}`;
    return statSync(new URL(p, ROOT)).isDirectory() ? filesIn(p, re) : re.test(n) ? [p] : [];
  });
}
const RECORDS = () => [...filesIn("docs/runs", /\.json$/), ...filesIn("docs/demo", /\.json$/)];

export const TEST_SUMMARY = "docs/assets/test-summary.json";
export interface TestSummary { total: number; passed: number; failed: number; skipped: number; files: number; commit: string }

export function testSummary(): TestSummary | null {
  const s = json(TEST_SUMMARY) as Partial<TestSummary> | null;
  return s && Number.isSafeInteger(s.passed) && Number.isSafeInteger(s.total) && typeof s.commit === "string" ? (s as TestSummary) : null;
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0);
/** An endpoint of Airwallex's API, as the call logs write it ("POST /authentication/login", "/pa/{id}/{id}"). */
const AWX_ENDPOINT = /^(?:(?:GET|POST|PUT|DELETE|PATCH) )?\/(?:api\/v1\/)?(?:authentication|balances|issuing|webhooks|fx|transfers|batch_transfers|beneficiaries|financial_transactions|pa|accounts|account|conversions|deposits|simulation|global_accounts|payment_intents|connected_accounts|hosted_flows)\b/;

/** The Airwallex API calls one record's call logs hold: endpoint counts, a log's total, or each logged call. */
export function airwallexCallsIn(rec: unknown): number {
  if (!isRec(rec)) return 0;
  let n = 0;
  const calls = rec.calls;
  // awx-1's shape: { airwallex: [{ endpoint, calls }] }.
  if (isRec(calls) && Array.isArray(calls.airwallex)) n += calls.airwallex.reduce((k: number, c) => k + (isRec(c) && typeof c.endpoint === "string" && AWX_ENDPOINT.test(c.endpoint) ? num(c.calls) : 0), 0);
  // A logger's shape: { total, by_endpoint: [{ endpoint, calls }] }, counted by its Airwallex endpoints.
  else if (isRec(calls) && Array.isArray(calls.by_endpoint)) n += calls.by_endpoint.reduce((k: number, c) => k + (isRec(c) && typeof c.endpoint === "string" && AWX_ENDPOINT.test(c.endpoint) ? num(c.calls) : 0), 0);
  // A read-back's shape: [{ method, endpoint }], one line per call.
  else if (Array.isArray(calls)) n += calls.filter((c) => isRec(c) && typeof c.endpoint === "string" && AWX_ENDPOINT.test(`${typeof c.method === "string" ? `${c.method} ` : ""}${c.endpoint}`)).length;
  // The VIC runs' shape: each purchase with its own count, { calls: { airwallex } }.
  if (Array.isArray(rec.purchases)) n += rec.purchases.reduce((k: number, p) => k + (isRec(p) && isRec(p.calls) ? num(p.calls.airwallex) : 0), 0);
  return n;
}

const TX = /testnet\.metalntwx\.com\/tx\/(0x[0-9a-f]{64})/g;
const REQ = /\breq_011[A-Za-z0-9]{10,}/g;
const REFUSAL = /refus|declin|reject|fraud/;

export interface ScaleFigures {
  tests: TestSummary | null;
  liveRuns: number;
  airwallexCalls: { calls: number; records: number };
  metalTx: number;
  claudeCalls: number;
  refusals: number;
}

/** Every figure of the band, computed from the files now. */
export function scaleFigures(): ScaleFigures {
  const records = RECORDS();
  let calls = 0, callRecords = 0;
  for (const f of records) { const n = airwallexCallsIn(json(f)); if (n) { calls += n; callRecords++; } }
  const tx = new Set<string>();
  for (const f of [...records, ...filesIn("docs/runs", /\.md$/)]) for (const m of read(f).matchAll(TX)) tx.add(m[1]!);
  const req = new Set<string>();
  for (const f of filesIn("docs", /\.jsonl?$/)) for (const m of read(f).matchAll(REQ)) req.add(m[0]);
  const rows = new Set<string>();
  const walk = (o: unknown): void => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (!isRec(o)) return;
    if (typeof o.event === "string" && REFUSAL.test(o.event)) rows.add(typeof o.row_hash === "string" ? o.row_hash : JSON.stringify([o.event, o.ts ?? null, o.subject ?? null]));
    Object.values(o).forEach(walk);
  };
  for (const f of records) walk(json(f));
  return { tests: testSummary(), liveRuns: liveRunCount(), airwallexCalls: { calls, records: callRecords }, metalTx: tx.size, claudeCalls: req.size, refusals: rows.size };
}

/** A figure: its few words in sight, and in its link's title what exactly it counts and where. */
export interface ScaleStat { n: number; label: string; title: string; icon: string; href: string; external?: boolean; tone?: "ok" | "bad" }

const CI_URL = "https://github.com/agamemnon-coder/x402-business-agents/actions/workflows/ci.yml?query=branch%3Amain";

/** The band's figures, each with its words and its link; a figure whose source is missing drops out. */
export function scaleStats(f: ScaleFigures = scaleFigures()): ScaleStat[] {
  const out: ScaleStat[] = [];
  if (f.tests && f.tests.passed > 0) out.push({ n: f.tests.passed, label: "tests passing", title: `${fmt(f.tests.passed)} of ${fmt(f.tests.total)} tests passed in the last full run, on commit ${f.tests.commit} (${TEST_SUMMARY}); CI runs them on every push`, icon: "shield-check", href: CI_URL, external: true, tone: "ok" });
  if (f.liveRuns) out.push({ n: f.liveRuns, label: "sandbox and testnet runs", title: "Every run with the partners' sandboxes or Metal's testnet, each with its record; rehearsals, control tests and partial runs not counted", icon: "calendar-range", href: "runs" });
  if (f.airwallexCalls.calls) out.push({ n: f.airwallexCalls.calls, label: "Airwallex sandbox API calls logged", title: `Airwallex sandbox API calls in the call logs of ${f.airwallexCalls.records} run records; runs without a call log add none`, icon: "landmark", href: "airwallex" });
  if (f.metalTx) out.push({ n: f.metalTx, label: "Metal testnet transactions", title: "Distinct transactions linked to Metal's testnet explorer from the run records and run logs", icon: "link-2", href: "metal" });
  if (f.claudeCalls) out.push({ n: f.claudeCalls, label: "Claude calls with request ids", title: "Distinct Anthropic request ids in the run and eval records", icon: "bot", href: "claude" });
  if (f.refusals) out.push({ n: f.refusals, label: "refusals on record", title: "Audit rows of a refusal, a decline, a rejection or a fraud stop in the run records: over a limit, at the rail, on chain", icon: "ban", href: "proof#stops", tone: "bad" });
  return out;
}

/**
 * Home's "On record" band (judge panel, 13 Nov: six figures read as number soup): the three strongest, each with its
 * link: the tests CI runs, the live runs and the refusals on record. /proof's strip keeps every figure.
 */
const HOME_SCALE: readonly string[] = ["tests passing", "sandbox and testnet runs", "refusals on record"];
export const homeScaleStats = (stats: ScaleStat[] = scaleStats()): ScaleStat[] => stats.filter((s) => HOME_SCALE.includes(s.label));

const fmt = (n: number) => n.toLocaleString("en-GB");

/** The band: big figures that count up when in view (src/redesign/stats.ts COUNT_JS), each a link to its source. */
export function scaleBandHtml(stats: ScaleStat[] = scaleStats(), label = "What ran, in numbers", o: { strip?: boolean } = {}): string {
  if (!stats.length) return "";
  // /proof (the owner, 13 Nov: "enterprise level"): one metrics strip, a figure and its label per column, no icons.
  return `<ul class="scale"${o.strip ? ' data-look="strip"' : ""} aria-label="${esc(label)}">${stats.map((s) => `<li${s.tone ? ` class="${s.tone}"` : ""} data-rec="${esc(SCALE_SOURCES)}"><a href="${esc(s.href)}" title="${esc(s.title)}"${s.external ? ' target="_blank" rel="noopener"' : ""}>${o.strip ? "" : `<span class="sk-ic">${icon(s.icon, 18)}</span>`}<b><span data-count="${s.n}" data-dec="0">${esc(fmt(s.n))}</span></b><small>${esc(s.label)}${s.external ? " ↗" : ""}</small></a></li>`).join("")}</ul>`;
}

/** Where the band's figures come from, as the block names them (data-rec). */
export const SCALE_SOURCES = `${TEST_SUMMARY} docs/runs docs/demo docs/evals`;
export const SCALE_SOURCE_URL = `${REPO_BLOB}docs/runs`;

export const SCALE_CSS = `
ul.scale { list-style: none; margin: 12px 0 20px; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 760px) { ul.scale { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
ul.scale a { display: grid; grid-template-columns: auto 1fr; column-gap: 10px; row-gap: 2px; align-items: center; height: 100%; min-height: 44px; padding: 14px 16px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); color: inherit; text-decoration: none; }
ul.scale a:hover, ul.scale a:focus-visible { border-color: var(--accent); }
ul.scale .sk-ic { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
ul.scale li.ok .sk-ic { background: var(--ok-soft); color: var(--ok); } ul.scale li.bad .sk-ic { background: var(--bad-soft); color: var(--bad); }
ul.scale b { font-size: 30px; line-height: 1.05; font-weight: 780; letter-spacing: -.02em; font-variant-numeric: tabular-nums; white-space: nowrap; }
ul.scale small { grid-column: 1 / -1; margin-top: 6px; font-size: 13.5px; line-height: 1.35; color: var(--muted); }
@media (max-width: 420px) { ul.scale b { font-size: 26px; } ul.scale a { padding: 12px; } }
/* The strip (/proof): one bordered row of six equal columns, divided by hairlines; two columns of three on a phone. */
ul.scale[data-look="strip"] { grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 0; margin: 8px 0 28px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); overflow: hidden; }
ul.scale[data-look="strip"] li { border-left: 1px solid var(--border); }
ul.scale[data-look="strip"] li:first-child { border-left: 0; }
ul.scale[data-look="strip"] a { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; border: 0; border-radius: 0; background: none; padding: 18px 18px 16px; }
ul.scale[data-look="strip"] a:hover, ul.scale[data-look="strip"] a:focus-visible { background: var(--sunken); }
ul.scale[data-look="strip"] b { font-size: 28px; font-weight: 720; letter-spacing: -.02em; }
ul.scale[data-look="strip"] small { margin: 0; font-size: 13px; line-height: 1.35; }
@media (max-width: 900px) { ul.scale[data-look="strip"] { grid-template-columns: repeat(3, minmax(0, 1fr)); } ul.scale[data-look="strip"] li:nth-child(3n + 1) { border-left: 0; } ul.scale[data-look="strip"] li:nth-child(n + 4) { border-top: 1px solid var(--border); } }
@media (max-width: 560px) { ul.scale[data-look="strip"] { grid-template-columns: repeat(2, minmax(0, 1fr)); } ul.scale[data-look="strip"] li { border-left: 0; border-top: 1px solid var(--border); } ul.scale[data-look="strip"] li:nth-child(-n + 2) { border-top: 0; } ul.scale[data-look="strip"] li:nth-child(2n) { border-left: 1px solid var(--border); } ul.scale[data-look="strip"] a { padding: 14px 14px 12px; } ul.scale[data-look="strip"] b { font-size: 24px; } }
`;

/** Only for a note under the band: where to check each figure, in words. */
export const SCALE_NOTE = "Computed from the run records, the run logs and the last full test run when the site was built. Sandbox, testnet and test money only.";
