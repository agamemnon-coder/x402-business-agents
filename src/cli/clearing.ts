// npm run clearing                          the prepaid clearing budget: Summit's deposit and our earnings, as Metal reports them
// npm run clearing -- deposit <amount>      Summit puts *USDZ into Metal clearing (its prepaid budget; e.g. 5.00)
// npm run clearing -- buy <from> <to>       Summit buys stock checks on the prepaid route; the mandate route is the fallback
// npm run clearing -- withdraw              our finalized clearing earnings go to the business account (call again later)
// Metal's Offer Pay-per-Call Clearing is new on testnet (October 2026). Keys stay in KIT11_KEYS_DIR; nothing secret is printed.

import { audit } from "../audit/log.js";
import { openDb, type DB } from "../db/open.js";
import { baseUnitsToCents, centsToBaseUnits, fromCents, toCents } from "../lib/money.js";
import { keyPath } from "../metal/agentCli.js";
import { clearingDeployment, depositCustomer, spendable, withdrawSeller, type ClearingParty } from "../metal/clearing.js";
import { EXPLORER_TX } from "../metal/network.js";
import { addresses, sellPrice, startRuntime } from "../world/runtime.js";

const args = process.argv.slice(2);
const db = openDb();
const units = (u: bigint) => fromCents(baseUnitsToCents(u - (u % 10n ** 16n)));

function recordBalance(db: DB, party: ClearingParty, u: bigint): void {
  db.prepare("INSERT INTO clearing_ops (party, kind, units, tx, detail, created_at) VALUES (?, 'balance', ?, NULL, NULL, ?)").run(party, u.toString(), new Date().toISOString());
}

async function status(): Promise<void> {
  const d = await clearingDeployment();
  if (!d) {
    console.log("Metal's facilitator offers no clearing on testnet now; sales use the mandate route");
    return;
  }
  console.log(`clearing  contract ${d.settlement}, service ${new URL(d.serviceUrl).host} (Metal testnet; new in October 2026)`);
  for (const party of ["customer", "seller"] as const) {
    const s = await spendable(party);
    recordBalance(db, party, s.units);
    console.log(`${party === "customer" ? "Summit's prepaid budget" : "our clearing earnings  "}  ${units(s.units)} *USDZ spendable now (clearing key ${s.account.slice(0, 12)}…)`);
  }
  const sold = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(price_cents), 0) AS c FROM sales WHERE scheme = 'bajillion' AND status = 'DELIVERED'").get() as { n: number; c: number };
  console.log(`sold by clearing          ${sold.n} stock checks, ${fromCents(sold.c)} *USDZ (no transaction per query)`);
}

const cmd = args[0] ?? "status";
if (cmd === "status") {
  await status();
} else if (cmd === "deposit") {
  const amount = args[1];
  if (!amount || !/^\d+\.\d{2}$/.test(amount)) {
    console.error("usage: npm run clearing -- deposit <amount, e.g. 5.00>");
    process.exit(2);
  }
  const r = await depositCustomer(centsToBaseUnits(toCents(amount)));
  db.prepare("INSERT INTO clearing_ops (party, kind, units, tx, detail, created_at) VALUES ('customer', 'deposit', ?, ?, NULL, ?)").run(centsToBaseUnits(toCents(amount)).toString(), r.depositTx, new Date().toISOString());
  audit(db, "customer", "clearing.deposited", r.account.slice(0, 18), { amount, tx: r.depositTx });
  console.log(`Summit deposited ${amount} *USDZ into Metal clearing: ${EXPLORER_TX}${r.depositTx}`);
} else if (cmd === "buy") {
  const from = Number(args[1] ?? 1);
  const to = Number(args[2] ?? from);
  const rt = await startRuntime(db);
  console.log(`GOAL      sell stock checks ${from}..${to} at ${sellPrice(db)} *USDZ from Summit's clearing deposit; the mandate route is the fallback`);
  let byClearing = 0, byMandate = 0;
  try {
    for (let seq = from; seq <= to; seq++) {
      const t = Date.now();
      const p = await rt.customer.buyPrepaid(seq);
      const ms = Date.now() - t;
      if (p.via === "clearing") {
        if (p.status === 200) byClearing++;
        console.log(`sale  #${seq}  ${p.status === 200 ? "paid by clearing (receipt, no transaction)" : `clearing: HTTP ${p.status} ${p.body.slice(0, 120)}`}  ${ms} ms`);
      } else {
        const o = p.outcome;
        if (o.kind === "paid") byMandate++;
        console.log(`sale  #${seq}  ${o.kind === "paid" ? `paid on the mandate route ${EXPLORER_TX}${o.tx}` : `${o.kind}: ${o.reason}; Summit charged: ${p.charged ? "YES" : "no"}`}  (clearing not used: ${(p.fallbackFrom ?? "").slice(0, 160)})  ${ms} ms`);
      }
    }
  } finally {
    await rt.close();
  }
  console.log(`RESULT    ${byClearing} by clearing, ${byMandate} on the mandate route`);
} else if (cmd === "withdraw") {
  const r = await withdrawSeller(addresses(db).business, keyPath("owner-business.key.json"));
  if (r.status === "sent") {
    for (const c of r.claimed) {
      db.prepare("INSERT INTO clearing_ops (party, kind, units, tx, detail, created_at) VALUES ('seller', 'withdraw', ?, ?, ?, ?)").run(c.amount.toString(), c.tx, c.deferred ? "deferred" : null, new Date().toISOString());
      audit(db, "treasury", "clearing.withdrawn", null, { amount: units(c.amount), tx: c.tx, deferred: c.deferred });
      console.log(`claimed ${units(c.amount)} *USDZ to the business account${c.deferred ? " (deferred: the destination must collect it)" : ""}: ${EXPLORER_TX}${c.tx}`);
    }
    if (r.queued) console.log(`queued the rest for withdrawal: ${EXPLORER_TX}${r.queued.tx}; call again once its epoch is final (about 20 minutes)`);
  } else if (r.status === "waiting") {
    console.log(`a withdrawal is queued in epoch ${r.epoch}, not final yet; call again later`);
  } else {
    console.log("nothing to withdraw yet: earnings leave once their epoch is final");
  }
} else {
  console.error("usage: npm run clearing [-- deposit <amount> | buy <from> <to> | withdraw]");
  process.exit(2);
}
