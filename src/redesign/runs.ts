// /runs and docs/runs/README.md: every live run in one list, newest first. Each row is read from its record (the ids,
// dates, counts and checks): nothing is typed in but the rows whose record is a markdown run log (the two-locks payout,
// the platform build's runs of 10 Nov, the T:0 posting); test/runs-page.test.ts holds their ids and figures to those logs.
// A run that ran with test money says so; a rehearsal says so. test/runs-page.test.ts holds every figure to its record
// and the README to runsReadme().
//
// The page is a timeline (jury, 12 Nov): each run is one compact entry under a plain name (what the run shows), with an
// honest badge (the kind of run), one line, its partners, its rate ("7 of 7 checks passed", later "18 of 20 paid"), its
// first id and its record; the rest sits behind one fold. Rehearsals sit in one closed group. One run is marked as the
// product. The filters are plain links to anchors and CSS on :target: they work with JavaScript off and never hide the
// newest run. The run's short name in the docs (awx-1, vic-1, ...) stays as the row's key and its anchor, not as text.
//
// A row in the old shape, rows.push({ key, iso, date, title, rails, what, checks, money, ids, files }), still renders: its
// title is its name, its badge and partners are read from its rails and money words, its what's first sentence is its
// line. A new row adds the optional fields: name, line, kind, rate (and product, for the one run that is the product).

import { readFileSync } from "node:fs";
import { AIRI_RUN_FILE, AIRI_RUN_LOG, airiRun } from "./airiRun.js";
import { AWX_RUN_FILE, AWX_RUN_LOG, awxRun } from "./awxRun.js";
import { REPO_BLOB } from "./metalStory.js";
import { AGENT_RUN_1_FILE, AGENT_RUN_FILE, payments, tapRun, type RunRecord } from "./run.js";
import { OPEN_TARGET_JS, esc, icon, page } from "./ui.js";
import { VIC2_RUN_FILE, VIC2_RUN_LOG, vic2Run } from "./vic2Run.js";
import { CAVEAT_LINE } from "../config/brand.js";
import { EXPLORER_TX } from "../metal/network.js";

export const RUNS_URL = "runs";
export const RUNS_TITLE = "Every live run";

export interface RunId { label: string; value: string; href?: string }
/** One number of a run and what it counts. A row in the old shape may carry some: they are listed quietly in its fold. */
export interface RunStat { v: string; l: string }
/**
 * The kind of run, its honest badge: real calls to a partner's sandbox, real transactions on Metal testnet, both, a run
 * on Purser's own fakes (no payment partner called), a rehearsal or dry run, or a live run that called no partner and
 * moved nothing.
 */
export type RunKind = "sandbox" | "testnet" | "both" | "simulated" | "rehearsal" | "nothing";
/** A partner a run can take part in: its chip, its filter and its count. */
export type RunPartner = "Airwallex" | "Metal" | "T:0" | "Visa" | "Claude";
/** A series as a rate: "done of of what" ("7 of 7 checks passed", "18 of 20 paid"). */
export interface RunRate { done: number; of: number; what: string }
export interface RunRow {
  key: string; iso: string; date: string; title: string; rails: string; what: string; checks: string; money: string;
  ids: RunId[]; files: { label: string; href: string }[]; stats?: RunStat[];
  /** What the run shows, in plain words: the name a visitor reads (without it, the title). */
  name?: string;
  /** One line, two sentences at most: what happened and what was simulated (without it, the first sentence of `what`). */
  line?: string;
  /** The kind of run (without it, read from the rails and the money words: kindOf). */
  kind?: RunKind;
  /** The run's rate, when it has one: its checks passed, or a series of payouts paid. */
  rate?: RunRate;
  /** The one run to open if you open one: the product, end to end. */
  product?: true;
  /**
   * The partners that took part, from the run's record, where reading them from the rails and title words would be wrong
   * (without it: railsOf). A partner's chip, filter class and count follow it.
   */
  partners?: RunPartner[];
}

const readJson = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")) as T;
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
const short = (id: string) => id.length > 20 ? `${id.slice(0, 10)}…${id.slice(-4)}` : id;
const tx = (label: string, hash: string): RunId => ({ label, value: short(hash), href: `${EXPLORER_TX}${hash}` });
const pl = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const blob = (file: string) => `${REPO_BLOB}${file}`;
/**
 * A record link as the site opens it: a link written relative to docs/runs/README.md ("../../docs/runs/….md", right in
 * the README) opens the file at the repository's address on the page, where "../../docs/…" is not served.
 */
const siteHref = (href: string) => href.startsWith("../../") ? blob(href.slice("../../".length)) : href;
/** A record's checks as a rate: how many passed, of how many. */
const checkRate = (checks: Record<string, { ok: boolean }>): RunRate => {
  const all = Object.values(checks);
  return { done: all.filter((c) => c.ok).length, of: all.length, what: "checks passed" };
};
const rateWords = (r: RunRate) => `${r.done} of ${r.of} ${r.what}`;
const okOf = (checks: Record<string, { ok: boolean }>) => rateWords(checkRate(checks));
/** What the main run and its rehearsal simulated: the site's one caveat line, without its "Test money." */
const SIMULATED_LINE = CAVEAT_LINE.replace(/^Test money\. /, "");

interface TraceLite { payments: { id: string; kind: string; rail_id?: string; ref: string }[] }

function ledgerRow(key: string, file: string, log: string, title: string, name: string, rehearsal: boolean): RunRow {
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
  const what = `${pl(p.onChain, "Metal payment")}, ${pl(p.cards, "card charge")}, ${pl(p.transfers, "SWIFT transfer")}; ${pl((r.proof as unknown as { face_id: number }).face_id, "CFO Face ID decision")}.`;
  return {
    key, iso: r.recorded_at, date: day(r.recorded_at), title, rails: "Metal testnet, Airwallex sandbox, Claude",
    name, line: `${what} ${SIMULATED_LINE}`, kind: rehearsal ? "rehearsal" : "both", what,
    checks: `${s.reconciliation.checked} money flows reconciled, ${s.reconciliation.differences} differences; audit log ${s.audit.rows} rows, ${s.audit.intact ? "intact" : "broken"}.`,
    money: rehearsal ? "Rehearsal · test money" : "Test money",
    ids, files: [{ label: "record (JSON)", href: blob(file) }, { label: "run log", href: blob(log) }],
  };
}

/**
 * Numbers typed for a row in the old shape, by its key (from its run log). The big numbers per card went on 12 Nov: a
 * row's one line and its rate replace them; what is listed here shows quietly in that row's fold.
 */
const TYPED_STATS: Record<string, RunStat[]> = {};

/** Every live run, newest first. */
export function liveRuns(): RunRow[] {
  const rows: RunRow[] = [];

  // 10 and 12 Nov: two locks on one payout, created 10 Nov and PAID 12 Nov (docs/runs/2026-11-10-airwallex-two-locks.md,
  // docs/runs/2026-11-12-airwallex-two-locks-paid.md). The row is dated at the moment it ended PAID.
  rows.push({
    key: "two-locks-1", iso: "2026-11-12T09:43:58.000Z", date: day("2026-11-12T09:43:58.000Z"), kind: "sandbox",
    name: "One payout, two locks: signed in Purser, then approved in Airwallex's web app",
    line: "Airwallex held EUR 240.00 until the owner approved, then PAID. A test passkey signed; settlement simulated.",
    title: "Two locks on one payout: a test passkey's signature, then a person's approval at Airwallex", rails: "Airwallex sandbox (transfer approval workflow), test passkey",
    what: "Created on 10 Nov: a labelled virtual test passkey (not a person's Face ID) signed the exact terms in Purser, only then did Purser create the EUR 240.00 transfer, and Airwallex's own approval workflow held it IN_APPROVAL with the signed hash in its metadata. On 12 Nov the owner approved it in Airwallex's sandbox web app; it then went PAID (settlement simulated).",
    checks: "Airwallex answered IN_APPROVAL on create and on a read on each day; Purser did not simulate past it or send it again. The first read after the approval showed PROCESSING; the sandbox's simulation endpoint then moved it to SENT and PAID (simulated settlement). A person approved only at Airwallex, not in Purser. 14 Airwallex calls (7 on 10 Nov, 7 on 12 Nov), within the budget the owner raised from 10 to 12 to 14.", money: "Sandbox · test money",
    ids: [{ label: "Transfer", value: "4074d684-4704-406c-a527-2832753baf4f" }, { label: "Request id", value: "c25bfc22-64fe-4ff3-aeb2-102a3684fc19" }, { label: "Short reference", value: "P261110-48HWOJN" }, { label: "Purser proposal", value: "P-0001" }, { label: "Signed terms (SHA-256)", value: "f9ba0fe8758eadbef3b48f23e571ea92e3208f4ebd802703b413a414d444ac28" }],
    files: [{ label: "run log, 12 Nov", href: "../../docs/runs/2026-11-12-airwallex-two-locks-paid.md" }, { label: "run log, 10 Nov", href: "../../docs/runs/2026-11-10-airwallex-two-locks.md" }],
  });

  // 10 Nov: the platform build end to end, three test companies (docs/runs/2026-11-10-platform-e2e.md).
  rows.push({
    key: "platform-e2e-1", iso: "2026-11-10T07:06:03.000Z", date: day("2026-11-10T07:06:03.000Z"), kind: "sandbox",
    name: "Three test companies, each on its own Airwallex account", rate: { done: 1, of: 4, what: "payouts paid" },
    line: "One EUR 4.84 invoice paid and booked in T:0; Airwallex refused the new accounts' payouts. A test passkey signed.",
    title: "Three test companies on their own Airwallex accounts (built after the kit)", rails: "Airwallex sandbox (connected accounts, SEPA payouts), Claude, T:0",
    what: "Purser opened two more connected accounts (3 ACTIVE). Invoices came in by upload and e-mail and were read by Claude. New suppliers and payments were approved with a test passkey (not Face ID). One EUR 4.84 payout went PAID on the company's behalf, with Purser's EUR 0.02 fee taken; it was booked and posted to T:0. The new accounts' payouts were refused by Airwallex.",
    checks: "The receipt verifies offline (signature over the exact terms, 8 hash-chained steps to T:0). Airwallex refused the new accounts' payouts: the paying company's registration number is required (they were opened as non-registered sole traders), and a payer object on the transfer is refused (code 048). 75 Airwallex, 20 Claude and 12 T:0 calls, within the budgets Max approved.", money: "Sandbox · test money",
    ids: [{ label: "Payout PAID", value: "593c340b-1752-4537-9ef2-0eb3558897cc" }, { label: "New accounts", value: "acct_O07lI0VvMLagXlj5aeOgyg, acct_XFhJLpkwNp6lzl8rpySE_Q" }, { label: "T:0 entries", value: "je_prod_wop0vx1B8xOmHQl0, je_prod_WN96JsvKXGCY7mYs" }],
    files: [{ label: "run log", href: "../../docs/runs/2026-11-10-platform-e2e.md" }],
  });

  // 10 Nov: Purser's books of the 3 Nov main run posted to T:0 (docs/runs/2026-11-10-t0-journal-sandbox.md).
  rows.push({
    key: "t0-1", iso: "2026-11-10T06:08:08.750Z", date: day("2026-11-10T06:08:08.750Z"), kind: "sandbox",
    name: "Purser's books posted to T:0 and matched line by line", rate: { done: 95, of: 95, what: "entries posted" },
    line: "The 3 Nov run's books in T:0's shared sandbox: 0 differences; a second push posted 0.",
    title: "The main run's books posted to T:0", rails: "T:0 shared sandbox entity (general ledger)",
    what: "95 journal entries from the 3 Nov books posted to T:0's shared sandbox entity, one at a time, each with an idempotency key.",
    checks: "Debits equal credits (21,141,221.86 USD each); T:0 matches our books line by line, 0 differences; a second push posted 0.", money: "Sandbox · test money",
    ids: [{ label: "First journal entry", value: "je_prod_z7kTCuZ1iiwad01q" }],
    files: [{ label: "run log", href: "../../docs/runs/2026-11-10-t0-journal-sandbox.md" }],
  });

  // 10 Nov: the platform build's connected-accounts runs (docs/runs/2026-11-10-connected-accounts-sandbox.md).
  rows.push({
    key: "connected-1", iso: "2026-11-10T05:02:45.871Z", date: day("2026-11-10T05:02:45.871Z"), kind: "sandbox",
    name: "Purser opens a test company's Airwallex account and pays on its behalf",
    line: "EUR 5.00 paid out, Purser's fee EUR 0.05. Simulated: company, verification, settlement.",
    title: "Connected accounts in the sandbox (built after the kit)", rails: "Airwallex sandbox (connected accounts, payouts)",
    what: "Purser's platform rail opened a connected account for a fake test company; fake verification details, submitted, made ACTIVE by the sandbox's simulation. Then a EUR 5.00 payout on its behalf, with Purser's fee sent as an application fee.",
    checks: "Airwallex accepted the fee at exactly EUR 0.05; the payout went PAID through the sandbox's simulation (settlement simulated, no Face ID on this payout). 17 calls, each within the budget Max approved.", money: "Sandbox · test money",
    ids: [{ label: "Connected account", value: "acct_SC-QD89fOneAeqaRFgOymw" }, { label: "Payout", value: "a9460dba-f31b-4111-be58-6d9a9e71adb1" }],
    files: [{ label: "run log", href: "../../docs/runs/2026-11-10-connected-accounts-sandbox.md" }],
  });

  const v2 = vic2Run() as unknown as { started_at: string; checks: Record<string, { ok: boolean }>; outside_calls: { airi: number; airwallex: number }; audit?: { event: string; payload: { terms_sha256?: string } }[] } | null;
  const v2Terms = v2?.audit?.find((a) => a.event === "proposal.created")?.payload.terms_sha256;
  if (v2) rows.push({
    key: "vic-2", iso: v2.started_at, date: day(v2.started_at), title: "Airi, second run: what Purser adds around it", rails: "Purser relay, CFO passkey",
    name: "A purchase changed after the CFO signed is refused; nothing is bought", kind: "nothing", rate: checkRate(v2.checks),
    // The partners its record shows called: an Airi call is an Airwallex wallet paying with a Visa credential.
    partners: [...(v2.outside_calls.airi + v2.outside_calls.airwallex > 0 ? ["Airwallex" as const] : []), ...(v2.outside_calls.airi > 0 ? ["Visa" as const] : [])],
    line: `Our own test changed it; the CFO's Face ID was real. ${v2.outside_calls.airi} Airi and ${v2.outside_calls.airwallex} Airwallex calls.`,
    what: `A purchase changed after the CFO's Face ID was refused, a shop the CFO locked was refused, and unlocking offered it again. ${v2.outside_calls.airi} Airi and ${v2.outside_calls.airwallex} Airwallex calls.`,
    checks: `${okOf(v2.checks)}.`, money: "Nothing bought",
    ids: v2Terms ? [{ label: "Signed terms (SHA-256)", value: v2Terms }] : [],
    files: [{ label: "record (JSON)", href: blob(VIC2_RUN_FILE) }, { label: "run log", href: blob(VIC2_RUN_LOG) }],
  });

  const ai = airiRun() as unknown as { started_at: string; checks: Record<string, { ok: boolean }>; purchases: { step: string; outcome?: string; payment_intent_id?: string; amount: string; currency: string }[] } | null;
  if (ai) rows.push({
    key: "vic-1", iso: ai.started_at, date: day(ai.started_at), title: "Visa Intelligent Commerce through Airwallex's Airi", rails: "Airi wallet, Airwallex sandbox, test card",
    name: "An agent buys with a single-use Visa card; above the limit, only after Face ID", kind: "sandbox", rate: checkRate(ai.checks),
    line: `${ai.purchases.filter((x) => x.outcome === "SUCCEEDED").length} purchases through Airwallex's Airi wallet, one after Face ID; a disallowed merchant was refused. Test card.`,
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
      name: "Airwallex itself declines an agent's card over the CFO's limit", kind: "sandbox", rate: checkRate(awx.checks),
      line: `Airwallex declined ${awx.card_transactions.filter((c) => !c.approved).length} of ${awx.card_transactions.length} card payments; ${awx.invoices.length} invoices paid after Face ID. SWIFT settlement simulated.`,
      what: `${awx.cards.length} cards, one per agent; ${awx.card_transactions.length} card transactions, declines by Airwallex itself; ${awx.webhooks.length} signed webhooks; ${awx.invoices.length} invoices paid after the CFO's Face ID (SWIFT settlement simulated in the sandbox).`,
      checks: `${okOf(awx.checks)}.`, money: "Sandbox · test money",
      ids: [
        ...(decline ? [{ label: "Declined by Airwallex (LIMIT_EXCEEDED)", value: decline.id }] : []),
        ...(swift?.transfer_id ? [{ label: `SWIFT transfer ${swift.invoice_no}`, value: swift.transfer_id }] : []),
      ],
      files: [{ label: "record (JSON)", href: blob(AWX_RUN_FILE) }, { label: "run log", href: blob(AWX_RUN_LOG) }],
    });
  }

  rows.push({ ...ledgerRow("main-1", AGENT_RUN_FILE, "docs/runs/2026-11-03-main-run.md", "The main run: three agents, one day of work", "Three Claude agents run a company for a day", false), product: true });

  const tap = tapRun();
  if (tap) rows.push({
    key: "tap-1", iso: tap.ranAt, date: day(tap.ranAt), title: "Visa Trusted Agent Protocol: signed agent checkout", rails: "Visa's TAP reference proxy, Airwallex sandbox card",
    name: "A checkout signed with Visa's Trusted Agent Protocol, on an Airwallex card", kind: "sandbox",
    line: `${tap.steps.filter((s) => s.approved).length} approved, ${tap.steps.filter((s) => !s.approved).length} declined by Airwallex over the card's limit. The merchant was simulated.`,
    what: `${tap.steps.length} signed checkouts at a merchant we run: ${tap.steps.filter((s) => s.approved).length} approved, ${tap.steps.filter((s) => !s.approved).length} declined over the card's limit by Airwallex.`,
    checks: `Each charge read back from Airwallex (${tap.steps.map((s) => s.getStatus).join(", ")}).`, money: "Simulated merchant · test money",
    ids: tap.steps.map((s) => ({ label: `Card transaction, ${s.currency} ${s.amount}`, value: s.txId })),
    files: [{ label: "record (JSON)", href: blob(tap.file) }],
  });

  rows.push(ledgerRow("agent-1", AGENT_RUN_1_FILE, "docs/runs/2026-11-02-agent-run-1.md", "Agent run 1, the rehearsal for the main run", "The three-agent day, rehearsed once before the main run", true));

  const metal = readJson<{ recorded_at: string; dispute: { case_id: string; packs: { tx: string }[]; decision: { outcome: string } } }>("docs/demo/metal.json");
  rows.push({
    key: "friday-1", iso: metal.recorded_at, date: day(metal.recorded_at), title: "Friday run 1, with a Dispute desk case", rails: "Metal testnet",
    name: "A customer disputes payments its agent made; Purser answers from the signed orders", kind: "rehearsal",
    line: `${metal.dispute.packs.length} payments disputed as never ordered; each was checked on chain against its signed order (outcome: ${metal.dispute.decision.outcome}). The customer was simulated.`,
    what: `A customer's agent claimed it never ordered ${metal.dispute.packs.length} paid stock checks; Purser answered from the signed orders and the on-chain payments (outcome: ${metal.dispute.decision.outcome}).`,
    checks: "Each disputed payment checked on chain against its signed order.", money: "Rehearsal · test money",
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
const railChip = ([, name, ic, cls]: (typeof RAILS)[number]) => `<span class="rl ${cls}">${icon(ic, 13)}${esc(name)}</span>`;
/**
 * The partners shown as chips and counted by the filters: the row's own list where it has one, else read from its words
 * (T:0 where it took part). A passkey is not a partner: it stays in the fold's rails line.
 */
const partnersOf = (r: RunRow) => r.partners ? RAILS.filter(([, n]) => (r.partners as string[]).includes(n))
  // A simulated run without its own list names the partners it faked: none of them took part.
  : kindOf(r) === "simulated" ? [] : railsOf(r).filter(([, , , cls]) => cls !== "pk");

/** The honest badge: the kind of run, in the words the page shows. */
export const KIND_LABEL: Record<RunKind, string> = {
  sandbox: "Live sandbox", testnet: "Live testnet", both: "Live testnet and sandbox", simulated: "Simulated", rehearsal: "Rehearsal", nothing: "Live, nothing bought",
};
/** Words that say a run, or a part of it, was not real: such a row can claim no more than Simulated. */
const FAKED = /simulat|\bfake|\bmock|\bstub|\bdummy|\bemulat/i;
/**
 * A row's kind: its own, or (a row in the old shape) read from its money words and the payment rails it names. A row
 * whose own money, rails or title words say simulated, fake or mock, or that names no payment partner's sandbox or
 * testnet, is Simulated: the least it can claim. "Rehearsal" is read from the money words only.
 */
export function kindOf(r: Pick<RunRow, "kind" | "title" | "rails" | "money">): RunKind {
  if (r.kind) return r.kind;
  if (/rehearsal|dry run/i.test(r.money)) return "rehearsal";
  if (FAKED.test(`${r.money} ${r.rails} ${r.title}`)) return "simulated";
  if (/no money moved|nothing bought/i.test(r.money)) return "nothing";
  const testnet = /Metal/i.test(r.rails), sandbox = /Airwallex|Airi\b|T:0|sandbox/i.test(r.rails);
  return testnet && sandbox ? "both" : testnet ? "testnet" : sandbox ? "sandbox" : "simulated";
}
const isRehearsal = (r: RunRow) => kindOf(r) === "rehearsal";
const nameOf = (r: RunRow) => r.name ?? r.title;
/** Words whose point does not end a sentence: a month ("12 Nov. at 09:00"), "e.g.", "i.e." and their like. */
const ABBREV = /(?:\b(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|etc|vs|approx|incl|No|Nr|cf|Inc|Ltd|Co)|\be\.g|\bi\.e)$/;
/**
 * The first full sentence of a text: up to the first ".", "!" or "?" followed by a space and a word that starts a
 * sentence, not after an abbreviation (the point in "EUR 4.84", "12 Nov. at 09:00" or "e.g. EUR 0.05" does not end it).
 */
export function firstSentence(text: string): string {
  for (const m of text.matchAll(/[.!?](?=\s+(\S)|\s*$)/g)) {
    const at = m.index!, next = m[1];
    if (next === undefined) return text.slice(0, at + 1);
    if (/[a-z]/.test(next) || ABBREV.test(text.slice(0, at))) continue;
    return text.slice(0, at + 1);
  }
  return text;
}
/** A row's one line: its own, or the first full sentence of what ran. */
const lineOf = (r: RunRow) => r.line ?? firstSentence(r.what);
const newestFirst = (rows: RunRow[]) => [...rows].sort((a, b) => b.iso.localeCompare(a.iso));
/** The last live run, newest first: a run on Purser's own fakes is listed but never dates the last live run. */
const lastLive = (live: RunRow[]) => live.find((r) => kindOf(r) !== "simulated") ?? live[0]!;
/** The main run's "Trace any payment" is a link among its ids, not an id. */
const isId = (i: RunId) => i.value !== "Trace any payment";
/** A record link's words in sight: "JSON" for "record (JSON)", "Log" for "run log" (the full label stays its name). */
const linkWords = (label: string) => label.replace(/^record \(JSON\)$/, "JSON").replace(/^run log/, "Log");
/** The mark on the one run that is the product. */
const PRODUCT_MARK = "The product, end to end";
/** The folder with every run log, the dry runs' too. */
const RUN_LOGS_URL = `${REPO_BLOB.replace("/blob/", "/tree/")}docs/runs`;
/** The runs the docs call by their key (test/runs-page.test.ts finds each name in the docs): the README says so. */
const DOC_NAMES = new Set(["awx-1", "vic-1", "vic-2", "main-1", "agent-1", "friday-1"]);

/**
 * The filters: the four partners, then the kinds. A filter's id is its anchor (/runs#airwallex) and, as f-<id>, the
 * class of every entry it keeps.
 */
const FILTERS: { id: string; label: string; has: (r: RunRow) => boolean }[] = [
  ...["Airwallex", "Metal", "Visa", "Claude"].map((name) => ({ id: name.toLowerCase(), label: name, has: (r: RunRow) => partnersOf(r).some(([, n]) => n === name) })),
  { id: "sandbox", label: KIND_LABEL.sandbox, has: (r) => ["sandbox", "both"].includes(kindOf(r)) },
  { id: "testnet", label: KIND_LABEL.testnet, has: (r) => ["testnet", "both"].includes(kindOf(r)) },
  { id: "simulated", label: KIND_LABEL.simulated, has: (r) => kindOf(r) === "simulated" },
];

const idChip = (i: RunId) => {
  const ext = i.href?.startsWith("http");
  const val = i.href ? `<a class="v" href="${esc(i.href)}"${ext ? ' target="_blank" rel="noopener"' : ""}>${esc(i.value)}${ext ? " ↗" : ""}</a>` : `<code class="v">${esc(i.value)}</code>`;
  const copy = i.href && !ext ? "" : `<button type="button" class="cp" data-copy="${esc(i.value)}" aria-label="Copy ${esc(i.label)}">${icon("copy", 14)}</button>`;
  return `<span class="idc"><span class="k">${esc(i.label)}</span>${val}${copy}</span>`;
};

/**
 * One run, one compact entry. In sight: its date and badge, its name, one line with the links to its record, its
 * partners, its rate and its first id. Behind its one fold (or, in the rehearsals group, which is itself the fold, under
 * it, where the first id is not repeated above): every id in full, what ran, the checks, the rails and the money words.
 */
function entry(r: RunRow, o: { newest?: boolean; folded: boolean }): string {
  const kind = kindOf(r), [first, ...rest] = r.ids;
  // The fold lists every id in full, the first one included: the chip in sight may be cut on a phone (review 12 Nov).
  const more = rest.filter(isId).length;
  const cls = ["run", `k-${kind}`, ...FILTERS.filter((f) => f.has(r)).map((f) => `f-${f.id}`), ...(r.product ? ["prod"] : []), ...(o.newest ? ["newest"] : [])].join(" ");
  // A rate that fell short is not a success: no tick, no green.
  const full = r.rate && r.rate.done === r.rate.of;
  const rate = r.rate ? `<span class="rt${full ? " ok" : ""}">${full ? icon("check", 14) : ""}${esc(rateWords(r.rate))}</span>` : "";
  const files = r.files.map((f) => `<a class="f" href="${esc(siteHref(f.href))}" target="_blank" rel="noopener"${linkWords(f.label) === f.label ? "" : ` aria-label="${esc(f.label)}"`}>${esc(linkWords(f.label))} ↗</a>`).join(" ");
  const fold = `<div class="fold">${r.ids.length ? `<div class="ids">${r.ids.map(idChip).join("")}</div>` : ""}<p>${esc(r.what)}</p><p><b>Checks:</b> ${esc(r.checks)}</p>${r.stats?.length ? `<p class="q">${r.stats.map((x) => `${esc(x.v)} ${esc(x.l)}`).join(" · ")}</p>` : ""}<p class="q">Rails: ${esc(r.rails)}. Money: ${esc(r.money)}.</p></div>`;
  const label = `Ids, what ran and the checks${more ? `: ${pl(more, "more id")}` : ""}`;
  return `<li class="${cls}" id="${esc(r.key)}"><article${o.folded ? ' class="fd"' : ""} aria-label="${esc(nameOf(r))}">
<p class="meta"><time datetime="${esc(r.iso)}" title="${esc(r.date)}">${esc(r.date.replace(/ \d{4}$/, ""))}</time><span class="kd ${kind}">${esc(KIND_LABEL[kind])}</span>${o.newest ? '<span class="mk new">Newest</span>' : ""}${r.product ? `<span class="mk prod">${esc(PRODUCT_MARK)}</span>` : ""}</p>
<h2>${esc(nameOf(r))}</h2>
<p class="ln">${esc(lineOf(r))} ${files}</p>
<div class="ch">${partnersOf(r).map(railChip).join("")}${rate}${first && o.folded ? idChip(first) : ""}</div>
${o.folded ? `<details class="more"><summary aria-label="${esc(label)}">${more ? esc(pl(more, "more id")) : "Checks"}${icon("chevron-down", 16)}</summary>${fold}</details>` : fold}
</article></li>`;
}

/** The filtering, CSS only: a filter's anchor, once it is the target, hides the entries without its class, never the newest. */
const FILTER_CSS = `${FILTERS.map((f) => `#${f.id}:target ~ ol.tl > li.run:not(.f-${f.id}):not(.newest) { display: none; }`).join("\n")}
.runsp nav.flt a.all, ${FILTERS.map((f) => `#${f.id}:target ~ nav.flt a[href="#${f.id}"]`).join(", ")} { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
.runsp .fa:not(#all):target ~ nav.flt a.all { background: var(--surface); border-color: var(--border); color: var(--muted); }`;

const CSS = `.runsp h1 { margin: 24px 0 6px; }
.runsp .last { color: var(--muted); margin: 0 0 12px; font-size: 16px; line-height: 1.5; max-width: 64ch; }
.runsp .fa { position: absolute; top: 0; }
.runsp nav.flt { display: flex; flex-wrap: wrap; gap: 5px; margin: 0 0 6px; }
.runsp nav.flt a { display: inline-flex; align-items: center; gap: 5px; min-height: 44px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--muted); font: 650 13.5px/1 Inter, system-ui, sans-serif; text-decoration: none; white-space: nowrap; }
.runsp nav.flt a b { font-weight: 650; opacity: .75; font-variant-numeric: tabular-nums; }
${FILTER_CSS}
.runsp ol.tl { list-style: none; margin: 0; padding: 0 0 0 20px; position: relative; }
.runsp ol.tl::before { content: ""; position: absolute; left: 5px; top: 20px; bottom: 20px; width: 2px; background: var(--border); }
.runsp li.run { position: relative; scroll-margin-top: 72px; }
.runsp li.run + li.run { border-top: 1px solid var(--border); }
.runsp li.run::before { content: ""; position: absolute; left: -20px; top: 16px; width: 12px; height: 12px; border-radius: 50%; box-sizing: border-box; background: var(--bg); border: 3px solid var(--accent); }
.runsp li.run.k-rehearsal::before, .runsp li.run.k-nothing::before, .runsp li.run.k-simulated::before { border-color: var(--faint); }
.runsp li.run.prod::before { background: var(--accent); }
.runsp article { position: relative; padding: 11px 0 0; }
.runsp .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin: 0; min-height: 22px; }
.runsp article.fd .meta { padding-right: 104px; }
.runsp time { font-size: 14px; color: var(--muted); font-weight: 650; font-variant-numeric: tabular-nums; white-space: nowrap; }
.runsp .kd, .runsp .mk { font: 650 12.5px/1.3 Inter, system-ui, sans-serif; padding: 2px 9px; border-radius: 999px; white-space: nowrap; background: var(--sunken); color: var(--muted); }
.runsp .kd.sandbox, .runsp .kd.testnet, .runsp .kd.both { background: var(--ok-soft); color: var(--ok); }
.runsp .mk.prod { background: var(--accent); color: var(--bg); }
.runsp h2 { font-size: 16.5px; font-weight: 700; line-height: 1.3; margin: 3px 0 0; letter-spacing: -.01em; }
.runsp .ln { margin: 3px 0 0; font-size: 14.5px; line-height: 1.45; color: var(--muted); }
.runsp a.f { display: inline-block; padding: 12px 0; margin: -12px 2px; color: var(--muted); font-weight: 600; white-space: nowrap; }
.runsp .ch { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; margin: 5px 0 0; }
.runsp .rl { display: inline-flex; align-items: center; gap: 4px; font: 650 12.5px/1.3 Inter, system-ui, sans-serif; padding: 2px 8px; border-radius: 999px; background: var(--sunken); color: var(--muted); }
.runsp .rl.awx { background: var(--awx-soft); color: var(--awx); } .runsp .rl.metal { background: var(--metal-soft); color: var(--metal); }
.runsp .rl.claude { background: var(--claude-soft); color: var(--claude); } .runsp .rl.visa { background: var(--accent-soft); color: var(--accent); }
.runsp .rt { display: inline-flex; align-items: center; gap: 3px; margin: 0 4px; font: 650 13px/1.3 Inter, system-ui, sans-serif; color: var(--muted); white-space: nowrap; }
.runsp .rt.ok { color: var(--ok); }
.runsp .idc { display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%; min-height: 44px; font-size: 13px; }
.runsp .idc .k { color: var(--muted); font-weight: 600; white-space: nowrap; }
.runsp .idc .v { font: 500 13px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--text); overflow-wrap: anywhere; min-width: 0; }
.runsp .idc a.v { color: var(--accent); text-decoration: none; padding: 14px 0; } .runsp .idc a.v:hover { text-decoration: underline; }
.runsp .ch .idc { flex: 0 1 auto; } .runsp .ch .idc .k { flex: 0 1 auto; white-space: normal; }
.runsp .fold .idc { flex-wrap: wrap; } .runsp .fold .idc .k { white-space: normal; }
.runsp .ch .idc .v { flex: 0 1000 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 9ch; }
.runsp .cp { flex: none; width: 44px; height: 44px; margin: 0 -12px; border: 0; background: transparent; color: var(--muted); cursor: pointer; border-radius: 10px; display: inline-grid; place-items: center; }
.runsp .cp:hover { color: var(--text); } .runsp .cp.ok { color: var(--ok); }
.runsp summary { list-style: none; cursor: pointer; } .runsp summary::-webkit-details-marker { display: none; }
.runsp summary:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; border-radius: 8px; }
.runsp summary .i { flex: none; transition: transform .15s; } .runsp details[open] > summary .i { transform: rotate(180deg); }
.runsp details.more > summary { position: absolute; top: 0; right: 0; display: flex; align-items: center; gap: 2px; min-height: 44px; padding-left: 10px; color: var(--muted); font: 650 13px/1.2 Inter, system-ui, sans-serif; white-space: nowrap; }
.runsp .fold { font-size: 14.5px; line-height: 1.5; padding: 0 0 10px; }
.runsp .fold p { margin: 4px 0; } .runsp .q { color: var(--muted); font-size: 13.5px; }
.runsp .fold .ids { display: grid; justify-items: start; }
.runsp details.rehs, .runsp details.gloss { border-top: 1px solid var(--border); }
.runsp details.gloss { border-bottom: 1px solid var(--border); }
.runsp details.rehs > summary, .runsp details.gloss > summary { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 48px; font-size: 15px; font-weight: 650; }
.runsp details.rehs > .q { margin: 0 0 8px 20px; }
.runsp .gloss dl { display: grid; grid-template-columns: minmax(0, 12em) minmax(0, 1fr); gap: 4px 12px; margin: 0 0 12px; font-size: 14px; }
.runsp .gloss dt { color: var(--muted); } .runsp .gloss dd { margin: 0; overflow-wrap: anywhere; }
.runsp .more-links { display: flex; flex-wrap: wrap; align-items: center; gap: 0 16px; margin: 4px 0 0; font-size: 14.5px; color: var(--muted); }
.runsp .more-links a { display: inline-flex; align-items: center; min-height: 44px; }
@media (max-width: 560px) { .runsp .gloss dl { grid-template-columns: minmax(0, 1fr); } }
@media (min-width: 760px) {
  .runsp article { display: grid; grid-template-columns: 180px minmax(0, 1fr); column-gap: 20px; padding: 14px 0 4px; }
  .runsp article > * { grid-column: 2; }
  .runsp article .meta { grid-column: 1; grid-row: 1 / span 4; flex-direction: column; align-items: flex-start; gap: 6px; padding-right: 0; }
  .runsp li.run::before { top: 19px; }
  .runsp h2 { font-size: 18px; margin: 0; } .runsp article.fd h2 { padding-right: 120px; }
  .runsp .ln { font-size: 15px; max-width: 80ch; }
}`;

const COPY_JS = `document.querySelectorAll("button.cp").forEach(function (b) {
  if (!navigator.clipboard) { b.hidden = true; return; }
  b.addEventListener("click", function () { navigator.clipboard.writeText(b.dataset.copy || "").then(function () { b.classList.add("ok"); setTimeout(function () { b.classList.remove("ok"); }, 1200); }); });
});`;

/** Names the active filter for a screen reader (aria-current). The filtering itself is CSS and needs no script. */
const FILTER_JS = `(function () {
  var links = document.querySelectorAll("nav.flt a");
  function mark() {
    var on = links[0];
    links.forEach(function (a) { if (a.getAttribute("href") === location.hash) on = a; });
    links.forEach(function (a) { if (a === on) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current"); });
  }
  mark();
  window.addEventListener("hashchange", mark);
})();`;

export function runsPage(all: RunRow[] = liveRuns()): string {
  const rows = newestFirst(all), live = rows.filter((r) => !isRehearsal(r)), rehearsals = rows.filter(isRehearsal);
  const last = lastLive(live);
  const filters = FILTERS.map((f) => ({ ...f, n: live.filter(f.has).length })).filter((f) => f.n > 0);
  const chevron = icon("chevron-down", 16);
  const body = `<main class="wrap runsp">
<h1>${esc(RUNS_TITLE)}</h1>
<p class="last">Last live run: ${esc(last.date)}. ${pl(live.length, "live run")}, newest first, every id from its own record. Test money only; what was simulated is said on each run.</p>
<span class="fa" id="all"></span>${filters.map((f) => `<span class="fa" id="${f.id}"></span>`).join("")}
<nav class="flt" aria-label="Filter the runs"><a class="all" href="#all">All <b>${live.length}</b></a>${filters.map((f) => `<a href="#${f.id}">${esc(f.label)} <b>${f.n}</b></a>`).join("")}</nav>
<ol class="tl">
${live.map((r, i) => entry(r, { newest: i === 0, folded: true })).join("\n")}
</ol>
${rehearsals.length ? `<details class="rehs" id="rehearsals"><summary>Rehearsals and dry runs · ${rehearsals.length}${chevron}</summary>
<ol class="tl">
${rehearsals.map((r) => entry(r, { folded: false })).join("\n")}
</ol>
<p class="q">Every dry run's log: <a class="f" href="${esc(RUN_LOGS_URL)}" target="_blank" rel="noopener">docs/runs on GitHub ↗</a></p></details>` : ""}
<details class="gloss"><summary>What the main run's record holds (docs/demo/main-run.json)${chevron}</summary><dl>
${MAIN_RUN_GLOSSARY.map(([k, v]) => `<dt><code>${esc(k)}</code></dt><dd>${esc(v)}</dd>`).join("")}
</dl></details>
<p class="more-links">Per agent: <a href="agents/sourcing">Sourcing</a><a href="agents/support">Support</a><a href="agents/treasury">Treasury</a><a href="trace">Trace any payment</a><a href="proof">Proof</a></p>
</main>`;
  return page({
    title: `Purser · ${RUNS_TITLE}`, description: `Every live run of Purser, newest first, with its ids, checks and records. Last live run: ${last.date}.`, tab: null, css: CSS, body,
    js: `${COPY_JS}\n${OPEN_TARGET_JS}\n${FILTER_JS}`, stage: false,
    source: "Source: each run's record in docs/demo and docs/runs (listed per run).",
  });
}

/** Text for one Markdown table cell: backslashes escaped first, then the pipes that would end the cell. */
export const mdCell = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");

/** docs/runs/README.md, generated from the same rows (npx tsx src/cli/runs-readme.ts). */
export function runsReadme(all: RunRow[] = liveRuns()): string {
  const rows = newestFirst(all), live = rows.filter((r) => !isRehearsal(r)), rehearsals = rows.filter(isRehearsal);
  const cell = mdCell;
  const idCell = (i: RunId) => `${i.label}: ${i.href?.startsWith("http") ? `[\`${i.value}\`](${i.href})` : `\`${i.value}\``}`;
  const ids = (r: RunRow) => r.ids.filter(isId).map((i) => cell(idCell(i))).join("<br>");
  const files = (r: RunRow) => r.files.map((f) => `[${f.label}](${f.href.replace(REPO_BLOB, "../../")})`).join("<br>");
  // The money words the kind does not already say ("Rehearsal · test money" after "Rehearsal": "test money").
  const money = (r: RunRow) => r.money.split(" · ").filter((w) => !KIND_LABEL[kindOf(r)].toLowerCase().includes(w.toLowerCase()));
  // The plain name, the name the docs use where they use one, then the kind, the mark, the rate and the money words.
  const run = (r: RunRow) => `**${cell(nameOf(r))}**${DOC_NAMES.has(r.key) ? ` (in the docs: \`${r.key}\`)` : ""}<br>${[KIND_LABEL[kindOf(r)], ...(r.product ? [PRODUCT_MARK] : []), ...(r.rate ? [rateWords(r.rate)] : []), ...money(r)].map(cell).join(" · ")}`;
  return `# Live runs

Every live run, newest first, generated from the records by \`src/redesign/runs.ts\` (\`npx tsx src/cli/runs-readme.ts\`).
The same list is on the site at [/runs](https://kit11.max-31b.workers.dev/runs). Test money only; what is simulated is
said per run. The other files in this folder are build notes, dry runs and rehearsals.

**Last live run:** ${lastLive(live).date}.

| Date | Run | Rails | What ran | Checks | Key ids | Files |
|---|---|---|---|---|---|---|
${live.map((r) => `| ${r.date} | ${run(r)} | ${cell(r.rails)} | ${cell(r.what)} | ${cell(r.checks)} | ${ids(r)} | ${files(r)} |`).join("\n")}

## Rehearsals and dry runs

Not counted as live runs. The dry runs' logs are the other files in this folder.

| Date | Run | What ran | Key ids | Files |
|---|---|---|---|---|
${rehearsals.map((r) => `| ${r.date} | ${run(r)} | ${cell(r.what)} | ${ids(r)} | ${files(r)} |`).join("\n")}

## What \`docs/demo/main-run.json\` holds

| Field | What it holds |
|---|---|
${MAIN_RUN_GLOSSARY.map(([k, v]) => `| \`${k}\` | ${cell(v)} |`).join("\n")}
`;
}
