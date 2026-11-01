// npm run world -- <command>: the world, which the demo changes; the agents decide what to do about it (D19).
//   serve [--every 20]       the shop runs: the suppliers (Stockline, Ridgeline Data) and the seller on localhost, and a
//                            customer agent that buys one stock check every N seconds (Sourcing's buy policy applies)
//   price-rise [0.04]        Stockline raises its price and sends its notice to the Sourcing agent
//   ridgeline-price <0.03>   Ridgeline Data changes its price
//   dispute                  Summit Outfitters disputes a batch of orders (the email reaches the Support agent)
//   invoice                  Stockline Data's monthly licence invoice reaches the Treasury agent
//   packwise-pro             Packwise ends its Starter plan; the warehouse software continues on Pro, 45.00 EUR a month
//                            (the Sourcing agent decides; its card at Airwallex may decline)
//   money-in                 the day's sales have settled on Metal; the Treasury agent hears what came in
//   packwise-renewal         Packwise charges its Pro renewal to the Sourcing agent's card; Airwallex decides, and its
//                            webhook (or the runner's poll) tells the agent (D22)
//   report-offer             Ridgeline Data offers a one-off report, over x402 or by single-use card (D22)
//   deposit [short]          a retailer pays its invoice into Northwind's Global Account at Airwallex; the Treasury
//                            agent hears it once it is matched (D22)
// Nothing here decides for an agent.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { openDb } from "../db/open.js";
import { publish } from "../autonomy/bus.js";
import { setSupplierPrice } from "../autonomy/teamProfiles.js";
import { startRuntime } from "../world/runtime.js";
import { redactSecrets } from "../lib/redact.js";
import { baseUnitsToCents, fromCents } from "../lib/money.js";
import { netEarnings } from "../agents/sweep.js";
import { PLANS, REPORT_OFFER } from "../config/policy.js";
import { execFileSync } from "node:child_process";
import { issuingFromEnv } from "../airwallex/issuing.js";
import { cardOf } from "../policy/cards.js";

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
} else if (cmd === "packwise-pro") {
  const pro = PLANS["packwise-pro"]!;
  publish(db, "supplier.notice", { supplier: "Packwise", text: `Packwise ends its Starter plan this month. Your warehouse software continues only on the Pro plan, ${fromCents(pro.amountCents)} EUR a month (${pro.label}). Without a plan, warehouse sync stops at the end of the month.` }, "sourcing");
  console.log("Packwise's notice reached the Sourcing agent: Starter ends, Pro costs 45.00 EUR a month");
} else if (cmd === "money-in") {
  const e = netEarnings(db);
  const sold = (db.prepare("SELECT COUNT(*) AS n FROM sales WHERE status = 'DELIVERED'").get() as { n: number }).n;
  publish(db, "money.in", { text: `The day's sales have settled on Metal: ${sold} stock checks sold for ${fromCents(e.revenueCents)}; net earnings ${fromCents(Math.max(0, e.netCents))} sit on the business account, not yet swept to Airwallex.` }, "treasury");
  console.log(`money in: ${sold} sales settled; net earnings ${fromCents(Math.max(0, e.netCents))} on the business account; the Treasury agent was told`);
} else if (cmd === "packwise-renewal") {
  // D22: the merchant charges the renewal at the Pro price to the Sourcing agent's card; Airwallex decides. Nothing is
  // recorded here: the webhook (hosted relay) or the runner's poll records it, and only then does the agent hear it.
  const iss = issuingFromEnv();
  const card = cardOf(db, "sourcing");
  if (!iss || !card) { console.error("no Airwallex sandbox keys or no Sourcing card in this world (npm run cards -- setup)"); process.exit(1); }
  const pro = PLANS["packwise-pro"]!;
  const t = await iss.sim.simulateCardCharge({ cardId: card.card_id, amountCents: pro.amountCents, currency: "EUR", merchant: pro.merchant, mcc: pro.mcc });
  console.log(`Packwise charged its Pro renewal, ${fromCents(pro.amountCents)} EUR, to the Sourcing agent's card ····${card.last4}: Airwallex ${t.approved ? "approved it" : `declined it (${t.failureReason ?? t.status})`} (${t.transactionId}); its webhook or the runner's poll tells the agent`);
} else if (cmd === "report-offer") {
  // D22: a supplier offers something on two rails; the Sourcing agent picks (x402 under its mandate, or a task card).
  publish(db, "supplier.offer", {
    supplier: REPORT_OFFER.supplier, offer: "report", item: REPORT_OFFER.item,
    x402: `${fromCents(REPORT_OFFER.x402Cents)} test USD over x402 on Metal`, card: `${fromCents(REPORT_OFFER.cardCents)} EUR by card, on a single-use card per order`,
    text: `Ridgeline Data: our regional demand report for outdoor gear (November) is out. Pay ${fromCents(REPORT_OFFER.x402Cents)} test USD over x402, or ${fromCents(REPORT_OFFER.cardCents)} EUR by card; for card payments we ask for a single-use card per order.`,
  }, "sourcing");
  console.log(`Ridgeline Data's offer reached the Sourcing agent: the demand report for ${fromCents(REPORT_OFFER.x402Cents)} test USD over x402 or ${fromCents(REPORT_OFFER.cardCents)} EUR on a single-use card`);
} else if (cmd === "deposit") {
  // D22: a retailer pays its invoice into Northwind's EUR Global Account (the sandbox's deposit simulation), in full
  // or short; the poll here (the webhook on the hosted relay) matches it, and the Treasury agent hears it as money in.
  const out = execFileSync("npx", ["tsx", resolve(import.meta.dirname, "receivables.ts"), "customer-pays", ...(arg === "short" ? ["short"] : [])], { env: process.env, encoding: "utf8" });
  console.log(redactSecrets(out.trim()));
} else {
  console.error("usage: npm run world -- serve [--every 20] | price-rise [0.04] | ridgeline-price <x.xx> | dispute | invoice | packwise-pro | packwise-renewal | money-in | deposit [short] | report-offer");
  process.exit(2);
}
