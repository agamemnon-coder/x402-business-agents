// "How Purser uses Alta" (awards item 2): each Alta feature Purser uses, in plain words, with the proof from a live
// run and the Alta docs page. The mandates and the Dispute desk case come from the recorded run's ledger, as the
// chain enforced them. Some features did not run in that run (clearing, the receive policy, four eyes on chain, the
// compliance send policy, finality certificates); their proofs are the
// transactions of the separate live testnet runs that docs/metal-award.md records, and the page says so.
// Nothing here is a stand-in: an item the ledger has no record of is left out.

import type { DB } from "../db/open.js";
import { AGENT_DISPLAY } from "../config/brand.js";
import { MANDATE_EXPIRES_IN_SECONDS } from "../config/policy.js";
import { fromCents, toCents } from "../lib/money.js";
import { mandateAvailability } from "../policy/available.js";
import { disputeCases, type DisputeCase } from "../seller/desk.js";
import { EXPLORER_TX } from "./network.js";

export interface Proof { label: string; href: string | null }
export interface DocLink { label: string; href: string }

export interface MetalFeature {
  id: string;
  title: string;
  /** What it does, in plain words. */
  plain: string;
  /** Why it matters when the spender is an AI agent. */
  why: string;
  /** A big figure for the card, from the ledger. */
  figure: string | null;
  proofs: Proof[];
  /** Where the proof comes from: the recorded run, or a separate live run named here. */
  source: string;
  docs: DocLink[];
}

export interface MandateView {
  /** sourcing, support, treasury: Northwind's agents; customer: Summit's agent, buying from Northwind. */
  role: "sourcing" | "support" | "treasury" | "customer";
  agent: string;
  job: string;
  account: string;
  payee: { name: string; address: string };
  cap: string;
  budget: string;
  /** Paid under it, as the dashboard counts it (src/policy/available.ts); after a replacement, over all its credentials. */
  used: string;
  /** Sent and not final, or held for a payment being made now: the chain may count some of it already. */
  pending: string;
  left: string;
  expires_at: string;
  /** Bind and replace, oldest first. */
  history: { at: string; what: string; cap: string; budget: string; tx: Proof | null }[];
  /** Payments made under it: how many, and the latest few with their transactions. */
  count: number;
  latest: { at: string; amount: string; what: string; tx: Proof | null }[];
  /** A payment the chain refused, and what happened next. */
  refusal: { at: string; reason: string; plain: string } | null;
}

export interface MetalShowcase {
  features: MetalFeature[];
  mandates: MandateView[];
  /** The Dispute desk's recorded case, whole: every order's evidence as the seller holds it (the newest case). */
  dispute: DisputeCase | null;
  /** Every case the desk decided, newest first: /metal shows the newest and folds the older ones into an archive. */
  disputes?: DisputeCase[];
}

export const METAL_DOCS = {
  mandates: "https://docs.metalntwx.com/agents/mandates",
  x402: "https://docs.metalntwx.com/agents/x402-on-metal",
  facilitator: "https://docs.metalntwx.com/agents/facilitator",
  clearing: "https://docs.metalntwx.com/agents/clearing",
  receive: "https://docs.metalntwx.com/reference/compliance/receive-policy",
  finality: "https://docs.metalntwx.com/reference/network-fundamentals/settlement",
  payouts: "https://docs.metalntwx.com/agents/payouts",
  agent: "https://docs.metalntwx.com/agents/metal-agent",
  account: "https://docs.metalntwx.com/build/controls/create-and-manage-a-smart-account",
  compliance: "https://docs.metalntwx.com/learn/compliance/programmable-compliance",
  certificates: "https://docs.metalntwx.com/reference/interop/finality-certificates",
} as const;

/**
 * Proofs from separate live testnet runs (not the recorded Northwind run), as docs/metal-award.md lists them; a test
 * checks every hash here is in that file.
 */
export const OTHER_RUNS = {
  clearing: {
    source: "A separate live run on Alta testnet, 29 October (the clearing run log): a buyer deposits once and pays each query by signed receipt. A load test on 30 October (the clearing load run log) paid 2,000 of 2,000 at 4.24 a second",
    proofs: [
      { what: "deposit of 5.00", tx: "0x055ba89987f658cb038fcbd1660f4d9e98e78e4c44c86c5346946f8cca1a6766" },
      { what: "withdrawal queued", tx: "0x902badf6f82f4e453c99ff9e5fd870d3e96ab40293bff64e3a611014930cc3d4" },
      { what: "claim of 0.70 once final", tx: "0x522470d292f78b390fe153cb40905cdc6102afef1345d62e1dc975f900145092" },
    ],
  },
  receive: {
    source: "A separate live run of Purser's own code on Alta testnet, 30 October (b1 world): the CFO approved the return with Face ID at 08:45 UTC",
    proofs: [
      { what: "allowlist-only policy set on the sweep wallet", tx: "0xf1a7fe9664053c9d2fdf1b2d11122bde5be0668da8afc8d4f17b08088e220c37" },
      { what: "a stranger's 0.02, held by Alta", tx: "0x9076343b01ba60809fad1a25c4f8dfa91bfaa15ffec45f55946ceea4e15e20d3" },
      { what: "returned after the CFO's Face ID", tx: "0x786686b6dd5112b80bbf84902c8b51f407459c3e3112a6a3d8a0e23bac60fc3c" },
    ],
  },
  fourEyes: {
    source: "A separate live run on Alta testnet, 30 October (the four-eyes run log): a test account with two owners, the CFO and the controller, threshold 2",
    proofs: [
      { what: "CFO alone: reverted", tx: "0xe0976c5a0ad7ebe51ed0bc9564b2f366fd141b6ba24a55b09fe71ea23e2269c3" },
      { what: "CFO and a stranger: reverted", tx: "0x728a9c270614d5bbeb11540f897a3b29fab00e2275c84cbb4022c74d7149c43b" },
      { what: "CFO and controller: paid", tx: "0xd98e94ffa3c859de037f944322b05c0f3a097f45780dbd1b8ec9d4689961d30d" },
      { what: "revoke by CFO alone: reverted", tx: "0x3bf9f70e0b7c4e3c9cef05eddc755d3a4218227251b3699ddaa77756ba303ab5" },
    ],
  },
  compliance: {
    source: "A separate live run on Alta testnet, 30 October (the compliance run log): our send-policy contract, with test lists and a stand-in sanctioned address",
    proofs: [
      { what: "screened payment: paid", tx: "0xc2eb68144c8285a07ac6687a8f1c8085e9ee2826f8d6043663073eca2e79f237" },
      { what: "replayed decision: reverted", tx: "0x222385b575d3b143e462e1146bd37d556fd263a6aa87f264fce9721b63232737" },
      { what: "redirected to the attacker: reverted", tx: "0x0381193151a1990c4d6c829fa15243b30471e72dfb9bdfdfcd9c2ce13ad5e23a" },
      { what: "sanctioned payee: reverted", tx: "0x91ed35a52e1b3a0c01dbff9ab23f934d7d617b506ab89ac4022cf0739aed442e" },
    ],
  },
} as const;

type Row = Record<string, unknown>;
const has = (db: DB, table: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
const all = (db: DB, sql: string, ...a: unknown[]) => db.prepare(sql).all(...a) as Row[];
const one = (db: DB, sql: string, ...a: unknown[]) => db.prepare(sql).get(...a) as Row | undefined;
const short = (s: string) => (s.length > 14 ? `${s.slice(0, 10)}…${s.slice(-4)}` : s);
const tx = (hash: unknown, label?: string): Proof | null =>
  typeof hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(hash) ? { label: label ? `${label} · ${short(hash)}` : short(hash), href: `${EXPLORER_TX}${hash}` } : null;
const events = (db: DB, event: string) =>
  all(db, "SELECT ts, subject, payload_json FROM audit_log WHERE event = ? ORDER BY seq", event).map((r) => ({ ts: String(r.ts), subject: String(r.subject ?? ""), p: JSON.parse(String(r.payload_json)) as Row }));
const money = (s: unknown) => (typeof s === "string" && /^\d+\.\d{2}$/.test(s) ? s : "0.00");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Each account's role, from the ledger: who a payee is, in words. */
function payeeName(db: DB, address: string): string {
  const role = has(db, "metal_accounts") ? one(db, "SELECT role FROM metal_accounts WHERE lower(address) = lower(?)", address)?.role : undefined;
  return ({ supplier: "Stockline, a stand-in warehouse API we run", customer: "Summit Outfitters, a simulated customer", sweep: "Northwind's sweep wallet", business: "Northwind Outdoor" } as Record<string, string>)[String(role)] ?? short(address);
}

/** What each mandate paid: the purchases, refunds, sweeps or (for Summit) the sales it paid for. */
function paidUnder(db: DB, role: MandateView["role"]): { at: string; cents: number; what: string; tx: unknown }[] {
  const q = (sql: string) => (has(db, sql.match(/FROM (\w+)/)![1]!) ? all(db, sql) : []);
  if (role === "sourcing") return q("SELECT created_at AS at, price_cents AS c, tx_hash AS tx FROM upstream_purchases WHERE outcome = 'PAID' ORDER BY created_at").map((r) => ({ at: String(r.at), cents: Number(r.c), what: "stock check bought from Stockline", tx: r.tx }));
  if (role === "support") return events(db, "refund.paid").map((e) => ({ at: e.ts, cents: toCents(money(e.p.amount)), what: `refund of sale ${e.subject}, back to the customer's account`, tx: e.p.tx }));
  if (role === "treasury") return q("SELECT created_at AS at, amount_cents AS c, tx_hash AS tx FROM sweeps WHERE outcome = 'PAID' ORDER BY created_at").map((r) => ({ at: String(r.at), cents: Number(r.c), what: "earnings swept to the sweep wallet", tx: r.tx }));
  return q("SELECT created_at AS at, price_cents AS c, tx_hash AS tx, sale_id AS sale FROM sales WHERE status = 'DELIVERED' AND scheme = 'exact' ORDER BY sale_id").map((r) => ({ at: String(r.at), cents: Number(r.c), what: `stock check ${String(r.sale)} bought from Northwind`, tx: r.tx }));
}

const ROLES = ["sourcing", "support", "treasury", "customer"] as const;
const REFUSAL_WORDS: Record<string, string> = {
  mandate_cap_exceeded: "the payment was above the mandate's cap per payment",
  mandate_budget_exceeded: "the payment would go past the mandate's total budget",
  mandate_payee_not_allowed: "the payee is not the mandate's payee",
  mandate_expired: "the mandate had expired",
};

/** Each mandate as the chain enforces it now: bound, then replaced, with what was paid under it. */
export function mandateViews(db: DB): MandateView[] {
  const bound = events(db, "mandate.bound");
  const replaced = events(db, "mandate.replaced");
  const refusals = events(db, "upstream.refused");
  const out: MandateView[] = [];
  for (const role of ROLES) {
    const b = bound.find((e) => e.subject === role);
    if (!b) continue;
    const reps = replaced.filter((e) => e.subject === role);
    const last = reps.at(-1) ?? b;
    const paid = paidUnder(db, role);
    // Replacing carries the spend so far into the new budget (Alta docs, "Binding, replacing and revoking").
    // What was used and what is left come from the one source the dashboard and the check against the chain read.
    const av = mandateAvailability(db, role);
    const usedCents = av.paidCents;
    const budget = money(last.p.budget);
    const refusal = role === "sourcing" ? refusals.find((r) => String(r.p.reason ?? "").startsWith("mandate_")) : undefined;
    const display = role === "customer" ? { name: "Summit's buying agent", job: "Summit Outfitters, a simulated customer, buys Northwind's stock checks under a mandate its own owner bound" } : AGENT_DISPLAY[role];
    out.push({
      role, agent: display.name, job: display.job, account: String(b.p.principal ?? ""),
      payee: { name: payeeName(db, String(b.p.payee ?? "")), address: String(b.p.payee ?? "") },
      cap: money(last.p.cap), budget, used: fromCents(usedCents), pending: fromCents(av.pendingCents + av.heldCents),
      left: fromCents(Math.max(0, toCents(budget) - usedCents - av.pendingCents - av.heldCents)),
      expires_at: new Date(Date.parse(last.ts) + MANDATE_EXPIRES_IN_SECONDS * 1000).toISOString(),
      history: [
        { at: b.ts, what: role === "customer" ? "Bound by Summit's owner" : "Bound by Northwind's owner", cap: money(b.p.cap), budget: money(b.p.budget), tx: tx(b.p.tx) },
        ...reps.map((r) => ({ at: r.ts, what: `Replaced after the CFO's Face ID (${String(r.p.proposal_id ?? "")}); the old mandate revoked in the same transaction`, cap: money(r.p.cap), budget: money(r.p.budget), tx: tx(r.p.tx) })),
      ],
      count: paid.length,
      latest: paid.slice(-4).reverse().map((p) => ({ at: p.at, amount: fromCents(p.cents), what: p.what, tx: tx(p.tx) })),
      refusal: refusal ? {
        at: refusal.ts, reason: String(refusal.p.reason),
        plain: `Stockline (a stand-in supplier we run) doubled its price. The next purchase was refused against the on-chain mandate: ${REFUSAL_WORDS[String(refusal.p.reason).split(":")[0]!] ?? String(refusal.p.reason)}. Nothing moved and the customer was not charged; Purser priced the options, Opus reviewed them, and the CFO approved a new mandate with Face ID.`,
      } : null,
    });
  }
  return out;
}

/** The feature cards, each with its proof. Features without proof in this ledger or the other runs are left out. */
export function metalFeatures(db: DB, mandates: MandateView[], dispute: DisputeCase | null): MetalFeature[] {
  const f: MetalFeature[] = [];
  const recorded = "The recorded Northwind run on Alta testnet, 29 and 30 October";
  const afterwards = "The recorded Northwind run's payments, checked afterwards on a copy of its ledger";
  const ours = mandates.filter((m) => m.role !== "customer");
  if (ours.length) {
    f.push({
      id: "mandates", title: "A mandate per agent",
      plain: "Each agent pays from the company's Alta account under its own mandate: a cap per payment, a total budget, one payee and an expiry, bound on chain by the account's owner.",
      why: "The limit lives on the chain, not in the agent's prompt. A confused or tricked agent cannot pay more, or pay someone else: the payment simply does not settle.",
      figure: plural(ours.length, "mandate"), proofs: ours.map((m) => m.history[0]!.tx && { ...m.history[0]!.tx!, label: `${m.agent} · ${m.history[0]!.tx!.label}` }).filter((p): p is Proof => !!p),
      source: recorded, docs: [{ label: "Mandates", href: METAL_DOCS.mandates }],
    });
  }
  const reps = mandates.flatMap((m) => m.history.slice(1).map((h) => ({ m, h })));
  if (reps.length) {
    f.push({
      id: "replace", title: "Replace and revoke, after Face ID",
      plain: "A change to a mandate is one transaction: the new limits are bound, the old mandate is revoked, and the spend so far carries over.",
      why: "Loosening an agent's limit is a CFO decision. Purser proposes it, the CFO signs the exact terms with Face ID, and only then does the owner key bind it.",
      figure: plural(reps.length, "replacement"), proofs: reps.map(({ m, h }) => h.tx && { ...h.tx, label: `${m.agent} · ${h.tx.label}` }).filter((p): p is Proof => !!p),
      source: recorded, docs: [{ label: "Binding, replacing and revoking", href: `${METAL_DOCS.mandates}#binding-replacing-and-revoking` }],
    });
  }
  const sales = has(db, "sales") ? Number(one(db, "SELECT COUNT(*) AS n FROM sales WHERE status = 'DELIVERED' AND scheme = 'exact'")?.n ?? 0) : 0;
  const buys = has(db, "upstream_purchases") ? Number(one(db, "SELECT COUNT(*) AS n FROM upstream_purchases WHERE outcome = 'PAID'")?.n ?? 0) : 0;
  if (sales || buys) {
    const firstSale = has(db, "sales") ? one(db, "SELECT tx_hash FROM sales WHERE status = 'DELIVERED' AND tx_hash IS NOT NULL ORDER BY sale_id LIMIT 1") : undefined;
    const firstBuy = has(db, "upstream_purchases") ? one(db, "SELECT tx_hash FROM upstream_purchases WHERE outcome = 'PAID' AND tx_hash IS NOT NULL ORDER BY created_at LIMIT 1") : undefined;
    f.push({
      id: "x402", title: "Pay per request (x402), with a signed order",
      plain: "An API answers 402 with its price; the agent signs an order for exactly that amount, payee and resource, and pays under its mandate. Northwind requires every buyer's signed order, and buys from its own supplier the same way under its mandate.",
      why: "Agents buy in cents, many times a day. Each payment is tied to the order the agent signed, so the seller can prove later what was bought, at what price, by whom.",
      figure: `${sales + buys} payments`,
      proofs: [tx(firstSale?.tx_hash, "first sale"), tx(firstBuy?.tx_hash, "first purchase")].filter((p): p is Proof => !!p),
      source: recorded, docs: [{ label: "x402 on Alta", href: METAL_DOCS.x402 }, { label: "Signed orders", href: `${METAL_DOCS.mandates}#signed-orders` }],
    });
  }
  const refused = mandates.find((m) => m.refusal)?.refusal;
  const settlement = has(db, "sales") ? one(db, "SELECT settlement_id FROM sales WHERE status = 'DELIVERED' AND settlement_id IS NOT NULL ORDER BY sale_id LIMIT 1") : undefined;
  if (refused || settlement) {
    f.push({
      id: "facilitator", title: "Settled by Alta's facilitator, or refused",
      plain: "Alta's hosted facilitator settles each x402 payment and gives it a settlement id; a payment outside the mandate is refused with a reason, and nothing moves.",
      why: "The refusal is the safety: when the supplier doubled its price, Alta checked the on-chain mandate and said no before a cent left, and the agent had to ask the CFO.",
      figure: refused ? "1 refusal, 0 moved" : null,
      proofs: ([settlement?.settlement_id ? { label: `settlement id ${short(String(settlement.settlement_id).split(":").at(-1) ?? "")}`, href: null } : null, refused ? { label: `refused: ${refused.reason}`, href: null } : null] as (Proof | null)[]).filter((p): p is Proof => !!p),
      source: recorded, docs: [{ label: "Facilitator", href: METAL_DOCS.facilitator }, { label: "Refusal reasons", href: `${METAL_DOCS.facilitator}#refusal-reasons` }],
    });
  }
  if (dispute) {
    const within = dispute.packs.filter((p) => p.mandate.within).length;
    f.push({
      id: "verify", title: "verifyMandatePayment: each payment checked against the chain",
      plain: "With the payment's transaction and the signed order the seller keeps, the chain confirms that the owner bound the mandate it was paid under and that the agent paid inside its limits.",
      why: "When a customer says \"our agent never ordered this\", the seller does not argue. It checks each payment on chain and shows the signed order.",
      figure: `${within} of ${dispute.packs.length} verified`,
      proofs: [tx(dispute.packs.find((p) => p.mandate.bound_tx)?.mandate.bound_tx, "the customer's mandate")].filter((p): p is Proof => !!p),
      source: afterwards, docs: [{ label: "Verifying", href: `${METAL_DOCS.mandates}#verifying` }],
    });
  }
  const support = mandates.find((m) => m.role === "support");
  if (support?.count) {
    f.push({
      id: "pull", title: "Refunds as mandate pulls",
      plain: "A refund is a payment under the Support agent's own mandate, whose only payee is the customer's account, each with its own payment id.",
      why: "A refund can only go back to the account that paid, never to an address in an email, and a retry never pays twice.",
      figure: `${support.count} refunds`, proofs: support.latest.map((l) => l.tx).filter((p): p is Proof => !!p),
      source: recorded, docs: [{ label: "How a payment is checked", href: `${METAL_DOCS.mandates}#how-a-payment-is-checked` }, { label: "Payouts", href: METAL_DOCS.payouts }],
    });
  }
  const sweep = events(db, "credit.locked")[0];
  if (sweep) {
    f.push({
      id: "finality", title: "Sweep after finality",
      plain: `Earnings move to the sweep wallet under the Treasury agent's mandate. Purser books them at Airwallex, as a simulated sandbox deposit, only once their block (${String(sweep.p.block)}) is final (${String(sweep.p.finalized_block)}), and exactly once.`,
      why: "The books never count money that could still be undone, and a restart never credits it twice.",
      figure: "booked once", proofs: [tx(sweep.p.tx, "sweep")].filter((p): p is Proof => !!p),
      source: recorded, docs: [{ label: "Settlement and finality", href: METAL_DOCS.finality }],
    });
  }
  f.push({
    id: "clearing", title: "Pay-per-call clearing",
    plain: "A buyer deposits once into Alta's clearing contract and pays each call with a signed receipt: no transaction per call. The seller withdraws its earnings once an epoch is final.",
    why: "Cent-sized calls at machine speed without a transaction each. Purser offers clearing only when it can deliver, because a clearing payment counts before the seller can refuse.",
    figure: "0 tx per call", proofs: OTHER_RUNS.clearing.proofs.map((p) => tx(p.tx, p.what)!),
    source: OTHER_RUNS.clearing.source, docs: [{ label: "Clearing", href: METAL_DOCS.clearing }],
  });
  f.push({
    id: "receive", title: "Receive policy: money from strangers held",
    plain: "Purser can set the sweep wallet to accept money only from the business's own account. Anything else is held by Alta in quarantine; the CFO returns or accepts it with Face ID.",
    why: "Unknown money is a compliance problem, not a windfall. It never reaches the books or the bank until a person decides.",
    figure: "held, then returned", proofs: OTHER_RUNS.receive.proofs.map((p) => tx(p.tx, p.what)!),
    source: OTHER_RUNS.receive.source, docs: [{ label: "Receive policy", href: METAL_DOCS.receive }],
  });
  f.push({
    id: "four-eyes", title: "Four eyes on chain",
    plain: "A Alta account with two owners, the CFO and the controller, and a threshold of two (a test account; Northwind's own account has one owner). Binding or revoking a mandate, or paying from the account itself, needs both signatures; one is refused by the chain.",
    why: "No single person, and no single stolen owner key, can change an agent's limits or move the account's money beyond what the agents' mandates allow. Agents still pay alone inside their mandates.",
    figure: "1 signature: reverted", proofs: OTHER_RUNS.fourEyes.proofs.map((p) => tx(p.tx, p.what)!),
    source: OTHER_RUNS.fourEyes.source, docs: [{ label: "Smart account", href: METAL_DOCS.account }],
  });
  f.push({
    id: "compliance", title: "Compliance before a payout from the policy contract",
    plain: "Outgoing funds sit in a send-policy contract. They leave only with a decision Purser signed for exactly that payee, amount and moment, after screening the payee; without it the chain reverts.",
    why: "A sanctioned or unapproved payee cannot be paid from the contract, even by someone holding the payer key; only Purser's compliance key can clear a payment. Eleven attacks on it reverted on chain.",
    figure: "11 attacks reverted", proofs: OTHER_RUNS.compliance.proofs.map((p) => tx(p.tx, p.what)!),
    source: OTHER_RUNS.compliance.source, docs: [{ label: "Programmable compliance", href: METAL_DOCS.compliance }],
  });
  f.push({
    id: "certificates", title: "Finality certificates as evidence",
    plain: "For each payment the runner sees within about 2 hours, Purser stores the finality certificate Alta's RPC reports for its block: the header, and which validators signed. It checks the header and the quorum, and keeps it in the dispute pack, the audit report and verify.",
    why: "Proof of finality kept with the payment, not looked up later. Honest limit: the validators' signature is not verified (their keys are not published for testnet), and nodes keep certificates about 2 hours.",
    figure: "3 of 4 validators", proofs: OTHER_RUNS.fourEyes.proofs.slice(2, 3).map((p) => tx(p.tx, "a certified payment")!),
    source: "The same live runs: all 26 of their transactions have a reported certificate", docs: [{ label: "Finality certificates", href: METAL_DOCS.certificates }],
  });
  if (dispute) {
    f.push({
      id: "dispute", title: "The Dispute desk",
      plain: "Northwind, as the seller, decides a customer's claim from what Alta lets it prove: the signed order, the chain check, the settlement and the hash of the data delivered.",
      why: "Agent commerce needs a fair way to settle \"we never ordered this\". Code checks each order against the evidence, Opus explains it, and a refund above the CFO's limits waits for Face ID.",
      figure: `${dispute.packs.length} orders checked`, proofs: [{ label: `case ${dispute.case_id}`, href: "#dispute" }],
      source: afterwards, docs: [{ label: "Verifying", href: `${METAL_DOCS.mandates}#verifying` }, { label: "Signed orders", href: `${METAL_DOCS.mandates}#signed-orders` }],
    });
  }
  return f;
}

export function metalShowcase(db: DB): MetalShowcase {
  const mandates = mandateViews(db);
  let disputes: DisputeCase[] = [];
  try {
    disputes = disputeCases(db);
  } catch (e) {
    if (!/no such table/.test((e as Error).message)) throw e;
  }
  const dispute = disputes[0] ?? null;
  return { features: metalFeatures(db, mandates, dispute), mandates, dispute, disputes };
}
