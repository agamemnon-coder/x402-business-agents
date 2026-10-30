// "Purser live" (storyboard: docs/plans/purser-live-storyboard.md): one working day at Northwind as an animation.
// Every number on screen comes from a recorded live run: the demo story and dashboard recorded from Friday run 1
// (docs/demo/), and for the three moments recorded elsewhere, their run logs (LIVE_RUNS below). A fact that cannot
// be found stops the build: the page never invents one.

import type { Story } from "../demo/story.js";
import type { Recorded } from "../demo/recorded.js";

export interface LiveFact { label: string; value: string; href: string | null }
export interface LiveScene {
  id: string;
  /** What draws the scene. */
  kind: "title" | "coins" | "card" | "refuse" | "faceid" | "invoice" | "dispute" | "ask" | "fx" | "wall" | "end";
  seconds: number;
  /** The agent or party acting, highlighted on the left. */
  actor: "ops" | "sales" | "finance" | "cfo" | "customer" | "stranger" | null;
  title: string;
  line: string;
  facts: LiveFact[];
  /** Which Claude model did what, as small labels (advice, never a decision). */
  models: { model: "Haiku" | "Sonnet" | "Opus"; did: string }[];
  /** Where the numbers come from. */
  source: string;
  /** The rail the scene happens on: its screen time is counted per rail (about 30 seconds each). */
  rail: "airwallex" | "metal" | null;
  /** Money on the move: along a lane, from an agent (or to it, "in"), approved, or stopped at the lane's gate. */
  moves: LiveMove[];
  /** What the CFO's phone shows, and when. */
  phone: { at: number; text: string; faceId: boolean } | null;
  /** The one big number of the scene. */
  big: { value: string; label: string } | null;
  /** The proof: an Airwallex id (from the sandbox API) or a Metal transaction (explorer link). */
  proofs: LiveFact[];
}
export interface LiveMove {
  lane: "airwallex" | "metal";
  /** Who pays (left) and who is paid (the end of the lane). */
  from: string;
  to: string;
  amount: string;
  /** ok: paid; in: paid to Northwind; declined (by Airwallex), refused (by the chain), held (by Metal's receive policy), blocked (by Purser before the rail). */
  outcome: "ok" | "in" | "declined" | "refused" | "held" | "blocked";
  /** Seconds into the scene. */
  at: number;
  /** The words on the gate the payment stops at. */
  gate?: string;
}
export interface LiveTimeline { company: string; recorded_at: string; run: string; scenes: LiveScene[] }

/**
 * The moments recorded after Friday run 1, in their own live runs. Kept here, in the run logs' words (their result
 * column, without the decline codes), so the page can show them without a ledger.
 */
export const LIVE_RUNS = {
  task: {
    source: "Live in the Airwallex sandbox, 30 October (docs/runs/2026-10-30-single-use.md)",
    ask: "Book a flight to Berlin on 12 November, at most €150", card: "Single-use flight card •••• 8653, at most 150.00 EUR, until 12 Nov",
    booked: "Skyline Air 120.00 EUR: approved by Airwallex", second: "A second charge, 20.00 EUR: declined, the card had closed itself",
  },
  quarantine: {
    source: "Live on Metal testnet, 30 October (docs/metal-award.md, section 5)",
    held: "0.02 test USD from 0xA262…b646: held by Metal's receive policy", returned: "Returned to the sender after the CFO's Face ID",
    tx: "0x786686b6dd5112b80bbf84902c8b51f407459c3e3112a6a3d8a0e23bac60fc3c",
  },
} as const;

const EXPLORER = "https://testnet.metalntwx.com/tx/";

/** Stockline's price before the rise, as Friday run 1's log records it ("S1 price rise: Stockline 0.02 -> 0.04"). */
export const FROM_RUN_LOG = { oldPrice: "0.02", source: "docs/runs/2026-10-30-friday-1.md" } as const;
const FROM_RUN_LOG_PRICE = FROM_RUN_LOG.oldPrice;

export function buildLiveTimeline(story: Story, recorded: Recorded): LiveTimeline {
  const step = (id: string) => {
    const s = story.steps.find((x) => x.id === id);
    if (!s) throw new Error(`the recorded story has no step "${id}"`);
    return s;
  };
  const fact = (id: string, label: RegExp): LiveFact => {
    const f = (step(id).facts ?? []).find((x) => label.test(x.label));
    if (!f) throw new Error(`the recorded step "${id}" has no fact matching ${label}`);
    // On screen, chain money reads "test USD", as on every page.
    return { label: f.label, value: f.value.replace(/\*?USDZ( \(testnet dollars\))?/g, "test USD"), href: f.href ?? null };
  };
  const snap = recorded.snapshot as unknown as { disputes?: { case_id: string; claim: string; outcome: string; refund: string; sales: { order: string; chain: boolean }[] }[] };
  const dispute = snap.disputes?.[0];
  if (!dispute) throw new Error("the recorded dashboard has no Dispute desk case");
  const verified = dispute.sales.filter((s) => s.chain && s.order.startsWith("signed")).length;
  // The proofs per rail, as the recorded dashboard lists them (src/dashboard/rails.ts).
  const rails = (recorded.snapshot as unknown as { rails?: { airwallex: { what: string; proof: LiveFact | null; simulated?: boolean }[]; metal: { what: string; proof: LiveFact | null }[] } }).rails;
  if (!rails) throw new Error("the recorded dashboard has no rails");
  const proof = (lane: "airwallex" | "metal", what: RegExp, label: string): LiveFact => {
    const r = (rails[lane] as { what: string; proof: { label: string; href: string | null } | null; simulated?: boolean }[]).find((x) => what.test(x.what));
    if (!r?.proof) throw new Error(`the recorded ${lane} rail has no proof for ${what}`);
    return { label: r.simulated ? `${label} (sandbox)` : label, value: r.proof.label, href: r.proof.href };
  };
  const amount = (v: string) => {
    const m = v.match(/(?:EUR |USD )?\d[\d,]*\.\d{2}(?: EUR)?/);
    if (!m) throw new Error(`no amount in "${v}"`);
    return m[0].includes("EUR") ? `€${m[0].replace(/ ?EUR ?/, "")}` : m[0];
  };
  const salesPrice = fact("buy", /Sales/).value.match(/at (\d+\.\d{2})/)?.[1];
  const capRise = (step("refused").details ?? "").match(/asks ([\d.]+) for a stock check\. The mandate's cap is ([\d.]+)/);
  if (!salesPrice || !capRise) throw new Error("the recorded story lacks the stock-check prices");
  const newPrice = capRise[1]!, cap = capRise[2]!;
  const card = { ok: fact("card", /^Approved/).value, no: fact("card", /^Declined/).value, raise: fact("card", /^Limit raised/).value };
  const raise = card.raise.match(/^([\d.]+) \/ [\d.]+ → ([\d.]+)/);
  if (!raise) throw new Error("the recorded story lacks the card raise");
  const conversion = fact("swift", /^Conversion/).value.match(/USD ([\d,.]+) → EUR ([\d,.]+)/);
  const swiftAmount = fact("swift", /^SWIFT/).value.match(/EUR ([\d,.]+)/)?.[1];
  const fee = fact("swift", /^Airwallex fee/).value.match(/EUR ([\d,.]+)/)?.[1];
  if (!conversion || !swiftAmount || !fee) throw new Error("the recorded story lacks the euro bill");
  const blocked = fact("stopped", /Invoice blocked/).value.match(/EUR ([\d,.]+)/)?.[1];
  if (!blocked) throw new Error("the recorded story lacks the blocked invoice");
  const firstSale = dispute.sales[0] as { tx?: string } | undefined;
  const none = { moves: [] as LiveMove[], phone: null, big: null, proofs: [] as LiveFact[] };
  const company = story.company ?? "Northwind Outdoor";
  const run = "Friday run 1, 30 October 2026 (Metal testnet, Airwallex sandbox)";

  const scenes: LiveScene[] = [
    { id: "title", kind: "title", seconds: 5, actor: null, title: `A working day at ${company}`, line: "Three AI agents. One CFO. Real rails, test money.", facts: [], models: [], source: run, rail: null, ...none, big: { value: "3 agents · 2 rails · 1 CFO", label: "the agents act alone inside their limits; the CFO approves the rest with Face ID" } },
    { id: "coins", kind: "coins", seconds: 6, actor: "ops", title: "Agents pay per request, on their own", line: "A retailer's agent pays us for each stock check; our agent buys the data from the supplier, cents at a time, under on-chain mandates.",
      facts: [fact("buy", /Sales/), fact("buy", /first payment/i)], models: [], source: run, rail: "metal", moves: [0, 1.6, 3.2].flatMap((t) => [{ lane: "metal" as const, from: "Summit's agent", to: "Northwind", amount: salesPrice, outcome: "in" as const, at: t }, { lane: "metal" as const, from: "Operations agent", to: "Stockline", amount: FROM_RUN_LOG_PRICE, outcome: "ok" as const, at: t + 0.8 }]), phone: null, big: { value: fact("buy", /Sales/).value.split(" at ")[0]!, label: `sold per request at ${fact("buy", /Sales/).value.split(" at ")[1] ?? ""}, each paid under the buyer's mandate on chain` }, proofs: [proof("metal", /x402/, "First sale"), proof("metal", /buys from its supplier/, "First purchase")] },
    { id: "card", kind: "card", seconds: 10, actor: "ops", title: "Its own company card", line: "The Operations agent pays for software on its own Airwallex card, within the limit the CFO set.",
      facts: [fact("card", /^Approved/), fact("card", /^Declined/)], models: [], source: run, rail: "airwallex", moves: [{ lane: "airwallex", from: "Operations agent", to: "Packwise", amount: amount(card.ok), outcome: "ok", at: 0.4 }, { lane: "airwallex", from: "Operations agent", to: "Packwise", amount: amount(card.no), outcome: "declined", at: 3, gate: `Airwallex declines: over the €${raise[1]} limit` }, { lane: "airwallex", from: "Operations agent", to: "Packwise", amount: amount(card.no), outcome: "ok", at: 7.4 }], phone: { at: 5, text: `Card limit €${raise[1]} → €${raise[2]}`, faceId: true }, big: { value: `${amount(card.no)} declined, then paid`, label: `declined by Airwallex on the €${raise[1]} limit; paid after the CFO raised it to €${raise[2]} with Face ID` }, proofs: [proof("airwallex", /^Approved by Airwallex/, "Approved"), proof("airwallex", /^Declined by Airwallex/, "Declined")] },
    { id: "refuse", kind: "refuse", seconds: 9, actor: "ops", title: "The limit holds, on chain", line: "The supplier doubles its price. The payment bounces off the mandate: nothing moves, the customer is not charged.",
      facts: [fact("refused", /^Refusal/), fact("refused", /Option A/), fact("refused", /Option B/)],
      models: [{ model: "Haiku", did: "sorted the notice" }, { model: "Sonnet", did: "read the new price" }], source: run, rail: "metal", moves: [{ lane: "metal", from: "Operations agent", to: "Stockline", amount: FROM_RUN_LOG_PRICE, outcome: "ok", at: 0.4 }, { lane: "metal", from: "Operations agent", to: "Stockline", amount: newPrice, outcome: "refused", at: 2.6, gate: `Metal refuses: over the ${cap} cap on chain` }], phone: null, big: { value: `${newPrice} > ${cap}`, label: "refused by the mandate on chain: nothing moved, the customer was not charged" }, proofs: [{ label: "Refused on chain", value: "mandate_cap_exceeded (no transaction: nothing moved)", href: null }, proof("metal", /A mandate per agent/, "The mandate")] },
    { id: "faceid", kind: "faceid", seconds: 6, actor: "cfo", title: "The CFO decides, with Face ID", line: "The phone shows the exact terms. Face ID signs their hash; the mandates are replaced in a safe order.",
      facts: [{ label: "Approved", value: step("faceid").approval?.proposal ? `${step("faceid").approval!.proposal}: ${step("faceid").approval!.what}` : "", href: null }, fact("faceid", /mandate replaced/i)],
      models: [{ model: "Opus", did: fact("faceid", /Advice/).value.replace(/^Opus (advised )?/, "") + " (advice)" }], source: run, rail: "metal", moves: [], phone: { at: 0.6, text: `${step("faceid").approval?.proposal ?? ""}: new mandates`, faceId: true }, big: { value: "Face ID", label: "the CFO signs the exact terms; the mandates are replaced on chain" }, proofs: [proof("metal", /Mandate replaced/, "Replaced on chain")] },
    { id: "invoice", kind: "invoice", seconds: 7, actor: "finance", title: "A fake invoice goes nowhere", line: "An invoice with changed bank details, and a planted instruction in a customer's email: both stopped before any money moves.",
      facts: [fact("stopped", /Invoice blocked/), fact("stopped", /Planted/)],
      models: [{ model: "Haiku", did: "sorted the document" }, { model: "Sonnet", did: "read the invoice" }, { model: "Opus", did: "do not pay (advice)" }], source: run, rail: null, moves: [{ lane: "airwallex", from: "Finance agent", to: "a changed IBAN", amount: `€${blocked}`, outcome: "blocked", at: 1.2, gate: "Purser blocks it before Airwallex" }], phone: null, big: { value: `€${blocked}`, label: "to changed bank details: blocked before any money moved" }, proofs: [] },
    { id: "dispute", kind: "dispute", seconds: 7, actor: "customer", title: "\"Our agent never ordered this\"", line: "Northwind checks what it can prove: each order the agent signed, each payment against the customer's mandate on chain.",
      facts: [{ label: `Dispute ${dispute.case_id}`, value: `${verified} of ${dispute.sales.length} orders signed and verified on chain`, href: null }, { label: "Decision by code", value: dispute.outcome === "rejected" ? `Not refunded (${dispute.refund})` : `Refund ${dispute.refund}`, href: null }],
      models: [{ model: "Opus", did: "explained the decision (advice)" }], source: `${run}, with a Dispute desk case afterwards`, rail: "metal", moves: [{ lane: "metal", from: "Summit's agent", to: "Northwind", amount: "12 orders", outcome: "in", at: 0.3 }], phone: null, big: { value: `${verified} of ${dispute.sales.length}`, label: "orders proven from the chain: signed by their agent, inside their mandate" }, proofs: firstSale?.tx ? [{ label: "Order 5, paid on chain", value: `${firstSale.tx.slice(0, 10)}…${firstSale.tx.slice(-4)}`, href: `${EXPLORER}${firstSale.tx}` }] : [] },
    { id: "ask", kind: "ask", seconds: 10, actor: "cfo", title: "Ask Purser", line: `"${LIVE_RUNS.task.ask}"`,
      facts: [{ label: "Issued", value: LIVE_RUNS.task.card, href: null }, { label: "Booked", value: LIVE_RUNS.task.booked, href: null }, { label: "Then", value: LIVE_RUNS.task.second, href: null }],
      models: [], source: LIVE_RUNS.task.source, rail: "airwallex", moves: [{ lane: "airwallex", from: "Task card", to: "Skyline Air", amount: amount(LIVE_RUNS.task.booked), outcome: "ok", at: 2 }, { lane: "airwallex", from: "Task card", to: "Skyline Air", amount: amount(LIVE_RUNS.task.second), outcome: "declined", at: 5.5, gate: "Airwallex declines: the card closed itself" }], phone: { at: 0.6, text: `${LIVE_RUNS.task.card}: issued within the CFO's policy`, faceId: false }, big: { value: "1 charge", label: "a single-use Airwallex card: the booking goes through, the second charge is declined" }, proofs: [{ label: "Airwallex card", value: "•••• 8653, single use", href: null }] },
    { id: "fx", kind: "fx", seconds: 11, actor: "finance", title: "The euro bill", line: "Only the missing euros are bought, on a checked rate; the SWIFT payment carries the approval's hash.",
      facts: [fact("swift", /Conversion/), fact("swift", /SWIFT/)], models: [], source: run, rail: "airwallex", moves: [{ lane: "airwallex", from: "Finance agent", to: "EUR account", amount: `USD ${conversion[1]}`, outcome: "ok", at: 0.6 }, { lane: "airwallex", from: "Finance agent", to: "Supplier (SWIFT)", amount: `€${swiftAmount}`, outcome: "ok", at: 5.4 }], phone: { at: 3.4, text: `${step("swift").approval?.proposal ?? ""}: pay €${swiftAmount} by SWIFT`, faceId: true }, big: { value: `€${swiftAmount}`, label: `paid by SWIFT (marked paid by the sandbox); only the missing €${conversion[2]} converted, because the demo plan sets aside most of the sandbox's test euros; fee €${fee}` }, proofs: [proof("airwallex", /FX conversion/, "Conversion"), proof("airwallex", /SWIFT payout/, "SWIFT payout")] },
    { id: "wall", kind: "wall", seconds: 5, actor: "stranger", title: "Money from a stranger", line: "A payment from an unknown address stops at Metal's receive policy. The CFO decides what happens to it.",
      facts: [{ label: "Held", value: LIVE_RUNS.quarantine.held, href: null }, { label: "Returned", value: LIVE_RUNS.quarantine.returned, href: `${EXPLORER}${LIVE_RUNS.quarantine.tx}` }], models: [], source: LIVE_RUNS.quarantine.source, rail: "metal", moves: [{ lane: "metal", from: "Unknown sender", to: "Sweep wallet", amount: "0.02", outcome: "held", at: 0.6, gate: "Metal's receive policy holds it" }], phone: { at: 2.6, text: "Return the 0.02 to the sender", faceId: true }, big: { value: "0.02 held", label: "money from a stranger never reaches the books; returned after the CFO's Face ID" }, proofs: [{ label: "Returned on chain", value: `${LIVE_RUNS.quarantine.tx.slice(0, 10)}…${LIVE_RUNS.quarantine.tx.slice(-4)}`, href: `${EXPLORER}${LIVE_RUNS.quarantine.tx}` }] },
    { id: "end", kind: "end", seconds: 6, actor: null, title: "Every payment has a proof.", line: "The CFO keeps the pen.", facts: [fact("audit", /Audit rows/)], models: [], source: run, rail: null, ...none, big: { value: fact("audit", /Audit rows/).value.split(",")[0]!, label: "audit rows, hash-chained: every euro has a proof" } },
  ];
  for (const s of scenes) for (const f of s.facts) if (!f.value) throw new Error(`scene ${s.id}: empty fact ${f.label}`);
  return { company, recorded_at: story.recorded_at, run, scenes };
}
