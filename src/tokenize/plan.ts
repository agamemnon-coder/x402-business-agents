// The run's plan, worked out offline before anything is asked of Metal: the invoice (the source ledger's passkey
// approval and the document, checked as the mint checks them), the face value and the price, what each role's key
// must hold, and how many requests each step needs. `preflight` prints it; `fund` and the steps act on it. The call
// counts are computed from the same list of transactions the steps send (test/tokenize-live.test.ts holds each to the
// requests the in-memory chain counts).

import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { centsToBaseUnits } from "../lib/money.js";
import { discountedPrice } from "./flow.js";
import { ROLES, type Role } from "./keys.js";
import { approvalPasskey, approvedInvoice, mintRecord, MintRefused, testnetFaceValue, type ApprovalPasskey, type ApprovedInvoice } from "./record.js";

/**
 * What `fund` gives each role for gas on top of the money it must pay: 0.01 *USDZ. Gas is paid in *USDZ at 1 wei per
 * unit of gas, so the whole run's gas (a few million units) costs far less than this.
 */
export const GAS_ALLOWANCE = centsToBaseUnits(1);
/** The least a role with transactions still to send must hold for gas: half the allowance, so gas already paid never trips it. */
const GAS_ENOUGH = GAS_ALLOWANCE / 2n;

export interface RunInputs { sourceDb: string; proposal: string; documentPath: string; divisor: number; discountBps: number; debtor: string }

export const inputsOf = (env: Record<string, string | undefined>): RunInputs => ({
  sourceDb: env.TOKENIZE_SOURCE_DB ?? "", proposal: env.TOKENIZE_PROPOSAL ?? "", documentPath: env.TOKENIZE_DOCUMENT ?? "",
  divisor: Number(env.TOKENIZE_DIVISOR ?? "100"), discountBps: Number(env.TOKENIZE_DISCOUNT_BPS ?? "200"), debtor: env.TOKENIZE_DEBTOR ?? "Northwind Outdoor",
});

export interface RunPlan {
  invoice: ApprovedInvoice;
  approval: ApprovalPasskey;
  document: string;
  documentPath: string;
  divisor: number;
  discountBps: number;
  debtor: string;
  /** What settlement pays, in base units of *USDZ: the invoice amount divided by `divisor`. */
  faceValue: bigint;
  /** What the financier pays the creditor: the face value less the discount, to the cent. */
  price: bigint;
}

/** Everything the mint will check, checked now with no network: refused (MintRefused) exactly when the mint would be. */
export function planRun(i: RunInputs): RunPlan {
  let src: Database.Database;
  try { src = new Database(i.sourceDb, { readonly: true, fileMustExist: true }); } catch { throw new MintRefused(`cannot open the source ledger (TOKENIZE_SOURCE_DB) read-only`); }
  let invoice: ApprovedInvoice, approval: ApprovalPasskey;
  try {
    invoice = approvedInvoice(src, i.proposal);
    approval = approvalPasskey(src, i.proposal);
  } finally { src.close(); }
  let document: string;
  try { document = readFileSync(i.documentPath, "utf8"); } catch { throw new MintRefused(`cannot read the document (TOKENIZE_DOCUMENT)`); }
  const faceValue = testnetFaceValue(invoice.amountCents, i.divisor);
  // The mint's own refusals (the document's hash, its due date, the currency code), with placeholder addresses and salt.
  mintRecord(invoice, { document, creditor: "0x0000000000000000000000000000000000000001", payer: "0x0000000000000000000000000000000000000001", salt: Buffer.alloc(32, 1), debtorName: i.debtor, faceValue });
  return { invoice, approval, document, documentPath: i.documentPath, divisor: i.divisor, discountBps: i.discountBps, debtor: i.debtor, faceValue, price: discountedPrice(faceValue, i.discountBps) };
}

// ---- The run's transactions, step by step --------------------------------------------------------------------------

export type TxStep = "fund" | "deploy" | "mint" | "finance" | "settle";
export const TX_STEPS: readonly TxStep[] = ["fund", "deploy", "mint", "finance", "settle"];
export interface StepTx {
  /** The transaction's key in the run's journal. */
  key: string;
  sender: Role | "donor";
  /** One eth_estimateGas before it is signed (Purser's own contract); a direct call to *USDZ has a fixed limit. */
  estimate: boolean;
  what: string;
}

export const fundKey = (role: Role) => `fund-${role}`;

export const STEP_TXS: Record<TxStep, StepTx[]> = {
  fund: ROLES.map((r) => ({ key: fundKey(r), sender: "donor" as const, estimate: false, what: `Fund the ${r}'s key` })),
  deploy: [{ key: "deploy", sender: "issuer", estimate: true, what: "Deploy PurserInvoiceToken" }],
  mint: [{ key: "mint", sender: "issuer", estimate: true, what: "Mint to the creditor" }],
  finance: [
    { key: "offer", sender: "creditor", estimate: true, what: "Offer to the financier" },
    { key: "financier-approve", sender: "financier", estimate: false, what: "Financier approves the price" },
    { key: "accept", sender: "financier", estimate: true, what: "Financier accepts: advance to the creditor" },
  ],
  settle: [
    { key: "payer-approve", sender: "payer", estimate: false, what: "Debtor approves the face value" },
    { key: "settle", sender: "payer", estimate: true, what: "Debtor settles: face value to the holder, token burned" },
  ],
};

export type TxStatus = "signed" | "success" | "reverted" | undefined;

/**
 * The fewest requests a step still needs, with every receipt found on its first read. A finished transaction needs
 * none; a recorded one without a receipt needs one read; a new one needs its send and one receipt read, one estimate
 * when it calls Purser's own contract (or is sent again after a revert), and one nonce read for the first new
 * transaction of each sender. `fund` reads
 * the four balances every time, and the donor's balance once when it has to send; counted here as if every role
 * without a finished transfer needs one, so for `fund` this is the most it needs.
 */
export function callsNeeded(step: TxStep | "verify", statusOf: (key: string) => TxStatus, o: { estimate: boolean } = { estimate: true }): number {
  if (step === "verify") return 1;
  let n = step === "fund" ? ROLES.length : 0;
  const nonceRead = new Set<string>();
  let fresh = 0;
  for (const tx of STEP_TXS[step]) {
    const s = statusOf(tx.key);
    if (s === "success") continue;
    if (s === "signed") { n += 1; continue; }
    fresh++;
    // A transaction sent again after a revert asks the node's estimate first, whatever its kind.
    n += 2 + ((tx.estimate && o.estimate) || s === "reverted" ? 1 : 0);
    if (!nonceRead.has(tx.sender)) { nonceRead.add(tx.sender); n += 1; }
  }
  if (step === "fund" && fresh > 0) n += 1;
  return n;
}

/** preflight's own reads at most: the chain id, the four role balances and one spare (the donor's balance). */
export const PREFLIGHT_MAX_CALLS = 6;

// ---- What each role's key must hold --------------------------------------------------------------------------------

export interface RoleNeed {
  /** The least the role must hold now for what it still has to do. */
  enough: bigint;
  /** What `fund` brings it to when it holds less than `enough`. */
  target: bigint;
}

/**
 * From the face value, the price and the gas allowance: the financier still owes the price until its accept landed,
 * the payer the face value until its settlement landed; each role needs gas while it has transactions to send.
 */
export function roleNeeds(plan: { faceValue: bigint; price: bigint }, statusOf: (key: string) => TxStatus): Record<Role, RoleNeed> {
  const open = (key: string) => statusOf(key) !== "success";
  const need = (owes: bigint, sending: boolean): RoleNeed => ({ enough: owes + (sending ? GAS_ENOUGH : 0n), target: owes + (sending ? GAS_ALLOWANCE : 0n) });
  return {
    issuer: need(0n, open("deploy") || open("mint")),
    creditor: need(0n, open("offer")),
    financier: need(open("accept") ? plan.price : 0n, open("financier-approve") || open("accept")),
    payer: need(open("settle") ? plan.faceValue : 0n, open("payer-approve") || open("settle")),
  };
}
