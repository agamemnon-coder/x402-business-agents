// The live sources for the hourly reconciliation: Airwallex (transfers, card transactions) when its sandbox keys are
// set, and Metal's chain when METAL_RPC_URL is. Each is read-only.

import { erc20Abi, parseAbi, parseEventLogs, type Hash } from "viem";
import { AirwallexRest } from "../airwallex/adapter.js";
import { ftBySourceVia } from "./awxFinancialTx.js";
import { listDeposits } from "../airwallex/deposits.js";
import { Airwallex, fromEnv } from "../airwallex/client.js";
import { issuingFromEnv } from "../airwallex/issuing.js";
import { centsToBaseUnits, fromCents } from "../lib/money.js";
import { publicClient } from "../metal/chain.js";
import { findSettlementByNonce } from "../metal/pay.js";
import { USDZ } from "../metal/network.js";
import type { ReconcileSources } from "./reconcile.js";
import type { DB } from "../db/open.js";

/** Null if the receipt succeeded and carries exactly this *USDZ transfer, otherwise what is wrong. */
export async function receiptCarries(tx: string, from: string, to: string, cents: number): Promise<string | null> {
  const receipt = await publicClient().getTransactionReceipt({ hash: tx as Hash }).catch(() => null);
  if (!receipt) return "no such transaction on chain";
  if (receipt.status !== "success") return "the transaction failed on chain";
  const hit = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs }).some((l) =>
    l.address.toLowerCase() === USDZ.toLowerCase() && l.args.from.toLowerCase() === from.toLowerCase() && l.args.to.toLowerCase() === to.toLowerCase() && l.args.value === centsToBaseUnits(cents));
  return hit ? null : `no *USDZ transfer of ${fromCents(cents)} from ${from.slice(0, 8)}… to ${to.slice(0, 8)}… in the receipt`;
}

const ERC3009 = parseAbi(["function authorizationState(address authorizer, bytes32 nonce) view returns (bool)"]);

/** Whether the payer's ERC-3009 nonce has been used on the *USDZ token (a read; nothing is sent). */
export function authorizationUsed(payer: string, nonce: string): Promise<boolean> {
  return publicClient().readContract({ address: USDZ, abi: ERC3009, functionName: "authorizationState", args: [payer as `0x${string}`, nonce as `0x${string}`] });
}

export function reconcileSourcesFromEnv(db?: DB): ReconcileSources {
  const cfg = fromEnv();
  const api = cfg ? new Airwallex(cfg) : null;
  const rest = api ? new AirwallexRest(api) : null;
  const issuing = issuingFromEnv(db);
  return {
    ...(rest ? { transfer: async (id: string) => { const t = await rest.getTransfer(id); return { status: t.status, amountCents: t.amountCents, currency: t.currency }; } } : {}),
    ...(rest ? { transferByRequestId: async (requestId: string) => { const t = await rest.findTransferByRequestIdStrict(requestId); return t && { id: t.id, status: t.status, amountCents: t.amountCents, currency: t.currency }; } } : {}),
    ...(api ? { financialTransactions: ftBySourceVia(api), deposits: (w: { from: string; to: string }) => listDeposits(api, w) } : {}),
    ...(issuing ? { cardTransactions: (cardId: string) => issuing.rail.listCardTransactions(cardId) } : {}),
    ...(process.env.METAL_RPC_URL ? { chainTransfer: receiptCarries } : {}),
    // A live world (Metal configured): the facilitator's public list of what settled to Northwind.
    ...(process.env.METAL_RPC_URL ? { settlementByNonce: (payTo: string, nonce: string, sinceMs: number) => findSettlementByNonce(payTo as `0x${string}`, nonce, sinceMs), authorizationUsed } : {}),
  };
}
