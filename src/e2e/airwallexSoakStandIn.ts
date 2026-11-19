// The Airwallex soak's stand-in (`npm run airwallex:soak -- stand-in`, test/airwallex-soak.test.ts): the in-memory
// Airwallex (src/redteam/airwallex.ts) with both payees on file, each rail method counted as the live adapter sends it
// (src/airwallex/adapter.ts: one HTTP request each), and the reads the soak makes, answered in Airwallex's field names.

import type { CallLine } from "../airwallex/callBudget.js";
import { LICENSOR, MANUFACTURER } from "../config/payees.js";
import { FakeAirwallex } from "../redteam/airwallex.js";
import type { Rail } from "./airwallexSoak.js";

const ENDPOINT: Record<string, [string, string]> = {
  balances: ["GET", "/balances/current"], createTransfer: ["POST", "/transfers/create"], getTransfer: ["GET", "/transfers/{id}"], findTransferByRequestId: ["GET", "/transfers"],
  findTransferByRequestIdStrict: ["GET", "/transfers"], transitionTransfer: ["POST", "/simulation/transfers/{id}/transition"], currentRate: ["GET", "/fx/rates/current"],
  createQuote: ["POST", "/fx/quotes/create"], createConversion: ["POST", "/fx/conversions/create"], findConversionByRequestId: ["GET", "/fx/conversions"], findBeneficiaryByIban: ["GET", "/beneficiaries"],
};

export async function soakStandIn() {
  const awx = new FakeAirwallex();
  awx.bal.EUR.availableCents = 6_000_000;
  awx.bal.USD.availableCents = 4_000_000;
  for (const p of [MANUFACTURER, LICENSOR]) await awx.createBeneficiary(p);
  const calls: CallLine[] = [];
  const note = (method: string, endpoint: string) => calls.push({ at: new Date().toISOString(), method, endpoint, pid: process.pid });
  const rail = new Proxy(awx, {
    get(t, p, r) {
      const v = Reflect.get(t, p, r) as unknown;
      if (typeof v !== "function" || typeof p !== "string" || !ENDPOINT[p]) return v;
      return (...a: unknown[]) => { note(...ENDPOINT[p]!); return (v as (...x: unknown[]) => unknown).apply(t, a); };
    },
  }) as unknown as Rail;
  const asAwx = (t: (typeof awx.transfers)[number]) => ({
    id: t.id, request_id: t.requestId, status: t.status, transfer_amount: t.amountCents / 100, transfer_currency: t.currency, beneficiary_id: t.beneficiaryId, reference: t.reference,
    metadata: { approval_sha256: t.metadata }, fee_amount: t.fee ? t.fee.cents / 100 : null, fee_currency: t.fee?.currency ?? null,
  });
  const get = async (path: string, q?: Record<string, string>): Promise<unknown> => {
    note("GET", path.replace(/\/transfers\/[^/]+$/, "/transfers/{id}"));
    if (path.startsWith("/transfers/")) return asAwx(awx.transfers.find((x) => x.id === decodeURIComponent(path.slice("/transfers/".length)))!);
    if (path === "/transfers") return { items: awx.transfers.filter((x) => x.requestId === q?.request_id).map(asAwx) };
    if (path === "/fx/conversions") {
      return { items: awx.conversions.filter((c) => c.requestId === q?.request_id).map((c) => ({ conversion_id: c.conversionId, request_id: c.requestId, quote_id: c.quoteId, status: c.status, buy_amount: c.buyAmountCents / 100, sell_amount: c.sellAmountCents / 100, metadata: { approval_sha256: awx.conversionMetadata.get(c.conversionId) } })) };
    }
    throw new Error(`stand-in: no read for ${path}`);
  };
  return { awx, rail, get, calls: () => calls };
}
