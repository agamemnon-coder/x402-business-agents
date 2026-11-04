// npm run trade -- <from> <to>: the customer agent buys stock checks <from>..<to>, live on Metal testnet.

import { openDb } from "../db/open.js";
import { fromCents, baseUnitsToCents } from "../lib/money.js";
import { activeMandate, mandateSpent } from "../metal/mandate.js";
import { EXPLORER_TX } from "../metal/network.js";
import { sellPrice, startRuntime, upstreamPrice } from "../world/runtime.js";

const from = Number(process.argv[2] ?? 1);
const to = Number(process.argv[3] ?? from);
const db = openDb();
const rt = await startRuntime(db);
console.log(`GOAL      sell stock checks ${from}..${to} at ${sellPrice(db)} *USDZ; upstream costs ${upstreamPrice(db)}`);
try {
  for (let seq = from; seq <= to; seq++) {
    const p = await rt.customer.buy(seq);
    const o = p.outcome;
    if (o.kind === "paid") console.log(`sale  #${seq}  paid ${fromCents(Number(BigInt(o.amount) / 10n ** 16n))}  ${EXPLORER_TX}${o.tx}`);
    else console.log(`sale  #${seq}  ${o.kind.toUpperCase()}  ${o.reason}  customer charged: ${p.charged ? "YES" : "no"}`);
  }
  for (const agent of ["sourcing", "customer"] as const) {
    const m = await activeMandate(agent);
    console.log(`${agent} mandate spent ${fromCents(baseUnitsToCents(await mandateSpent(m)))}`);
  }
} finally {
  await rt.close();
}
