// The premiere (docs/video/premiere-script.md): Purser in under three minutes, a premiere-style film made from the main
// run of 3 November (docs/demo/main-run.json). Every number on screen and in the voice-over is read here, through
// code, each with where it comes from: the run's record for everything about the run, the README's test line for the
// test count, and the /try/sign page's own code for its mock. A number that cannot be found stops the build, so the
// film is never rendered with a figure typed in by hand (test/premiere.test.ts). The page (src/film/premiere.html)
// only places these strings; it computes no figure of its own.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { FIXED_PROPOSALS, TEST_WORLD, canonical, checkPayment, proposalTerms } from "../../worker/src/trySign.js";
import { TRY_SIGN_LABEL } from "../try/sign.js";

/** The run the premiere tells, and nothing else. */
export const MAIN_RUN_FILE = "docs/demo/main-run.json";
/** The hosted page a viewer can try (live since 4 November): the end card and the /try/sign scene. */
export const TRY_SIGN_URL = "https://kit11.max-31b.workers.dev/try/sign";

// ---- The record, as far as the film reads it ----

interface LedgerEvent { seq: number; ts: string; actor: string; event: string; subject: string | null; payload: Record<string, unknown> }
interface Proposal { proposal_id: string; kind: string; status: string; created_by: string; created_at: string; terms: Record<string, unknown> }
interface Dispute {
  dispute_id: string;
  claims: { customer: string; sale_refs: number[]; claims: string[]; excerpts: string[] };
  evidence: { sale_id: number; signed_order: boolean }[];
}
interface Flow { at: string; kind: string; agent: string | null; amount: string; count?: number; what: string; refused?: { by: string; reason: string } | null; proof: { href: string | null; full?: string | null } }
export interface MainRun {
  run: string;
  recorded_at: string;
  snapshot: {
    audit: { rows: number; head: string; intact: boolean };
    flows: Flow[];
    agent_stats: { agent: string; decisions: number; by_claude: number; fallback: number }[];
  };
  ledger?: { events: LedgerEvent[]; proposals: Proposal[]; disputes: Dispute[] };
}

/** A figure the film shows or says, with where it comes from (the source column of the script). */
export interface Fact { value: string; source: string }

/** One line of the voice-over: when it starts (seconds into its scene), who says it, the words. */
export interface VoiceLine { at: number; who: "Max" | "Voice"; text: string }

export interface PremiereData {
  facts: Record<string, Fact>;
  /** What each scene shows, by scene id: every string on screen, built from the facts. */
  screen: Record<string, Record<string, unknown>>;
  /** What is said over each scene, by scene id. */
  voice: Record<string, VoiceLine[]>;
}

// ---- Small helpers ----

class Missing extends Error {}
/** Stops the build: the film never shows a figure it cannot find. */
function need<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined || v === "" || (typeof v === "number" && !Number.isFinite(v))) throw new Missing(`premiere: the main run's record has no ${what}; nothing is rendered without it`);
  return v;
}
const str = (v: unknown, what: string) => need(typeof v === "string" || typeof v === "number" ? String(v) : null, what);
/** "11:23:33" from an ISO time (the run's clock is UTC). */
const hms = (iso: string) => need(/T(\d\d:\d\d:\d\d)/.exec(iso)?.[1], `a time in "${iso}"`);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDay = (iso: string) => { const d = new Date(need(Date.parse(iso), `a date in "${iso}"`)); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
/** Money the way the pages write it: EUR 1,850.00 (the /try/sign page's own format). */
const eur = (s: string) => `EUR ${s.replace(/\B(?=(\d{3})+\.)/g, ",")}`;
const cents = (s: string) => { if (!/^\d+\.\d{2}$/.test(s)) throw new Missing(`premiere: "${s}" is not an amount`); return Number(s.replace(".", "")); };
const fromCents = (c: number) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
const short = (h: string, a = 10, b = 4) => `${h.slice(0, a)}…${h.slice(-b)}`;
const family = (model: unknown) => need(/claude-(haiku|sonnet|opus)/i.exec(String(model ?? ""))?.[1], `a Claude model in "${String(model)}"`).replace(/^./, (c) => c.toUpperCase());
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
/** A small count as it is said: "twelve", "twenty-four". */
export function spoken(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) throw new Missing(`premiere: ${n} is not a count the voice-over says in words`);
  return n < 20 ? WORDS[n]! : `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${WORDS[n % 10]}` : ""}`;
}
const cap1 = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

/** The README's test line ("**2181 tests in 241 files, all passing**"), read when the film is built. */
export function testLine(readme: string): { tests: string; files: string } {
  const m = /\*\*(\d[\d,]*) tests in (\d[\d,]*) files, all passing\*\*/.exec(readme);
  if (!m) throw new Missing("premiere: the README has no test line (\"**N tests in M files, all passing**\"); nothing is rendered without it");
  return { tests: m[1]!.replace(/,/g, ""), files: m[2]!.replace(/,/g, "") };
}

// ---- The /try/sign mock: the live page's own words and figures ----

/** Lines the mock shows word for word; test/premiere.test.ts finds each on the page itself (src/try/sign.ts). */
export const TRY_SIGN_WORDS = {
  eyebrow: "Try it yourself", h1: "Sign with your own Face ID", tag: "fixed text, no model call",
  check: "Check: pass · waiting for a person", hashNote: "The hash of the exact terms, which your passkey signs (checked on this device):",
  sign: "Sign with Face ID", done: "Signed, verified and executed in your test world.", signed: "Signed", verified: "Verified by the server", executed: "Executed in your test world",
  tamper: "Try to tamper: change the amount by 0.01", refused: "Refused: the same signature does not verify for the changed terms",
} as const;

/** The proposal a visitor signs on /try/sign (the one that waits for a person), as the page's code has it. */
export function trySignExample() {
  const p = need(FIXED_PROPOSALS.find((x) => checkPayment(x.amount, TEST_WORLD.balance).check === "pass"), "/try/sign proposal that waits for a person");
  const check = checkPayment(p.amount, TEST_WORLD.balance);
  // The terms of an example world (the live page binds them to the visitor's own world id and expiry): a real hash of
  // real example terms, so the mock shows what the page shows, not a made-up string.
  const world = createHash("sha256").update("premiere example world").digest("hex").slice(0, 16);
  const terms = proposalTerms(p, world, "2026-11-04T12:00:00.000Z");
  const tampered = { ...terms, amount: fromCents(cents(p.amount) + 1) };
  const sha = (t: typeof terms) => createHash("sha256").update(canonical(t)).digest("hex");
  return { p, terms, tampered, waits: check.check === "pass" ? check.waits : "", hash: sha(terms), tamperedAmount: String(tampered.amount), tamperedHash: sha(tampered) };
}

// ---- The facts ----

/**
 * Every figure the film shows or says, each from the record (or the README's test line, or the /try/sign page's code),
 * with its source. Throws, naming what is missing, when the record lacks one.
 */
export function premiereFacts(r: MainRun, readme: string): Record<string, Fact> {
  const ev = need(r.ledger?.events, "ledger (events)");
  const proposals = need(r.ledger?.proposals, "ledger (proposals)");
  const one = (name: string, f: (e: LedgerEvent) => boolean = () => true) => need(ev.find((e) => e.event === name && f(e)), `"${name}" row in its ledger`);
  const F: Record<string, Fact> = {};
  const fact = (key: string, value: unknown, source: string) => { F[key] = { value: str(value, key), source }; };

  // The run.
  fact("run.day", longDay(need(ev[0], "first ledger row").ts), "record `ledger.events[].ts` (the run's own rows)");

  // The price rise: one purchase let through to Metal on purpose, refused by Metal, the refusal put on chain.
  const lt = one("upstream.let_through");
  const ltRefused = one("upstream.let_through_refused", (e) => e.subject === lt.subject);
  const onChain = one("upstream.refused_on_chain", (e) => e.subject === lt.subject && e.payload.let_through === true);
  const metalRefused = one("upstream.refused", (e) => e.subject === lt.subject && e.payload.refused_by === "metal");
  const flow = need(r.snapshot.flows.find((f) => f.proof.full === onChain.payload.tx), "money movement for the on-chain refusal");
  const before = need(r.snapshot.flows.find((f) => f.kind === "upstream" && f.what === flow.what && !f.refused && Date.parse(f.at) < Date.parse(lt.ts)), `purchase from ${flow.what} before the price rise`);
  fact("price.supplier", flow.what, "record `snapshot.flows` (the refused purchase's supplier)");
  fact("price.old", (Number(need(before.amount, "first purchase's amount")) / need(before.count ?? 1, "first purchases' count")).toFixed(2), `record \`snapshot.flows\`: ${before.what}'s purchases before the rise, ${before.amount} for ${before.count ?? 1}`);
  fact("price.new", lt.payload.amount, `record \`ledger.events\` \`upstream.let_through\` (seq ${lt.seq})`);
  fact("price.cap", lt.payload.bound_cap, `record \`ledger.events\` \`upstream.let_through\` (seq ${lt.seq}), the mandate's cap`);
  fact("price.query", lt.subject, `record \`ledger.events\` \`upstream.let_through\` (seq ${lt.seq}), the query`);
  fact("price.reason", ltRefused.payload.metal_reason ?? metalRefused.payload.reason, `record \`ledger.events\` \`upstream.let_through_refused\` (seq ${ltRefused.seq})`);
  fact("price.label", ltRefused.payload.label, `record \`ledger.events\` \`upstream.let_through_refused\` (seq ${ltRefused.seq}), the run's own label`);
  fact("price.tx", onChain.payload.tx, `record \`ledger.events\` \`upstream.refused_on_chain\` (seq ${onChain.seq})`);
  fact("price.txAt", hms(onChain.ts), `record \`ledger.events\` \`upstream.refused_on_chain\` (seq ${onChain.seq}), UTC`);
  fact("price.explorer", need(/^https:\/\/([^/]+)\//.exec(flow.proof.href ?? "")?.[1], "explorer link for the refusal"), "record `snapshot.flows[].proof.href`");

  // The dispute: twelve orders claimed never placed, all signed; the wrong ones refunded by Support; the rest rejected.
  const d = need(r.ledger?.disputes?.[0], "dispute case");
  const orders = need(d.claims.sale_refs?.length ? d.claims.sale_refs : null, "disputed orders");
  const signed = d.evidence.filter((e) => e.signed_order && orders.includes(e.sale_id));
  const refunds = ev.filter((e) => e.event === "refund.paid" && e.actor === "support");
  need(refunds.length || null, "refund by the Support agent");
  const batch = need(proposals.find((p) => p.kind === "refund_batch" && p.status === "REJECTED"), "rejected refund batch");
  const rejected = one("proposal.rejected", (e) => e.subject === batch.proposal_id && /\bmax\b/.test(String(e.payload.approver)) && e.payload.method === "passkey");
  const rest = need((batch.terms.refunds as unknown[] | undefined)?.length, "refunds in the rejected batch");
  if (rest + refunds.length !== orders.length) throw new Missing(`premiere: ${refunds.length} refunded and ${rest} rejected do not add up to the ${orders.length} disputed orders`);
  const claim = need(/^(.*?)\s*\([^)]*\)\.$/.exec(d.claims.excerpts?.[0] ?? "")?.[1], "customer's claim (its first sentence)");
  fact("dispute.customer", d.claims.customer, "record `ledger.disputes[0].claims.customer`");
  fact("dispute.claim", `${claim}.`, "record `ledger.disputes[0].claims.excerpts[0]` (its words, the bracket left out)");
  fact("dispute.orders", orders.map((n) => `#${n}`).join(" "), "record `ledger.disputes[0].claims.sale_refs`");
  fact("dispute.count", orders.length, "record `ledger.disputes[0].claims.sale_refs` (counted)");
  fact("dispute.signed", signed.length, "record `ledger.disputes[0].evidence[].signed_order` (counted)");
  fact("dispute.refunded", refunds.map((e) => `#${e.subject}`).join(" "), "record `ledger.events` `refund.paid` by the Support agent");
  fact("dispute.refundCount", refunds.length, "record `ledger.events` `refund.paid` (counted)");
  fact("dispute.refundTotal", fromCents(refunds.reduce((n, e) => n + cents(str(e.payload.amount, "refund amount")), 0)), "record `ledger.events` `refund.paid` (summed)");
  fact("dispute.rest", rest, `record \`ledger.proposals\` ${batch.proposal_id} (\`refund_batch\`, its refunds counted)`);
  fact("dispute.proposal", batch.proposal_id, "record `ledger.proposals` (the rejected `refund_batch`)");
  fact("dispute.rejectedAt", hms(rejected.ts), `record \`ledger.events\` \`proposal.rejected\` (seq ${rejected.seq}), UTC`);
  const faceIds = new Set(ev.filter((e) => /^proposal\.(approved|rejected)$/.test(e.event) && /\bmax\b/.test(String(e.payload.approver)) && e.payload.method === "passkey").map((e) => e.subject));
  fact("run.faceIds", need(faceIds.size || null, "decision by Max's Face ID"), "record `ledger.events` `proposal.approved` and `proposal.rejected` with Max's passkey (proposals counted once)");

  // The licence: the Treasury agent's plan, the CFO's Face ID, FX then SWIFT, PAID.
  const paid = one("transfer.status", (e) => e.payload.status === "PAID");
  const executed = one("proposal.executed", (e) => e.payload.transfer_id === paid.subject);
  const p = need(proposals.find((x) => x.proposal_id === executed.subject), `proposal ${executed.subject}`);
  const created = one("proposal.created", (e) => e.subject === p.proposal_id);
  const approved = one("proposal.approved", (e) => e.subject === p.proposal_id && /\bmax\b/.test(String(e.payload.approver)) && e.payload.method === "passkey");
  const fx = one("fx.converted", (e) => (e.payload.origin as { proposal_id?: string } | undefined)?.proposal_id === p.proposal_id);
  const transfer = one("transfer.created", (e) => e.subject === paid.subject);
  const fee = one("transfer.fee", (e) => e.subject === paid.subject);
  const conv = need(p.terms.conversion as { buy_currency?: string; buy_amount?: string; sell_currency?: string; sell_amount?: string } | undefined, `${p.proposal_id}'s conversion`);
  const origin = need(created.payload.origin as { agent?: string; model?: string } | undefined, `${p.proposal_id}'s origin`);
  const seconds = Math.round((Date.parse(paid.ts) - Date.parse(approved.ts)) / 1000);
  fact("licence.proposal", p.proposal_id, "record `ledger.proposals` (the proposal that paid the transfer)");
  fact("licence.by", need(origin.agent === p.created_by ? `${cap1(p.created_by)} agent` : null, `${p.proposal_id}'s planner`), `record \`ledger.proposals\` ${p.proposal_id} \`created_by\``);
  fact("licence.model", family(origin.model), `record \`ledger.events\` \`proposal.created\` (seq ${created.seq}), its origin's model`);
  fact("licence.vendor", p.terms.vendor, `record \`ledger.proposals\` ${p.proposal_id} terms`);
  fact("licence.invoice", p.terms.invoice_no, `record \`ledger.proposals\` ${p.proposal_id} terms`);
  fact("licence.amount", `${str(p.terms.currency, "currency")} ${str(p.terms.amount, "amount")}`, `record \`ledger.proposals\` ${p.proposal_id} terms`);
  fact("licence.method", p.terms.method, `record \`ledger.proposals\` ${p.proposal_id} terms`);
  fact("licence.feeMax", `${str(p.terms.currency, "currency")} ${str(p.terms.fee_max, "fee ceiling")}`, `record \`ledger.proposals\` ${p.proposal_id} terms`);
  fact("licence.fxBuy", `${str(conv.buy_currency, "FX buy currency")} ${str(conv.buy_amount, "FX buy amount")}`, `record \`ledger.proposals\` ${p.proposal_id} terms (conversion)`);
  fact("licence.fxSell", `${str(conv.sell_currency, "FX sell currency")} ${str(conv.sell_amount, "FX sell amount")}`, `record \`ledger.proposals\` ${p.proposal_id} terms (conversion)`);
  fact("licence.hash", need(approved.payload.terms_sha256 === created.payload.terms_sha256 ? approved.payload.terms_sha256 : null, `${p.proposal_id}'s terms hash, the same when planned and approved`), `record \`ledger.events\` \`proposal.approved\` (seq ${approved.seq}), \`terms_sha256\``);
  fact("licence.expires", hms(str(p.terms.expires_at, "expiry")), `record \`ledger.proposals\` ${p.proposal_id} terms, UTC`);
  fact("paid.faceAt", hms(approved.ts), `record \`ledger.events\` \`proposal.approved\` (seq ${approved.seq}), UTC`);
  fact("paid.fxAt", hms(fx.ts), `record \`ledger.events\` \`fx.converted\` (seq ${fx.seq}), UTC`);
  fact("paid.createdAt", hms(transfer.ts), `record \`ledger.events\` \`transfer.created\` (seq ${transfer.seq}), UTC`);
  fact("paid.paidAt", hms(paid.ts), `record \`ledger.events\` \`transfer.status\` PAID (seq ${paid.seq}), UTC`);
  fact("paid.seconds", need(seconds > 0 ? seconds : null, "time from Face ID to PAID"), `record \`ledger.events\`: ${approved.ts.slice(11, 23)} (Face ID, seq ${approved.seq}) to ${paid.ts.slice(11, 23)} (PAID, seq ${paid.seq}), rounded`);
  fact("paid.transfer", paid.subject, `record \`ledger.events\` \`transfer.status\` PAID (seq ${paid.seq})`);
  fact("paid.fee", fee.payload.fee, `record \`ledger.events\` \`transfer.fee\` (seq ${fee.seq})`);
  fact("paid.conversion", fx.subject, `record \`ledger.events\` \`fx.converted\` (seq ${fx.seq})`);

  // The figures on the spec cards.
  const t = testLine(readme);
  fact("specs.tests", t.tests, "README.md's test line, read when the film is built (CI runs the same suite)");
  fact("specs.files", t.files, "README.md's test line");
  const audit = r.snapshot.audit;
  need(audit?.intact ? audit.rows : null, "intact audit chain");
  fact("specs.auditRows", audit.rows, "record `snapshot.audit.rows`, with `intact: true`");
  const stops = {
    metal: ev.filter((e) => e.event === "upstream.refused" && e.payload.refused_by === "metal" && e.payload.reason === "mandate_cap_exceeded").length,
    cfo: ev.filter((e) => e.event === "proposal.rejected" && /\bmax\b/.test(String(e.payload.approver))).length,
    airwallex: ev.filter((e) => e.event === "card.charge_declined").length,
  };
  fact("specs.stopped", need(stops.metal + stops.cfo + stops.airwallex || null, "payment stopped at a limit"), "record `ledger.events`: Metal's refusals at the cap (`upstream.refused`, `mandate_cap_exceeded`), the CFO's rejections (`proposal.rejected`), Airwallex's declines (`card.charge_declined`); a refusal of a just-replaced mandate (`mandate_revoked`) is not a limit");
  fact("specs.stoppedMetal", stops.metal, "record `ledger.events` `upstream.refused` by Metal, `mandate_cap_exceeded`");
  fact("specs.stoppedCfo", stops.cfo, "record `ledger.events` `proposal.rejected` with Max's passkey");
  fact("specs.stoppedAirwallex", stops.airwallex, "record `ledger.events` `card.charge_declined`");
  const st = need(r.snapshot.agent_stats?.length ? r.snapshot.agent_stats : null, "agent statistics");
  fact("run.agents", st.length, "record `snapshot.agent_stats` (one row per agent)");
  const sum = (k: "decisions" | "by_claude" | "fallback") => st.reduce((n, a) => n + need(a[k], `${a.agent}'s ${k}`), 0);
  fact("specs.decisions", need(sum("decisions") || null, "decisions"), "record `snapshot.agent_stats[].decisions` (summed)");
  fact("specs.byClaude", sum("by_claude"), "record `snapshot.agent_stats[].by_claude` (summed)");
  fact("specs.fallbacks", sum("fallback"), "record `snapshot.agent_stats[].fallback` (summed)");
  for (const a of ["sourcing", "support", "treasury"]) fact(`specs.${a}`, need(st.find((x) => x.agent === a), `${a} agent's statistics`).decisions, `record \`snapshot.agent_stats\` (${a})`);

  // The /try/sign mock: the live page's own proposal and its tamper step (+0.01), from the page's code.
  const m = trySignExample();
  fact("try.proposal", m.p.id, "`FIXED_PROPOSALS` in worker/src/trySign.ts (the page's own proposal)");
  fact("try.amount", eur(m.p.amount), "`FIXED_PROPOSALS` in worker/src/trySign.ts");
  fact("try.tampered", eur(m.tamperedAmount), "the page's tamper step: the amount plus 0.01 (src/try/sign.ts)");
  fact("try.aloneLimit", eur(TEST_WORLD.alone_limit), "`TEST_WORLD` in worker/src/trySign.ts");
  fact("try.hash", m.hash, "SHA-256 of the proposal's canonical terms in an example world (`proposalTerms`, `canonical`)");
  fact("try.tamperedHash", m.tamperedHash, "SHA-256 of the same terms with the amount plus 0.01");
  return F;
}

// ---- What each scene shows and says ----

/** The film's data: the facts, the strings on screen and the voice-over. Throws when a figure is missing. */
export function buildPremiere(r: MainRun, readme: string): PremiereData {
  const F = premiereFacts(r, readme);
  const v = (k: string) => need(F[k], k).value;
  const n = (k: string) => Number(v(k));
  const m = trySignExample();
  const site = TRY_SIGN_URL.replace(/^https:\/\//, "").replace(/\/try\/sign$/, "");

  const screen: PremiereData["screen"] = {
    "01-line": { line: "AI agents can now spend money." },
    "02-hook": { slot: "Optional · an AI hook, at most 10 seconds", note: "Labelled “AI-generated” on screen. No logos.", label: "AI-generated" },
    "03-pen": { question: "So who holds the pen?", title: "Purser", sub: "Starter Kit 11" },
    "04-architecture": {
      kicker: "How Purser works",
      nodes: [
        { t: "Agent", s: "a Claude agent proposes" },
        { t: "Rules", s: "code checks the limits" },
        { t: "Person", s: "Face ID, beyond the limits" },
        { t: "Airwallex or Metal", s: "moves the test money" },
        { t: "Books", s: "every movement, double-entry" },
      ],
      t0: "T:0: built, not yet live",
    },
    "05-price-rise": {
      kicker: `The main run · ${v("run.day")} · test money`,
      supplier: v("price.supplier"), rise: "raised its price",
      from: v("price.old"), to: v("price.new"), unit: "test USD a stock check",
      cap: `The Sourcing agent's mandate on Metal: at most ${v("price.cap")} a payment`, capValue: v("price.cap"), capTag: `cap ${v("price.cap")}`,
      letThrough: "Let through on purpose. Purser normally refuses first.",
      refused: "Metal refused it.", reason: `${v("price.reason")} · nothing moved`,
      txLabel: "The refusal, on chain", tx: short(v("price.tx")), txFull: v("price.tx"), txWhere: `${v("price.explorer")} · ${v("price.txAt")} UTC`,
      label: v("price.label"),
    },
    "06-dispute": {
      kicker: `The dispute · ${v("dispute.customer")}, a simulated customer`,
      claim: `“${v("dispute.claim")}”`,
      orders: v("dispute.orders").split(" "), refunded: v("dispute.refunded").split(" "),
      signed: `${v("dispute.signed")} of ${v("dispute.count")} signed by its own agent`, signedOf: `of ${v("dispute.count")} signed by its own agent`,
      refundLine: `${v("dispute.refundCount")} with wrong data: refunded by the Support agent · ${v("dispute.refundTotal")} test USD`,
      rest: `“Refund the other ${v("dispute.rest")}”`, rejected: "Rejected · Face ID", rejectedWhen: `${v("dispute.proposal")} · the CFO, ${v("dispute.rejectedAt")} UTC`,
    },
    "07-approval": {
      pid: `${v("licence.proposal")} · waits for your Face ID`,
      what: `Pay ${v("licence.vendor")} ${v("licence.amount")} by ${v("licence.method")}`,
      rows: [["Invoice", v("licence.invoice")], ["Buy first", `${v("licence.fxBuy")} for ${v("licence.fxSell")}`], ["Fee at most", v("licence.feeMax")], ["Planned by", `${v("licence.by")} · Claude ${v("licence.model")}`], ["Expires", `${v("licence.expires")} UTC`]],
      hashLabel: "Terms hash", hash: short(v("licence.hash"), 16, 8), button: "Confirm with Face ID",
      side: ["The exact terms.", "And their hash."], caption: `Drawn from ${v("licence.proposal")}'s exact terms in the record, planned by the ${v("licence.by")}.`,
    },
    "08-faceid": {
      slot: "Recording slot · Max's iPhone · Face ID", note: "Max films the Face ID approval on his own phone.",
      label: "Max's iPhone · real Face ID · filmed after the run, on a test proposal (test money)",
      sub: `In the main run: ${v("licence.proposal")} approved with Face ID at ${v("paid.faceAt")} UTC`,
    },
    "09-six-seconds": {
      big: v("paid.seconds"), unit: n("paid.seconds") === 1 ? "second" : "seconds", line: "from Face ID to PAID",
      steps: [[v("paid.faceAt"), "Face ID"], [v("paid.fxAt"), `FX · ${v("licence.fxBuy")} for ${v("licence.fxSell")}`], [v("paid.createdAt"), `${v("licence.method")} · ${v("licence.amount")}`], [v("paid.paidAt"), "PAID"]],
      transferLabel: "Airwallex sandbox transfer", transfer: v("paid.transfer"), detail: `${v("licence.amount")} by ${v("licence.method")} · fee ${v("paid.fee")} (at most ${v("licence.feeMax")})`,
      look: "Look it up yourself.", where: `Every id of the run: ${site}/proof`,
      foot: "The sandbox simulates a SWIFT transfer's last steps (SENT, PAID). Test money.",
    },
    "10-try-sign": {
      label: TRY_SIGN_LABEL, url: TRY_SIGN_URL.replace(/^https:\/\//, ""), ...TRY_SIGN_WORDS,
      agent: m.p.agent, says: m.p.says, facts: [["Pay", m.p.payee], ["Amount", v("try.amount")], ["Reference", m.p.reference], ["Proposal", v("try.proposal")]],
      waits: m.waits, hash: v("try.hash"),
      side: ["Your turn.", "Your own test world.", "Your own test passkey.", "Sign the exact terms with Face ID.", "The server checks the signature."],
      mockNote: "A mock of the live page, drawn from its code",
      overlay: "Max's iPhone · the live page",
    },
    "11-one-cent": {
      from: v("try.amount"), plus: "+0.01", to: v("try.tampered"),
      hashes: `Terms hash ${short(v("try.hash"), 8, 4)} → ${short(v("try.tamperedHash"), 8, 4)}`,
      refused: TRY_SIGN_WORDS.refused, last: "One cent. Worthless.",
    },
    "12-why-face-id": {
      q: "Why Face ID, not a password?",
      a: ["A password is the same for every payment;", "Face ID signs the hash of these exact terms:", "change anything after signing, and the signature is worthless."],
    },
    "13-specs": {
      cards: [
        { big: v("specs.tests"), label: "tests, all passing", small: "npx vitest run · CI runs the same suite on every push" },
        { big: v("specs.auditRows"), label: "audit rows, hash-chained", small: "chain intact · check it yourself: npm run verify" },
        { big: v("specs.stopped"), label: "stopped at a limit", small: `Metal ${v("specs.stoppedMetal")} · the CFO ${v("specs.stoppedCfo")}${n("specs.stoppedAirwallex") ? ` · Airwallex ${v("specs.stoppedAirwallex")}` : ""} · in the main run` },
        { big: `${v("specs.byClaude")}/${v("specs.decisions")}`, label: "decisions by Claude", small: `Sourcing ${v("specs.sourcing")} · Support ${v("specs.support")} · Treasury ${v("specs.treasury")} · ${v("specs.fallbacks")} fallbacks` },
      ],
    },
    "14-real": {
      kicker: "What's real, what's ours",
      realHead: "Real", real: ["the Airwallex sandbox", "Metal testnet", "Claude", "Face ID"], realNote: "test money only",
      oursHead: "Ours or simulated", ours: ["the suppliers", "the customer", "the merchant", "the second approver: a labelled test passkey"],
    },
    "15-close": {
      lines: CLOSING, name: "Max Geurtsen", role: "Purser · Starter Kit 11",
      slot: "Recording slot · Max on camera, or his voice over this card",
    },
    "16-end": {
      cta: "Try it yourself", url: TRY_SIGN_URL, foot: "Test money only: the Airwallex sandbox and Metal testnet.",
      credits: { max: "Voice: Max Geurtsen", ai: "Voice-over: an AI-generated voice · opening and closing: Max Geurtsen" },
      mark: "Purser · Starter Kit 11",
    },
  };

  const said = (k: string) => spoken(n(k));
  const voice: PremiereData["voice"] = {
    "03-pen": [{ at: 0.4, who: "Max", text: "So who holds the pen?" }, { at: 3.6, who: "Max", text: "I'm Max Geurtsen, and this is Purser." }],
    "04-architecture": [
      { at: 0.5, who: "Voice", text: "An agent proposes. Rules in code check it." },
      { at: 4.0, who: "Voice", text: "Beyond the limits, a person signs with Face ID." },
      { at: 8.0, who: "Voice", text: "Then Airwallex or Metal moves the money, into the books." },
    ],
    "05-price-rise": [
      { at: 0.5, who: "Voice", text: `${cap1(dayWords(v("run.day")))}, ${said("run.agents")} ${v("specs.byClaude") === v("specs.decisions") ? "Claude " : ""}agents ran a business, on test money.` },
      { at: 6.3, who: "Voice", text: `Their supplier ${cents(v("price.new")) === 2 * cents(v("price.old")) ? "doubled" : "raised"} its price, past the mandate's cap.` },
      { at: 10.3, who: "Voice", text: "We let one purchase through on purpose: Purser normally refuses first." },
      { at: 15.2, who: "Voice", text: "Metal refused it, on chain." },
    ],
    "06-dispute": [
      { at: 0.5, who: "Voice", text: `Then our simulated customer disputed ${said("dispute.count")} orders.` },
      { at: 3.8, who: "Voice", text: `${cap1(n("dispute.signed") === n("dispute.count") ? `all ${said("dispute.count")}` : `${said("dispute.signed")} of them`)} were signed by its own agent.` },
      { at: 7.3, who: "Voice", text: `Support refunded the ${said("dispute.refundCount")} with wrong data.` },
      { at: 10.8, who: "Voice", text: `Refund the other ${said("dispute.rest")}? Rejected, with Face ID.` },
    ],
    "07-approval": [
      { at: 0.4, who: "Voice", text: `The ${v("licence.by")} planned a euro payment.` },
      { at: 3.6, who: "Voice", text: "The phone shows the exact terms." },
    ],
    "09-six-seconds": [
      { at: 0.6, who: "Voice", text: `${cap1(said("paid.seconds"))} ${n("paid.seconds") === 1 ? "second" : "seconds"} from Face ID to paid, in the Airwallex sandbox.` },
      { at: 5.4, who: "Voice", text: "That is the transfer id." },
      { at: 7.8, who: "Voice", text: "Look it up yourself." },
    ],
    "10-try-sign": [
      { at: 0.6, who: "Voice", text: "Now it's your turn." },
      { at: 2.6, who: "Voice", text: "Open your own test world, and sign an agent's proposal with your own Face ID." },
      { at: 9.2, who: "Voice", text: "The server checks the signature against the exact terms." },
    ],
    "12-why-face-id": [
      { at: 0.4, who: "Voice", text: "Why Face ID, and not a password?" },
      { at: 3.4, who: "Voice", text: "A password is the same for every payment; Face ID signs these exact terms: change anything, and the signature is worthless." },
    ],
    "13-specs": [
      { at: 0.5, who: "Voice", text: "All tests passing." },
      { at: 4.4, who: "Voice", text: "An audit log, hash-chained: check it yourself." },
      { at: 8.4, who: "Voice", text: `${cap1(said("specs.stopped"))} stopped at a limit.` },
      { at: 12.4, who: "Voice", text: `${cap1(said("specs.byClaude"))} of ${said("specs.decisions")} decisions by Claude.` },
    ],
    "14-real": [
      { at: 0.5, who: "Voice", text: "Real: the Airwallex sandbox, Metal testnet, Claude, and Face ID." },
      { at: 5.3, who: "Voice", text: "Ours, or simulated: the suppliers, the customer, the merchant, and the second approver, a labelled test passkey." },
    ],
    "15-close": [
      { at: 0.5, who: "Max", text: CLOSING[0]! },
      { at: 4.0, who: "Max", text: `${CLOSING[1]!} ${CLOSING[2]!}` },
      { at: 11.6, who: "Max", text: CLOSING[3]! },
    ],
  };
  return { facts: F, screen, voice };
}

/** Max's closing line (docs/video/max-opening-close.md, "Slot"), in the lines the fallback card shows. */
export const CLOSING = ["A price shock, a dispute, a euro bill.", "Claude decided, the rails and the code held the limits,", "and I signed only what went beyond them.", "Purser, Starter Kit 11."] as const;

/** "3 November 2026" as it is said: "on the third of November". */
function dayWords(day: string): string {
  const m = need(/^(\d{1,2}) (\w+) \d{4}$/.exec(day), `a day in "${day}"`);
  const ORD = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth"];
  const d = Number(m[1]);
  const ord = d <= 20 ? ORD[d]! : d === 30 ? "thirtieth" : `${d < 30 ? "twenty" : "thirty"}-${ORD[d % 10]}`;
  return `on the ${ord} of ${m[2]}`;
}

// ---- The page ----

const TEMPLATE = readFileSync(new URL("./premiere.html", import.meta.url), "utf8");
const inlineHash = (page: string, tag: "script" | "style") => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(page);
  if (!m) throw new Error(`the premiere page has no inline ${tag}`);
  return `'sha256-${createHash("sha256").update(m[1]!, "utf8").digest("base64")}'`;
};
/** Only the page's own script and style run; it loads nothing but the font from its own origin. */
export const PREMIERE_CSP = [
  "default-src 'none'", `script-src ${inlineHash(TEMPLATE, "script")}`, `style-src ${inlineHash(TEMPLATE, "style")}`,
  "font-src 'self'", "img-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join("; ");

/** The record and the README, read now (the film is built when it is recorded). */
export function loadPremiere(root = new URL("../../", import.meta.url)): PremiereData {
  const record = JSON.parse(readFileSync(new URL(MAIN_RUN_FILE, root), "utf8")) as MainRun;
  return buildPremiere(record, readFileSync(new URL("README.md", root), "utf8"));
}

/** The film page, its data inside it ("<" escaped); the scenes' times come from the script (premiereScript.ts). */
export function premierePage(data: PremiereData, scenes: { id: string; start: number; seconds: number; kind: string }[]): string {
  return TEMPLATE.replace("__PREMIERE_JSON__", () => JSON.stringify({ screen: data.screen, scenes }).replace(/</g, "\\u003c"));
}
