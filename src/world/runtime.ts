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
import { existsSync } from "node:fs";
import { WALLET_DIRS, clearingDeployment, openWallet } from "../metal/clearing.js";
import { SUPPLIERS, type SupplierId } from "../config/suppliers.js";
import { autonomyOn } from "../config/agents.js";

export interface Addresses {
  business: Address;
  customer: Address;
  supplier: Address;
  sweep: Address;
  /** D19: the second supplier, when its key exists (the autonomous agents). */
  ridgeline?: Address;
}

export function addresses(db: DB): Addresses {
  const row = (role: string) => {
    const r = db.prepare("SELECT address FROM metal_accounts WHERE role = ?").get(role) as { address: Address } | undefined;
    if (!r) throw new Error(`no ${role} account in the ledger; run npm run bootstrap`);
    return r.address;
  };
  const ridge = keyPath(SUPPLIERS.ridgeline.keyFile);
  return { business: row("business"), customer: row("customer"), supplier: readKeyFile(keyPath("supplier.key.json")).address, sweep: readKeyFile(keyPath("sweep.key.json")).address,
    ...(existsSync(ridge) ? { ridgeline: readKeyFile(ridge).address } : {}) };
}

export const sellPrice = (db: DB) => getSetting(db, "sell_price", fromCents(SELL_PRICE_CENTS));
export const upstreamPrice = (db: DB) => getSetting(db, "upstream_price", fromCents(UPSTREAM_PRICE_CENTS));
export const supplierPrice = (db: DB, id: SupplierId) => getSetting(db, SUPPLIERS[id].priceKey, fromCents(SUPPLIERS[id].defaultPriceCents));

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

/** Our clearing key when the seller has a clearing wallet and Metal offers clearing on testnet; otherwise null. */
async function sellerClearingKey(): Promise<`0x${string}` | null> {
  if (!existsSync(keyPath(WALLET_DIRS.seller))) return null;
  if (!(await clearingDeployment().catch(() => null))) return null;
  const w = await openWallet("seller");
  try {
    return w.signer.publicKey;
  } finally {
    await w.close();
  }
}

export async function startRuntime(db: DB, ports = { supplier: 4101, seller: 4102 }): Promise<Runtime> {
  const addr = addresses(db);
  const supplierBase = `http://127.0.0.1:${ports.supplier}`;
  const sellerBase = `http://127.0.0.1:${ports.seller}`;
  const ridgeline = autonomyOn() && addr.ridgeline ? { base: `http://127.0.0.1:${SUPPLIERS.ridgeline.port}`, address: addr.ridgeline } : null;
  const sourcing = new SourcingAgent(db, supplierBase, addr.supplier, ridgeline);
  const servers = [
    await listen(supplierApp({ payTo: addr.supplier, price: () => upstreamPrice(db) }), ports.supplier),
    // D19: Ridgeline Data, the second supplier: its own price, older data, sometimes unavailable.
    ...(ridgeline ? [await listen(supplierApp({ payTo: ridgeline.address, price: () => supplierPrice(db, "ridgeline"), name: SUPPLIERS.ridgeline.name,
      dataAgeSeconds: SUPPLIERS.ridgeline.dataAgeSeconds, unavailableEvery: SUPPLIERS.ridgeline.unavailableEvery }), SUPPLIERS.ridgeline.port)] : []),
    await listen(sellerApp({
      db, payTo: addr.business, price: () => sellPrice(db), buyUpstream: (seq) => sourcing.buy(seq),
      // The prepaid route (Metal clearing) is offered only when we have a clearing key and Metal offers clearing.
      clearing: await sellerClearingKey().then((payTo) => (payTo ? { payTo, preflight: (seq: number) => sourcing.wouldRefuse(seq) } : undefined)),
    }), ports.seller),
  ];
  return {
    addr, sourcing, sellerBase,
    customer: new CustomerAgent(sellerBase, addr.business),
    close: async () => {
      await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
    },
  };
}
