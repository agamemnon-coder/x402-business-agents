// The three locks on /try/sign (Max, 6 Nov): a payment can be stopped by Purser's policy (rules in code, before anything
// is signed), by Airwallex's card limit, or by Metal's mandate on chain. The visitor's blocked payment is a simulation
// in their test world; each lock links to a real example, taken here from the records, never typed in:
//   Purser's policy  the main run (docs/demo/main-run.json): the floors that held at P-0005 (Max, 6 Nov). Purser's
//                    invoice plan (code, the plan_invoice row) found EUR needed and EUR free, and the FX converted
//                    only the shortfall (the ledger's fx.converted row), so the floors held; the USD balance after
//                    it stayed above the USD floor (the treasury snapshot after P-0005 ran);
//   Airwallex        the separate TAP run of 2 November (docs/runs/visa-tap-live-*.json): the card payment Airwallex's
//                    sandbox declined over the card's limit (LIMIT_EXCEEDED);
//   Metal            the main run: the purchase let through to Metal on purpose, refused on chain over the mandate's
//                    cap (its transaction, on Metal's testnet explorer).
// And the approval sheet's model: the CFO's own approval in the main run (P-0005, the licence invoice), named under the
// visitor's sheet. test/try-examples.test.ts checks each against its record.

import { EXPLORER_TX } from "../metal/network.js";
import { REPO_URL } from "../submission/deck.js";
import { letThroughOf, loadRecord, runName, tapRun, type RunRecord } from "../redesign/run.js";

export type LockId = "purser" | "airwallex" | "metal";
export interface Lock {
  id: LockId;
  /** "Purser's policy", "Airwallex's card limit", "Metal's mandate". */
  name: string;
  /** What the lock is, in one line. */
  what: string;
  /** Which run the example is from, said as such ("Main run, 3 Nov"; "Separate TAP run, 2 Nov"). */
  run: string;
  /** The real example, in one line. */
  example: string;
  /** Where to see it. */
  href: string;
  /** The link's words. */
  link: string;
}

const dayMonth = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
const hhmm = (iso: string) => iso.slice(11, 19);
const need = <T>(v: T | null | undefined, what: string): T => {
  if (v === null || v === undefined || v === "") throw new Error(`/try/sign's locks: the record has no ${what}`);
  return v;
};

interface LedgerRow { seq: number; ts: string; event: string; subject: string | null; payload: Record<string, unknown> }
const cents = (s: string) => Math.round(Number(s) * 100);

/**
 * Purser's own floors holding in the main run: the invoice plan in code (its row) needed EUR (invoice + fee ceiling)
 * beyond the EUR free above the floors, and the FX that followed (its ledger row) bought only that shortfall; the
 * USD left after it stayed above the USD floor. Every figure is the record's; they must add up, or this throws.
 */
export interface FloorsHeld { proposal: string; at: string; planSeq: number; fxSeq: number; needed: string; free: string; buy: string; sell: string; usdAfter: string; usdFloor: string }
export function floorsHeld(r: RunRecord): FloorsHeld {
  const events = (r.ledger?.events ?? []) as unknown as LedgerRow[];
  const fx = need(events.find((e) => e.event === "fx.converted"), "FX conversion (fx.converted)");
  const proposal = need((fx.payload.origin as { proposal_id?: string } | undefined)?.proposal_id, "proposal behind the FX");
  const steps = (r.snapshot.traces ?? []).flatMap((t) => t.steps);
  const plan = need(steps.find((s) => s.tool === "plan_invoice" && /EUR needed \d+\.\d{2}/.test(s.text ?? "")), "invoice plan (plan_invoice)");
  const text = plan.text ?? "";
  const needed = need(/EUR needed (\d+\.\d{2})/.exec(text)?.[1], "EUR needed in the plan");
  const free = need(/free EUR (\d+\.\d{2})/.exec(text)?.[1], "EUR free in the plan");
  const buy = String(fx.payload.buy ?? ""), sell = String(fx.payload.sell ?? "");
  if (!/^EUR \d+\.\d{2}$/.test(buy) || !/^USD \d+\.\d{2}$/.test(sell)) throw new Error("/try/sign's locks: the FX row has no EUR bought or USD sold");
  if (cents(needed) - cents(free) !== cents(buy.slice(4)) || !new RegExp(`convert only the shortfall: buy ${buy}`).test(text)) {
    throw new Error(`/try/sign's locks: the plan (${needed} needed, ${free} free) and the FX (${buy}) do not agree`);
  }
  const awx = (r.snapshot as unknown as { treasury?: { airwallex?: { label?: string; usd?: { available?: string; floor?: string } } } }).treasury?.airwallex;
  if (awx?.label !== `post-exec:${proposal}`) throw new Error(`/try/sign's locks: no treasury snapshot after ${proposal}`);
  const usdAfter = need(awx.usd?.available, "USD after"), usdFloor = need(awx.usd?.floor, "USD floor");
  if (cents(usdAfter) < cents(usdFloor)) throw new Error("/try/sign's locks: the USD floor did not hold");
  return { proposal, at: fx.ts, planSeq: need(plan.seq, "the plan's row number"), fxSeq: fx.seq, needed, free, buy, sell, usdAfter, usdFloor };
}

/** The three locks with their real examples, from the main run's record and the TAP run's. Throws when one is missing. */
export function tryLocks(r: RunRecord = loadRecord().record): Lock[] {
  const run = `${runName(r).replace(/^the /, "").replace(/^./, (c) => c.toUpperCase())}`;

  // Purser's policy: its floors holding at P-0005 (FX only for the shortfall).
  const f = floorsHeld(r);

  // Airwallex's card limit: the TAP run's declined card payment.
  const tap = need(tapRun(), "TAP run (docs/runs/visa-tap-live-*.json)");
  const decline = need(tap.steps.find((s) => !s.approved && s.reason === "LIMIT_EXCEEDED"), "LIMIT_EXCEEDED decline in the TAP run");

  // Metal's mandate: the purchase let through on purpose, refused on chain.
  const lt = need(letThroughOf(r), "purchase let through to Metal");
  const tx = need(lt.tx, "on-chain refusal's transaction");
  if (!/^0x[0-9a-f]{64}$/.test(tx)) throw new Error(`/try/sign's locks: not a transaction hash: ${tx}`);

  return [
    {
      id: "purser", name: "Purser's policy", what: "Rules in code, checked before anything is signed: reserve floors, limits, what an agent may pay alone.",
      run: `${run}, ${dayMonth(f.at)}`,
      example: `${f.proposal}: the invoice needed EUR ${f.needed} and EUR ${f.free} was free, so Purser's plan converted only the shortfall: ${f.buy} for ${f.sell} at ${hhmm(f.at)} UTC (plan row ${f.planSeq}, ledger row ${f.fxSeq}). The floors held: USD ${f.usdAfter} after it, above the USD floor of ${f.usdFloor}.`,
      href: "proof#airwallex", link: "See the FX row on Proof",
    },
    {
      id: "airwallex", name: "Airwallex's card limit", what: "Each agent's card has its own limit at Airwallex; over it, Airwallex declines the payment.",
      run: `Separate TAP run, ${dayMonth(tap.ranAt)} (Airwallex sandbox)`,
      example: `Airwallex declined ${decline.currency} ${decline.amount} over the card's limit: ${decline.reason} (transaction ${decline.txId}).`,
      href: `${REPO_URL}/blob/main/${tap.file}`, link: "Open the run's record",
    },
    {
      id: "metal", name: "Metal's mandate", what: "Each agent's limit is a mandate on chain; over its cap, Metal refuses the payment itself.",
      run: `${run}, ${dayMonth(lt.at)}`,
      example: `${lt.amount} test USD over the mandate's ${lt.cap} cap, let through on purpose: Metal refused it on chain; nothing moved (tx ${tx.slice(0, 10)}…${tx.slice(-4)}).`,
      href: `${EXPLORER_TX}${tx}`, link: "Open the transaction on Metal's explorer",
    },
  ];
}

/** The CFO's own approval in the main run that the visitor's sheet is modelled on: the invoice paid after Face ID. */
export interface CfoApproval { proposal: string; vendor: string; amount: string; currency: string; method: string; at: string; hash: string; line: string }
export function cfoApproval(r: RunRecord = loadRecord().record): CfoApproval {
  const proposals = (r.ledger?.proposals ?? []) as unknown as { proposal_id: string; kind: string; status: string; terms: Record<string, unknown> }[];
  const events = (r.ledger?.events ?? []) as unknown as LedgerRow[];
  const p = need(proposals.find((x) => x.kind === "invoice_payment" && x.status === "EXECUTED"), "invoice payment approved and executed");
  const ok = need(events.find((e) => e.event === "proposal.approved" && e.subject === p.proposal_id && e.payload.method === "passkey"), `passkey approval of ${p.proposal_id}`);
  const t = p.terms;
  const out = { proposal: p.proposal_id, vendor: String(t.beneficiary_name ?? t.vendor ?? ""), amount: String(t.amount ?? ""), currency: String(t.currency ?? ""), method: String(t.method ?? ""), at: hhmm(ok.ts), hash: String(ok.payload.terms_sha256 ?? "") };
  if (!out.vendor || !/^\d+\.\d{2}$/.test(out.amount) || !out.currency || !/^[0-9a-f]{64}$/.test(out.hash)) throw new Error(`/try/sign: ${p.proposal_id}'s terms are incomplete in the record`);
  return { ...out, line: `Modelled on the CFO's real approval sheet (${runName(r).replace(/^the /, "")}): ${out.proposal}, pay ${out.vendor} ${out.currency} ${out.amount}${out.method ? ` by ${out.method}` : ""}, signed with Face ID at ${out.at} UTC.` };
}

/** The main run's FX quote (P-0005's conversion, in its terms), shown at the Airwallex lock only when no live quote is to be had, labelled "recorded, not live". */
export interface RecordedQuote { quote_id: string; buy_currency: string; buy_amount: string; sell_currency: string; sell_amount: string; client_rate: string; valid_to: string; run: string }
export function recordedQuote(r: RunRecord = loadRecord().record): RecordedQuote {
  const proposals = (r.ledger?.proposals ?? []) as unknown as { proposal_id: string; terms: { conversion?: Record<string, unknown> } }[];
  const f = floorsHeld(r);
  const c = need(proposals.find((x) => x.proposal_id === f.proposal)?.terms.conversion, `${f.proposal}'s conversion in its terms`);
  const q = { quote_id: String(c.quote_id ?? ""), buy_currency: String(c.buy_currency ?? ""), buy_amount: String(c.buy_amount ?? ""), sell_currency: String(c.sell_currency ?? ""), sell_amount: String(c.sell_amount ?? ""), client_rate: String(c.client_rate ?? ""), valid_to: String(c.valid_to ?? "") };
  if (`${q.buy_currency} ${q.buy_amount}` !== f.buy || `${q.sell_currency} ${q.sell_amount}` !== f.sell || !/^[0-9a-f-]{36}$/.test(q.quote_id)) throw new Error("/try/sign: the recorded quote and the FX row do not agree");
  return { ...q, run: `${runName(r).replace(/^the /, "")}, ${dayMonth(f.at)}` };
}
