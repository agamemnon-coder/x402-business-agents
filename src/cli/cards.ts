// npm run cards                                       each agent's card: limits, spend this month, last purchases
// npm run cards -- setup                              issue (or adopt) a virtual Visa card per agent at Airwallex
// npm run cards -- sync                               read every card back and fix limits that differ from the policy
// npm run cards -- buy <plan>                         the agent subscribes; the (simulated) merchant charges its card
// npm run cards -- raise <agent> <per purchase> [<per month>] [--reason text]
//                                                     the agent asks the CFO for a higher limit (a Face ID proposal)
// npm run cards -- scenario                          S4 for demo:all: issue the cards, a plan inside the limit, one over it
//                                                     (declined by Airwallex), and the agent's request for a raise
// npm run cards -- poll                               record transactions Airwallex made that we have not seen yet
// npm run cards -- webhook [--replace]                subscribe the relay to Airwallex's webhooks for every object Purser uses; the
//                                                     signing secret goes to the keys dir and the Worker, never the screen
// Sandbox only. The card number stays at Airwallex; this prints the last four digits.

import { issuingFromEnv } from "../airwallex/issuing.js";
import { buyPlan, proposeCardRaise } from "../agents/cardBuyer.js";
import { AGENTS, PLANS, type Agent } from "../config/policy.js";
import { openDb } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { cardRows, cardSpendCents, pollCardTransactions, setupCards, syncCards } from "../policy/cards.js";
import { approvalHint } from "./hint.js";
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Airwallex, fromEnv } from "../airwallex/client.js";
import { createWebhook, deleteWebhook, listWebhooks, WEBHOOK_SECRET_FILE } from "../airwallex/webhooks.js";
import { ALL_EVENTS } from "../policy/airwallexEvents.js";
import { keyPath } from "../metal/agentCli.js";
import { relayConfig } from "../relay/config.js";
import { agentsOn } from "../config/agents.js";
import { chooseRails } from "../agents/railChoice.js";
import { meetNewDeclines } from "../agents/declineTrigger.js";
import { startRuntime } from "../world/runtime.js";
import type { CardTransaction, IssuingSim } from "../airwallex/issuing.js";

/** Block 5.2: the declines this command just caused start their agents here (claimed once; the runner skips them). */
async function meetDeclinesHere(): Promise<void> {
  for (const m of await meetNewDeclines(db, { by: "cli" })) {
    const who = m.run.calls.length || m.source === "claude" ? `${m.run.model ?? "Claude"}` : "code";
    console.log(`DECLINE AGENT    ${m.source === "claude" ? who : "not available; code"}: ${m.proposal_id ? `proposed ${m.proposal_id}` : "no raise"}${m.said ? `: "${m.said}"` : ""}`);
    if (m.proposal_id) console.log(`                 ${approvalHint(db, m.proposal_id)}`);
  }
}

/**
 * Block 5.1: the Sourcing agent's two purchases, each on the rail it picks; code checks the supplier accepts it. The
 * stock check serves the next customer query (bought upstream over x402 under the Sourcing mandate); Packwise Starter is
 * charged to the agent's card. Returns the Packwise transaction, as the plain purchase would.
 */
async function railChoice(sim: IssuingSim): Promise<CardTransaction> {
  const rt = await startRuntime(db);
  let card: CardTransaction | null = null;
  try {
    const r = await chooseRails(db, {
      payStockline: async () => {
        const seq = ((db.prepare("SELECT MAX(CAST(json_extract(request_params_json, '$.seq') AS INTEGER)) AS s FROM sales").get() as { s: number | null }).s ?? 0) + 1;
        const before = (db.prepare("SELECT COALESCE(MAX(id), 0) AS n FROM upstream_purchases").get() as { n: number }).n;
        const p = await rt.customer.buy(seq);
        const u = db.prepare("SELECT price_cents, outcome, tx_hash, refusal_reason FROM upstream_purchases WHERE id > ? ORDER BY id DESC LIMIT 1").get(before) as { price_cents: number; outcome: string; tx_hash: string | null; refusal_reason: string | null } | undefined;
        if (u?.outcome === "PAID") return { ok: true, text: `stock check #${seq} bought from Stockline for ${fromCents(u.price_cents)} under the Sourcing mandate${p.outcome.kind === "paid" ? ", and sold to the customer" : ""}`, ref: u.tx_hash };
        if (u?.outcome === "IN_DOUBT") return { ok: false, text: `stock check #${seq}: in doubt, it may have settled; the reconciliation resolves it (never paid twice)`, ref: null };
        return { ok: false, text: `stock check #${seq}: ${u ? `refused (${u.refusal_reason ?? u.outcome})` : `nothing was bought (${p.outcome.kind})`}`, ref: null };
      },
      payPackwise: async () => {
        card = await buyPlan(db, sim, "packwise-starter");
        return { ok: card.approved, text: card.approved ? "19.99 EUR approved by Airwallex on the agent's card" : `declined by Airwallex (${card.failureReason})`, ref: card.transactionId };
      },
    });
    console.log(`SOURCING AGENT   ${r.source === "claude" ? `${r.run.model ?? "Claude"}: picked the rail per purchase` : "did not finish; code paid the rest on the rail each supplier accepts"}`);
    for (const p of r.purchases) console.log(`                 ${p.supplier}: ${p.rail} (${p.by}${p.by === "claude" && p.reason ? `: "${p.reason}"` : ""}): ${p.text}`);
    for (const c of r.run.calls.filter((x) => x.blocked === "supplier's rails")) console.log(`                 refused by code: ${c.text.slice(0, 200)}`);
  } finally {
    await rt.close();
  }
  if (!card) throw new Error("Packwise Starter's purchase stopped before Airwallex answered; see npm run cards and the ledger");
  return card;
}

const args = process.argv.slice(2);
const db = openDb();
const need = () => {
  const awx = issuingFromEnv();
  if (!awx) {
    console.error("the Airwallex sandbox keys are not set (AIRWALLEX_CLIENT_ID, AIRWALLEX_API_KEY); nothing was done");
    process.exit(2);
  }
  return awx;
};

function status(): void {
  const rows = cardRows(db);
  if (rows.length === 0) console.log("no cards yet: npm run cards -- setup");
  for (const c of rows) {
    const spent = cardSpendCents(db, c.agent);
    console.log(`${c.agent.padEnd(9)} Visa •••• ${c.last4}  ${fromCents(c.per_tx_cents)} EUR per purchase, ${fromCents(c.monthly_cents)} EUR per month, spent ${fromCents(spent)} this month  (${c.nickname})`);
  }
  const recent = db.prepare("SELECT agent, merchant, amount_cents, approved, failure_reason, source, occurred_at FROM card_transactions ORDER BY occurred_at DESC LIMIT 8").all() as
    { agent: string; merchant: string; amount_cents: number; approved: number; failure_reason: string | null; source: string; occurred_at: string }[];
  for (const t of recent) {
    console.log(`  ${t.occurred_at.slice(0, 16)} ${t.agent.padEnd(9)} ${t.merchant.padEnd(24)} ${fromCents(t.amount_cents).padStart(8)} EUR  ${t.approved ? "approved" : `DECLINED ${t.failure_reason ?? ""}`}  (${t.source})`);
  }
}

const cmd = args[0] ?? "status";
if (cmd === "status") {
  status();
} else if (cmd === "setup") {
  await setupCards(db, need().rail);
  status();
} else if (cmd === "sync") {
  const changed = await syncCards(db, need().rail);
  console.log(changed.length ? `updated at Airwallex: ${changed.join(", ")}` : "every card already matches the CFO policy");
} else if (cmd === "poll") {
  console.log(`${await pollCardTransactions(db, need().rail)} new transaction(s)`);
} else if (cmd === "buy") {
  const plan = PLANS[args[1] ?? ""];
  if (!plan) {
    console.error(`usage: npm run cards -- buy <plan>; plans: ${Object.entries(PLANS).map(([id, p]) => `${id} (${p.agent}, ${fromCents(p.amountCents)} EUR)`).join(", ")}`);
    process.exit(2);
  }
  const t = await buyPlan(db, need().sim, args[1]!);
  console.log(`${plan.agent} agent: ${plan.merchant}, ${plan.label}, ${fromCents(t.amountCents)} EUR -> ${t.approved ? "approved by Airwallex" : `DECLINED by Airwallex (${t.failureReason ?? t.status})`}`);
  if (!t.approved && t.failureReason === "LIMIT_EXCEEDED") console.log(`the card's limit held. To allow it, the agent asks the CFO: npm run cards -- raise ${plan.agent} <new limit> --reason "…"`);
} else if (cmd === "webhook") {
  const cfg = fromEnv();
  if (!cfg) { console.error("the Airwallex sandbox keys are not set; nothing was done"); process.exit(2); }
  const api = new Airwallex(cfg);
  const url = `${(await relayConfig()).url}/hooks/airwallex`;
  const file = keyPath(WEBHOOK_SECRET_FILE);
  const events = (process.env.AIRWALLEX_WEBHOOK_EVENTS ?? ALL_EVENTS.join(",")).split(",");
  const replace = args.includes("--replace");
  const existing = (await listWebhooks(api)).find((w) => w.url === url);
  const missing = existing ? events.filter((e) => !existing.events.includes(e)) : events;
  if (existing && existsSync(file) && missing.length === 0) {
    console.log(`already subscribed: ${existing.id} (${existing.events.length} events); the secret is in the keys dir`);
    process.exit(0);
  }
  if (existing && !replace) {
    console.error(existsSync(file)
      ? `${existing.id} lacks ${missing.length} event(s) (${missing.slice(0, 4).join(", ")}${missing.length > 4 ? ", …" : ""}). Airwallex cannot add events to a subscription, so this needs a new one with a NEW signing secret: run with --replace (asks nothing more; get the CFO's go first)`
      : `a webhook for ${url} exists (${existing.id}) but its secret is not in the keys dir; run with --replace to make a new one`);
    process.exit(1);
  }
  // The new subscription first, its secret on the relay and the runner, and only then the old one goes: no gap in
  // which Airwallex sends to a relay that cannot check the signature.
  const w = await createWebhook(api, { url, events, version: process.env.AIRWALLEX_WEBHOOK_VERSION ?? "2025-11-11" });
  // The Worker's copy, through stdin like the relay token: never on a command line, never printed.
  const worker = resolve(import.meta.dirname, "../../worker");
  const r = spawnSync(resolve(worker, "node_modules/.bin/wrangler"), ["secret", "put", "AIRWALLEX_WEBHOOK_SECRET"], {
    cwd: worker, input: w.secret, env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, stdio: ["pipe", "inherit", "inherit"],
  });
  if (r.status !== 0) {
    await deleteWebhook(api, w.id);
    console.error("the Worker secret was not set, so the new subscription was deleted again; nothing changed");
    process.exit(1);
  }
  writeFileSync(file, w.secret + "\n", { mode: 0o600 });
  if (existing) await deleteWebhook(api, existing.id);
  console.log(`subscribed ${w.id} to ${w.events.length} events (version ${w.version})${existing ? `; the old subscription ${existing.id} is deleted` : ""}; restart npm run relay so the runner checks them too`);
} else if (cmd === "scenario") {
  const awx = need();
  console.log("GOAL             every agent its own company card, with the CFO policy's limits on the card itself");
  await setupCards(db, awx.rail);
  status();
  // With KIT11_AGENTS=on the Sourcing agent picks the rail per purchase (block 5.1): this morning's stock check from
  // Stockline (x402 on Metal only) and Packwise Starter (card only). Off, code buys Packwise Starter as in every recording.
  const ok = agentsOn() ? await railChoice(awx.sim) : await buyPlan(db, awx.sim, "packwise-starter");
  console.log(`PLAN             the sourcing agent subscribes to Packwise Starter, 19.99 EUR: ${ok.approved ? "approved by Airwallex" : `DECLINED (${ok.failureReason})`}`);
  const pro = await buyPlan(db, awx.sim, "packwise-pro");
  console.log(`NEW INFORMATION  it needs the Pro plan, 45.00 EUR, on a card that allows ${fromCents(cardRows(db).find((c) => c.agent === "sourcing")!.per_tx_cents)} a purchase: ${pro.approved ? "approved (the limit was already high enough)" : `DECLINED by Airwallex (${pro.failureReason})`}`);
  // Block 5.2: with the agents on, the decline starts the Sourcing agent (it explains and proposes; code bounds it).
  if (agentsOn() && !pro.approved) await meetDeclinesHere();
  const open = db.prepare("SELECT proposal_id FROM proposals WHERE kind = 'policy_change' AND status = 'PENDING_APPROVAL' AND created_by = 'sourcing'").get() as { proposal_id: string } | undefined;
  if (!pro.approved && !open && !agentsOn()) {
    const p = proposeCardRaise(db, "sourcing", { perTx: "50.00" }, "Packwise's Pro plan costs 45.00 EUR a month; my card allows 30.00 per purchase, so Airwallex declined it. The Pro plan gives the faster prices our customers pay for. Monthly limit stays 100.00.");
    console.log(`REVISED DECISION the agent asks the CFO for 50.00 per purchase: ${p.proposal_id}, hash ${p.terms_sha256.slice(0, 8)}; ${approvalHint(db, p.proposal_id, p.terms_sha256.slice(0, 8))}`);
  }
  // Governance: a card may pay only its own kind of merchant. The support card is for helpdesk software; Airwallex itself declines
  // warehouse software on it, whatever its limits.
  const wrong = await buyPlan(db, awx.sim, "packwise-on-support-card");
  console.log(`CONTROL          the support agent's card tries warehouse software (MCC 5734) on a helpdesk-only card (MCC 7372): ${wrong.approved ? "APPROVED (the control did not hold)" : `declined by Airwallex (${wrong.failureReason})`}`);
  if (agentsOn() && !wrong.approved) await meetDeclinesHere();
} else if (cmd === "raise") {
  const [, agent, perTx, monthly] = args;
  const at = args.indexOf("--reason");
  if (!AGENTS.includes(agent as Agent) || !perTx || perTx.startsWith("--")) {
    console.error("usage: npm run cards -- raise <sourcing|support|treasury> <per purchase, e.g. 50.00> [<per month>] [--reason text]");
    process.exit(2);
  }
  const p = proposeCardRaise(db, agent as Agent, { perTx, monthly: monthly && !monthly.startsWith("--") ? monthly : undefined }, at >= 0 ? (args[at + 1] ?? "") : "a higher card limit");
  console.log(`${p.proposal_id} card limit raise for the ${agent} agent, hash ${p.terms_sha256.slice(0, 8)}; ${approvalHint(db, p.proposal_id, p.terms_sha256.slice(0, 8))}`);
} else {
  console.error("usage: npm run cards [-- setup | sync | poll | buy <plan> | raise <agent> <limit> …]");
  process.exit(2);
}
