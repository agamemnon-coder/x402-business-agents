// The agent API as an MCP server (P1). Any MCP client (a Claude agent, say) that is given this server works as one
// outside agent, under the name the person who set it up chose (KIT11_AGENT). Its tools only ask, pay within the
// card's limits, and read: no tool approves, sets a limit or touches another agent's card. Errors come back as tool
// errors in plain words, so the calling agent can tell its user what to do. A refusal (Purser's gate, or a charge
// Airwallex declined) also carries a structured object, in structuredContent and as a second text item, that says who
// refused and, for a limit decline, the next tool to call; the agent need not parse the sentence.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { IssuingSim } from "../airwallex/issuing.js";
import type { DB } from "../db/open.js";
import { redactJson, redactSecrets } from "../lib/redact.js";
import { askPurser } from "../agents/askPurser.js";
import type { Actor } from "../audit/log.js";
import { ClaudeReader } from "../claude/reader.js";
import { Tools } from "../claude/tools.js";
import { authorize, keyMatches } from "../policy/principals.js";
import { cardStatus, payWithCard, requestCardRaise, requestCompanyCard, type ExternalAgentId } from "./externalAgents.js";

const EUR = z.string().regex(/^\d{1,6}\.\d{2}$/, "an amount in EUR with two decimals, like 25.00");

type Structured = Record<string, unknown>;
type Text = { content: { type: "text"; text: string }[]; structuredContent?: Structured; isError?: boolean };
/** A result: the sentence first; with an object, the object too, as structuredContent and as JSON text. Redacted. */
function result(text: string, object?: Structured, isError?: true): Text {
  const o = object && redactJson(object);
  return {
    content: [{ type: "text", text: redactSecrets(text) }, ...(o ? [{ type: "text" as const, text: JSON.stringify(o) }] : [])],
    ...(o ? { structuredContent: o } : {}),
    ...(isError ? { isError } : {}),
  };
}
const ok = (text: string, object?: Structured): Text => result(text, object);
const fail = (e: unknown): Text => result(e instanceof Error ? e.message : String(e), undefined, true);
/** Purser's own refusal ("code: message", from the principal gate), with its code. */
function refused(denied: string): Text {
  const at = denied.indexOf(":");
  return result(denied, { refused: true, refused_by: "purser", code: denied.slice(0, at), message: denied.slice(at + 1).trim() }, true);
}
/** Only a charge over the card's limits can be helped by a higher limit; a frozen or closed card cannot. */
const NEXT_TOOL: Record<string, string> = { LIMIT_EXCEEDED: "request_limit_raise" };

export function agentApiServer(db: DB, id: ExternalAgentId, sim: IssuingSim | null, reader: ClaudeReader = new ClaudeReader(db), key: string | undefined = process.env.KIT11_AGENT_KEY): McpServer {
  // Each call is made as this agent's principal (backend review B5): it must hold the agent's current key (once one
  // was issued), be neither revoked nor expired, and have the tool among its capabilities.
  const gate = (tool: string): string | null =>
    keyMatches(db, id, key) ? authorize(db, id, { tool }) : `principal_key_invalid: this is not ${id}'s current key (it was rotated, or none was given); ask Northwind for the new key file`;
  const server = new McpServer({ name: "purser-agent-api", version: "1.0.0" }, {
    instructions: `You are connected to Northwind Outdoor's agent API as the outside agent ${id}. You can ask for a company card, pay merchants on it, ask for a higher limit, see your card, and ask Purser for a single-use card for one task (a flight, a hotel or a train). Every request is decided by Northwind's CFO with Face ID; the card's limits are enforced by Airwallex. You cannot approve anything yourself.`,
  });

  server.registerTool("request_company_card", {
    title: "Ask for a company card",
    description: "Ask Northwind's CFO for a virtual company card (Airwallex, EUR) with the limits you need. Nothing is issued until the CFO approves with Face ID; call company_card to see the outcome.",
    inputSchema: {
      display_name: z.string().min(1).max(60).describe("Your name as the CFO will see it, e.g. 'Acme Research agent'"),
      purpose: z.string().min(1).max(300).describe("What you will buy with the card"),
      per_purchase_eur: EUR.describe("Most you need per purchase, in EUR"),
      monthly_eur: EUR.describe("Most you need per month, in EUR"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (a) => {
    const denied = gate("request_company_card");
    if (denied) return refused(denied);
    try {
      const p = requestCompanyCard(db, id, { displayName: a.display_name, purpose: a.purpose, perTx: a.per_purchase_eur, monthly: a.monthly_eur });
      return ok(`Asked. ${p.proposal_id} waits for the CFO's Face ID until ${p.expires_at}. No card exists until then; call company_card to see when it is issued.`);
    } catch (e) {
      return fail(e);
    }
  });

  server.registerTool("company_card", {
    title: "My company card",
    description: "Your card request's state, and once issued: the card's last four digits, limits, this month's spend, whether it is frozen, and recent charges.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    const denied = gate("company_card");
    if (denied) return refused(denied);
    try {
      return ok(JSON.stringify(cardStatus(db, id), null, 2));
    } catch (e) {
      return fail(e);
    }
  });

  server.registerTool("pay_with_card", {
    title: "Pay a merchant with the company card",
    description: "Charge your company card. Airwallex approves or declines it against the card's limits (over the limit, or frozen by the CFO's emergency stop: declined). In this sandbox the merchant's charge is Airwallex's simulation.",
    inputSchema: {
      merchant: z.string().min(1).max(60).describe("Who you pay"),
      amount_eur: EUR.describe("The amount in EUR"),
      description: z.string().min(1).max(120).describe("What it is for"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (a) => {
    const denied = gate("pay_with_card");
    if (denied) return refused(denied);
    try {
      if (!sim) throw new Error("the Airwallex sandbox keys are not set on this server, so no card can be charged");
      const t = await payWithCard(db, sim, id, { merchant: a.merchant, amount: a.amount_eur, description: a.description });
      if (t.approved) {
        return ok(`Airwallex approved ${a.amount_eur} EUR at ${a.merchant} (transaction ${t.transactionId}).`,
          { approved: true, amount_eur: a.amount_eur, merchant: a.merchant, transaction_id: t.transactionId });
      }
      const reason = t.failureReason ?? t.status;
      const next = NEXT_TOOL[reason];
      return result(`Airwallex declined ${a.amount_eur} EUR at ${a.merchant}: ${reason}. If you need a higher limit, ask with request_limit_raise.`,
        { approved: false, refused_by: "airwallex", reason, amount_eur: a.amount_eur, merchant: a.merchant, ...(next ? { next_tool: next } : {}) }, true);
    } catch (e) {
      return fail(e);
    }
  });

  server.registerTool("request_limit_raise", {
    title: "Ask for a higher card limit",
    description: "Ask the CFO to raise your card's limit per purchase, per month, or both. Nothing changes until the CFO approves with Face ID.",
    inputSchema: {
      per_purchase_eur: EUR.optional().describe("New most per purchase, in EUR"),
      monthly_eur: EUR.optional().describe("New most per month, in EUR"),
      reason: z.string().min(1).max(300).describe("Why you need it"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (a) => {
    const denied = gate("request_limit_raise");
    if (denied) return refused(denied);
    try {
      const p = requestCardRaise(db, id, { perTx: a.per_purchase_eur, monthly: a.monthly_eur }, a.reason);
      return ok(`Asked. ${p.proposal_id} waits for the CFO's Face ID until ${p.expires_at}.`);
    } catch (e) {
      return fail(e);
    }
  });

  server.registerTool("ask_for_task_card", {
    title: "Ask Purser for a card for one task",
    description: "Ask, in plain words, for a single-use card for one flight, hotel or train, with the most it may cost (for example: 'a train ticket to Antwerp on 12 November, at most €40'). It becomes a proposal the CFO approves with Face ID; you never get a card at once.",
    inputSchema: { message: z.string().min(1).max(500).describe("What you need, the most it may cost in EUR, and the day") },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (a) => {
    const denied = gate("ask_for_task_card");
    if (denied) return refused(denied);
    try {
      const r = await askPurser(db, new Tools(db, reader), a.message, new Date(), { asker: id as Actor });
      return ok(r.reply);
    } catch (e) {
      return fail(e);
    }
  });

  return server;
}
