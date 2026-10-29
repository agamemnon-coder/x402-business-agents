// Tidemark Data's query route. Other companies' agents pay per tick with x402, under their own
// mandate, and must sign the order (requireSignedOffer). The handler buys the upstream tick first,
// through the sourcing agent's mandate. If that purchase is refused, the handler answers 503, so the
// middleware never settles and the customer is not charged. A sale is recorded only on the settle
// answer that claimed the payment first, with its signed order, tx and the exact body delivered.

import express from "express";
import type { HTTPTransportContext } from "@x402/core/http";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { paymentMiddleware } from "@x402/express";
import { registerMetalScheme } from "@metalntwx/metal-pay";
import { SIGNED_OFFER_REQUIRED, mandateRefOf, requireSignedOffer, signedOfferOf } from "@metalntwx/metal-pay/mandates";
import type { Address } from "viem";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { sha256Hex } from "../lib/terms.js";
import { FACILITATOR_URL, rpcUrl } from "../metal/network.js";
import { toCents } from "../lib/money.js";

export const SELLER_ROUTE = "/v1/fx-tick";
export const SELLER_RESOURCE = `GET ${SELLER_ROUTE}`;
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
}

export function sellerApp(opts: SellerOptions) {
  const { db } = opts;
  const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
  const server = requireSignedOffer(registerMetalScheme(new x402ResourceServer(facilitator), { networks: ["testnet"] }), { rpcUrl: rpcUrl() });

  server.onAfterSettle(async ({ paymentPayload, requirements, result, transportContext }) => {
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
  return app;
}

function centsOfUnits(units: string | undefined): number {
  if (!units) return 0;
  const n = BigInt(units);
  if (n % 10n ** 16n !== 0n) throw new Error(`sub-cent sale: ${units}`);
  return Number(n / 10n ** 16n);
}

export const priceToCents = (price: string) => toCents(price.replace(/^\$/, ""));
