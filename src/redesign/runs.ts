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
import { esc, page } from "./ui.js";
import { VIC2_RUN_FILE, VIC2_RUN_LOG, vic2Run } from "./vic2Run.js";
import { EXPLORER_TX } from "../metal/network.js";

export const RUNS_URL = "runs";
export const RUNS_TITLE = "Every live run";

export interface RunId { label: string; value: string; href?: string }
export interface RunRow {
  key: string; iso: string; date: string; title: string; rails: string; what: string; checks: string; money: string;
  ids: RunId[]; files: { label: string; href: string }[];
}

const readJson = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")) as T;
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
const short = (id: string) => id.length > 20 ? `${id.slice(0, 10)}…${id.slice(-4)}` : id;
const tx = (label: string, hash: string): RunId => ({ label, value: short(hash), href: `${EXPLORER_TX}${hash}` });
const pl = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const blob = (file: string) => `${REPO_BLOB}${file}`;
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
    ids, files: [{ label: "record (JSON)", href: blob(file) }, { label: "run log", href: blob(log) }],
  };
}

/** Every live run, newest first. */
export function liveRuns(): RunRow[] {
  const rows: RunRow[] = [];

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
    checks: `${okOf(v2.checks)}.`, money: "Nothing bought",
    ids: [{ label: "Run", value: "vic-2" }],
    files: [{ label: "record (JSON)", href: blob(VIC2_RUN_FILE) }, { label: "run log", href: blob(VIC2_RUN_LOG) }],
  });

  const ai = airiRun() as unknown as { started_at: string; checks: Record<string, { ok: boolean }>; purchases: { step: string; outcome?: string; payment_intent_id?: string; amount: string; currency: string }[] } | null;
  if (ai) rows.push({
    key: "vic-1", iso: ai.started_at, date: day(ai.started_at), title: "Visa Intelligent Commerce through Airwallex's Airi", rails: "Airi wallet, Airwallex sandbox, test card",
    what: `${ai.purchases.filter((x) => x.outcome === "SUCCEEDED").length} purchases with a single-use Visa credential (one within the limit, one after the CFO's Face ID); one disallowed merchant refused by Purser before Airi was asked.`,
    checks: `${okOf(ai.checks)}.`, money: "Test card · test money",
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
    ids: tap.steps.map((s) => ({ label: `Card transaction, ${s.currency} ${s.amount}`, value: s.txId })),
    files: [{ label: "record (JSON)", href: blob(tap.file) }],
  });

  rows.push(ledgerRow("agent-1", AGENT_RUN_1_FILE, "docs/runs/2026-11-02-agent-run-1.md", "Agent run 1, the rehearsal for the main run", true));

  const metal = readJson<{ recorded_at: string; dispute: { case_id: string; packs: { tx: string }[]; decision: { outcome: string } } }>("docs/demo/metal.json");
  rows.push({
    key: "friday-1", iso: metal.recorded_at, date: day(metal.recorded_at), title: "Friday run 1, with a Dispute desk case", rails: "Metal testnet",
    what: `A customer's agent claimed it never ordered ${metal.dispute.packs.length} paid stock checks; Purser answered from the signed orders and the on-chain payments (outcome: ${metal.dispute.decision.outcome}).`,
    checks: "Each disputed payment checked on chain against its signed order.", money: "Rehearsal · test money",
    ids: [{ label: "Dispute case", value: metal.dispute.case_id }, tx("A disputed payment", metal.dispute.packs[0]!.tx)],
    files: [{ label: "record (JSON)", href: blob("docs/demo/metal.json") }, { label: "run log", href: blob("docs/runs/2026-10-30-dispute-desk.md") }],
  });

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

const idHtml = (i: RunId) => `<dt>${esc(i.label)}</dt><dd>${i.href ? `<a href="${esc(i.href)}"${i.href.startsWith("http") ? ' target="_blank" rel="noopener"' : ""}>${esc(i.value)}</a>` : `<code>${esc(i.value)}</code>`}</dd>`;

const CSS = `.runsp h1 { margin: 24px 0 6px; }
.runsp .last { color: var(--muted, #5b6474); margin: 0 0 18px; }
.runsp .run { margin: 0 0 14px; padding: 16px 18px; }
.runsp .run h2 { font-size: 17px; margin: 0 0 4px; }
.runsp .meta { font-size: 13px; color: var(--muted, #5b6474); margin: 0 0 8px; }
.runsp .tag { display: inline-block; font-size: 12px; padding: 2px 8px; border-radius: 999px; background: var(--chip, #eef1f6); margin-left: 6px; }
.runsp p { margin: 6px 0; }
.runsp dl { display: grid; grid-template-columns: minmax(0, 14em) minmax(0, 1fr); gap: 4px 12px; margin: 8px 0; font-size: 14px; }
.runsp dt { color: var(--muted, #5b6474); }
.runsp dd { margin: 0; overflow-wrap: anywhere; }
.runsp .files a { margin-right: 14px; font-size: 14px; }
.runsp .gloss { margin-top: 22px; }
.runsp .gloss dl { grid-template-columns: minmax(0, 12em) minmax(0, 1fr); }
@media (max-width: 560px) { .runsp dl, .runsp .gloss dl { grid-template-columns: minmax(0, 1fr); } .runsp dt { margin-top: 6px; } }`;

export function runsPage(rows: RunRow[] = liveRuns()): string {
  const last = rows[0]!;
  const body = `<main class="wrap runsp">
<h1>${esc(RUNS_TITLE)}</h1>
<p class="last">Last live run: ${esc(last.date)} (${esc(last.title)}). ${rows.length} runs, newest first. Every id below comes from the run's own record.</p>
${rows.map((r) => `<section class="card run" id="${esc(r.key)}" aria-label="${esc(r.title)}"><h2>${esc(r.title)}</h2>
<p class="meta">${esc(r.date)} · ${esc(r.rails)}<span class="tag">${esc(r.money)}</span></p>
<p>${esc(r.what)}</p>
<p><b>Checks:</b> ${esc(r.checks)}</p>
${r.ids.length ? `<dl>${r.ids.map(idHtml).join("")}</dl>` : ""}
<p class="files">${r.files.map((f) => `<a href="${esc(f.href)}" target="_blank" rel="noopener">${esc(f.label)} ↗</a>`).join("")}</p>
</section>`).join("\n")}
<details class="card gloss run"><summary>What the main run's record holds (docs/demo/main-run.json)</summary><dl>
${MAIN_RUN_GLOSSARY.map(([k, v]) => `<dt><code>${esc(k)}</code></dt><dd>${esc(v)}</dd>`).join("")}
</dl></details>
<p class="files">Per agent: <a href="agents/sourcing">Sourcing</a><a href="agents/support">Support</a><a href="agents/treasury">Treasury</a><a href="trace">Trace any payment</a><a href="proof">Proof</a></p>
</main>`;
  return page({
    title: `${RUNS_TITLE} · Purser`, description: `Every live run of Purser, newest first, with its ids, checks and records. Last live run: ${last.date}.`, tab: null, css: CSS, body,
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
