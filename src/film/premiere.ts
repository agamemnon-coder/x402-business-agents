// The premiere (docs/video/premiere-script.md): Purser in a little over three minutes, a premiere-style film made from the main
// run of 3 November (docs/demo/main-run.json). Every number on screen and in the voice-over is read here, through
// code, each with where it comes from: the run's record for everything about the run, the README's test line for the
// test count, and the /try/sign page's own code for its mock. A number that cannot be found stops the build, so the
// film is never rendered with a figure typed in by hand (test/premiere.test.ts). The page (src/film/premiere.html)
// only places these strings; it computes no figure of its own.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { FIXED_PROPOSALS, TEST_WORLD, canonical, checkPayment, proposalTerms } from "../../worker/src/trySign.js";
import { TRY_SIGN_LABEL } from "../try/sign.js";
import { AGENT_DISPLAY } from "../config/brand.js";
import { CARDS, INITIAL_MANDATES } from "../config/policy.js";

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
    agent_stats: { agent: string; decisions: number; by_claude: number; fallback: number; models?: string[] }[];
    agents?: { id: string; name: string; job: string; alone: string[] }[];
    /** The run's stops: each refusal row once (`counts.blocked` counts them). */
    refusals?: { agent: string; what: string; reason: string }[];
    counts?: { blocked?: number };
  };
  proof?: { chain_refusals?: number; over_limit_eur?: string };
  ledger?: { events: LedgerEvent[]; proposals: Proposal[]; disputes: Dispute[] };
}

/** A figure the film shows or says, with where it comes from (the source column of the script). */
export interface Fact { value: string; source: string }

/** One line of the voice-over: when it starts (seconds into its scene), who says it, the words. */
export interface VoiceLine { at: number; who: "Max" | "Voice"; text: string }

export interface PremiereData {
  facts: Record<string, Fact>;
  /** The corner credits in the top letterbox bar, text only (no logos of others). */
  credits: { left: string; right: string };
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
/** "Haiku 5.5" from a model id in the record ("claude-haiku-5-5"). */
const modelName = (model: unknown) => {
  const m = need(/^claude-(haiku|sonnet|opus)-(\d+)-(\d+)$/.exec(String(model ?? "")), `a Claude model id in "${String(model)}"`);
  return `${cap1(m[1]!)} ${m[2]}.${m[3]}`;
};
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

/** The README's tests badge ("badge/tests-2342%20passing"), when it has one: the film shows nothing it disagrees with. */
export function testBadge(readme: string): string | null {
  return /badge\/tests-(\d+)%20passing/.exec(readme)?.[1] ?? null;
}

/** Max's voice-over (docs/video/voice-script-max.md): each scene's line, as the script's table has it. */
export const VOICE_SCRIPT_FILE = "docs/video/voice-script-max.md";
export function voiceScript(md: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of md.split("\n")) {
    const c = /^\| (\d\d[a-z]?-[a-z-]+) \| [^|]* \| ([^|]+) \| [^|]* \|$/.exec(row.trim());
    if (c) out[c[1]!] = c[2]!.trim();
  }
  return out;
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
  const sent = one("transfer.status", (e) => e.subject === paid.subject && e.payload.status === "SENT");
  // The sandbox's last steps (SENT, then PAID) are Purser's own calls to Airwallex's simulation API (settleInSandbox in
  // src/executors/invoicePayment.ts), each recorded by the executor: the settlement itself is simulated.
  const settled = ev.filter((e) => e.event === "transfer.status" && e.subject === paid.subject && e.actor === "awx-executor").map((e) => String(e.payload.status));
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
  fact("paid.sentAt", hms(sent.ts), `record \`ledger.events\` \`transfer.status\` SENT (seq ${sent.seq}), UTC`);
  fact("paid.paidAt", hms(paid.ts), `record \`ledger.events\` \`transfer.status\` PAID (seq ${paid.seq}), UTC`);
  fact("paid.simulated", need(settled.join(",") === "SENT,PAID" ? "SENT and then PAID" : null, "sandbox settlement (SENT, then PAID, by the executor)"), "record `ledger.events` `transfer.status` SENT and PAID by the executor (`awx-executor`): `settleInSandbox` (src/executors/invoicePayment.ts) moves a sandbox transfer through Airwallex's simulation API, `POST /simulation/transfers/{id}/transition`");
  fact("paid.seconds", need(seconds > 0 ? seconds : null, "time from Face ID to PAID"), `record \`ledger.events\`: ${approved.ts.slice(11, 23)} (Face ID, seq ${approved.seq}) to ${paid.ts.slice(11, 23)} (PAID, seq ${paid.seq}), rounded`);
  fact("paid.transfer", paid.subject, `record \`ledger.events\` \`transfer.status\` PAID (seq ${paid.seq})`);
  fact("paid.fee", fee.payload.fee, `record \`ledger.events\` \`transfer.fee\` (seq ${fee.seq})`);
  fact("paid.conversion", fx.subject, `record \`ledger.events\` \`fx.converted\` (seq ${fx.seq})`);

  // The figures on the spec cards.
  const t = testLine(readme), badge = testBadge(readme);
  if (badge !== null && badge !== t.tests) throw new Missing(`premiere: the README's tests badge (${badge}) and its test line (${t.tests}) disagree; nothing is rendered until they match`);
  fact("specs.tests", t.tests, "README.md's test line, read when the film is built; its tests badge must say the same (CI runs the same suite)");
  fact("specs.files", t.files, "README.md's test line");
  const audit = r.snapshot.audit;
  need(audit?.intact ? audit.rows : null, "intact audit chain");
  fact("specs.auditRows", audit.rows, "record `snapshot.audit.rows`, with `intact: true`");
  // The stops (Max, 5 November, second round): every refusal row the record counts, by who stopped it; the parts must
  // add up to the record's own count, and Metal's to the record's refusals on chain, or nothing is rendered.
  const rows = need(r.snapshot.refusals?.length ? r.snapshot.refusals : null, "refusal rows (`snapshot.refusals`)");
  const stops = {
    claude: rows.filter((x) => x.agent === "sourcing" && /own buy policy/.test(x.reason)).length,
    metal: rows.filter((x) => /refused on chain/.test(x.reason)).length,
    cfo: rows.filter((x) => /^proposal rejected$/i.test(x.what) && /Face ID/.test(x.reason)).length,
    planted: rows.filter((x) => /planted instruction/i.test(x.what)).length,
  };
  const blocked = need(r.snapshot.counts?.blocked, "the run's stops (`snapshot.counts.blocked`)");
  need(stops.claude + stops.metal + stops.cfo + stops.planted === blocked ? true : null, "stops that add up to `snapshot.counts.blocked`");
  need(stops.metal === r.proof?.chain_refusals ? true : null, "Metal's refusals, the same as `proof.chain_refusals`");
  fact("specs.stops", blocked, "record `snapshot.counts.blocked` (the rows of `snapshot.refusals`, each once)");
  fact("specs.stopsClaude", stops.claude, "record `snapshot.refusals`: the Sourcing agent's own buy policy (Claude chose not to buy over its cap; nothing signed)");
  fact("specs.stopsMetal", stops.metal, "record `snapshot.refusals` refused on chain by Metal (over the mandate's cap, or on a mandate just replaced), the same as `proof.chain_refusals`");
  fact("specs.stopsCfo", stops.cfo, "record `snapshot.refusals` \"Proposal rejected\" (Max · Face ID)");
  fact("specs.stopsPlanted", stops.planted, "record `snapshot.refusals` \"Planted instruction ignored\" (a line aimed at the AI in the dispute document)");
  fact("specs.overLimit", need(r.proof?.over_limit_eur !== undefined && Number(r.proof.over_limit_eur) === 0 ? "nothing" : null, "nothing paid over a limit (`proof.over_limit_eur`)"), "record `proof.over_limit_eur` (nothing)");
  const st = need(r.snapshot.agent_stats?.length ? r.snapshot.agent_stats : null, "agent statistics");
  fact("run.agents", st.length, "record `snapshot.agent_stats` (one row per agent)");
  const sum = (k: "decisions" | "by_claude" | "fallback") => st.reduce((n, a) => n + need(a[k], `${a.agent}'s ${k}`), 0);
  fact("specs.decisions", need(sum("decisions") || null, "decisions"), "record `snapshot.agent_stats[].decisions` (summed)");
  fact("specs.byClaude", sum("by_claude"), "record `snapshot.agent_stats[].by_claude` (summed)");
  fact("specs.fallbacks", sum("fallback"), "record `snapshot.agent_stats[].fallback` (summed)");
  for (const a of ["sourcing", "support", "treasury"]) fact(`specs.${a}`, need(st.find((x) => x.agent === a), `${a} agent's statistics`).decisions, `record \`snapshot.agent_stats\` (${a})`);

  // The team (the intro): each agent's one Claude model and its job, as the record has them. A job is said in the
  // film's few words only when the record's own description of that agent says it.
  const team = need(r.snapshot.agents?.length ? r.snapshot.agents : null, "agents (`snapshot.agents`)");
  const member = (a: string) => need(team.find((x) => x.id === a), `${a} agent in \`snapshot.agents\``);
  for (const a of ["sourcing", "support", "treasury"]) {
    const models = need(st.find((x) => x.agent === a)?.models, `${a} agent's model`);
    fact(`team.${a}Model`, `Claude ${modelName(models.length === 1 ? models[0] : null)}`, `record \`snapshot.agent_stats\` (${a}: its one model, \`${models[0]}\`)`);
  }
  const src = need(member("sourcing"), "Sourcing agent");
  fact("team.sourcingJob", /buys upstream data per query/.test(src.job) && src.alone.some((x) => /on chain \(x402\)/.test(x)) && r.snapshot.flows.some((f) => f.kind === "upstream" && /^https:\/\/testnet\.metal/.test(f.proof.href ?? "")) ? "Buys data per query, over x402 on Metal" : null,
    "record `snapshot.agents` (sourcing: \"buys upstream data per query\"; alone: \"on chain (x402)\") and `snapshot.flows` (its purchases, on Metal testnet)");
  const sup = member("support");
  fact("team.supportJob", /refunds customers when a dispute holds/.test(sup.job) && proposals.some((p) => p.kind === "refund_batch" && p.created_by === "support") ? "Handles disputes and refunds" : null,
    "record `snapshot.agents` (support: \"refunds customers when a dispute holds\") and `ledger.proposals` (its `refund_batch`)");
  const tre = member("treasury");
  fact("team.treasuryJob", /FX and SWIFT/.test(tre.job) && proposals.some((p) => p.kind === "mandate_replace" && p.created_by === "treasury" && p.terms.total_budget) ? "FX, SWIFT, budgets" : null,
    "record `snapshot.agents` (treasury: \"Airwallex FX and SWIFT\") and `ledger.proposals` (its `mandate_replace` plans, each with the agents' `total_budget`)");

  // Every Metal payment in the run, each its own transaction on Metal testnet (06-metal): the record's flows on the
  // Metal rail that went through, counted; the mandate transactions: one per mandate bound at setup (the agents' and the
  // simulated customer's) and one per replacement with its tx; the refusal recorded on chain.
  const metalPaid = r.snapshot.flows.filter((f) => (f as { rail?: string }).rail === "metal" && !f.refused && /^https:\/\/testnet\.metal/.test(f.proof.href ?? ""));
  fact("metal.payments", need(metalPaid.reduce((k, f) => k + (f.count ?? 1), 0) || null, "payment on Metal"), "record `snapshot.flows` on the Metal rail, not refused, each with its testnet tx (counted, `count` per row)");
  const budgets = (r.snapshot as { budgets?: { agents?: unknown[]; counterparty?: unknown } }).budgets;
  const replacedTx = ev.filter((e) => e.event === "mandate.replaced" && typeof e.payload.tx === "string");
  fact("metal.mandates", need(budgets?.agents?.length ? budgets.agents.length + (budgets.counterparty ? 1 : 0) + replacedTx.length : null, "Metal mandates"),
    `record \`snapshot.budgets\` (${budgets?.agents?.length ?? 0} agents' mandates and the customer's, bound at setup) and \`ledger.events\` \`mandate.replaced\` with a tx (${replacedTx.length})`);
  fact("metal.chainRefusals", need(ev.filter((e) => e.event === "upstream.refused_on_chain").length || null, "refusal on chain"), "record `ledger.events` `upstream.refused_on_chain` (counted)");

  // Treasury's two options after the price rise (05b-treasury): A and B, the same total; A signed by Max with Face ID,
  // co-signed by a labelled test passkey (four eyes).
  const opt = (o: string) => need(proposals.find((p) => p.kind === "mandate_replace" && p.created_by === "treasury" && p.terms.option === o), `Treasury's option ${o}`);
  const A = opt("A"), B = opt("B");
  const sourcingStep = (p: Proposal) => need((p.terms.steps as { agent: string; cap: string }[] | undefined)?.find((x) => x.agent === "sourcing"), `${p.proposal_id}'s step for the Sourcing agent`);
  const sale = need(r.snapshot.flows.find((f) => f.kind === "sale" && !f.refused && Date.parse(f.at) < Date.parse(A.created_at)), "sale before Treasury's options");
  const priceBefore = (Number(sale.amount) / (sale.count ?? 1)).toFixed(2);
  const cosigned = one("proposal.cosigned", (e) => e.subject === A.proposal_id && /\bmax\b/.test(String(e.payload.approver)) && e.payload.method === "passkey");
  const aApproved = one("proposal.approved", (e) => e.subject === A.proposal_id);
  fact("treasury.a", A.proposal_id, "record `ledger.proposals` (Treasury's `mandate_replace`, option A)");
  fact("treasury.b", B.proposal_id, "record `ledger.proposals` (Treasury's `mandate_replace`, option B)");
  fact("treasury.aCap", sourcingStep(A).cap, `record \`ledger.proposals\` ${A.proposal_id} terms (the Sourcing agent's step, its cap)`);
  fact("treasury.aPrice", need(A.terms.query_price === priceBefore ? A.terms.query_price : null, `${A.proposal_id}'s price, unchanged`), `record \`ledger.proposals\` ${A.proposal_id} terms \`query_price\`, the same as the sales before (${priceBefore})`);
  fact("treasury.bPrice", B.terms.query_price, `record \`ledger.proposals\` ${B.proposal_id} terms \`query_price\``);
  fact("treasury.total", need(A.terms.total_budget === B.terms.total_budget ? A.terms.total_budget : null, "the same total in both options"), `record \`ledger.proposals\` ${A.proposal_id} and ${B.proposal_id} terms \`total_budget\``);
  fact("treasury.at", hms(A.created_at), `record \`ledger.proposals\` ${A.proposal_id} \`created_at\`, UTC`);
  fact("treasury.signedAt", hms(cosigned.ts), `record \`ledger.events\` \`proposal.cosigned\` (seq ${cosigned.seq}), Max's passkey, UTC`);
  fact("treasury.cosigner", need(/test-controller/.test(String(aApproved.payload.approver)) ? "a labelled test passkey" : null, `${A.proposal_id}'s second approver`), `record \`ledger.events\` \`proposal.approved\` (seq ${aApproved.seq}): "${String(aApproved.payload.approver)}"; the test-controller is a labelled test passkey (docs/claims.md)`);

  // The limits that hold each agent (the intro), as the run began: its own Airwallex card and its own Metal mandate.
  // The starting values are the config's (src/config/policy.ts), and the record must agree with them wherever it shows
  // them: a card whose limits were synced in the run started from the config's (\`card.limits_synced\` from), any other
  // card is the config's at the end too (\`snapshot.cards\`); the mandate let through to Metal was bound at the config's
  // cap (\`upstream.let_through\` bound_cap), and a mandate never replaced is the config's at the end (\`snapshot.budgets\`).
  const money = (c: number) => fromCents(c);
  for (const a of ["sourcing", "support", "treasury"] as const) {
    const cfg = CARDS[a], start = `${money(cfg.perTxCents)} / ${money(cfg.monthlyCents)}`;
    const synced = ev.find((e) => e.event === "card.limits_synced" && e.subject === a);
    const card = (r.snapshot as { cards?: { agent: string; per_tx: string; monthly: string }[] }).cards?.find((c) => c.agent === a);
    const cardOk = synced ? synced.payload.from === start : card ? `${card.per_tx} / ${card.monthly}` === start : false;
    fact(`team.${a}Card`, cardOk ? `EUR ${money(cfg.perTxCents)} a purchase · ${money(cfg.monthlyCents)} a month` : null,
      synced ? `src/config/policy.ts \`CARDS\` (${a}), as the run began; record \`ledger.events\` \`card.limits_synced\` (seq ${synced.seq}) from "${start}"` : `src/config/policy.ts \`CARDS\` (${a}); record \`snapshot.cards\` (${a}: ${start}, unchanged in the run)`);
    const m = INITIAL_MANDATES[a];
    const replaced = ev.some((e) => e.event === "mandate.replaced" && e.subject === a);
    const bound = a === "sourcing" ? lt.payload.bound_cap : null;
    const end = (r.snapshot as { budgets?: { agents?: { agent: string; cap: string; budget: string }[] } }).budgets?.agents?.find((x) => x.agent === a);
    const mandateOk = bound != null ? bound === money(m.capCents) : !replaced ? !!end && end.cap === money(m.capCents) && end.budget === money(m.budgetCents) : true;
    fact(`team.${a}Mandate`, mandateOk ? `${money(m.capCents)} test USD a payment · ${money(m.budgetCents)} in all` : null,
      `src/config/policy.ts \`INITIAL_MANDATES\` (${a}), as the run began; ${bound != null ? `record \`ledger.events\` \`upstream.let_through\` (seq ${lt.seq}): bound_cap ${String(bound)}` : !replaced ? "record `snapshot.budgets` (unchanged in the run)" : "replaced in the run by P-0002 (record `mandate.replaced`)"}`);
  }

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

/** Each scene's length in seconds (film v5, Max): the script (premiereScript.ts) checks its scenes against these. */
export const SCENE_SECONDS: Record<string, number> = {
  "01-hook": 6, "02-purser": 4, "03-agents": 10, "04-how": 8, "05-price": 12, "05b-treasury": 8, "06-metal": 8, "07-dispute": 10,
  "08-faceid": 8, "09-six": 10, "10-why": 10, "11-turn": 7, "12-tamper": 8, "13-proof": 13, "13b-value": 4, "14-real": 10, "15-close": 13, "16-end": 13,
};

/** How long a line takes at Max's calm pace, about 2.5 words a second (to the hundredth). */
export const speechSeconds = (text: string) => Math.round((text.split(/\s+/).filter(Boolean).length / 2.5) * 100) / 100;

/**
 * A scene's line from the voice script, timed in its scene: it starts about 0.5 s in, and each "…" is a pause of about
 * 0.5 s ("… …" is the second of silence before "One cent. Worthless."). When the line is long for its scene, the pauses
 * shrink to a quarter second and then the line starts earlier; a line that still does not fit stops the build.
 */
export function timeLine(id: string, line: string, seconds: number): VoiceLine[] {
  const parts: { text: string; pauses: number }[] = [];
  const re = /((?:\s*…)+)\s*/g;
  let last = 0, m: RegExpExecArray | null, pending = 0;
  while ((m = re.exec(line))) {
    const text = line.slice(last, m.index).trim();
    if (text) parts.push({ text, pauses: pending });
    pending = (m[1]!.match(/…/g) ?? []).length;
    last = m.index + m[0].length;
  }
  parts.push({ text: line.slice(last).trim(), pauses: pending });
  const speech = parts.reduce((k, x) => k + speechSeconds(x.text), 0), n = parts.reduce((k, x) => k + x.pauses, 0);
  let s0 = 0.5, p = 0.5;
  const end = () => s0 + speech + n * p;
  // The second of silence before "One cent. Worthless." is the scene's own; it never shrinks.
  if (end() > seconds - 0.05 && id !== "12-tamper" && n) p = Math.max(0.25, (seconds - 0.05 - s0 - speech) / n);
  if (end() > seconds - 0.05) s0 = Math.max(0, Math.round((seconds - 0.05 - speech - n * p) * 100) / 100);
  if (end() > seconds + 1e-9) throw new Missing(`premiere: the voice script's ${id} line takes ${speech.toFixed(1)} s to say; its scene is ${seconds} s`);
  const out: VoiceLine[] = [];
  let at = s0;
  for (const x of parts) { at += x.pauses * p; out.push({ at: Math.round(at * 100) / 100, who: "Max", text: x.text }); at += speechSeconds(x.text); }
  return out;
}

/** The film's data: the facts, the strings on screen and the voice-over. Throws when a figure is missing. */
export function buildPremiere(r: MainRun, readme: string, script: string = readFileSync(new URL(`../../${VOICE_SCRIPT_FILE}`, import.meta.url), "utf8")): PremiereData {
  const F = premiereFacts(r, readme);
  const v = (k: string) => need(F[k], k).value;
  const n = (k: string) => Number(v(k));
  const said = (k: string) => spoken(n(k));
  const m = trySignExample();
  const site = TRY_SIGN_URL.replace(/^https:\/\//, "").replace(/\/try\/sign$/, "");

  // P-0005's terms as its approval sheet shows them (the reconstruction on 08).
  const approvalRows = [["Invoice", v("licence.invoice")], ["Buy first", `${v("licence.fxBuy")} for ${v("licence.fxSell")}`], ["Fee at most", v("licence.feeMax")], ["Planned by", `${v("licence.by")} · Claude ${v("licence.model")}`], ["Expires", `${v("licence.expires")} UTC`]];

  const screen: PremiereData["screen"] = {
    // The hook (Max, 5 November): the line slams in on black; the question, large, a pen stroke drawn under it.
    "01-hook": { line: "AI agents can now spend money.", question: "So who signs off?" },
    // A straight cut to the wordmark, the core line under it word for word (the README's first line), in two lines.
    "02-purser": { title: "Purser", core: CORE_LINE, sub: "Starter Kit 11" },
    "03-agents": {
      head: `${cap1(said("run.agents"))} ${v("specs.byClaude") === v("specs.decisions") ? "Claude " : ""}agents run a small company's money.`,
      agents: (["sourcing", "support", "treasury"] as const).map((a) => ({ name: AGENT_DISPLAY[a].name, model: v(`team.${a}Model`), job: v(`team.${a}Job`), card: v(`team.${a}Card`), mandate: v(`team.${a}Mandate`) })),
      cardLabel: "Its own Airwallex card", mandateLabel: "Its own Metal mandate", note: "Each agent's limits as the run began · test money",
      limits: "The rails and the code hold the limits.",
    },
    "04-how": {
      kicker: "How Purser works",
      // The refused payment (Max, 5 November: the red pulse alone read as a stray dot): the box it stops at flashes
      // red and says so under it, then both fade.
      refusedTag: "Refused at the limit",
      nodes: [
        { t: "Agent", s: "a Claude agent proposes" },
        { t: "Rules", s: "code checks the limits" },
        { t: "Person", s: "Face ID, beyond the limits" },
        { t: "Airwallex or Metal", s: "moves the test money" },
        { t: "Books", s: "every movement, double-entry" },
      ],
    },
    "05-price": {
      kicker: `The main run · ${v("run.day")} · test money`,
      supplier: v("price.supplier"), rise: "raised its price",
      from: v("price.old"), to: v("price.new"), unit: "test USD a stock check",
      cap: `The Sourcing agent's mandate on Metal: at most ${v("price.cap")} a payment`, capValue: v("price.cap"), capTag: `cap ${v("price.cap")}`,
      letThrough: "Let through on purpose. Purser normally refuses first.",
      refused: "Metal refused it.", reason: `${v("price.reason")} · nothing moved`,
      txLabel: "The refusal, on chain", tx: short(v("price.tx")), txFull: v("price.tx"), txWhere: `${v("price.explorer")} · ${v("price.txAt")} UTC`,
      label: v("price.label"),
    },
    // Treasury's two options (Max, v5), each from its proposal's terms; A signed with Face ID, four eyes said honestly.
    "05b-treasury": {
      kicker: `The Treasury agent's two options · ${v("treasury.at")} UTC`,
      options: [
        { tag: "A", id: v("treasury.a"), lines: [`The Sourcing agent's cap to ${v("treasury.aCap")}`, `Our price stays ${v("treasury.aPrice")}`] },
        { tag: "B", id: v("treasury.b"), lines: [`Our price to ${v("treasury.bPrice")}`] },
      ],
      within: `Within the same ${v("treasury.total")}`, unit: "test USD",
      signed: "Signed", signedWhen: `${v("treasury.a")} · Face ID, ${v("treasury.signedAt")} UTC`,
      second: `four eyes · second approver: ${v("treasury.cosigner")}`,
    },
    // Every Metal payment its own transaction (Max, v5): the record's count; the render stops without it.
    "06-metal": {
      big: v("metal.payments"), label: "payments", line: "each its own transaction on Metal testnet · no emulator",
      small: `+ ${v("metal.mandates")} mandate transactions · ${v("metal.chainRefusals")} ${n("metal.chainRefusals") === 1 ? "refusal" : "refusals"} on chain`,
    },
    "07-dispute": {
      kicker: `The dispute · ${v("dispute.customer")}, a simulated customer`,
      claim: `“${v("dispute.claim")}”`,
      orders: v("dispute.orders").split(" "), refunded: v("dispute.refunded").split(" "),
      signed: `${v("dispute.signed")} of ${v("dispute.count")} signed by its own agent`, signedOf: `of ${v("dispute.count")} signed by its own agent`,
      refundLine: `${v("dispute.refundCount")} with wrong data: refunded by the Support agent · ${v("dispute.refundTotal")} test USD`,
      rest: `“Refund the other ${v("dispute.rest")}”`, rejected: "Rejected · Face ID", rejectedWhen: `${v("dispute.proposal")} · the CFO, ${v("dispute.rejectedAt")} UTC`,
    },
    "08-faceid": {
      // The reconstruction: P-0005's approval sheet, its exact terms from the record, Face ID, then approved.
      pid: `${v("licence.proposal")} · waits for your Face ID`, pidDone: `${v("licence.proposal")} · approved`,
      what: `Pay ${v("licence.vendor")} ${v("licence.amount")} by ${v("licence.method")}`, rows: approvalRows,
      hashLabel: "Terms hash", hash: short(v("licence.hash"), 16, 8), button: "Confirm with Face ID", approved: "Approved",
      side: ["The exact terms.", "Face ID.", "Approved."], when: `${v("licence.proposal")} · the CFO, ${v("paid.faceAt")} UTC`,
      recon: `Reconstruction of the approval screen · the real Face ID was at ${v("paid.faceAt")} UTC (main run)`,
      // A real recording laid in with --slot, and its overlay for an editor: labelled as what it is.
      label: "Max's iPhone · real Face ID · filmed after the run, on a test proposal (test money)",
      sub: `In the main run: ${v("licence.proposal")} approved with Face ID at ${v("paid.faceAt")} UTC`,
      recHead: "Real Face ID.", recLine: "On Max's own iPhone, filmed after the run on a test proposal, with test money.",
    },
    "09-six": {
      big: v("paid.seconds"), unit: n("paid.seconds") === 1 ? "second" : "seconds", line: "from Face ID to PAID",
      simulated: "In the sandbox, the settlement is simulated.",
      steps: [[v("paid.faceAt"), "Face ID"], [v("paid.fxAt"), `FX · ${v("licence.fxBuy")} for ${v("licence.fxSell")}`], [v("paid.createdAt"), `${v("licence.method")} · ${v("licence.amount")}`], [v("paid.sentAt"), "SENT (simulated)"], [v("paid.paidAt"), "PAID (simulated)"]],
      transferLabel: "Airwallex sandbox transfer", transfer: v("paid.transfer"), detail: `${v("licence.amount")} by ${v("licence.method")} · fee ${v("paid.fee")} (at most ${v("licence.feeMax")})`,
      look: "Every id is on /proof", where: `${site}/proof`,
      foot: `Purser moved the transfer to ${v("paid.simulated")} itself, through Airwallex's sandbox simulation API. Test money.`,
    },
    "10-why": {
      q: "Why Face ID, not a password?",
      // The passkey signs; Face ID unlocks it (the claims, /try/sign).
      a: ["A password is the same for every payment;", "the passkey behind Face ID signs the hash of these exact terms:", "change anything after signing, and the signature is worthless."],
    },
    "11-turn": {
      label: TRY_SIGN_LABEL, url: TRY_SIGN_URL.replace(/^https:\/\//, ""), ...TRY_SIGN_WORDS,
      agent: m.p.agent, says: m.p.says, facts: [["Pay", m.p.payee], ["Amount", v("try.amount")], ["Reference", m.p.reference], ["Proposal", v("try.proposal")]],
      waits: m.waits, hash: v("try.hash"),
      side: ["Your turn.", "Your own test world.", "Your own test passkey.", "Sign the exact terms with Face ID.", "The server checks the signature."],
      mockNote: "A mock of the live page, drawn from its code",
      overlay: "Max's iPhone · the live page",
    },
    "12-tamper": {
      from: v("try.amount"), plus: "+0.01", to: v("try.tampered"),
      hashes: `Terms hash ${short(v("try.hash"), 8, 4)} → ${short(v("try.tamperedHash"), 8, 4)}`,
      refused: TRY_SIGN_WORDS.refused, last: "One cent. Worthless.",
    },
    "13-proof": {
      cards: [
        { big: `${v("specs.byClaude")}/${v("specs.decisions")}`, label: "decisions by Claude", small: `Sourcing ${v("specs.sourcing")} · Support ${v("specs.support")} · Treasury ${v("specs.treasury")} · ${v("specs.fallbacks")} fallbacks` },
        // The stops (Max, 5 November, second round: "1 + 1" told too little): all of the run's stops and who stopped
        // them, each the record's figure, shown as it is (no count-up); the parts add up to the figure (premiereFacts).
        { stops: true, figure: `${v("specs.stops")} stops`, sub: `${v("specs.overLimit")} paid over a limit`,
          rows: [
            { big: v("specs.stopsClaude"), label: "Claude skipped an overpriced check" },
            { big: v("specs.stopsMetal"), label: "Metal refused a purchase" },
            { big: v("specs.stopsCfo"), label: "the CFO rejected a proposal" },
            { big: v("specs.stopsPlanted"), label: "planted instruction changed nothing" },
          ] },
      ],
    },
    "13b-value": { line: ["The agents do the work.", "The CFO signs only the exceptions."] },
    "14-real": {
      kicker: "What's real, what's ours",
      realHead: "Real", real: ["the Airwallex sandbox", "Metal testnet", "Claude", "Face ID"], realNote: "test money only",
      oursHead: "Ours or simulated", ours: ["the suppliers", "the customer", "the merchant", "the second approver: a labelled test passkey"],
    },
    "15-close": {
      // The ending mirrors the intro (Max, 5 November): the three beats one by one, short and large; the closing line
      // in three short sentences on two lines, Max's spoken words; then the intro's wordmark lockup.
      beats: ["A price shock.", "A dispute.", "A euro bill."],
      line: ["Claude decided. Airwallex and Metal held the limits.", "The CFO signed only what went beyond them."],
      title: "Purser", sub: "Starter Kit 11",
      name: "Max Geurtsen", role: "Purser · Starter Kit 11",
      slot: "Recording slot · Max on camera, or his voice over this card",
    },
    "16-end": {
      cta: "Try it yourself", url: TRY_SIGN_URL, foot: "Test money only: the Airwallex sandbox and Metal testnet.",
      mark: "Purser · Starter Kit 11",
      // The end credits: who does what (Max, 5 November), text only, no logos; the voice and the music as what they are.
      head: "Who does what", roll: END_CREDITS, thanks: THANKS, credit: AI_CREDIT,
      last: "Test money only", short: TRY_SIGN_URL.replace(/^https:\/\//, ""),
    },
  };

  // The voice-over: Max's script (docs/video/voice-script-max.md), word for word, each line timed in its scene. Every
  // figure it says must be the record's: a script that says another stops the build.
  const lines = voiceScript(script);
  const dollars = (k: string) => need(/^(\d+)\.00$/.exec(v(k))?.[1], `${k} in whole dollars`);
  const says: Record<string, string[]> = {
    "01-hook": ["AI agents can now spend money.", "So who signs off?"],
    "02-purser": ["I'm Max Geurtsen, and this is Purser."],
    "03-agents": [`${cap1(said("run.agents"))} Claude agents`, "its own Airwallex card and its own Metal mandate"],
    "05-price": [`${cents(v("price.new")) === 2 * cents(v("price.old")) ? "doubles" : "raises"} its price, past the Sourcing agent's cap`, "Metal refused it"],
    "05b-treasury": ["two ways", `within the same ${spoken(Number(dollars("treasury.total")))} dollars`, "with Face ID"],
    "06-metal": [`${cap1(said("metal.payments"))} of them`, "No emulator"],
    "07-dispute": [`disputes ${said("dispute.count")} orders`, `Only the ${said("dispute.refundCount")} with wrong data`],
    "09-six": [`${cap1(said("paid.seconds"))} ${n("paid.seconds") === 1 ? "second" : "seconds"} later`, "Airwallex pays the euro invoice by SWIFT, in its sandbox"],
    "12-tamper": ["Change one cent", "One cent. Worthless."],
    "13-proof": [`${v("specs.byClaude") === v("specs.decisions") ? "All" : `${cap1(said("specs.byClaude"))} of`} ${said("specs.decisions")} decisions by Claude`,
      `${cap1(said("specs.stops"))} stops, ${v("specs.overLimit")} paid over a limit`, `${said("specs.stopsClaude")} skipped by Claude`, `${said("specs.stopsMetal")} refused by Metal`,
      `${said("specs.stopsCfo")} rejected by the CFO`, `${said("specs.stopsPlanted")} planted ${n("specs.stopsPlanted") === 1 ? "instruction" : "instructions"} ignored`],
    "13b-value": ["The agents do the work."],
    "15-close": [CLOSING[0], `${CLOSING[1]} ${CLOSING[2]}`, CLOSING[3]],
  };
  const voice: PremiereData["voice"] = {};
  for (const [id, seconds] of Object.entries(SCENE_SECONDS)) {
    if (id === "16-end") continue;
    const line = need(lines[id], `voice line for ${id} in ${VOICE_SCRIPT_FILE}`);
    for (const w of says[id] ?? []) if (!line.includes(w)) throw new Missing(`premiere: the voice script's ${id} line does not say "${w}", as the record has it`);
    voice[id] = timeLine(id, line, seconds);
  }
  return { facts: F, screen, voice, credits: CREDITS };
}


/** The corner credits (Max, 4 November): who made it, and what it is built on, in words. */
export const CREDITS = { left: "Max Geurtsen · Purser", right: "Built on Airwallex · Metal · Claude" } as const;
/** The voice and the music of the final film, as the end card credits them (Max, 5 November): both AI-generated. */
export const AI_CREDIT = "Voice-over: an AI-generated voice (ElevenLabs) · Music: AI-generated (ElevenLabs)";

/**
 * The background (Max, premiere v3: calm, enterprise): deep navy, a very faint static dot grid (one dot every `grid`
 * px, white at `dot`), a soft vignette, and a drift so slow it is hardly seen (`drift` px a second). It fades in when the
 * opening line has ended. Every text colour stays at WCAG AA over its brightest point (test/premiere.test.ts).
 */
export const BACKGROUND = { base: "#0a1020", grid: 36, dot: 0.07, drift: [0.5, 0.25], vignette: 0.55, fadeIn: 1 } as const;

/**
 * The end credits (Max, 5 November): who does what, text only, no logos, each line as docs/claims.md has it: what Max
 * built, and what each partner provides in the run (the README's "Who does what").
 */
export const END_CREDITS: [string, string][] = [
  ["Built by Max Geurtsen", "Purser: the CFO's limits, Face ID approvals, the agents' tools, the audit log"],
  ["Airwallex", "the agents' cards and card limits, FX, the SWIFT euro payout (sandbox)"],
  ["Metal", "the on-chain mandates and the agents' payments (testnet)"],
  ["Claude by Anthropic", "the three agents' decisions"],
];
/** The thanks under the credits. */
export const THANKS = "Thank you to Airwallex, Metal, Anthropic, and the hackathon organisers and mentors";

/** Purser's core line (the README's first line), word for word, in the two lines the wordmark shows it. */
export const CORE_LINE = ["Claude explains and proposes, the rules in code hold every limit,", "and a person signs before money moves beyond them."] as const;

/** The closing line (docs/video/voice-script-max.md, 15-close), in the lines the fallback card shows. */
export const CLOSING = ["A price shock, a dispute, a euro bill.", "Claude decided, Airwallex and Metal held the limits,", "and the CFO signed only what went beyond them.", "Purser. Starter Kit 11."] as const;

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
  return buildPremiere(record, readFileSync(new URL("README.md", root), "utf8"), readFileSync(new URL(VOICE_SCRIPT_FILE, root), "utf8"));
}

/** The film page, its data inside it ("<" escaped); the scenes' times come from the script (premiereScript.ts). */
export function premierePage(data: PremiereData, scenes: { id: string; start: number; seconds: number; kind: string; fade: [number, number]; credits: boolean; beats?: number[] }[]): string {
  // The background starts with the first scene after the opening line (the first that carries the corner credits).
  const background = { ...BACKGROUND, start: scenes.find((s) => s.credits)?.start ?? 0 };
  return TEMPLATE.replace("__PREMIERE_JSON__", () => JSON.stringify({ screen: data.screen, scenes, credits: data.credits, background }).replace(/</g, "\\u003c"));
}
