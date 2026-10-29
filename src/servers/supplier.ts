// Feedstock Labs, the simulated upstream provider: sells one raw tick per x402 payment.
// Its price is whatever its next 402 offer says; the demo raises it from 0.02 to 0.04.

import express from "express";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { paymentMiddleware } from "@x402/express";
import { registerMetalScheme } from "@metalntwx/metal-pay";
import type { Address } from "viem";
import { servedTick } from "../data/ticks.js";
import { FACILITATOR_URL } from "../metal/network.js";

export const SUPPLIER_ROUTE = "/v1/raw-tick";

export function supplierApp(opts: { payTo: Address; price: () => string }) {
  const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
  const server = registerMetalScheme(new x402ResourceServer(facilitator), { networks: ["testnet"] });
  const app = express();
  app.use(
    paymentMiddleware(
      {
        [`GET ${SUPPLIER_ROUTE}`]: {
          accepts: { scheme: "exact", network: "eip155:63825", payTo: opts.payTo, price: () => opts.price() },
          description: "Feedstock Labs raw EUR/USD tick",
        },
      },
      server,
    ),
  );
  app.get(SUPPLIER_ROUTE, (req, res) => {
    const seq = Number(req.query.seq);
    try {
      res.json({ supplier: "Feedstock Labs", tick: servedTick(seq, false) });
    } catch {
      res.status(400).json({ error: "bad seq" });
    }
  });
  return app;
}
