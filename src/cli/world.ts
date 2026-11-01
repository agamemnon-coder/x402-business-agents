// npm run world -- <command>: the world, which the demo changes; the agents decide what to do about it (D19).
//   serve [--every 20]       the shop runs: the suppliers (Stockline, Ridgeline Data) and the seller on localhost, and a
//                            customer agent that buys one stock check every N seconds (Sourcing's buy policy applies)
//   price-rise [0.04]        Stockline raises its price and sends its notice to the Sourcing agent
//   ridgeline-price <0.03>   Ridgeline Data changes its price
//   dispute                  Summit Outfitters disputes a batch of orders (the email reaches the Support agent)
//   invoice                  Stockline Data's monthly licence invoice reaches the Treasury agent
// Nothing here decides for an agent.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { openDb } from "../db/open.js";
import { publish } from "../autonomy/bus.js";
import { setSupplierPrice } from "../autonomy/teamProfiles.js";
import { startRuntime } from "../world/runtime.js";
import { redactSecrets } from "../lib/redact.js";
import { baseUnitsToCents, fromCents } from "../lib/money.js";

const [cmd, arg] = process.argv.slice(2);
const db = openDb();
const fixture = (f: string) => resolve(import.meta.dirname, "../../fixtures", f);
const stamp = () => new Date().toISOString().slice(11, 19);
const money = /^\d+\.\d{2}$/;

if (cmd === "serve") {
  const every = Number(process.argv.includes("--every") ? process.argv[process.argv.indexOf("--every") + 1] : "20") * 1000;
  const rt = await startRuntime(db);
  console.log(`${stamp()} world serving: Stockline, Ridgeline Data and the seller on localhost; a customer query every ${every / 1000} s`);
  let stopping = false;
  process.on("SIGTERM", () => { stopping = true; });
  process.on("SIGINT", () => { stopping = true; });
  let seq = ((db.prepare("SELECT MAX(CAST(json_extract(request_params_json, '$.seq') AS INTEGER)) AS s FROM sales").get() as { s: number | null }).s ?? 0) + 1;
  while (!stopping) {
    try {
      const p = await rt.customer.buy(seq);
      console.log(`${stamp()} query #${seq}: ${p.outcome.kind === "paid" ? `sold for ${fromCents(baseUnitsToCents(BigInt(p.outcome.amount)))}` : `not sold (${redactSecrets(String((p.outcome as { reason?: string }).reason ?? p.outcome.kind)).slice(0, 160)})`}`);
    } catch (e) {
      console.log(`${stamp()} query #${seq} failed: ${redactSecrets((e as Error).message).slice(0, 200)}`);
    }
    seq++;
    for (let t = 0; t < every && !stopping; t += 500) await new Promise((r) => setTimeout(r, 500));
  }
  await rt.close();
} else if (cmd === "price-rise") {
  const price = arg && money.test(arg) ? arg : "0.04";
  setSupplierPrice(db, "stockline", price);
  publish(db, "supplier.notice", { supplier: "Stockline", new_price: price, notice: readFileSync(fixture("stockline-price-notice.txt"), "utf8").slice(0, 1500) }, "sourcing");
  console.log(`Stockline now asks ${price} a stock check; its notice reached the Sourcing agent`);
} else if (cmd === "ridgeline-price" && arg && money.test(arg)) {
  setSupplierPrice(db, "ridgeline", arg);
  console.log(`Ridgeline Data now asks ${arg} a stock check`);
} else if (cmd === "dispute") {
  publish(db, "dispute.opened", { customer: "Summit Outfitters", email: readFileSync(fixture("summit-dispute-email.txt"), "utf8").slice(0, 2000) }, "support");
  console.log("Summit Outfitters' dispute email reached the Support agent");
} else if (cmd === "invoice") {
  publish(db, "invoice.received", { vendor: "Stockline Data GmbH", file: "stockline-licence-SLL-2026-11.txt", text: readFileSync(fixture("stockline-licence-SLL-2026-11.txt"), "utf8").slice(0, 1500) }, "treasury");
  console.log("Stockline Data's licence invoice reached the Treasury agent");
} else {
  console.error("usage: npm run world -- serve [--every 20] | price-rise [0.04] | ridgeline-price <x.xx> | dispute | invoice");
  process.exit(2);
}
