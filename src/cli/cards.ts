// npm run cards                                       each agent's card: limits, spend this month, last purchases
// npm run cards -- setup                              issue (or adopt) a virtual Visa card per agent at Airwallex
// npm run cards -- sync                               read every card back and fix limits that differ from the policy
// npm run cards -- buy <plan>                         the agent subscribes; the (simulated) merchant charges its card
// npm run cards -- raise <agent> <per purchase> [<per month>] [--reason text]
//                                                     the agent asks the CFO for a higher limit (a Face ID proposal)
// npm run cards -- poll                               record transactions Airwallex made that we have not seen yet
// npm run cards -- webhook                            subscribe the relay to Airwallex's card transaction webhooks; the
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
import { CARD_EVENTS, createWebhook, listWebhooks, WEBHOOK_SECRET_FILE } from "../airwallex/webhooks.js";
import { keyPath } from "../metal/agentCli.js";
import { relayConfig } from "../relay/config.js";

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
  const existing = (await listWebhooks(api)).find((w) => w.url === url);
  if (existing && existsSync(file)) {
    console.log(`already subscribed: ${existing.id} (${existing.events.join(", ")}); the secret is in the keys dir`);
    process.exit(0);
  }
  if (existing) { console.error(`a webhook for ${url} exists (${existing.id}) but its secret is not in the keys dir; delete it in the Airwallex web app and run this again`); process.exit(1); }
  const w = await createWebhook(api, { url, events: (process.env.AIRWALLEX_WEBHOOK_EVENTS ?? CARD_EVENTS.join(",")).split(","), version: process.env.AIRWALLEX_WEBHOOK_VERSION ?? "2025-11-11" });
  writeFileSync(file, w.secret + "\n", { mode: 0o600 });
  // The Worker's copy, through stdin like the relay token: never on a command line, never printed.
  const worker = resolve(import.meta.dirname, "../../worker");
  const r = spawnSync(resolve(worker, "node_modules/.bin/wrangler"), ["secret", "put", "AIRWALLEX_WEBHOOK_SECRET"], {
    cwd: worker, input: w.secret, env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, stdio: ["pipe", "inherit", "inherit"],
  });
  if (r.status !== 0) { console.error("the webhook exists and its secret is in the keys dir, but the Worker secret was not set; run this again"); process.exit(1); }
  console.log(`subscribed ${w.id} to ${w.events.join(", ")} (version ${w.version}); restart npm run relay so the runner checks them too`);
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
