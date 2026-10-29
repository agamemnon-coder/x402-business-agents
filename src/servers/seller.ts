// Tidemark Data's query route. Other companies' agents pay per tick with x402, under their own
// mandate, and must sign the order (requireSignedOffer). The handler buys the upstream tick first,
// through the sourcing agent's mandate. If that purchase is refused, the handler answers 503, so the
// middleware never settles and the customer is not charged. A sale is recorded only on the settle
// answer that claimed the payment first, with its signed order, tx and the exact body delivered.
//
// Beside it, the prepaid route takes Metal's Offer Pay-per-Call Clearing (scheme `bajillion`): the buyer pays from a
// clearing deposit with a signed receipt, no transaction per query. A clearing payment is counted when the buyer makes
// it, before this handler runs, so a refused upstream purchase would leave the buyer charged. The prepaid route
// therefore offers itself only when the supplier's current price is within the sourcing agent's limits (a free look
// at the supplier's offer); otherwise it answers 503 and the buyer uses the mandate route, where nothing moves unless
// the tick is delivered.

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

export const SELLER_ROUTE = "/v1/fx-tick";
export const SELLER_RESOURCE = `GET ${SELLER_ROUTE}`;
export const PREPAID_ROUTE = "/v1/fx-tick/prepaid";
export const PREPAID_RESOURCE = `GET ${PREPAID_ROUTE}`;
const UPSTREAM_HEADER = "x-upstream-purchase";

export type UpstreamResult =
  | { ok: true; purchaseId: number; body: unknown }
  | { ok: false; purchaseId: number; reason: string; inDoubt: boolean };

export interface SellerOptions {
  db: DB;
  payTo: Address;
  price: () => string;
  /** Buys the raw tick from the supplier under the sourcing mandate. */
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
    if (!result.success || !settlement?.first) return;
    const ctx = transportContext as HTTPTransportContext | undefined;
    const bodyText = ctx?.responseBody?.toString("utf8") ?? "";
    const url = ctx?.request.adapter.getUrl() ?? "";
    const upstream = Number(ctx?.responseHeaders?.[UPSTREAM_HEADER] ?? NaN);
    const auth = (paymentPayload.payload as { authorization?: { from?: string; value?: string } }).authorization;
    db.transaction(() => {
      const info = db.prepare(
        `INSERT OR IGNORE INTO sales (route, price_cents, payer, customer_mandate_ref, signed_offer, settlement_id, tx_hash, request_url,
           request_params_json, body_sha256, body_json, upstream_purchase_id, requirements_json, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DELIVERED', ?)`,
      ).run(
        SELLER_RESOURCE, centsOfUnits(auth?.value), auth?.from ?? result.payer ?? "", mandateRefOf(paymentPayload), signedOfferOf(paymentPayload),
        settlement.id, result.transaction, url, JSON.stringify(Object.fromEntries(new URL(url || "http://x/").searchParams)),
        sha256Hex(bodyText), bodyText, Number.isFinite(upstream) ? upstream : null, JSON.stringify(requirements), new Date().toISOString(),
      );
      if (info.changes === 1) {
        audit(db, "system", "sale.delivered", String(info.lastInsertRowid), { settlement_id: settlement.id, tx: result.transaction, body_sha256: sha256Hex(bodyText) });
      }
    }).immediate();
  });

  server.onSettleFailure(async ({ error, transportContext }) => {
    const ctx = transportContext as HTTPTransportContext | undefined;
    const upstream = Number(ctx?.responseHeaders?.[UPSTREAM_HEADER] ?? NaN);
    // The supplier was already paid; the customer was not charged. The upstream cost is written off.
    audit(db, "system", "sale.settle_failed", Number.isFinite(upstream) ? String(upstream) : null, { error: error.message });
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
        res.status(503).json({ error: "prepaid clearing is not offered for this tick now; buy it on the mandate route", reason: refusal, route: SELLER_ROUTE });
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
          description: "Tidemark Data EUR/USD tick, one per paid request",
        },
        ...(opts.clearing ? {
          [PREPAID_RESOURCE]: {
            accepts: { scheme: "bajillion", network: "eip155:63825", payTo: opts.clearing.payTo, price: () => opts.price() },
            description: "Tidemark Data EUR/USD tick, paid from a Metal clearing deposit",
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
      // Any status of 400 or above cancels the customer's payment: nothing moves.
      res.status(503).json({ error: "upstream purchase refused", reason: up.reason });
      return;
    }
    const { tick } = up.body as { tick: unknown };
    res.json({ seller: "Tidemark Data", seq, tick });
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
      const { tick } = up.body as { tick: unknown };
      const bodyText = JSON.stringify({ seller: "Tidemark Data", seq, tick });
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
        if (info.changes === 1) audit(db, "system", "sale.delivered", String(info.lastInsertRowid), { settlement_id: id, scheme: "bajillion", body_sha256: sha256Hex(bodyText) });
      }).immediate();
      res.type("application/json").send(bodyText);
    });
  }
  return app;
}

function centsOfUnits(units: string | undefined): number {
  if (!units) return 0;
  const n = BigInt(units);
  if (n % 10n ** 16n !== 0n) throw new Error(`sub-cent sale: ${units}`);
  return Number(n / 10n ** 16n);
}

export const priceToCents = (price: string) => toCents(price.replace(/^\$/, ""));
