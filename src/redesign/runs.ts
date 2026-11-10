// /runs and docs/runs/README.md: every live run in one list, newest first. Each row is read from its record (the ids,
// dates, counts and checks): nothing is typed in but the one run whose record lives on another branch (the platform
// build's first connected-accounts run, 10 Nov), which says so and links to its record there. A run that ran with
// test money says so; a rehearsal says so. test/runs-page.test.ts holds every figure to its record and the README to
// runsReadme().

import { readFileSync } from "node:fs";
import { AIRI_RUN_FILE, AIRI_RUN_LOG, airiRun } from "./airiRun.js";
import { AWX_RUN_FILE, AWX_RUN_LOG, awxRun } from "./awxRun.js";
import { REPO_BLOB } from "./metalStory.js";
import { AGENT_RUN_1_FILE, AGENT_RUN_FILE, payments, tapRun, type RunRecord } from "./run.js";
import { esc, icon, page } from "./ui.js";
import { VIC2_RUN_FILE, VIC2_RUN_LOG, vic2Run } from "./vic2Run.js";
import { EXPLORER_TX } from "../metal/network.js";

export const RUNS_URL = "runs";
export const RUNS_TITLE = "Every live run";

export interface RunId { label: string; value: string; href?: string }
/** One big number on a run's card: the value and what it counts (read from the same record as the row). */
export interface RunStat { v: string; l: string }
export interface RunRow {
  key: string; iso: string; date: string; title: string; rails: string; what: string; checks: string; money: string;
  ids: RunId[]; files: { label: string; href: string }[]; stats?: RunStat[];
}

const readJson = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")) as T;
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
const short = (id: string) => id.length > 20 ? `${id.slice(0, 10)}…${id.slice(-4)}` : id;
const tx = (label: string, hash: string): RunId => ({ label, value: short(hash), href: `${EXPLORER_TX}${hash}` });
const pl = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const blob = (file: string) => `${REPO_BLOB}${file}`;
const okStat = (checks: Record<string, { ok: boolean }>): RunStat => {
  const all = Object.values(checks);
  return { v: `${all.filter((c) => c.ok).length}/${all.length}`, l: "checks passed" };
};
const okOf = (checks: Record<string, { ok: boolean }>) => {
  const all = Object.values(checks);
  return `${all.filter((c) => c.ok).length} of ${all.length} checks passed`;
};

interface TraceLite { payments: { id: string; kind: string; rail_id?: string; ref: string }[] }

function ledgerRow(key: string, file: string, log: string, title: string, rehearsal: boolean): RunRow {
  const r = readJson<RunRecord & { recorded_at: string }>(file);
  const p = payments(r);
  const s = r.snapshot as unknown as { reconciliation: { checked: number; differences: number }; audit: { rows: number; intact: boolean } };
  const ids: RunId[] = [];
  if (key === "main-1") {
    const t = readJson<TraceLite>("docs/demo/main-run-trace.json");
    const transfer = t.payments.find((x) => x.kind === "transfer");
    const sweep = t.payments.find((x) => x.kind === "sweep");
    if (transfer) ids.push({ label: "SWIFT transfer (Airwallex)", value: transfer.ref, href: `trace#${transfer.id}` });
    if (sweep?.rail_id) ids.push(tx("Sweep on Metal", sweep.rail_id));
    ids.push({ label: "Every payment", value: "Trace any payment", href: "trace" });
  }
  return {
    key, iso: r.recorded_at, date: day(r.recorded_at), title, rails: "Metal testnet, Airwallex sandbox, Claude",
    what: `${pl(p.onChain, "Metal payment")}, ${pl(p.cards, "card charge")}, ${pl(p.transfers, "SWIFT transfer")}; ${pl((r.proof as unknown as { face_id: number }).face_id, "CFO Face ID decision")}.`,
    checks: `${s.reconciliation.checked} money flows reconciled, ${s.reconciliation.differences} differences; audit log ${s.audit.rows} rows, ${s.audit.intact ? "intact" : "broken"}.`,
    money: rehearsal ? "Rehearsal · test money" : "Test money",
    stats: [{ v: String(p.onChain), l: "Metal payments" }, { v: String((r.proof as unknown as { face_id: number }).face_id), l: "Face ID decisions" }, { v: String(s.reconciliation.differences), l: "differences" }],
    ids, files: [{ label: "record (JSON)", href: blob(file) }, { label: "run log", href: blob(log) }],
  };
}

/** The big numbers of the two runs typed in above (from their run logs), kept apart from their rows' text. */
const TYPED_STATS: Record<string, RunStat[]> = {
  "t0-1": [{ v: "95", l: "journal entries" }, { v: "0", l: "differences" }, { v: "0", l: "posted again" }],
  "connected-1": [{ v: "1", l: "connected account" }],
};

/** Every live run, newest first. */
export function liveRuns(): RunRow[] {
  const rows: RunRow[] = [];

  // 10 Nov: Purser's books of the 3 Nov main run posted to T:0 (docs/runs/2026-11-10-t0-journal-sandbox.md).
  rows.push({
    key: "t0-1", iso: "2026-11-10T06:08:08.750Z", date: day("2026-11-10T06:08:08.750Z"),
    title: "The main run's books posted to T:0", rails: "T:0 shared sandbox entity (general ledger)",
    what: "95 journal entries from the 3 Nov books posted to T:0's shared sandbox entity, one at a time, each with an idempotency key.",
    checks: "Debits equal credits (21,141,221.86 USD each); T:0 matches our books line by line, 0 differences; a second push posted 0.", money: "Sandbox · test money",
    ids: [{ label: "First journal entry", value: "je_prod_z7kTCuZ1iiwad01q" }],
    files: [{ label: "run log", href: "../../docs/runs/2026-11-10-t0-journal-sandbox.md" }],
  });

  // 10 Nov: the platform build's first connected-accounts run. Its record is on the platform branch, not in this code.
  rows.push({
    key: "connected-1", iso: "2026-11-10T05:02:45.871Z", date: day("2026-11-10T05:02:45.871Z"),
    title: "Connected accounts, first sandbox run (built after the kit)", rails: "Airwallex sandbox (connected accounts)",
    what: "Purser's platform rail opened a connected account for a fake test company. Activation needs the company's verification details: not done yet, nothing paid.",
    checks: "4 of 12 budgeted calls; stopped at the first blocker, as agreed.", money: "Sandbox · no money moved",
    ids: [{ label: "Connected account", value: "acct_SC-QD89fOneAeqaRFgOymw" }],
    files: [{ label: "run log (platform branch)", href: "https://github.com/agamemnon-coder/x402-business-agents/blob/platform/docs/runs/2026-11-10-connected-accounts-sandbox.md" }],
  });

  const v2 = vic2Run() as unknown as { started_at: string; checks: Record<string, { ok: boolean }>; outside_calls: { airi: number; airwallex: number } } | null;
  if (v2) rows.push({
    key: "vic-2", iso: v2.started_at, date: day(v2.started_at), title: "Airi, second run: what Purser adds around it", rails: "Purser relay, CFO passkey",
    what: `A purchase changed after the CFO's Face ID was refused, a shop the CFO locked was refused, and unlocking offered it again. ${v2.outside_calls.airi} Airi and ${v2.outside_calls.airwallex} Airwallex calls.`,
    checks: `${okOf(v2.checks)}.`, money: "Nothing bought", stats: [okStat(v2.checks), { v: String(v2.outside_calls.airi + v2.outside_calls.airwallex), l: "outside calls" }],
    ids: [{ label: "Run", value: "vic-2" }],
    files: [{ label: "record (JSON)", href: blob(VIC2_RUN_FILE) }, { label: "run log", href: blob(VIC2_RUN_LOG) }],
  });

  const ai = airiRun() as unknown as { started_at: string; checks: Record<string, { ok: boolean }>; purchases: { step: string; outcome?: string; payment_intent_id?: string; amount: string; currency: string }[] } | null;
  if (ai) rows.push({
    key: "vic-1", iso: ai.started_at, date: day(ai.started_at), title: "Visa Intelligent Commerce through Airwallex's Airi", rails: "Airi wallet, Airwallex sandbox, test card",
    what: `${ai.purchases.filter((x) => x.outcome === "SUCCEEDED").length} purchases with a single-use Visa credential (one within the limit, one after the CFO's Face ID); one disallowed merchant refused by Purser before Airi was asked.`,
    checks: `${okOf(ai.checks)}.`, money: "Test card · test money", stats: [{ v: String(ai.purchases.filter((x) => x.outcome === "SUCCEEDED").length), l: "Visa purchases" }, okStat(ai.checks)],
    ids: ai.purchases.filter((x) => x.payment_intent_id).map((x) => ({ label: `Payment intent, ${x.currency} ${x.amount}`, value: x.payment_intent_id! })),
    files: [{ label: "record (JSON)", href: blob(AIRI_RUN_FILE) }, { label: "run log", href: blob(AIRI_RUN_LOG) }],
  });

  const awx = awxRun();
  if (awx) {
    const decline = awx.card_transactions.find((c) => !c.approved && c.decline_code === "LIMIT_EXCEEDED");
    const swift = awx.invoices.find((i) => i.transfer_id);
    const at = awx.card_transactions[0]?.occurred_at ?? swift?.planned_at ?? "2026-11-07T00:00:00Z";
    rows.push({
      key: "awx-1", iso: at, date: day(at), title: "The Airwallex-only run", rails: "Airwallex sandbox: cards, webhooks, FX, SWIFT",
      what: `${awx.cards.length} cards, one per agent; ${awx.card_transactions.length} card transactions, declines by Airwallex itself; ${awx.webhooks.length} signed webhooks; ${awx.invoices.length} invoices paid after the CFO's Face ID (SWIFT settlement simulated in the sandbox).`,
      checks: `${okOf(awx.checks)}.`, money: "Sandbox · test money",
      stats: [{ v: String(awx.cards.length), l: "cards" }, { v: String(awx.card_transactions.filter((c) => !c.approved).length), l: "declined by Airwallex" }, okStat(awx.checks)],
      ids: [
        ...(decline ? [{ label: "Declined by Airwallex (LIMIT_EXCEEDED)", value: decline.id }] : []),
        ...(swift?.transfer_id ? [{ label: `SWIFT transfer ${swift.invoice_no}`, value: swift.transfer_id }] : []),
      ],
      files: [{ label: "record (JSON)", href: blob(AWX_RUN_FILE) }, { label: "run log", href: blob(AWX_RUN_LOG) }],
    });
  }

  rows.push(ledgerRow("main-1", AGENT_RUN_FILE, "docs/runs/2026-11-03-main-run.md", "The main run: three agents, one day of work", false));

  const tap = tapRun();
  if (tap) rows.push({
    key: "tap-1", iso: tap.ranAt, date: day(tap.ranAt), title: "Visa Trusted Agent Protocol: signed agent checkout", rails: "Visa's TAP reference proxy, Airwallex sandbox card",
    what: `${tap.steps.length} signed checkouts at a merchant we run: ${tap.steps.filter((s) => s.approved).length} approved, ${tap.steps.filter((s) => !s.approved).length} declined over the card's limit by Airwallex.`,
    checks: `Each charge read back from Airwallex (${tap.steps.map((s) => s.getStatus).join(", ")}).`, money: "Simulated merchant · test money",
    stats: [{ v: String(tap.steps.filter((s) => s.approved).length), l: "approved" }, { v: String(tap.steps.filter((s) => !s.approved).length), l: "declined by Airwallex" }],
    ids: tap.steps.map((s) => ({ label: `Card transaction, ${s.currency} ${s.amount}`, value: s.txId })),
    files: [{ label: "record (JSON)", href: blob(tap.file) }],
  });

  rows.push(ledgerRow("agent-1", AGENT_RUN_1_FILE, "docs/runs/2026-11-02-agent-run-1.md", "Agent run 1, the rehearsal for the main run", true));

  const metal = readJson<{ recorded_at: string; dispute: { case_id: string; packs: { tx: string }[]; decision: { outcome: string } } }>("docs/demo/metal.json");
  rows.push({
    key: "friday-1", iso: metal.recorded_at, date: day(metal.recorded_at), title: "Friday run 1, with a Dispute desk case", rails: "Metal testnet",
    what: `A customer's agent claimed it never ordered ${metal.dispute.packs.length} paid stock checks; Purser answered from the signed orders and the on-chain payments (outcome: ${metal.dispute.decision.outcome}).`,
    checks: "Each disputed payment checked on chain against its signed order.", money: "Rehearsal · test money",
    stats: [{ v: String(metal.dispute.packs.length), l: "payments disputed" }],
    ids: [{ label: "Dispute case", value: metal.dispute.case_id }, tx("A disputed payment", metal.dispute.packs[0]!.tx)],
    files: [{ label: "record (JSON)", href: blob("docs/demo/metal.json") }, { label: "run log", href: blob("docs/runs/2026-10-30-dispute-desk.md") }],
  });

  for (const r of rows) r.stats ??= TYPED_STATS[r.key];
  return rows.sort((a, b) => b.iso.localeCompare(a.iso));
}

/** What each top-level field of docs/demo/main-run.json holds (test/runs-page.test.ts checks each is in the record). */
export const MAIN_RUN_GLOSSARY: [string, string][] = [
  ["recorded_at", "When the record was written, UTC."],
  ["run", "The run's name."],
  ["company", "The example company the run plays (Northwind Outdoor, a test world)."],
  ["proof", "The headline counts: payments alone, blocked, Face ID decisions, refusals on chain, money over a limit."],
  ["snapshot", "The CFO dashboard at the end of the run: budgets, cards, decisions, refusals, reconciliation, audit head, books, Claude calls."],
  ["snapshot.traces", "Each Claude decision: agent, model, turns, tokens, latency and Anthropic request ids."],
  ["snapshot.reconciliation", "Every money flow checked against Airwallex and Metal, and the differences found."],
  ["snapshot.audit", "The hash-chained audit log: row count, head hash, whether the chain is intact."],
  ["ledger", "The ledger's rows the pages are built from (sanitised)."],
  ["kind", "What kind of record it is: from a live run, or an example."],
];

/** The rails a run touched, from its rails line and title: an icon and a name each (the name is always written out). */
const RAILS: [RegExp, string, string, string][] = [
  [/Airwallex|Airi/i, "Airwallex", "credit-card", "awx"], [/Metal/i, "Metal", "database", "metal"], [/T:0/, "T:0", "receipt", "t0"],
  [/Visa|Airi|TAP/i, "Visa", "wallet", "visa"], [/Claude/i, "Claude", "sparkles", "claude"], [/passkey/i, "Passkey", "scan-face", "pk"],
];
export const railsOf = (r: Pick<RunRow, "rails" | "title">) => RAILS.filter(([re]) => re.test(`${r.rails} ${r.title}`));
const railChip = ([, name, ic, cls]: (typeof RAILS)[number]) => `<span class="rl ${cls}">${icon(ic, 14)}${esc(name)}</span>`;
/** The status pill's tone: nothing moved, a rehearsal, or a live run with test money. The words are the row's own. */
const tone = (money: string) => /no money moved|nothing bought/i.test(money) ? "none" : /rehearsal/i.test(money) ? "reh" : "live";

const idChip = (i: RunId) => {
  const ext = i.href?.startsWith("http");
  const val = i.href ? `<a class="v" href="${esc(i.href)}"${ext ? ' target="_blank" rel="noopener"' : ""}>${esc(i.value)}${ext ? " ↗" : ""}</a>` : `<code class="v">${esc(i.value)}</code>`;
  const copy = i.href && !ext ? "" : `<button type="button" class="cp" data-copy="${esc(i.value)}" aria-label="Copy ${esc(i.label)}">${icon("copy", 13)}</button>`;
  return `<span class="idc"><span class="k">${esc(i.label)}</span>${val}${copy}</span>`;
};

const CSS = `.runsp h1 { margin: 24px 0 6px; }
.runsp .last { color: var(--muted); margin: 0 0 16px; }
.runsp .sum { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: 12px; margin: 0 0 22px; }
.runsp .sum .tile { padding: 16px 18px; } .runsp .sum .tile:hover { transform: none; border-color: var(--border); }
.runsp .sum .v { font-size: clamp(28px, 3vw, 36px); }
.runsp .sum .rls { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.runsp ol.tl { list-style: none; margin: 0; padding: 0 0 0 22px; position: relative; }
.runsp ol.tl::before { content: ""; position: absolute; left: 6px; top: 8px; bottom: 8px; width: 2px; background: var(--border); }
.runsp li.run { position: relative; margin: 0 0 14px; }
.runsp li.run::before { content: ""; position: absolute; left: -21px; top: 22px; width: 12px; height: 12px; border-radius: 50%; background: var(--surface); border: 3px solid var(--accent); }
.runsp li.run.reh::before { border-color: var(--faint); } .runsp li.run.none::before { border-color: var(--muted); }
.runsp .rc { padding: 16px 18px; }
.runsp .top { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 10px; }
.runsp .top h2 { font-size: 18px; margin: 0; flex: 1 1 260px; letter-spacing: -.01em; line-height: 1.25; }
.runsp time { font-size: 14px; color: var(--muted); font-weight: 600; font-variant-numeric: tabular-nums; }
.runsp .st { font: 650 13px/1.3 Inter, system-ui, sans-serif; padding: 3px 10px; border-radius: 999px; background: var(--ok-soft); color: var(--ok); white-space: nowrap; }
.runsp .st.reh { background: var(--sunken); color: var(--muted); } .runsp .st.none { background: var(--sunken); color: var(--faint); }
.runsp .rls { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 0; }
.runsp .rl { display: inline-flex; align-items: center; gap: 5px; font: 650 13px/1.3 Inter, system-ui, sans-serif; padding: 3px 9px; border-radius: 999px; background: var(--sunken); color: var(--muted); }
.runsp .rl.awx { background: var(--awx-soft); color: var(--awx); } .runsp .rl.metal { background: var(--metal-soft); color: var(--metal); }
.runsp .rl.claude { background: var(--claude-soft); color: var(--claude); } .runsp .rl.visa, .runsp .rl.pk { background: var(--accent-soft); color: var(--accent); }
.runsp .nums { display: flex; flex-wrap: wrap; gap: 8px 26px; margin: 12px 0 2px; }
.runsp .nums div { display: flex; flex-direction: column; }
.runsp .nums b { font-size: 28px; font-weight: 780; letter-spacing: -.03em; line-height: 1.05; font-variant-numeric: tabular-nums; }
.runsp .nums span { font-size: 14px; color: var(--muted); font-weight: 600; }
.runsp .ids { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 0; }
.runsp .idc { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 4px 6px 4px 10px; border-radius: 10px; background: var(--sunken); font-size: 13px; }
.runsp .idc .k { color: var(--muted); font-weight: 600; white-space: nowrap; }
.runsp .idc .v { font: 500 13px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--text); overflow-wrap: anywhere; min-width: 0; }
.runsp .idc a.v { color: var(--accent); text-decoration: none; } .runsp .idc a.v:hover { text-decoration: underline; }
.runsp .cp { border: 0; background: transparent; color: var(--muted); cursor: pointer; padding: 2px; border-radius: 6px; display: inline-grid; place-items: center; }
.runsp .cp:hover { color: var(--text); background: var(--surface); } .runsp .cp.ok { color: var(--ok); }
.runsp details.more { margin: 10px 0 0; font-size: 15px; }
.runsp details.more summary { cursor: pointer; color: var(--muted); font-weight: 600; font-size: 14px; }
.runsp details.more p { margin: 6px 0; }
.runsp .files { margin: 8px 0 0; font-size: 14px; } .runsp .files a { margin-right: 14px; color: var(--muted); }
.runsp .gloss { margin-top: 22px; padding: 16px 18px; }
.runsp .gloss dl { display: grid; grid-template-columns: minmax(0, 12em) minmax(0, 1fr); gap: 4px 12px; margin: 8px 0; font-size: 14px; }
.runsp .gloss dt { color: var(--muted); } .runsp .gloss dd { margin: 0; overflow-wrap: anywhere; }
.runsp .more-links a { margin-right: 14px; }
@media (max-width: 560px) { .runsp .sum { grid-template-columns: 1fr 1fr; } .runsp .sum .rt { grid-column: 1 / -1; order: 3; } .runsp .nums { gap: 8px 18px; } .runsp .gloss dl { grid-template-columns: minmax(0, 1fr); } .runsp .nums b { font-size: 24px; } .runsp .idc .k { white-space: normal; } }`;

const COPY_JS = `document.querySelectorAll("button.cp").forEach(function (b) {
  if (!navigator.clipboard) { b.hidden = true; return; }
  b.addEventListener("click", function () { navigator.clipboard.writeText(b.dataset.copy || "").then(function () { b.classList.add("ok"); setTimeout(function () { b.classList.remove("ok"); }, 1200); }); });
});`;

export function runsPage(rows: RunRow[] = liveRuns()): string {
  const last = rows[0]!;
  const rails = RAILS.filter(([re]) => rows.some((r) => re.test(`${r.rails} ${r.title}`)));
  const body = `<main class="wrap runsp">
<h1>${esc(RUNS_TITLE)}</h1>
<p class="last">Last live run: ${esc(last.date)} (${esc(last.title)}). Every id comes from the run's own record.</p>
<div class="sum">
<div class="card tile"><span class="v">${rows.length}</span><span class="l">live runs, newest first</span></div>
<div class="card tile rt"><span class="v">${rails.length}</span><span class="l">rails covered</span><span class="rls">${rails.map(railChip).join("")}</span></div>
<div class="card tile"><span class="v">${esc(last.date.replace(/ \d{4}$/, ""))}</span><span class="l">last live run</span></div>
</div>
<ol class="tl">
${rows.map((r) => `<li class="run ${tone(r.money)}" id="${esc(r.key)}"><article class="card rc" aria-label="${esc(r.title)}">
<div class="top"><h2>${esc(r.title)}</h2><time datetime="${esc(r.iso)}">${esc(r.date)}</time><span class="st ${tone(r.money)}">${esc(r.money)}</span></div>
<div class="rls">${railsOf(r).map(railChip).join("")}</div>
${r.stats?.length ? `<div class="nums">${r.stats.map((x) => `<div><b>${esc(x.v)}</b><span>${esc(x.l)}</span></div>`).join("")}</div>` : ""}
${r.ids.length ? `<div class="ids">${r.ids.map(idChip).join("")}</div>` : ""}
<details class="more"><summary>What ran and the checks</summary><p>${esc(r.what)}</p><p><b>Checks:</b> ${esc(r.checks)}</p><p class="vh">Rails: ${esc(r.rails)}</p></details>
<p class="files">${r.files.map((f) => `<a href="${esc(f.href)}" target="_blank" rel="noopener">${esc(f.label)} ↗</a>`).join("")}</p>
</article></li>`).join("\n")}
</ol>
<details class="card gloss"><summary>What the main run's record holds (docs/demo/main-run.json)</summary><dl>
${MAIN_RUN_GLOSSARY.map(([k, v]) => `<dt><code>${esc(k)}</code></dt><dd>${esc(v)}</dd>`).join("")}
</dl></details>
<p class="files more-links">Per agent: <a href="agents/sourcing">Sourcing</a><a href="agents/support">Support</a><a href="agents/treasury">Treasury</a><a href="trace">Trace any payment</a><a href="proof">Proof</a></p>
</main>`;
  return page({
    title: `${RUNS_TITLE} · Purser`, description: `Every live run of Purser, newest first, with its ids, checks and records. Last live run: ${last.date}.`, tab: null, css: CSS, body,
    js: COPY_JS, stage: false,
    source: "Source: each run's record in docs/demo and docs/runs (listed per run).",
  });
}

/** Text for one Markdown table cell: backslashes escaped first, then the pipes that would end the cell. */
export const mdCell = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");

/** docs/runs/README.md, generated from the same rows (npx tsx src/cli/runs-readme.ts). */
export function runsReadme(rows: RunRow[] = liveRuns()): string {
  const cell = mdCell;
  const idCell = (i: RunId) => `${i.label}: ${i.href?.startsWith("http") ? `[\`${i.value}\`](${i.href})` : `\`${i.value}\``}`;
  return `# Live runs

Every live run, newest first, generated from the records by \`src/redesign/runs.ts\` (\`npx tsx src/cli/runs-readme.ts\`).
The same list is on the site at [/runs](https://kit11.max-31b.workers.dev/runs). Test money only; what is simulated is
said per run. The other files in this folder are build notes, dry runs and rehearsals.

**Last live run:** ${rows[0]!.date}.

| Date | Run | Rails | What ran | Checks | Key ids | Files |
|---|---|---|---|---|---|---|
${rows.map((r) => `| ${r.date} | ${cell(r.title)} (${cell(r.money)}) | ${cell(r.rails)} | ${cell(r.what)} | ${cell(r.checks)} | ${r.ids.filter((i) => i.value !== "Trace any payment").map((i) => cell(idCell(i))).join("<br>")} | ${r.files.map((f) => `[${f.label}](${f.href.replace(REPO_BLOB, "../../")})`).join("<br>")} |`).join("\n")}

## What \`docs/demo/main-run.json\` holds

| Field | What it holds |
|---|---|
${MAIN_RUN_GLOSSARY.map(([k, v]) => `| \`${k}\` | ${cell(v)} |`).join("\n")}
`;
}
