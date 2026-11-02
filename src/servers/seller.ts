// Northwind Outdoor's query route. Other companies' agents pay per stock check with x402, under their own
// mandate, and must sign the order (requireSignedOffer). The handler buys the upstream stock check first,
// through the sourcing agent's mandate. If that purchase is refused, the handler answers 503, so the
// middleware never settles and the customer is not charged. A sale is recorded only on the settle
// answer that claimed the payment first, with its signed order, tx and the exact body delivered.
//
// Beside it, the prepaid route takes Metal's Offer Pay-per-Call Clearing (scheme `bajillion`): the buyer pays from a
// clearing deposit with a signed receipt, no transaction per query. A clearing payment is counted when the buyer makes
// it, before this handler runs, so a refused upstream purchase would leave the buyer charged. The prepaid route
// therefore offers itself only when the supplier's current price is within the sourcing agent's limits (a free look
// at the supplier's offer); otherwise it answers 503 and the buyer uses the mandate route, where nothing moves unless
// the stock check is delivered.

import express from "express";
import type { HTTPTransportContext } from "@x402/core/http";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { paymentMiddleware } from "@x402/express";
import { decodePaymentSignatureHeader } from "@x402/core/http";
import { ClearingServerScheme, clearingPaymentId, clearingPaymentOf, registerMetalScheme } from "@metalntwx/metal-pay";
import { SIGNED_OFFER_REQUIRED, mandateRefOf, requireSignedOffer, signedOfferOf } from "@metalntwx/metal-pay/mandates";
import type { Address } from "viem";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { sha256Hex } from "../lib/terms.js";
import { FACILITATOR_URL, rpcUrl } from "../metal/network.js";
import { toCents } from "../lib/money.js";
import { nothingSettled } from "../metal/pay.js";
import { keyOf, settlementDone, settlementFailed, settlementRepeated, settlementStarted, type Authorization } from "../seller/settling.js";

export const SELLER_ROUTE = "/v1/stock";
export const SELLER_RESOURCE = `GET ${SELLER_ROUTE}`;
export const PREPAID_ROUTE = "/v1/stock/prepaid";
export const PREPAID_RESOURCE = `GET ${PREPAID_ROUTE}`;
const UPSTREAM_HEADER = "x-upstream-purchase";

export type UpstreamResult =
  | { ok: true; purchaseId: number; body: unknown }
  | { ok: false; purchaseId: number; reason: string; inDoubt: boolean };

export interface SellerOptions {
  db: DB;
  payTo: Address;
  price: () => string;
  /** Buys the stock check from the supplier under the sourcing mandate. */
  buyUpstream: (seq: number) => Promise<UpstreamResult>;
  /** The prepaid route (clearing): our clearing key, and the free check that the supplier's price is within limits. */
  clearing?: { payTo: `0x${string}`; preflight: (seq: number) => Promise<string | null> };
}

/** A clearing sale as the settle step saw it; the handler records it with the body it delivers. */
interface ClearingSettled {
  payer: string;
  amountUnits: string;
  requirements: string;
  receipt: unknown;
}

export function sellerApp(opts: SellerOptions) {
  const { db } = opts;
  const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
  const server = requireSignedOffer(registerMetalScheme(new x402ResourceServer(facilitator), { networks: ["testnet"] }), { rpcUrl: rpcUrl() });
  if (opts.clearing) server.register("eip155:63825", new ClearingServerScheme("eip155:63825"));
  const clearingSettled = new Map<string, ClearingSettled>();
  const authorizationOf = (paymentPayload: { payload: unknown }) => (paymentPayload.payload as { authorization?: Authorization }).authorization;

  // A mandate payment is written down before Metal's facilitator settles it, so between its block and the sale's row
  // the dashboard shows it as pending, never a spend that differs from the chain without a reason (src/seller/settling.ts).
  // If it cannot be written, the settle does not start: the customer is not charged.
  server.onBeforeSettle(async ({ paymentPayload, transportContext }) => {
    if (clearingPaymentOf(paymentPayload)) return;
    const auth = authorizationOf(paymentPayload);
    try {
      settlementStarted(db, auth, floorCentsOfUnits(auth?.value));
    } catch (e) {
      // An abort here skips the server's settle-failure hooks, so the write-off is recorded the same way they would.
      const upstream = upstreamOf(transportContext);
      try {
        audit(db, "system", "sale.settle_failed", upstream, { error: `the payment could not be written down before its settle, so it was not settled and the customer was not charged: ${(e as Error).message.slice(0, 200)}` });
      } catch { /* the ledger is unavailable: the refusal below still stands */ }
      return { abort: true, reason: "ledger_unavailable", message: "the seller could not record the payment before settling it; nothing was charged" };
    }
  });

  server.onAfterSettle(async ({ paymentPayload, requirements, result, transportContext }) => {
    const paid = clearingPaymentOf(paymentPayload);
    if (paid) {
      // Settled before the handler runs: keep what the handler needs to record the sale with its body.
      if (result.success) {
        clearingSettled.set(clearingPaymentId(paid), {
          payer: result.payer ?? "", amountUnits: requirements.amount, requirements: JSON.stringify(requirements),
          receipt: (result.extra as { clearing?: unknown } | undefined)?.clearing ?? null,
        });
      }
      return;
    }
    const settlement = (result.extra as { settlement?: { id: string; first: boolean } } | undefined)?.settlement;
    const auth = authorizationOf(paymentPayload);
    const key = keyOf(auth);
    // Called on a successful settle only (a failed one goes to onSettleFailure below).
    if (!settlement?.first) {
      settlementRepeated(db, key);
      return;
    }
    const ctx = transportContext as HTTPTransportContext | undefined;
    const bodyText = ctx?.responseBody?.toString("utf8") ?? "";
    const url = ctx?.request.adapter.getUrl() ?? "";
    const upstream = upstreamOf(ctx);
    const saleId = db.transaction((): number | null => {
      const info = db.prepare(
        `INSERT OR IGNORE INTO sales (route, price_cents, payer, customer_mandate_ref, signed_offer, settlement_id, tx_hash, request_url,
           request_params_json, body_sha256, body_json, upstream_purchase_id, requirements_json, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DELIVERED', ?)`,
      ).run(
        SELLER_RESOURCE, centsOfUnits(auth?.value), auth?.from ?? result.payer ?? "", mandateRefOf(paymentPayload), signedOfferOf(paymentPayload),
        settlement.id, result.transaction, url, JSON.stringify(Object.fromEntries(new URL(url || "http://x/").searchParams)),
        sha256Hex(bodyText), bodyText, upstream === null ? null : Number(upstream), JSON.stringify(requirements), new Date().toISOString(),
      );
      if (info.changes !== 1) return null;
      audit(db, "system", "sale.delivered", String(info.lastInsertRowid), { origin: { actor: "external", party: "customer" }, settlement_id: settlement.id, tx: result.transaction, body_sha256: sha256Hex(bodyText) });
      return Number(info.lastInsertRowid);
    }).immediate();
    // After the sale's own transaction, so closing the pending line can never undo a sale the customer paid for and got.
    // From the sale's row on, the ledger counts the payment once even if this write fails (available.ts reads a
    // settlement with a recorded sale as that sale), and the reconciliation closes the row later.
    try {
      if (saleId === null) settlementRepeated(db, key);
      else settlementDone(db, key, saleId, result.transaction);
    } catch (e) {
      try {
        audit(db, "system", "sale.settlement_left_open", saleId === null ? null : String(saleId), { error: (e as Error).message.slice(0, 200), note: "the sale is recorded; the reconciliation closes its settlement row" });
      } catch { /* the ledger is unavailable: the sale's row stands */ }
    }
  });

  server.onSettleFailure(async ({ error, paymentPayload, transportContext }) => {
    if (!clearingPaymentOf(paymentPayload)) {
      const reason = (error as { errorReason?: string }).errorReason;
      settlementFailed(db, keyOf(authorizationOf(paymentPayload)), reason ?? error.message, nothingSettled(reason));
    }
    // The supplier was already paid; the customer was not charged. The upstream cost is written off.
    audit(db, "system", "sale.settle_failed", upstreamOf(transportContext), { error: error.message });
  });

  const app = express();
  // The prepaid route offers clearing only when it can deliver: before the 402, a free look at the supplier's price.
  if (opts.clearing) {
    const clearing = opts.clearing;
    app.get(PREPAID_ROUTE, async (req, res, next) => {
      if (req.headers["payment-signature"]) return next();
      const seq = Number(req.query.seq);
      if (!Number.isSafeInteger(seq) || seq < 1) {
        res.status(400).json({ error: "seq must be a positive integer" });
        return;
      }
      const refusal = await clearing.preflight(seq).catch((e: Error) => `the supplier's price could not be checked (${e.message.slice(0, 120)})`);
      if (refusal) {
        audit(db, "system", "sale.prepaid_not_offered", String(seq), { seq, reason: refusal });
        res.status(503).json({ error: "prepaid clearing is not offered for this stock check now; buy it on the mandate route", reason: refusal, route: SELLER_ROUTE });
        return;
      }
      next();
    });
  }
  app.use(
    paymentMiddleware(
      {
        [SELLER_RESOURCE]: {
          accepts: {
            scheme: "exact", network: "eip155:63825", payTo: opts.payTo, price: () => opts.price(),
            extra: { ...SIGNED_OFFER_REQUIRED, resource: SELLER_RESOURCE },
          },
          description: "Northwind Outdoor live stock check (units on hand, reserved), one per paid request",
        },
        ...(opts.clearing ? {
          [PREPAID_RESOURCE]: {
            accepts: { scheme: "bajillion", network: "eip155:63825", payTo: opts.clearing.payTo, price: () => opts.price() },
            description: "Northwind Outdoor live stock check, paid from a Metal clearing deposit",
          },
        } : {}),
      },
      server,
    ),
  );
  app.get(SELLER_ROUTE, async (req, res) => {
    const seq = Number(req.query.seq);
    if (!Number.isSafeInteger(seq) || seq < 1) {
      res.status(400).json({ error: "seq must be a positive integer" });
      return;
    }
    const up = await opts.buyUpstream(seq);
    res.setHeader(UPSTREAM_HEADER, String(up.purchaseId));
    if (!up.ok) {
      // Any status of 400 or above cancels the customer's payment: nothing moves. The ledger keeps what the customer got
      // for this query: the status, and that the middleware does not settle (Kit 11: "answer the customer with an error
      // status: the middleware then doesn't settle"). The world's serve loop adds the customer's side (query.answered).
      audit(db, "system", "sale.refused", String(seq), { seq, status: 503, settled: false, upstream_purchase_id: up.purchaseId, reason: up.reason.slice(0, 300) });
      res.status(503).json({ error: "upstream purchase refused", reason: up.reason });
      return;
    }
    const { stock } = up.body as { stock: unknown };
    res.json({ seller: "Northwind Outdoor", seq, stock });
  });
  if (opts.clearing) {
    app.get(PREPAID_ROUTE, async (req, res) => {
      const seq = Number(req.query.seq);
      const header = String(req.headers["payment-signature"] ?? "");
      let paid: ReturnType<typeof clearingPaymentOf> = null;
      try {
        paid = clearingPaymentOf(decodePaymentSignatureHeader(header));
      } catch {
        paid = null;
      }
      const id = paid ? clearingPaymentId(paid) : "";
      const settled = clearingSettled.get(id);
      clearingSettled.delete(id);
      const up = await opts.buyUpstream(seq);
      res.setHeader(UPSTREAM_HEADER, String(up.purchaseId));
      if (!up.ok) {
        // The buyer has paid already (clearing counts at payment): this sale is owed, and support refunds it.
        audit(db, "system", "sale.prepaid_undelivered", String(seq), { seq, clearing_id: id, payer: settled?.payer ?? null, reason: up.reason });
        res.status(503).json({ error: "upstream purchase refused after payment; the payment will be refunded", reason: up.reason });
        return;
      }
      const { stock } = up.body as { stock: unknown };
      const bodyText = JSON.stringify({ seller: "Northwind Outdoor", seq, stock });
      const url = `${req.protocol}://${req.get("host") ?? ""}${req.originalUrl}`;
      db.transaction(() => {
        const info = db.prepare(
          `INSERT OR IGNORE INTO sales (route, price_cents, payer, customer_mandate_ref, signed_offer, settlement_id, tx_hash, request_url,
             request_params_json, body_sha256, body_json, upstream_purchase_id, requirements_json, status, created_at, scheme, clearing_json)
           VALUES (?, ?, ?, NULL, NULL, ?, NULL, ?, ?, ?, ?, ?, ?, 'DELIVERED', ?, 'bajillion', ?)`,
        ).run(
          PREPAID_RESOURCE, centsOfUnits(settled?.amountUnits), settled?.payer ?? "", id || null, url, JSON.stringify({ seq: String(seq) }),
          sha256Hex(bodyText), bodyText, up.purchaseId, settled?.requirements ?? null, new Date().toISOString(),
          // The buyer's signed payment (from its header) and the service's receipt, so verify can check it again.
          JSON.stringify({ paid, settled: settled?.receipt ?? null }),
        );
        if (info.changes === 1) audit(db, "system", "sale.delivered", String(info.lastInsertRowid), { origin: { actor: "external", party: "customer" }, settlement_id: id, scheme: "bajillion", body_sha256: sha256Hex(bodyText) });
      }).immediate();
      res.type("application/json").send(bodyText);
    });
  }
  return app;
}

/** The upstream purchase a response names, as the audit row's subject. */
function upstreamOf(transportContext: unknown): string | null {
  const n = Number((transportContext as HTTPTransportContext | undefined)?.responseHeaders?.[UPSTREAM_HEADER] ?? NaN);
  return Number.isFinite(n) ? String(n) : null;
}

/** Whole cents of a payment for the pending line; a sub-cent amount is refused later, when the sale is recorded. */
function floorCentsOfUnits(units: string | undefined): number {
  try {
    return units ? Number(BigInt(units) / 10n ** 16n) : 0;
  } catch {
    return 0;
  }
}

function centsOfUnits(units: string | undefined): number {
  if (!units) return 0;
  const n = BigInt(units);
  if (n % 10n ** 16n !== 0n) throw new Error(`sub-cent sale: ${units}`);
  return Number(n / 10n ** 16n);
}

export const priceToCents = (price: string) => toCents(price.replace(/^\$/, ""));
