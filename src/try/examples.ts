// The three locks on /try/sign (Max, 6 Nov): a payment can be stopped by Purser's policy (rules in code, before anything
// is signed), by Airwallex's card limit, or by Metal's mandate on chain. The visitor's blocked payment is a simulation
// in their test world; each lock links to a real example, taken here from the records, never typed in:
//   Purser's policy  the main run (docs/demo/main-run.json): the first purchase Purser's code refused under a policy,
//                    before anything was signed (its ledger row, upstream.refused with refused_by buy_policy);
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

/** The three locks with their real examples, from the main run's record and the TAP run's. Throws when one is missing. */
export function tryLocks(r: RunRecord = loadRecord().record): Lock[] {
  const run = `${runName(r).replace(/^the /, "").replace(/^./, (c) => c.toUpperCase())}`;
  const events = (r.ledger?.events ?? []) as unknown as LedgerRow[];

  // Purser's policy: the first purchase its code refused under a policy, before anything was signed.
  const refused = need(events.find((e) => e.event === "upstream.refused" && e.payload.refused_by === "buy_policy"
    && (e.payload.origin as { actor?: string } | undefined)?.actor === "code"), "purchase refused by Purser's code under a policy");
  const row = need(r.snapshot.refusals.find((x) => x.seq === refused.seq), `refusal row for ledger row ${refused.seq}`);
  const check = need(/#(\d+)/.exec(row.reason)?.[1], "stock check number in the refusal");
  const setBy = (refused.payload.origin as { set_by?: { model?: string } } | undefined)?.set_by?.model;
  const family = /claude-(haiku|sonnet|opus)/i.exec(setBy ?? "")?.[1]?.replace(/^./, (c) => c.toUpperCase());

  // Airwallex's card limit: the TAP run's declined card payment.
  const tap = need(tapRun(), "TAP run (docs/runs/visa-tap-live-*.json)");
  const decline = need(tap.steps.find((s) => !s.approved && s.reason === "LIMIT_EXCEEDED"), "LIMIT_EXCEEDED decline in the TAP run");

  // Metal's mandate: the purchase let through on purpose, refused on chain.
  const lt = need(letThroughOf(r), "purchase let through to Metal");
  const tx = need(lt.tx, "on-chain refusal's transaction");
  if (!/^0x[0-9a-f]{64}$/.test(tx)) throw new Error(`/try/sign's locks: not a transaction hash: ${tx}`);

  return [
    {
      id: "purser", name: "Purser's policy", what: "Rules in code, checked before anything is signed: limits, reserve floor, what an agent may pay alone.",
      run: `${run}, ${dayMonth(refused.ts)}`,
      example: `${hhmm(refused.ts)} UTC: Purser's code refused stock check #${check} under the Sourcing agent's buy policy${family ? ` (set by Claude ${family})` : ""}; nothing was signed, nothing paid (ledger row ${refused.seq}).`,
      href: "proof#stops", link: "See it on Proof",
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
