// npm run world -- <command>: the world, which the demo changes; the agents decide what to do about it (D19).
//   serve [--every 20]       the shop runs: the suppliers (Stockline, Ridgeline Data) and the seller on localhost, and a
//                            customer agent that buys one stock check every N seconds (Sourcing's buy policy applies)
//   price-rise [0.04]        Stockline raises its price and sends its notice to the Sourcing agent
//   price-rise 0.04 --silent Thursday's world: Stockline raises its price without warning, from the serve loop's next
//                            query; its notice follows the first purchase attempt there (at most 5 min later). Waits
//                            until the serve loop applied it (src/world/supplierEvents.ts)
//   ridgeline-maintenance [hours|off]  Thursday's world: Ridgeline Data is offline for maintenance (default 12 h): its
//                            API answers 503 before any offer; its notice tells the Sourcing agent
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
//   setup [--upstream-cache off] [--free-eur 150.00] [--tap-rail on]
//                            the main run's world options, on a fresh world only (src/world/options.ts): no cache (every
//                            sale buys upstream once), less free EUR (the licence needs FX for its shortfall), the TAP rail
//   let-one-through          defense in depth, once per world: the next purchase Purser refuses over the cap goes on to
//                            Metal, which must refuse it itself (src/world/letThrough.ts); waits up to 90 s for the
//                            outcome and prints it
// Nothing here decides for an agent.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { openDb } from "../db/open.js";
import { publish } from "../autonomy/bus.js";
import { disputeReady } from "../agents/disputes.js";
import { setSupplierPrice } from "../autonomy/teamProfiles.js";
import { cancelSilentRise, ridgelineMaintenance, scheduleSilentRise, silentRise, stocklineNotice, worldQuery } from "../world/supplierEvents.js";
import { addresses, startRuntime } from "../world/runtime.js";
import { redactSecrets } from "../lib/redact.js";
import { baseUnitsToCents, fromCents } from "../lib/money.js";
import { netEarnings } from "../agents/sweep.js";
import { PLANS, REPORT_OFFER } from "../config/policy.js";
import { execFileSync } from "node:child_process";
import { issuingFromEnv } from "../airwallex/issuing.js";
import { cardOf } from "../policy/cards.js";
import { setupWorld } from "../world/options.js";
import { claimLetThrough, letThrough, requestLetThrough, LET_THROUGH_LABEL, LET_THROUGH_TTL_MS } from "../world/letThrough.js";
import { recordQueryAnswer } from "../world/customerAnswer.js";

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
      // Defense in depth (once per world, when asked): this process's Sourcing agent is armed for one purchase.
      const claimed = claimLetThrough(db);
      if (claimed?.armed_at) {
        rt.sourcing.armLetThrough(claimed.armed_at);
        console.log(`${stamp()} armed: the next purchase Purser refuses over the cap goes on to Metal, once (lapses in ${LET_THROUGH_TTL_MS / 60_000} min)`);
      }
      // A silent price rise (Thursday's world) is applied before this query and its notice sent after it, when due.
      const p = await worldQuery(db, seq, () => rt.customer.buy(seq), (line) => console.log(`${stamp()} ${line}`));
      // The customer's side of this query in the ledger: the HTTP status it received, and whether its payment settled.
      const a = recordQueryAnswer(db, seq, p);
      console.log(`${stamp()} query #${seq}: ${p.outcome.kind === "paid" ? `sold for ${fromCents(baseUnitsToCents(BigInt(p.outcome.amount)))}` : `not sold (${redactSecrets(String((p.outcome as { reason?: string }).reason ?? p.outcome.kind)).slice(0, 160)})`}; customer got ${a.status ?? "no answer"}, ${a.settled === true ? "settled" : a.settled === false ? "not settled" : "settlement unknown"}`);
    } catch (e) {
      const message = redactSecrets((e as Error).message);
      recordQueryAnswer(db, seq, { error: message });
      console.log(`${stamp()} query #${seq} failed: ${message.slice(0, 200)}`);
    }
    seq++;
    for (let t = 0; t < every && !stopping; t += 500) await new Promise((r) => setTimeout(r, 500));
  }
  await rt.close();
} else if (cmd === "price-rise" && process.argv.includes("--silent")) {
  // Thursday's world (Max, 2 November): the first contact with the new price is a purchase attempt, then the notice.
  const price = arg && money.test(arg) ? arg : "0.04";
  scheduleSilentRise(db, price);
  console.log(`Stockline will ask ${price} a stock check from the next customer query, without notice; waiting for the world's serve loop`);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const t0 = Date.now();
  while (silentRise(db)?.stage === "pending" && Date.now() - t0 < 90_000) await sleep(1000);
  if (silentRise(db)?.stage === "pending" && cancelSilentRise(db)) {
    console.error("not applied: the world's serve loop did not pick up the rise within 90 s (is npm run world -- serve running?); withdrawn, nothing changed");
    process.exit(3);
  }
  console.log(`Stockline now asks ${price} a stock check, from query #${silentRise(db)?.seq}; no notice sent`);
  // The first attempt is usually that same query; its refusal may be recorded on chain first, so allow some time.
  const t1 = Date.now();
  while (silentRise(db)?.stage === "applied" && Date.now() - t1 < 120_000) await sleep(1000);
  const r = silentRise(db);
  const first = db.prepare("SELECT id, outcome, refusal_reason FROM upstream_purchases WHERE id > ? AND supplier = 'stockline' ORDER BY id LIMIT 1").get(r?.from_id ?? 0) as { id: number; outcome: string; refusal_reason: string | null } | undefined;
  if (first) console.log(`first purchase attempt at Stockline after the rise: ${first.outcome}${first.refusal_reason ? ` (${redactSecrets(first.refusal_reason).slice(0, 160)})` : ""}`);
  const chain = first ? db.prepare(`SELECT event, payload_json FROM audit_log WHERE event IN ('upstream.refused_on_chain', 'upstream.refusal_not_recorded')
    AND seq > (SELECT COALESCE(MIN(seq), 0) FROM audit_log WHERE event = 'upstream.refused' AND subject = ?) ORDER BY seq LIMIT 1`).get(String(first.id)) as { event: string; payload_json: string } | undefined : undefined;
  if (chain) {
    const p = JSON.parse(chain.payload_json) as { tx?: string | null; error?: string };
    console.log(chain.event === "upstream.refused_on_chain" ? `Metal recorded the refusal on chain (tx ${p.tx ?? "none reported"})` : `the refusal was not recorded on chain: ${redactSecrets(p.error ?? "").slice(0, 160)}`);
  }
  console.log(r?.stage === "noticed"
    ? `Stockline's notice reached the Sourcing agent ${r.notice_after === "first_attempt" ? "after that first attempt" : "5 minutes after the rise"}`
    : "Stockline's notice follows the first purchase attempt there, at most 5 minutes after the rise (the serve loop sends it)");
} else if (cmd === "setup") {
  // The main run's world options (src/world/options.ts), on a fresh world only. Nothing secret is read or printed.
  const opt = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
  const cache = opt("--upstream-cache"), eur = opt("--free-eur"), tap = opt("--tap-rail");
  if ((cache !== undefined && cache !== "off") || (tap !== undefined && tap !== "on") || (cache === undefined && eur === undefined && tap === undefined)) {
    console.error("usage: npm run world -- setup [--upstream-cache off] [--free-eur 150.00] [--tap-rail on]");
    process.exit(2);
  }
  try {
    for (const line of setupWorld(db, { ...(cache ? { upstreamCache: "off" as const } : {}), ...(eur !== undefined ? { freeEur: eur } : {}), ...(tap ? { tapRail: "on" as const } : {}) })) console.log(line);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(3);
  }
} else if (cmd === "let-one-through") {
  try { requestLetThrough(db); } catch (e) { console.error(`not applied: ${(e as Error).message}; nothing changed`); process.exit(3); }
  console.log(`let-one-through requested: the world's serve loop arms it before its next query; the next purchase Purser refuses over the cap goes on to Metal, once (lapses ${LET_THROUGH_TTL_MS / 60_000} min after it is armed)`);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const t0 = Date.now();
  while (["pending", "armed"].includes(letThrough(db)?.stage ?? "") && Date.now() - t0 < 90_000) await sleep(1000);
  const lt = letThrough(db);
  if (lt?.stage === "used") {
    console.log(lt.outcome === "metal_refused" ? `${LET_THROUGH_LABEL} (Metal answered ${redactSecrets(lt.detail ?? "").slice(0, 120)}; purchase ${lt.purchase_id}, query #${lt.seq})`
      : lt.outcome === "incident" ? `INCIDENT: ${redactSecrets(lt.detail ?? "")}; the Sourcing agent is stopped until the CFO lifts it with Face ID`
        : `not let through to Metal (${lt.outcome}: ${redactSecrets(lt.detail ?? "").slice(0, 160)}); Purser refused before signing as usual`);
  } else {
    console.log(`still ${lt?.stage ?? "unknown"} after 90 s (no purchase met the cap yet; is npm run world -- serve running?); it lapses by itself`);
  }
} else if (cmd === "price-rise") {
  const price = arg && money.test(arg) ? arg : "0.04";
  setSupplierPrice(db, "stockline", price);
  stocklineNotice(db, price);
  console.log(`Stockline now asks ${price} a stock check; its notice reached the Sourcing agent`);
} else if (cmd === "ridgeline-maintenance") {
  if (arg === "off") {
    ridgelineMaintenance(db, null);
    console.log("Ridgeline Data is online again; its notice reached the Sourcing agent");
  } else {
    const hours = arg === undefined ? 12 : Number(arg);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) { console.error("usage: npm run world -- ridgeline-maintenance [hours, up to 24; default 12 | off]"); process.exit(2); }
    const until = new Date(Date.now() + hours * 3_600_000);
    ridgelineMaintenance(db, until);
    console.log(`Ridgeline Data is offline for maintenance until ${until.toISOString().slice(11, 16)} UTC: its API answers 503 before any offer; its notice reached the Sourcing agent`);
  }
} else if (cmd === "ridgeline-price" && arg && money.test(arg)) {
  setSupplierPrice(db, "ridgeline", arg);
  console.log(`Ridgeline Data now asks ${arg} a stock check`);
} else if (cmd === "dispute") {
  // Max, 2 November: the dispute names #5 to #16; it opens only once all 12 were delivered to Summit.
  const ready = disputeReady(db, addresses(db).customer);
  if (!ready.ready) {
    console.error(`not yet: Summit's dispute names #5 to #16, and #${ready.missing.join(", #")} ${ready.missing.length === 1 ? "was" : "were"} not delivered to Summit; the dispute waits`);
    process.exit(3);
  }
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
  console.error("usage: npm run world -- setup [--upstream-cache off] [--free-eur x.xx] [--tap-rail on] | serve [--every 20] | price-rise [0.04] [--silent] | let-one-through | ridgeline-maintenance [hours|off] | ridgeline-price <x.xx> | dispute | invoice | packwise-pro | packwise-renewal | money-in | deposit [short] | report-offer");
  process.exit(2);
}
