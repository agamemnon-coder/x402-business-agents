// The three steps of an invoice token, each a short list of transactions, plus the stand-in setup. Used by
// `npm run tokenize` (stand-in on the in-memory chain, or live on Metal testnet one step at a time) and the tests.

import type { Address, Hex, LocalAccount } from "viem";
import { centsToBaseUnits } from "../lib/money.js";
import { invoiceTokenCalls, tokenIdOf, type OnChainInvoice } from "./client.js";

export type Calls = ReturnType<typeof invoiceTokenCalls>;
export interface Step { step: string; hash: Hex; from: Address }
export type OnStep = (s: Step) => void;

const done = (onStep: OnStep, s: { label: string; hash: Hex; from: Address }) => { const step = { step: s.label, hash: s.hash, from: s.from }; onStep(step); return step; };

/** Purser's issuer mints the token to the creditor. The ledger checks (approvedInvoice, mintRecord) come first. */
export async function mintToken(calls: Calls, issuer: LocalAccount, contract: Address, creditor: Address, record: OnChainInvoice, onStep: OnStep = () => {}) {
  const s = await calls.mint(issuer, contract, creditor, record);
  return { tokenId: tokenIdOf(record.documentHash), steps: [done(onStep, s)] };
}

/** The creditor offers the token at `price`; the (simulated) financier approves the price and accepts in one go. */
export async function financeToken(calls: Calls, a: { creditor: LocalAccount; financier: LocalAccount }, contract: Address, settlementToken: Address, tokenId: bigint, price: bigint, onStep: OnStep = () => {}) {
  const steps: Step[] = [];
  steps.push(done(onStep, await calls.offer(a.creditor, contract, tokenId, a.financier.address, price)));
  steps.push(done(onStep, await calls.approve(a.financier, settlementToken, contract, price, "the financier allows the token contract to take the price")));
  steps.push(done(onStep, await calls.accept(a.financier, contract, tokenId, price)));
  return steps;
}

/** The debtor's paying wallet allows the face value and settles: paid to the holder, token burned. */
export async function settleToken(calls: Calls, payer: LocalAccount, contract: Address, settlementToken: Address, tokenId: bigint, faceValue: bigint, onStep: OnStep = () => {}) {
  const steps: Step[] = [];
  steps.push(done(onStep, await calls.approve(payer, settlementToken, contract, faceValue, "the debtor allows the token contract to take the face value")));
  steps.push(done(onStep, await calls.settle(payer, contract, tokenId)));
  return steps;
}

/** Discount price: face value minus `discountBps` basis points, rounded down to a whole cent of *USDZ. */
export function discountedPrice(faceValue: bigint, discountBps: number): bigint {
  if (!Number.isInteger(discountBps) || discountBps <= 0 || discountBps >= 10_000) throw new Error("the discount is 1 to 9999 basis points");
  const raw = (faceValue * BigInt(10_000 - discountBps)) / 10_000n;
  const cent = centsToBaseUnits(1);
  return raw - (raw % cent);
}
