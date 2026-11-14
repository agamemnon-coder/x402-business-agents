// /metal as one honest story, with pictures first (owner, 13 Nov: "people need to know where to look"; jury panel, 12 Nov:
// every on-chain sentence matches the transaction beside it). On top, one picture: the Sourcing agent, its mandate on
// chain, Alta's check, then two paths, each a real payment of the main run: #23 paid within the cap and #24 refused on
// chain over it. Then the charts: budget and spend per mandate on one scale, the 86 payments by kind in one stacked bar,
// and the refusals as a moment. Then the four mandates as cards (cap, budget spent, expiry), the spend read live from
// Alta testnet by the read-only inspector (worker/src/metalInspector.ts) or labelled as the check of 12 November, with
// the full table behind "Details: every mandate". Then the replace after Face ID in three steps (who signed on chain:
// one owner key held by the runner, the chain did not check Face ID), and the folds: what else ran on Alta, each dated,
// both refusals decoded, the main run's proof. Every figure, hash and address is read here from the records (the main
// run's record and trace, the check of 12 November, the separate runs' records), never typed in.

import { ownersRun } from "./metalOnchain.js";
import { readFileSync } from "node:fs";
import { INSPECTOR_DAILY_CEILING, INSPECTOR_TTL_SECONDS, METAL_INSPECTOR_PATH, metalRecordedOf, type MetalRecorded } from "../../worker/src/metalInspector.js";
import { EXPLORER, MAIN_RUN_CHECK, REPO_BLOB, metalStory, refusalNote, separateRuns, type MetalStory } from "./metalStory.js";
import type { RunRecord } from "./run.js";
import { esc, icon } from "./ui.js";

/** The read-only check of 12 November: its read, the two refusals decoded, and two mandates' terms from their events. */
export const METAL_INSPECTOR_RECORD = "docs/runs/2026-11-12-metal-inspector.json";
export const METAL_INSPECTOR_LOG = "docs/runs/2026-11-12-metal-inspector.md";
/** The hold for an approved amount (payment from reserved funds): the live run stopped before its capture. */
export const METAL_HOLD_RECORD = "docs/runs/2026-11-10-metal-extra.md";
export const MAIN_RUN_TRACE = "docs/demo/main-run-trace.json";
/** Where the inspector answers on the hosted site. */
export const INSPECTOR_URL = `https://kit11.max-31b.workers.dev${METAL_INSPECTOR_PATH}`;
/** The words that tell the hold is not finished: wherever the hold is mentioned while its record says so, these come with it. */
export const HOLD_NOT_FINISHED = "Holds: not finished; one hold placed on testnet on 10 Nov, its capture not sent";

/** The hold's state as its record tells it: placed on 10 Nov, and finished (captured) on a later day, or not. */
export function holdState(md: string): { finished: false } | { finished: true; day: string; capture: string } | null {
  const done = /## Finished on (\d{1,2}) (\w{3})\w* \d{4}/.exec(md), capture = /- captureHold: `(0x[0-9a-f]{64})`/.exec(md);
  if (done && capture && /`heldBalanceOf\(holder, spender\)` after \| 0 \|/.test(md)) return { finished: true, day: `${done[1]} ${done[2]}`, capture: capture[1]! };
  return /stopped at its budget/.test(md) && /`captureHold`[^|]*\|\s*not sent/.test(md) ? { finished: false } : null;
}

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const tx = (h: string) => `${EXPLORER}/tx/${h}`;
const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));
const AGENT = (a: string) => `${a[0]!.toUpperCase()}${a.slice(1)}`;
const a = (href: string, text: string, cls = "pf") => `<a class="${cls}" href="${esc(href)}"${/^https?:/.test(href) ? ' target="_blank" rel="noopener"' : ""}>${esc(text)}${/^https?:/.test(href) ? " ↗" : ""}</a>`;

interface TraceMandate { event: "mandate.bound" | "mandate.replaced"; agent: string; cap: string; budget: string; tx: string; proposal_id: string | null }
interface Budget { agent: string; payee: string; cap: string; budget: string; spent: string; expires_on: string }
export interface MandateRow {
  agent: string; whose: "business" | "customer";
  /** The terms in force at the end of the run, and the transaction that set them (a bind, or the replace after the CFO's change). */
  cap: string; budget: string; payee: string; expires: string; tx: string; how: "bind" | "replace";
  /** The first bind, when the mandate was replaced. */
  first: { cap: string; budget: string; tx: string } | null;
  /** The spend the main run recorded (3 Nov). */
  spent: string;
}

/** The four mandates of the main run, from its trace (binds and replaces) and its record (payee, expiry, spend). */
export function mandateRows(record: RunRecord, trace: { mandates: TraceMandate[] }): MandateRow[] {
  const s = record.snapshot as unknown as { budgets: { agents: Budget[]; counterparty?: Budget } };
  const budgets = [...s.budgets.agents, ...(s.budgets.counterparty ? [s.budgets.counterparty] : [])];
  return budgets.flatMap((b): MandateRow[] => {
    const events = trace.mandates.filter((m) => m.agent === b.agent);
    const last = events.at(-1), first = events.find((m) => m.event === "mandate.bound");
    if (!last || !first) return [];
    return [{
      agent: b.agent, whose: b.agent === "customer" ? "customer" : "business",
      cap: last.cap, budget: last.budget, payee: b.payee, expires: b.expires_on, tx: last.tx, how: last.event === "mandate.replaced" ? "replace" : "bind",
      first: last.event === "mandate.replaced" ? { cap: first.cap, budget: first.budget, tx: first.tx } : null, spent: b.spent,
    }];
  });
}

export interface DecodedRefusal {
  run: string; purchase: string | null; tx: string; block: number; block_time: string; account: string;
  event: { name: string; arg_names: string[]; arg_values: (string | number)[]; mandate: string; payee: string; amount: string; reason: number; reason_name: string };
  raw_log: { address: string; topics: string[]; data: string };
}
export interface InspectorRecord {
  abi: { mandates: string; mandates_selector: string; MandateRefused: string; topic0: Record<string, string>; reasons: string[] };
  refusals: DecodedRefusal[];
  bindings: { agent: string; kind: string; tx: string; terms: { per_payment_cap: string; budget: string; expiry_iso: string; payee: { account: string; name: string }; asset_name: string } }[];
}
export const inspectorRecord = (): InspectorRecord & { recorded: MetalRecorded | null } => {
  const j = JSON.parse(read(METAL_INSPECTOR_RECORD)) as InspectorRecord;
  return { ...j, recorded: metalRecordedOf(j) };
};

export interface CoverageRow { feature: string; when: string; link: { label: string; href: string } | null; status: "done" | "not finished"; note: string }
/**
 * What else ran on Alta, beyond the main run, each a separate run with its date and its record (src/redesign/metalStory.ts
 * SEPARATE_RUNS), and the hold, which is not finished (its record says the live run stopped at its budget).
 */
export function coverageRows(): CoverageRow[] {
  const runs = separateRuns(), by = (id: string) => runs.find((r) => r.id === id);
  const row = (id: string, feature: string, note: string): CoverageRow[] => {
    const r = by(id);
    return r ? [{ feature, when: day(r.date), link: { label: r.proofs.length ? "tx" : "record", href: r.proofs.find((p) => /: (paid|done)|held|returned|deposit/.test(p.label))?.href ?? r.proofs[0]?.href ?? r.record.href ?? "" }, status: "done", note }] : [];
  };
  const hold = holdState(read(METAL_HOLD_RECORD));
  return [
    ...row("four-eyes", "Two owners, both must sign", "paid with both signatures; one alone reverted"),
    ...row("passkey-owners", "Passkeys as the owners", "software passkeys, not a phone"),
    ...row("receive", "Money from strangers held", "held by Alta, then returned"),
    ...row("clearing", "Clearing", "one deposit, then each query paid by a signed receipt"),
    ...row("compliance", "Send policy", "Purser's own contract, not Alta's"),
    ...(hold?.finished ? [{ feature: "Hold for an approved amount", when: "10 Nov", link: { label: "tx", href: tx(hold.capture) }, status: "done" as const, note: `held, then captured to the supplier on ${hold.day}` }]
      : hold ? [{ feature: "Hold for an approved amount", when: "10 Nov", link: { label: "record", href: `${REPO_BLOB}${METAL_HOLD_RECORD}` }, status: "not finished" as const, note: "hold placed on testnet; its capture not sent" }] : []),
  ];
}

/** Who signed the mandate changes on chain in the main run: the ledger's actor of each replace, and the key that sent it. */
export function replaceSigner(record: RunRecord): { actor: string; count: number } | null {
  const rows = record.ledger?.events.filter((e) => e.event === "mandate.replaced") ?? [];
  const actors = [...new Set(rows.map((e) => (e as unknown as { actor: string }).actor))];
  return rows.length && actors.length === 1 ? { actor: actors[0]!, count: rows.length } : null;
}

const MT_CSS = `.mt { padding: 16px 18px 6px; display: grid; gap: 8px; }
.mt h2, .mc h2 { font-size: 19px; line-height: 1.25; letter-spacing: -.01em; margin: 0; }
.mtab { width: 100%; border-collapse: collapse; font-size: 15px; font-variant-numeric: tabular-nums; }
.mtab th, .mtab td { text-align: left; padding: 8px 8px 8px 0; border-top: 1px solid var(--border); vertical-align: top; }
.mtab thead th { border-top: 0; font-size: 13.5px; font-weight: 650; color: var(--muted); }
.mtab td a.pf, .mcov td a.pf { display: inline-flex; align-items: center; min-height: 44px; }
.mtab .sub { display: block; font-size: 13.5px; color: var(--muted); }
.mnote { margin: 0; font-size: 14.5px; color: var(--muted); line-height: 1.45; }
.mnote b { color: var(--text); }
.mc { padding: 16px 18px; display: grid; gap: 6px; align-content: start; }
.mc p { margin: 0; font-size: 15.5px; line-height: 1.5; }
.mc .tx2 { display: flex; flex-wrap: wrap; gap: 0 14px; }
.mc .tx2 a.pf { display: inline-flex; align-items: center; min-height: 44px; }
.mgrid { display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 800px) { .mgrid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.mcov { width: 100%; border-collapse: collapse; font-size: 15px; }
.mcov th, .mcov td { text-align: left; padding: 6px 8px 6px 0; border-top: 1px solid var(--border); vertical-align: top; }
.mcov .nf { color: var(--bad); font-weight: 650; }
pre.mcmd { margin: 4px 0 8px; padding: 10px 12px; background: var(--sunken); border-radius: 10px; font: 600 13px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
dl.mev { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 2px 12px; margin: 4px 0 10px; font-size: 14px; }
dl.mev dt { color: var(--muted); } dl.mev dd { margin: 0; font: 600 13px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
.mnote, .mc p, .mtab td, .mcov th, .mcov td { overflow-wrap: anywhere; }
/* Tap targets (jury panel, 12 Nov): on a phone every link and fold header in the page is at least 44 px high. A link
   is a 44 px box in its line, so the line grows with it and no link's area covers the one above or below. */
@media (max-width: 700px) { .mtp a.pf { display: inline-flex; align-items: center; min-height: 44px; max-width: 100%; vertical-align: middle; } .mtp a.open { min-height: 44px; } }
@media (max-width: 700px) {
  .mtab thead { display: none; }
  .mtab tr { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 10px; border-top: 1px solid var(--border); padding: 8px 0; }
  .mtab th, .mtab td { border-top: 0; padding: 2px 0; }
  .mtab th[scope=row] { grid-column: 1 / -1; font-size: 16px; }
  .mtab td::before { content: attr(data-l); display: block; font-size: 12.5px; color: var(--muted); font-weight: 600; }
  .mcov thead { display: none; }
  .mcov tr { display: grid; grid-template-columns: minmax(0, 1fr) auto; border-top: 1px solid var(--border); padding: 4px 0; }
  .mcov th, .mcov td { border-top: 0; padding: 2px 8px 2px 0; }
  .mcov td.n { grid-column: 1 / -1; }
}`;
/**
 * The page's charts and cards (owner, 13 Nov: "people need to know where to look"). Colours follow the agent who pays,
 * the same in every chart: the reference categorical slots 1 to 4 (blue, orange, aqua, yellow), validated with the
 * dataviz skill's script on this site's card surfaces, light #ffffff and dark #12151d, in the stacked bar's order
 * (sales, purchases, refunds, sweep: every adjacent pair passes; yellow and orange are never adjacent). Light yellow and
 * aqua sit under 3:1 on white, so every mark carries a visible label beside it and the table is one fold away. No text
 * wears a series colour. No inline style anywhere (the page's CSP allows its one <style> block by hash): a bar's length
 * is an SVG attribute, its colour a class.
 */
const VIZ_CSS = `.mtp { --c-sourcing: #2a78d6; --c-support: #eb6834; --c-treasury: #1baf7a; --c-customer: #eda100; --c-track: var(--sunken); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .mtp { --c-sourcing: #3987e5; --c-support: #d95926; --c-treasury: #199e70; --c-customer: #c98500; } }
:root[data-theme="dark"] .mtp { --c-sourcing: #3987e5; --c-support: #d95926; --c-treasury: #199e70; --c-customer: #c98500; }
.mtp .f-sourcing { fill: var(--c-sourcing); } .mtp .f-support { fill: var(--c-support); } .mtp .f-treasury { fill: var(--c-treasury); } .mtp .f-customer { fill: var(--c-customer); } .mtp .f-track { fill: var(--c-track); }
.mtp .d-sourcing { background: var(--c-sourcing); } .mtp .d-support { background: var(--c-support); } .mtp .d-treasury { background: var(--c-treasury); } .mtp .d-customer { background: var(--c-customer); }
.mtp .dot { display: inline-block; width: 10px; height: 10px; border-radius: 3px; flex: none; }
.mtp h2.mh { font-size: 19px; line-height: 1.25; letter-spacing: -.01em; margin: 0; }
.mtp .msub { margin: 0; font-size: 15px; color: var(--muted); line-height: 1.45; }
/* The hero: the story in one picture. An agent, its mandate on chain, Alta's check, then two paths: paid, and refused. */
.mhero { padding: 18px; display: grid; gap: 14px; }
.mflow { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; grid-template-columns: minmax(0, 1fr); }
.mflow > li { position: relative; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 10px; align-items: start; padding: 12px 14px; border-radius: 16px; background: var(--sunken); }
.mflow > li .ic { grid-row: span 2; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 11px; background: var(--metal-soft); color: var(--metal); }
.mflow > li b { font-size: 16px; } .mflow > li small { font-size: 14.5px; color: var(--muted); line-height: 1.4; }
.mflow > li:not(:last-child)::after { content: ""; position: absolute; left: 31px; bottom: -9px; width: 2px; height: 10px; background: var(--border); }
.mpaths { display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr); }
.mpath { border-radius: 16px; padding: 12px 14px; display: grid; gap: 4px; border: 2px solid transparent; }
.mpath.ok { background: var(--ok-soft); border-color: var(--ok); } .mpath.bad { background: var(--bad-soft); border-color: var(--bad); }
.mpath .tag { display: inline-flex; align-items: center; gap: 6px; font-weight: 750; font-size: 15px; }
.mpath.ok .tag { color: var(--ok); } .mpath.bad .tag { color: var(--bad); }
.mpath .big { font-size: 22px; font-weight: 780; letter-spacing: -.01em; font-variant-numeric: tabular-nums; }
.mpath p { margin: 0; font-size: 15px; line-height: 1.45; }
@media (min-width: 800px) {
  .mflow { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .mflow > li:not(:last-child)::after { left: auto; right: -9px; top: 50%; bottom: auto; width: 10px; height: 2px; }
  .mpaths { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
/* The charts. */
.mcharts { display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 900px) { .mcharts { grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); } .mcharts .mmoment { grid-column: 1 / -1; } }
.mchart { padding: 16px 18px; display: grid; gap: 10px; align-content: start; }
.mbars { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.mbars li { display: grid; gap: 4px; }
.mbars .row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; font-size: 15px; }
.mbars .row b { display: inline-flex; align-items: center; gap: 7px; } .mbars .row span { color: var(--muted); font-variant-numeric: tabular-nums; }
.mtp svg.bar { display: block; width: 100%; height: 14px; }
.mtp svg.stack { display: block; width: 100%; height: 30px; }
.mlegend { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px 14px; grid-template-columns: repeat(2, minmax(0, 1fr)); font-size: 15px; }
.mlegend li { display: flex; align-items: center; gap: 8px; } .mlegend b { font-size: 20px; font-variant-numeric: tabular-nums; min-width: 2ch; }
.mmoment { padding: 16px 18px; display: grid; gap: 10px; border: 2px solid var(--bad); background: linear-gradient(var(--bad-soft), var(--surface)); }
.mmoment .hd { display: flex; align-items: center; gap: 10px; color: var(--bad); font-weight: 780; font-size: 15px; text-transform: uppercase; letter-spacing: .04em; }
.mmoment .mm { display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 800px) { .mmoment .mm { grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); } }
.mmoment .one { display: grid; gap: 4px; padding: 12px 14px; border-radius: 14px; background: var(--surface); border: 1px solid var(--border); }
.mmoment .one .big { font-size: 26px; font-weight: 800; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.mmoment .one .big s { color: var(--muted); font-weight: 650; text-decoration: none; }
.mmoment .one p { margin: 0; font-size: 15px; line-height: 1.45; }
/* The mandate cards. */
.mmand { padding: 16px 18px; display: grid; gap: 10px; }
.mcards { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 560px) { .mcards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (min-width: 1000px) { .mcards { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
.mcards > li { border: 1px solid var(--border); border-radius: 16px; padding: 12px 14px; display: grid; gap: 6px; align-content: start; }
.mcards .nm { display: flex; align-items: center; gap: 8px; font-weight: 720; font-size: 16.5px; }
.mcards .kv { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0 10px; margin: 0; font-size: 15px; }
.mcards .kv dt { color: var(--muted); } .mcards .kv dd { margin: 0; font-variant-numeric: tabular-nums; }
.mcards .spent { font-size: 15px; font-variant-numeric: tabular-nums; } .mcards .spent b { font-size: 19px; }
.mcards .spent .sub { color: var(--muted); }
/* Mandates replaced after Face ID: three steps. */
.mrep { padding: 16px 18px; display: grid; gap: 10px; }
.msteps { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr); counter-reset: s; }
@media (min-width: 800px) { .msteps { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.msteps > li { counter-increment: s; border-radius: 16px; padding: 12px 14px; background: var(--sunken); display: grid; gap: 4px; align-content: start; }
.msteps > li.no { background: var(--bad-soft); }
.msteps > li .st { display: flex; align-items: center; gap: 8px; font-weight: 720; font-size: 16px; }
.msteps > li .st::before { content: counter(s); display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--surface); border: 1px solid var(--border); font-size: 13.5px; font-weight: 750; flex: none; }
.msteps > li p { margin: 0; font-size: 15px; line-height: 1.45; }
.msteps .tx2 { display: flex; flex-wrap: wrap; gap: 0 14px; }
.mtp .mchart p, .mtp .mrep p, .mtp .mhero p, .mtp .mmand p, .mcards dd { overflow-wrap: anywhere; }`;
/**
 * What the separate Face ID on chain run showed, and no more (the final review, 13 Nov: "Since 12 Nov it does"
 * overstated it; the main run's mandates are still owned by the runner's key).
 */
export const FACEID_SEPARATE_RUN = "In a separate 12 Nov run, a passkey account checked both passkeys on chain (the second a labelled test passkey).";
export const METAL_CSS = `${MT_CSS}\n${VIZ_CSS}`;

/**
 * The page's one script: the live read replaces the recorded spend only when the chain answered, and only then shows
 * the live wording ("one read for everyone every 15 minutes"); otherwise the page keeps saying it is a recorded snapshot.
 * Every place that shows an agent's spend (its card, its bar, the table) is updated; a bar's length is an attribute.
 */
export const METAL_INSPECT_JS = `(function () {
  var label = document.getElementById("mlive"), why = document.getElementById("mlive-why");
  if (!label || !window.fetch) return;
  var all = function (sel) { return [].slice.call(document.querySelectorAll(sel)); };
  fetch("${METAL_INSPECTOR_PATH.slice(1)}", { headers: { accept: "application/json" } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (a) {
    if (!a || !a.mandates) return;
    if (a.source === "chain" && typeof a.block === "number" && /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}/.test(a.read_at)) {
      a.mandates.forEach(function (m) {
        var spent = Number(m.spent);
        all('[data-spent="' + m.agent + '"]').forEach(function (c) { c.textContent = m.spent; });
        all('[data-revoked="' + m.agent + '"]').forEach(function (v) { v.textContent = m.revoked ? "yes" : "no"; });
        all('[data-pays="' + m.agent + '"]').forEach(function (p) { p.textContent = m.payments + (m.payments === 1 ? " payment" : " payments"); });
        all('rect[data-fill="' + m.agent + '"]').forEach(function (r) {
          var max = Number(r.getAttribute("data-max")), w = Number(r.getAttribute("data-w"));
          if (spent >= 0 && max > 0 && w > 0) r.setAttribute("width", String(Math.min(1, spent / max) * w));
        });
      });
      label.textContent = "Spent: read live from Alta testnet at " + a.read_at.slice(11, 16) + " UTC, block " + a.block + ".";
      if (why) why.textContent = "";
      // The live wording only once a live read succeeded (the final review, 13 Nov).
      var how = document.getElementById("mlive-how"), rec = document.getElementById("mlive-rec");
      if (how) how.hidden = false;
      if (rec) rec.hidden = true;
    }
  }).catch(function () {});
})();`;

export interface MetalBody { logo: string; label: string; folds: string; proofHash: string; /** Blocks of other runs shown under the folds (the invoice-token run, when its record exists). */ after?: string }

/** A paid Alta payment from the main run's trace: the kind, its number, its amount and its transaction. */
interface TracePayment { kind: string; ref: string; amount: string; rail: string; rail_id: string | null; origin?: { agent?: string } }

/**
 * The green path's example: the Sourcing agent's last purchase paid under the same mandate just before the refusal (the
 * trace's payment numbered one below the refusal), so both paths are the same agent, the same mandate, the same cap.
 */
export function paidBefore(trace: { payments: TracePayment[] }, seq: string): { ref: string; amount: string; tx: string } | null {
  const want = String(Number(seq) - 1);
  const p = trace.payments.find((x) => x.rail === "metal" && x.kind === "purchase" && x.ref === want && typeof x.rail_id === "string" && /^0x[0-9a-f]{64}$/.test(x.rail_id));
  return p ? { ref: p.ref, amount: p.amount, tx: p.rail_id! } : null;
}

const cents = (s: string) => Math.round(Number(s) * 100);
/** A horizontal bar in a 1000-unit viewBox: the track (the budget) and the fill (the spend), both on one shared scale. */
function barSvg(agent: string, cls: string, budget: string, spent: string, max: string, title: string): string {
  const W = 1000, track = Math.max(2, (cents(budget) / cents(max)) * W), fill = Math.min(track, (cents(spent) / cents(max)) * W);
  return `<svg class="bar" viewBox="0 0 ${W} 14" preserveAspectRatio="none" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><rect class="f-track" x="0" y="0" width="${track.toFixed(1)}" height="14" rx="3"/><rect class="f-${cls}" data-fill="${esc(agent)}" data-max="${esc(max)}" data-w="${W}" x="0" y="0" width="${fill.toFixed(1)}" height="14" rx="3"/></svg>`;
}

/** The body of /metal: the story in one picture, its charts, the mandate cards (the table folded), the replace, the folds. */
export function metalBody(record: RunRecord, o: MetalBody): string {
  const traceAll = JSON.parse(read(MAIN_RUN_TRACE)) as { mandates: TraceMandate[]; payments: TracePayment[] };
  const trace = traceAll;
  const rows = mandateRows(record, trace), insp = inspectorRecord(), live = insp.recorded, st: MetalStory = metalStory(record);
  const liveOf = (agent: string) => live?.mandates.find((m) => m.agent === agent);
  const name = (r: MandateRow) => r.whose === "customer" ? "Customer's agent" : AGENT(r.agent);
  const spentOf = (r: MandateRow) => liveOf(r.agent)?.spent ?? r.spent;
  const r = st.refusal, sourcing = rows.find((x) => x.agent === "sourcing"), green = r ? paidBefore(traceAll, r.seq) : null;

  // 1. The hero: agent → its mandate on chain → Alta checks → paid (green) or refused (red), both under the mandate
  // in force at #24: the Sourcing agent's first bind (the replace after Face ID came later, step 4).
  const atTheTime = sourcing?.first ?? (sourcing ? { cap: sourcing.cap, budget: sourcing.budget, tx: sourcing.tx } : null);
  const hero = r && sourcing && atTheTime ? `<section class="mhero card" id="mstory" aria-labelledby="mh-h"><h2 class="mh" id="mh-h">${esc("Each payment, checked on chain")}</h2>
<ol class="mflow" aria-label="${esc("From the agent to the chain, step by step")}">
<li><span class="ic">${icon("bot", 20)}</span><b>${esc("Sourcing agent")}</b><small>${esc(`pays ${sourcing.payee} per stock check, over x402`)}</small></li>
<li><span class="ic">${icon("link-2", 20)}</span><b>${esc("Its mandate, on chain")}</b><small>${esc(`cap ${atTheTime.cap} a payment · budget ${atTheTime.budget} · payee ${sourcing.payee} `)}${a(tx(atTheTime.tx), "bind")}</small></li>
<li><span class="ic">${icon("shield-check", 20)}</span><b>${esc("Alta checks each payment")}</b><small>${esc("against cap, budget, payee and expiry")}</small></li>
</ol>
<div class="mpaths">
${green ? `<div class="mpath ok"><span class="tag">${icon("circle-check", 18)}${esc("Within the cap: paid")}</span><span class="big">${esc(`#${green.ref} · ${green.amount} *USDZ`)}</span><p>${esc(`Under the ${atTheTime.cap} cap.`)} ${a(tx(green.tx), `tx ${short(green.tx)}`)}</p></div>` : ""}
<div class="mpath bad"><span class="tag">${icon("ban", 18)}${esc("Over the cap: refused on chain")}</span><span class="big">${esc(`#${r.seq} · ${r.amount} *USDZ`)}</span><p>${esc(`Over the ${r.cap} cap: MandateRefused on chain, nothing moved.`)} ${a(r.proof.href!, `tx ${short(r.proof.href!.split("/").pop()!)}`)}</p></div>
</div></section>` : "";

  // 2. The charts. (a) Budget and spend per mandate, one shared *USDZ scale (the largest budget). (b) The payments by
  // kind, one stacked bar. (c) The refusals, as a moment.
  const max = rows.reduce((m, x) => (cents(x.budget) > cents(m) ? x.budget : m), "0.00");
  const budgetChart = `<section class="mchart card" aria-labelledby="mb-h"><h2 class="mh" id="mb-h">${esc("Budget and spend, per mandate")}</h2><p class="msub">${esc("One scale, in *USDZ.")}</p>
<ul class="mbars">${rows.map((x) => `<li><span class="row"><b><span class="dot d-${esc(x.agent)}"></span>${esc(name(x))}</b><span>${esc("spent ")}<span data-spent="${esc(x.agent)}">${esc(spentOf(x))}</span>${esc(` of ${x.budget} · cap ${x.cap}`)}</span></span>${barSvg(x.agent, x.agent, x.budget, spentOf(x), max, `${name(x)}: spent ${spentOf(x)} of a ${x.budget} budget, cap ${x.cap} a payment`)}</li>`).join("")}</ul></section>`;

  const p = st.payments;
  const kinds = [
    // Coloured by the agent who pays: the customer's agent (sales), Sourcing, Support, Treasury.
    { n: p.sales, label: "sales", cls: "customer" },
    { n: p.purchases, label: "supplier purchases", cls: "sourcing" },
    { n: p.refunds, label: "refunds", cls: "support" },
    { n: p.sweeps, label: "sweep", cls: "treasury" },
  ].filter((k) => k.n > 0);
  const W = 1000, GAP = 4, usable = W - GAP * (kinds.length - 1);
  let x0 = 0;
  const segs = kinds.map((k) => {
    const w = Math.max(6, (k.n / p.total) * usable), s = `<rect class="f-${k.cls}" x="${x0.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="30" rx="3"><title>${esc(`${k.n} ${k.label}`)}</title></rect>`;
    x0 += w + GAP;
    return s;
  }).join("");
  const payChart = `<section class="mchart card" aria-labelledby="mp-h"><h2 class="mh" id="mp-h">${esc(`${p.total} Alta payments, each its own transaction`)}</h2>
<svg class="stack" viewBox="0 0 ${W} 30" preserveAspectRatio="none" role="img" aria-label="${esc(`${p.sales} sales, ${p.purchases} supplier purchases, ${p.refunds} refunds and ${p.sweeps} sweep`)}">${segs}</svg>
<ul class="mlegend">${kinds.map((k) => `<li><span class="dot d-${k.cls}"></span><b>${k.n}</b><span>${esc(k.label)}</span></li>`).join("")}</ul>
<p class="tx2">${a(p.account.href!, p.account.label)} ${a(`${REPO_BLOB}${MAIN_RUN_CHECK}`, "checked one by one")}</p></section>`;

  const x = st.replace, signer = replaceSigner(record);
  const moment = r ? `<section class="mmoment card" id="refused" aria-labelledby="mm-h"><span class="hd">${icon("ban", 20)}<span id="mm-h">${esc("Refused, nothing moved")}</span></span>
<div class="mm"><div class="one"><span class="big">${esc(`#${r.seq}: ${r.amount}`)} <s>${esc(`> cap ${r.cap}`)}</s></span><p>${esc("Our own check was off for this test. Alta refused it on chain; nothing moved.")}</p><p class="tx2">${a(r.proof.href!, `tx ${short(r.proof.href!.split("/").pop()!)}`)} <a class="pf" href="#refusals">${esc("decoded")} ↓</a></p></div>
${x?.revoked ? `<div class="one"><span class="big">${esc(`#${x.revoked.seq}`)}</span><p>${esc(`Old mandate, after the replace: refused by Alta's facilitator, no transaction.`)}</p></div>` : ""}</div></section>` : "";

  // 3. The mandate cards (the table behind "Details: every mandate"), with the spend's source and the read to repeat.
  const cards = `<section class="mmand card" id="mandates-cards" aria-labelledby="mc-h"><h2 class="mh" id="mc-h">${esc(`The ${rows.length} mandates on chain, one per agent`)}</h2>
<ul class="mcards">${rows.map((m) => {
    const l = liveOf(m.agent);
    // Spent of the budget, as figure and bar; the live read updates both (the table keeps the payment count).
    return `<li><span class="nm"><span class="dot d-${esc(m.agent)}"></span>${esc(name(m))}</span><dl class="kv"><dt>${esc("Pays")}</dt><dd>${esc(m.payee)}</dd><dt>${esc("Cap")}</dt><dd>${a(tx(m.tx), `${m.cap} a payment`)}</dd><dt>${esc("Expires")}</dt><dd>${esc(day(m.expires))}</dd></dl>`
      + `<span class="spent"><b><span data-spent="${esc(m.agent)}">${esc(spentOf(m))}</span></b>${esc(` of ${m.budget}`)}${l ? "" : ` <span class="sub">${esc("recorded 3 Nov")}</span>`}</span>`
      + barSvg(m.agent, m.agent, m.budget, spentOf(m), m.budget, `${name(m)}: spent ${spentOf(m)} of ${m.budget}`) + `</li>`;
  }).join("")}</ul>
<p class="mnote">${esc("*USDZ, test money.")}</p>
<p class="mnote" data-rec="${esc(METAL_INSPECTOR_RECORD)}"><b id="mlive">${esc(live ? `Spent: a recorded snapshot from ${day(live.recorded_on)} (block ${live.block}), not a live read.` : "Spent: as the main run recorded it.")}</b> <span id="mlive-why"></span></p>
${live ? `<details class="fold" data-rec="${esc(METAL_INSPECTOR_RECORD)}"><summary>${esc("Check it yourself")}</summary><pre class="mcmd">curl -s ${esc(INSPECTOR_URL)}</pre><p class="mnote"><span id="mlive-rec">${esc(`It answers with the recorded snapshot from ${day(live.recorded_on)} (block ${live.block}) until a live Alta testnet read is set up, and says so.`)}</span><span id="mlive-how" hidden>${esc(`Read live: one read for everyone every ${INSPECTOR_TTL_SECONDS / 60} minutes, at most ${INSPECTOR_DAILY_CEILING} calls a day, read-only.`)}</span> ${esc(`With your own Alta testnet RPC: eth_call to ${live.account} with mandates(ref), selector ${insp.abi.mandates_selector}, at the block shown. In a clone: npm run metal-inspect.`)} ${a(`${REPO_BLOB}${METAL_INSPECTOR_LOG}`, "the check of 12 Nov")}</p></details>` : ""}
<details class="fold" id="mandates"><summary>${esc("Details: every mandate")}</summary><section class="mt" aria-labelledby="mt-h"><h2 id="mt-h">${esc("Each mandate, its cap and its spend")}</h2>
<table class="mtab"><thead><tr><th scope="col">Agent</th><th scope="col">Cap a payment</th><th scope="col">Budget</th><th scope="col">Spent</th><th scope="col">Payee</th><th scope="col">Expires</th><th scope="col">Revoked</th></tr></thead><tbody>
${rows.map((m) => {
    const l = liveOf(m.agent);
    return `<tr><th scope="row">${esc(name(m))}</th><td data-l="Cap a payment">${a(tx(m.tx), m.cap)}${m.first ? `<span class="sub">${esc(`was ${m.first.cap}: `)}${a(tx(m.first.tx), "first bind")}</span>` : ""}</td><td data-l="Budget">${esc(m.first ? `${m.budget} (was ${m.first.budget})` : m.budget)}</td><td data-l="Spent"><span data-spent="${esc(m.agent)}">${esc(l ? l.spent : m.spent)}</span>${l ? `<span class="sub" data-pays="${esc(m.agent)}">${esc(`${l.payments} payment${l.payments === 1 ? "" : "s"}`)}</span>` : `<span class="sub">${esc("recorded 3 Nov")}</span>`}</td><td data-l="Payee">${esc(m.payee)}</td><td data-l="Expires">${esc(day(m.expires))}</td><td data-l="Revoked"><span data-revoked="${esc(m.agent)}">${esc(l ? (l.revoked ? "yes" : "no") : "no, 3 Nov")}</span></td></tr>`;
  }).join("\n")}
</tbody></table>
<p class="mnote">${esc("*USDZ, test money. Each cap links the transaction that set it.")}</p></section></details>
</section>`;

  // 4. Mandates replaced after Face ID, in three steps: Face ID in Purser → the new mandates on chain → the old one refused.
  const replace = x ? `<section class="mrep card" id="replace" aria-labelledby="mr-h"><h2 class="mh" id="mr-h">${esc("Mandates replaced after Face ID")}</h2>
<ol class="msteps">
<li><span class="st">${icon("scan-face", 18)}${esc("Face ID")}</span><p>${esc(`${x.proposal}: the CFO's Face ID and a test passkey approved it in Purser.`)}</p></li>
<li><span class="st">${icon("link-2", 18)}${esc("New mandates on chain")}</span><p class="tx2">${x.steps.map((s) => a(tx(s.proof.href!.split("/").pop()!), `${AGENT(s.agent)} ${s.cap}`)).join("")}</p><p>${esc(signer?.actor === "owner-signer" ? "One owner key, held by Purser's runner, signed on chain. The chain did not check Face ID." : "")}${signer?.actor === "owner-signer" && ownersRun() ? ` <a class="pf" href="#faceid-onchain">${esc(FACEID_SEPARATE_RUN)} ↓</a>` : ""}</p></li>
${x.revoked ? `<li class="no"><span class="st">${icon("ban", 18)}${esc("Old mandate refused")}</span><p>${esc(`#${x.revoked.seq} on the old mandate: refused by Alta's facilitator (${x.revoked.code}), no transaction.`)}</p></li>` : ""}
</ol></section>` : "";

  const cov = coverageRows();
  const done = cov.filter((c) => c.status === "done").length, open = cov.length - done;
  const coverage = cov.length ? `<details class="fold" id="also"><summary>${esc(`Also on Alta: ${done} separate runs${open ? `, and a hold, not finished` : ""}`)}</summary><table class="mcov"><thead><tr><th scope="col">What</th><th scope="col">When</th><th scope="col">Proof</th></tr></thead><tbody>${cov.map((c) => `<tr><th scope="row">${esc(c.feature)}</th><td>${esc(c.when)}${c.status === "not finished" ? ` <span class="nf">${esc("not finished")}</span>` : ""}</td><td>${c.link ? a(c.link.href, c.link.label) : ""}</td><td class="n mnote">${esc(c.note)}</td></tr>`).join("")}</tbody></table></details>` : "";

  const decoded = insp.refusals.find((d) => r && d.tx === (r.proof.href ?? "").split("/").pop()), revoked = insp.refusals.find((d) => d !== decoded);
  const ev = (d: DecodedRefusal) => `<dl class="mev">${d.event.arg_names.map((n, i) => `<dt>${esc(n)}</dt><dd>${esc(n === "reason" ? `${d.event.reason} (${d.event.reason_name})` : n === "amount" ? `${d.event.amount} *USDZ` : String(d.event.arg_values[i]))}</dd>`).join("")}</dl>`;
  const raw = (d: DecodedRefusal) => `<pre class="mcmd">${esc(`address ${d.raw_log.address}\n${d.raw_log.topics.map((t, i) => `topic ${i} ${t}`).join("\n")}\ndata ${d.raw_log.data}`)}</pre>`;
  const decodedFold = decoded ? `<details class="fold" id="refusals" data-rec="${esc(METAL_INSPECTOR_RECORD)}"><summary>${esc("Both refusals, decoded")}</summary>
<p class="mnote">${esc(`${insp.abi.MandateRefused} (topic 0 ${insp.abi.topic0.MandateRefused}).`)}</p>
<p class="mnote"><b>${esc(`#${decoded.purchase}, ${day(decoded.block_time)}, block ${decoded.block}`)}</b> ${a(tx(decoded.tx), "tx")}</p>${r ? `<p class="mnote">${esc(`Our own check was off for this one test. Alta's facilitator answered 402; a second call had Alta record the refusal on chain: ${r.amount} *USDZ over the cap at the time, ${r.cap}. Nothing moved.`)}</p>` : ""}${r && refusalNote(r) ? `<p class="mnote">${esc(refusalNote(r)!)}</p>` : ""}${ev(decoded)}${raw(decoded)}
${revoked ? `<p class="mnote"><b>${esc(`A revoked credential, ${day(revoked.block_time)}, a separate run, block ${revoked.block}`)}</b> ${a(tx(revoked.tx), "tx")}</p>${ev(revoked)}${raw(revoked)}` : ""}
<pre class="mcmd">${esc(`npm run metal-inspect -- refusal ${decoded.tx}`)}</pre></details>` : "";

  return `<main class="pp mtp"><div class="wrap">
  <div class="phd">${o.logo}<span class="pill run">${icon("database", 14)}${esc(o.label)}</span><h1>${esc("A limit the agent cannot talk past")}</h1></div>
  ${hero}
  <div class="mcharts">${budgetChart}${payChart}${moment}</div>
  ${cards}
  ${replace}
  <div class="folds card">${coverage}${decodedFold}${o.folds}</div>${o.after ?? ""}
  <a class="open" href="proof#${esc(o.proofHash)}">All the proof ${icon("arrow-right", 15)}</a>
</div></main>`;
}
