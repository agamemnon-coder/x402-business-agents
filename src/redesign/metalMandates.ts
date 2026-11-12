// /metal as one honest story (jury panel, 12 Nov): every on-chain sentence matches the transaction beside it. On top, the
// four mandates in one table (cap, budget, spent, payee, expiry; each row links the transaction that carries its terms),
// with the spend read live from Metal testnet by the read-only inspector (worker/src/metalInspector.ts) and, until a
// live read answers, the check of 12 November labelled as recorded. Then the payments, the refusal of #24 told as it ran
// (the facilitator's 402, then the record call, then Metal's MandateRefused on chain), who signed the mandate changes
// (one owner key held by the runner: the chain did not check Face ID), and what else ran on Metal, each with its date,
// in a short table: the separate runs, and the hold that is not finished. Every figure, hash and address is read here
// from the records (the main run's record and trace, the check of 12 November, the separate runs' records).

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
 * What else ran on Metal, beyond the main run, each a separate run with its date and its record (src/redesign/metalStory.ts
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
    ...row("receive", "Money from strangers held", "held by Metal, then returned"),
    ...row("clearing", "Clearing", "one deposit, then each query paid by a signed receipt"),
    ...row("compliance", "Send policy", "Purser's own contract, not Metal's"),
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
export const METAL_CSS = MT_CSS;

/** The page's one script: the live read replaces the recorded spend only when the chain answered; otherwise it says why. */
export const METAL_INSPECT_JS = `(function () {
  var label = document.getElementById("mlive"), why = document.getElementById("mlive-why");
  if (!label || !window.fetch) return;
  fetch("${METAL_INSPECTOR_PATH.slice(1)}", { headers: { accept: "application/json" } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (a) {
    if (!a || !a.mandates) return;
    if (a.source === "chain" && typeof a.block === "number" && /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}/.test(a.read_at)) {
      a.mandates.forEach(function (m) {
        var c = document.querySelector('[data-spent="' + m.agent + '"]'), p = document.querySelector('[data-pays="' + m.agent + '"]');
        var v = document.querySelector('[data-revoked="' + m.agent + '"]');
        if (c) c.textContent = m.spent;
        if (v) v.textContent = m.revoked ? "yes" : "no";
        if (p) p.textContent = m.payments + (m.payments === 1 ? " payment" : " payments");
      });
      label.textContent = "Spent: read live from Metal testnet at " + a.read_at.slice(11, 16) + " UTC, block " + a.block + ".";
      if (why) why.textContent = "";
    } else if (why && a.reason) {
      why.textContent = "Live read now: " + a.reason + ".";
    }
  }).catch(function () {});
})();`;

export interface MetalBody { logo: string; label: string; folds: string; proofHash: string; /** Blocks of other runs shown under the folds (the invoice-token run, when its record exists). */ after?: string }

/** The body of /metal: the mandates and their spend, the payments, the refusal, who signed, what else ran. */
export function metalBody(record: RunRecord, o: MetalBody): string {
  const trace = JSON.parse(read(MAIN_RUN_TRACE)) as { mandates: TraceMandate[] };
  const rows = mandateRows(record, trace), insp = inspectorRecord(), live = insp.recorded, st: MetalStory = metalStory(record);
  const liveOf = (agent: string) => live?.mandates.find((m) => m.agent === agent);
  const name = (r: MandateRow) => r.whose === "customer" ? "Customer's agent" : AGENT(r.agent);
  const table = `<section class="mt card" aria-labelledby="mt-h"><h2 id="mt-h">${esc(`${rows.length} mandates on chain, one per agent`)}</h2>
<table class="mtab"><thead><tr><th scope="col">Agent</th><th scope="col">Cap a payment</th><th scope="col">Budget</th><th scope="col">Spent</th><th scope="col">Payee</th><th scope="col">Expires</th><th scope="col">Revoked</th></tr></thead><tbody>
${rows.map((r) => {
    const l = liveOf(r.agent);
    return `<tr><th scope="row">${esc(name(r))}</th><td data-l="Cap a payment">${a(tx(r.tx), r.cap)}${r.first ? `<span class="sub">${esc(`was ${r.first.cap}: `)}${a(tx(r.first.tx), "first bind")}</span>` : ""}</td><td data-l="Budget">${esc(r.first ? `${r.budget} (was ${r.first.budget})` : r.budget)}</td><td data-l="Spent"><span data-spent="${esc(r.agent)}">${esc(l ? l.spent : r.spent)}</span>${l ? `<span class="sub" data-pays="${esc(r.agent)}">${esc(`${l.payments} payment${l.payments === 1 ? "" : "s"}`)}</span>` : `<span class="sub">${esc("recorded 3 Nov")}</span>`}</td><td data-l="Payee">${esc(r.payee)}</td><td data-l="Expires">${esc(day(r.expires))}</td><td data-l="Revoked"><span data-revoked="${esc(r.agent)}">${esc(l ? (l.revoked ? "yes" : "no") : "no, 3 Nov")}</span></td></tr>`;
  }).join("\n")}
</tbody></table>
<p class="mnote">${esc("*USDZ, test money. Each cap links the transaction that set it.")}</p>
<p class="mnote" data-rec="${esc(METAL_INSPECTOR_RECORD)}"><b id="mlive">${esc(live ? `Spent: recorded on ${day(live.recorded_on)} at block ${live.block}, a read-only check.` : "Spent: as the main run recorded it.")}</b> <span id="mlive-why"></span></p>
${live ? `<details class="fold" data-rec="${esc(METAL_INSPECTOR_RECORD)}"><summary>${esc("Check it yourself")}</summary><pre class="mcmd">curl -s ${esc(INSPECTOR_URL)}</pre><p class="mnote">${esc(`One read for everyone every ${INSPECTOR_TTL_SECONDS / 60} minutes, at most ${INSPECTOR_DAILY_CEILING} calls a day, read-only. With your own Metal testnet RPC: eth_call to ${live.account} with mandates(ref), selector ${insp.abi.mandates_selector}, at the block shown. In a clone: npm run metal-inspect.`)} ${a(`${REPO_BLOB}${METAL_INSPECTOR_LOG}`, "the check of 12 Nov")}</p></details>` : ""}
</section>`;

  const r = st.refusal, decoded = insp.refusals.find((x) => r && x.tx === (r.proof.href ?? "").split("/").pop()), revoked = insp.refusals.find((x) => x !== decoded);
  const payCard = `<div class="mc card"><h2>${esc(`${st.payments.total} Metal payments, each its own transaction`)}</h2><p>${esc(`${st.payments.sales} sales, ${st.payments.purchases} supplier purchases, ${st.payments.refunds} refunds and ${st.payments.sweeps} sweep, in *USDZ.`)}</p><p class="tx2">${a(st.payments.account.href!, st.payments.account.label)}${a(`${REPO_BLOB}${MAIN_RUN_CHECK}`, "checked one by one")}</p></div>`;
  const refusalCard = r ? `<div class="mc card"><h2>${esc(`#${r.seq} refused on chain`)}</h2><p>${esc(`Our own check was off for this one test. Metal's facilitator answered 402; a second call had Metal record the refusal on chain: ${r.amount} *USDZ over the ${r.cap} cap. Nothing moved.`)}</p><p class="tx2">${a(r.proof.href!, `tx ${short(r.proof.href!.split("/").pop()!)}`)}</p></div>` : "";
  const signer = replaceSigner(record), x = st.replace;
  const replaceCard = x ? `<div class="mc card"><h2>${esc("Mandates replaced after Face ID")}</h2><p>${esc(`${x.proposal}: the CFO's Face ID and a test passkey approved it in Purser${signer?.actor === "owner-signer" ? "; one owner key, held by Purser's runner, signed on chain. The chain did not check Face ID." : "."}`)}</p><p class="tx2">${x.steps.map((s) => a(tx(s.proof.href!.split("/").pop()!), `${AGENT(s.agent)} ${s.cap}`)).join("")}</p>${x.revoked ? `<p class="mnote">${esc(`#${x.revoked.seq} on the old mandate: refused by Metal's facilitator (${x.revoked.code}), no transaction.`)}</p>` : ""}</div>` : "";

  const cov = coverageRows();
  const done = cov.filter((c) => c.status === "done").length, open = cov.length - done;
  const coverage = cov.length ? `<details class="fold" id="also"><summary>${esc(`Also on Metal: ${done} separate runs${open ? `, and a hold, not finished` : ""}`)}</summary><table class="mcov"><thead><tr><th scope="col">What</th><th scope="col">When</th><th scope="col">Proof</th></tr></thead><tbody>${cov.map((c) => `<tr><th scope="row">${esc(c.feature)}</th><td>${esc(c.when)}${c.status === "not finished" ? ` <span class="nf">${esc("not finished")}</span>` : ""}</td><td>${c.link ? a(c.link.href, c.link.label) : ""}</td><td class="n mnote">${esc(c.note)}</td></tr>`).join("")}</tbody></table></details>` : "";

  const ev = (d: DecodedRefusal) => `<dl class="mev">${d.event.arg_names.map((n, i) => `<dt>${esc(n)}</dt><dd>${esc(n === "reason" ? `${d.event.reason} (${d.event.reason_name})` : n === "amount" ? `${d.event.amount} *USDZ` : String(d.event.arg_values[i]))}</dd>`).join("")}</dl>`;
  const raw = (d: DecodedRefusal) => `<pre class="mcmd">${esc(`address ${d.raw_log.address}\n${d.raw_log.topics.map((t, i) => `topic ${i} ${t}`).join("\n")}\ndata ${d.raw_log.data}`)}</pre>`;
  const decodedFold = decoded ? `<details class="fold" id="refusals" data-rec="${esc(METAL_INSPECTOR_RECORD)}"><summary>${esc("Both refusals, decoded")}</summary>
<p class="mnote">${esc(`${insp.abi.MandateRefused} (topic 0 ${insp.abi.topic0.MandateRefused}).`)}</p>
<p class="mnote"><b>${esc(`#${decoded.purchase}, ${day(decoded.block_time)}, block ${decoded.block}`)}</b> ${a(tx(decoded.tx), "tx")}</p>${r && refusalNote(r) ? `<p class="mnote">${esc(refusalNote(r)!)}</p>` : ""}${ev(decoded)}${raw(decoded)}
${revoked ? `<p class="mnote"><b>${esc(`A revoked credential, ${day(revoked.block_time)}, a separate run, block ${revoked.block}`)}</b> ${a(tx(revoked.tx), "tx")}</p>${ev(revoked)}${raw(revoked)}` : ""}
<pre class="mcmd">${esc(`npm run metal-inspect -- refusal ${decoded.tx}`)}</pre></details>` : "";

  return `<main class="pp mtp"><div class="wrap">
  <div class="phd">${o.logo}<span class="pill run">${icon("database", 14)}${esc(o.label)}</span><h1>${esc("A limit the agent cannot talk past")}</h1></div>
  ${table}
  <div class="mgrid">${payCard}${refusalCard}${replaceCard}</div>
  <div class="folds card">${coverage}${decodedFold}${o.folds}</div>${o.after ?? ""}
  <a class="open" href="proof#${esc(o.proofHash)}">All the proof ${icon("arrow-right", 15)}</a>
</div></main>`;
}
