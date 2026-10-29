// Starts the supplier and seller on localhost and wires the agents to them.

import type { Server } from "node:http";
import type { Address } from "viem";
import { SourcingAgent } from "../agents/sourcing.js";
import { CustomerAgent } from "../agents/customer.js";
import { SELL_PRICE_CENTS, UPSTREAM_PRICE_CENTS } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { readKeyFile } from "../metal/chain.js";
import { keyPath } from "../metal/agentCli.js";
import { sellerApp } from "../servers/seller.js";
import { supplierApp } from "../servers/supplier.js";
import { getSetting } from "./settings.js";

export interface Addresses {
  business: Address;
  customer: Address;
  supplier: Address;
  sweep: Address;
}

export function addresses(db: DB): Addresses {
  const row = (role: string) => {
    const r = db.prepare("SELECT address FROM metal_accounts WHERE role = ?").get(role) as { address: Address } | undefined;
    if (!r) throw new Error(`no ${role} account in the ledger; run npm run bootstrap`);
    return r.address;
  };
  return { business: row("business"), customer: row("customer"), supplier: readKeyFile(keyPath("supplier.key.json")).address, sweep: readKeyFile(keyPath("sweep.key.json")).address };
}

export const sellPrice = (db: DB) => getSetting(db, "sell_price", fromCents(SELL_PRICE_CENTS));
export const upstreamPrice = (db: DB) => getSetting(db, "upstream_price", fromCents(UPSTREAM_PRICE_CENTS));

export interface Runtime {
  addr: Addresses;
  sourcing: SourcingAgent;
  customer: CustomerAgent;
  sellerBase: string;
  close(): Promise<void>;
}

function listen(app: ReturnType<typeof supplierApp>, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const s = app.listen(port, "127.0.0.1", () => resolve(s));
    s.on("error", reject);
  });
}

export async function startRuntime(db: DB, ports = { supplier: 4101, seller: 4102 }): Promise<Runtime> {
  const addr = addresses(db);
  const supplierBase = `http://127.0.0.1:${ports.supplier}`;
  const sellerBase = `http://127.0.0.1:${ports.seller}`;
  const sourcing = new SourcingAgent(db, supplierBase, addr.supplier);
  const servers = [
    await listen(supplierApp({ payTo: addr.supplier, price: () => upstreamPrice(db) }), ports.supplier),
    await listen(sellerApp({ db, payTo: addr.business, price: () => sellPrice(db), buyUpstream: (seq) => sourcing.buy(seq) }), ports.seller),
  ];
  return {
    addr, sourcing, sellerBase,
    customer: new CustomerAgent(sellerBase, addr.business),
    close: async () => {
      await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
    },
  };
}
