// awx-1 live: the driver's deps on the Airwallex sandbox. The conductor (npm run awx-1 -- live) makes only the
// scenario's own calls; the runner (npm run relay, the same KIT11_DB) records the webhooks, starts the agent whose card
// was declined, and executes what Max approves with Face ID. The conductor waits for each in the ledger and records
// what did not come. Nothing here approves, retries or pays.

import { existsSync } from "node:fs";
import { AirwallexRest } from "../airwallex/adapter.js";
import { Airwallex, fromEnv } from "../airwallex/client.js";
import { issuingFor } from "../airwallex/issuing.js";
import { WEBHOOK_SECRET_FILE } from "../airwallex/webhooks.js";
import { audit } from "../audit/log.js";
import { approvalHint } from "../cli/hint.js";
import type { DB } from "../db/open.js";
import { keyPath } from "../metal/agentCli.js";
import { pollCardTransactions } from "../policy/cards.js";
import { RUN, type Awx1Deps } from "./scenario.js";

/** How long the conductor waits: for a webhook, for the CFO (a raise lives an hour, an invoice 20 minutes). */
export const WAIT = { webhookMs: 120_000, raiseMs: 60 * 60_000, invoiceMs: 20 * 60_000, pollMs: 2000 } as const;

/** Why the live run may not start, or [] when it may. Reads the environment and the files only; calls nothing. */
export function liveRefusals(env: NodeJS.ProcessEnv, o: { keysDirHasHookSecret: boolean }): string[] {
  const why: string[] = [];
  if (!env.AIRWALLEX_CLIENT_ID || !env.AIRWALLEX_API_KEY) why.push("AIRWALLEX_CLIENT_ID and AIRWALLEX_API_KEY must be set");
  if (!env.AIRWALLEX_CALL_BUDGET || !env.AIRWALLEX_CALL_LOG) why.push("AIRWALLEX_CALL_BUDGET (the number Max approved) and AIRWALLEX_CALL_LOG must be set");
  if (!/awx-1[^/]*\.sqlite$/.test(env.KIT11_DB ?? "")) why.push("KIT11_DB must be this world's own ledger (data/awx-1*.sqlite)");
  if (!/\/awx-1[^/]*$/.test(env.KIT11_KEYS_DIR ?? "")) why.push("KIT11_KEYS_DIR must be this world's own keys folder (…/awx-1*)");
  if (env.METAL_RPC_URL) why.push("METAL_RPC_URL must be unset: awx-1 makes no Metal call");
  if (env.KIT11_AGENTS !== "on") why.push("KIT11_AGENTS=on: the agents meet the declines and advise on the invoices");
  if (env.KIT11_AUTONOMY === "on") why.push("KIT11_AUTONOMY must be off: the autonomous loops reach Metal");
  if (env.KIT11_CARD_POLL_MS !== "off") why.push("KIT11_CARD_POLL_MS=off: the webhooks bring the card transactions");
  if (!o.keysDirHasHookSecret) why.push(`the Airwallex webhook secret is not in this world's keys folder (${WEBHOOK_SECRET_FILE}); without it the runner cannot check a webhook`);
  return why;
}

export const hookSecretInKeysDir = () => existsSync(keyPath(WEBHOOK_SECRET_FILE));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function liveDeps(db: DB, log: (line: string) => void): Awx1Deps {
  const cfg = fromEnv();
  if (!cfg) throw new Error("no Airwallex sandbox keys; nothing was called");
  const api = new Airwallex(cfg);
  const issuing = issuingFor(api, db);
  const awx = new AirwallexRest(api);
  const waitFor = async <T>(what: string, check: () => T | undefined, timeoutMs: number): Promise<T> => {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const v = check();
      if (v !== undefined) return v;
      if (Date.now() > until) throw new Error(`waited ${Math.round(timeoutMs / 1000)} s for ${what}; it did not happen`);
      await sleep(WAIT.pollMs);
    }
  };
  return {
    db, issuing, awx, log, agents: true,
    waitFor,
    awaitWebhooks: async (ids) => {
      const hooked = (id: string) => !!db.prepare("SELECT 1 FROM card_transactions WHERE transaction_id = ? AND source = 'webhook'").get(id);
      const transferHooked = (id: string) => !!db.prepare("SELECT 1 FROM airwallex_events WHERE object = 'transfer' AND object_id = ?").get(id);
      try {
        await waitFor(`Airwallex's webhooks for ${[...(ids.cardTransactions ?? []), ...(ids.transfers ?? [])].join(", ")}`,
          () => ((ids.cardTransactions ?? []).every(hooked) && (ids.transfers ?? []).every(transferHooked) ? true : undefined), WAIT.webhookMs);
      } catch (e) {
        // Recorded, never hidden: the card is polled once (a counted call), and check e will show the transaction came by poll.
        audit(db, "system", "awx1.webhook_missing", RUN, { run: RUN, ids, cause: (e as Error).message });
        log(`WEBHOOK MISSING  ${(e as Error).message}; polling the cards once`);
        if (ids.cardTransactions?.length) await pollCardTransactions(db, issuing);
      }
    },
    approve: async (id) => {
      const kind = (db.prepare("SELECT kind FROM proposals WHERE proposal_id = ?").get(id) as { kind: string } | undefined)?.kind;
      log(`FACE ID          ${approvalHint(db, id)}`);
      const done = await waitFor(`${id} to be decided and executed`, () => {
        const s = (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;
        return ["EXECUTED", "FAILED", "REJECTED", "EXPIRED", "NEEDS_REAPPROVAL", "SUPERSEDED"].includes(s) ? s : undefined;
      }, kind === "invoice_payment" ? WAIT.invoiceMs : WAIT.raiseMs);
      if (done !== "EXECUTED") throw new Error(`${id} ended ${done}`);
    },
  };
}
