// Stockline, the simulated warehouse API: sells one live stock check per x402 payment.
// Its price is whatever its next 402 offer says; the demo raises it from 0.02 to 0.04.

import express from "express";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { paymentMiddleware } from "@x402/express";
import { registerMetalScheme } from "@metalntwx/metal-pay";
import type { Address } from "viem";
import { servedCheck } from "../data/stock.js";
import { FACILITATOR_URL } from "../metal/network.js";

export const SUPPLIER_ROUTE = "/v1/stock-check";

export const SUPPLIER_INFO_ROUTE = "/v1/info";

/**
 * A supplier's x402 seller. `name`, `dataAgeSeconds` and `unavailableEvery` default to Stockline's; with the autonomous
 * agents on, Ridgeline Data runs the same app with its own (src/config/suppliers.ts). An unavailable stock check is
 * refused before any offer, so it never costs the buyer anything. GET /v1/info is free: price, data age, uptime.
 * `down`: while it gives a reason (a supplier offline for maintenance, src/world/supplierEvents.ts), every route,
 * /v1/info too, answers 503 with that reason before any offer.
 */
export function supplierApp(opts: { payTo: Address; price: () => string; name?: string; dataAgeSeconds?: number; unavailableEvery?: number; down?: () => string | null }) {
  const name = opts.name ?? "Stockline";
  const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
  const server = registerMetalScheme(new x402ResourceServer(facilitator), { networks: ["testnet"] });
  const app = express();
  const every = opts.unavailableEvery ?? 0;
  app.use((_req, res, next) => {
    const why = opts.down?.();
    if (why) {
      res.status(503).json({ error: why });
      return;
    }
    next();
  });
  app.get(SUPPLIER_INFO_ROUTE, (_req, res) => {
    res.json({ supplier: name, price: opts.price(), data_age_seconds: opts.dataAgeSeconds ?? 5, unavailable_every: every });
  });
  app.use(SUPPLIER_ROUTE, (req, res, next) => {
    const seq = Number(req.query.seq);
    if (every > 0 && Number.isSafeInteger(seq) && seq % every === 0 && !req.headers["payment-signature"] && !req.headers["x-payment"]) {
      res.status(503).json({ error: `${name} is unavailable for this stock check; nothing was offered` });
      return;
    }
    next();
  });
  app.use(
    paymentMiddleware(
      {
        [`GET ${SUPPLIER_ROUTE}`]: {
          accepts: { scheme: "exact", network: "eip155:63825", payTo: opts.payTo, price: () => opts.price() },
          description: `${name} live stock check, one product at one warehouse`,
        },
      },
      server,
    ),
  );
  app.get(SUPPLIER_ROUTE, (req, res) => {
    const seq = Number(req.query.seq);
    try {
      const stock = servedCheck(seq, false);
      const age = opts.dataAgeSeconds ?? 0;
      res.json({ supplier: name, stock: age > 60 ? { ...stock, ts: new Date(Date.parse(stock.ts) - age * 1000).toISOString() } : stock, data_age_seconds: opts.dataAgeSeconds ?? 5 });
    } catch {
      res.status(400).json({ error: "bad seq" });
    }
  });
  return app;
}
