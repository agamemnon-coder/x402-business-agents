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

export function supplierApp(opts: { payTo: Address; price: () => string }) {
  const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
  const server = registerMetalScheme(new x402ResourceServer(facilitator), { networks: ["testnet"] });
  const app = express();
  app.use(
    paymentMiddleware(
      {
        [`GET ${SUPPLIER_ROUTE}`]: {
          accepts: { scheme: "exact", network: "eip155:63825", payTo: opts.payTo, price: () => opts.price() },
          description: "Stockline live stock check, one product at one warehouse",
        },
      },
      server,
    ),
  );
  app.get(SUPPLIER_ROUTE, (req, res) => {
    const seq = Number(req.query.seq);
    try {
      res.json({ supplier: "Stockline", stock: servedCheck(seq, false) });
    } catch {
      res.status(400).json({ error: "bad seq" });
    }
  });
  return app;
}
