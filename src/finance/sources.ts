// The live sources for the daily reconciliation: Airwallex (transfers, card transactions) when its sandbox keys are
// set, and Metal's chain when METAL_RPC_URL is. Each is read-only.

import { erc20Abi, parseEventLogs, type Hash } from "viem";
import { AirwallexRest } from "../airwallex/adapter.js";
import { Airwallex, fromEnv } from "../airwallex/client.js";
import { issuingFromEnv } from "../airwallex/issuing.js";
import { centsToBaseUnits, fromCents } from "../lib/money.js";
import { publicClient } from "../metal/chain.js";
import { USDZ } from "../metal/network.js";
import type { ReconcileSources } from "./reconcile.js";

/** Null if the receipt succeeded and carries exactly this *USDZ transfer, otherwise what is wrong. */
export async function receiptCarries(tx: string, from: string, to: string, cents: number): Promise<string | null> {
  const receipt = await publicClient().getTransactionReceipt({ hash: tx as Hash }).catch(() => null);
  if (!receipt) return "no such transaction on chain";
  if (receipt.status !== "success") return "the transaction failed on chain";
  const hit = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs }).some((l) =>
    l.address.toLowerCase() === USDZ.toLowerCase() && l.args.from.toLowerCase() === from.toLowerCase() && l.args.to.toLowerCase() === to.toLowerCase() && l.args.value === centsToBaseUnits(cents));
  return hit ? null : `no *USDZ transfer of ${fromCents(cents)} from ${from.slice(0, 8)}… to ${to.slice(0, 8)}… in the receipt`;
}

export function reconcileSourcesFromEnv(): ReconcileSources {
  const cfg = fromEnv();
  const rest = cfg ? new AirwallexRest(new Airwallex(cfg)) : null;
  const issuing = issuingFromEnv();
  return {
    ...(rest ? { transfer: async (id: string) => { const t = await rest.getTransfer(id); return { status: t.status, amountCents: t.amountCents, currency: t.currency }; } } : {}),
    ...(issuing ? { cardTransactions: (cardId: string) => issuing.rail.listCardTransactions(cardId) } : {}),
    ...(process.env.METAL_RPC_URL ? { chainTransfer: receiptCarries } : {}),
  };
}
