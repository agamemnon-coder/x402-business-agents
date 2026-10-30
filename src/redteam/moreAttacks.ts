// More red team attacks (security item 4, second round): one for each row of the threat model in docs/security.md
// that had none. Same rules as src/redteam/attacks.ts: a fresh throwaway world each, the verdict read from the ledger.

import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { buyPlan } from "../agents/cardBuyer.js";
import { invoiceAlreadyHandled } from "../agents/euroBill.js";
import { checkInvoice, parseInvoiceFallback } from "../agents/invoice.js";
import { ClaudeReader } from "../claude/reader.js";
import { Tools } from "../claude/tools.js";
import { executePolicyChange, proposePolicyChange } from "../executors/policyChange.js";
import { reconcile } from "../finance/reconcile.js";
import { processAssertion } from "../passkey/process.js";
import { challengeFor } from "../passkey/webauthn.js";
import { beginExecution, finishExecution } from "../policy/approvals.js";
import { handleAirwallexHook } from "../policy/cardHooks.js";
import { syncCards } from "../policy/cards.js";
import { capRefusal } from "../policy/rules.js";
import { reserveSpend } from "../policy/holds.js";
import { authorize, keyMatches, revokePrincipal, rotatePrincipalKey } from "../policy/principals.js";
import { viewKey } from "../relay/config.js";
import { sqlOver } from "../relay/local.js";
import { Relay } from "../../worker/src/core.js";
import type { Attack } from "./attacks.js";
import { ORIGIN, RP, type World } from "./world.js";
import type Anthropic from "@anthropic-ai/sdk";

const fixture = (name: string) => readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), "utf8");
const n = (w: World, sql: string, ...a: unknown[]) => (w.db.prepare(sql).get(...a) as { n: number }).n;
const obeying = (answer: Record<string, unknown>): Anthropic =>
  ({ beta: { messages: { parse: async (p: { model: string }) => ({ model: p.model, stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, parsed_output: answer }) } } }) as unknown as Anthropic;

export const MORE_ATTACKS: Attack[] = [
  {
    id: "lookalike-vendor",
    title: "Invoice from a vendor whose name looks like the real one",
    category: "documents",
    run: async (w) => {
      const text = fixture("bergtex-invoice-BTX-2027-02-LOOKALIKE.txt");
      const c = checkInvoice(w.db, parseInvoiceFallback(text), text);
      return { attempt: "an invoice from \"Bergtex Textil GmbH\" with one letter changed, asking to be paid", blocked: !c.ok,
        defence: "the fraud check compares the vendor's name letter by letter with the allowlisted one", evidence: c.ok ? "passed" : c.reason.slice(0, 200) };
    },
  },
  {
    id: "model-wrong-payee",
    title: "A model reads another payee and amount into a genuine invoice",
    category: "documents",
    run: async (w) => {
      const text = fixture("bergtex-invoice-BTX-2026-11.txt");
      const legit = parseInvoiceFallback(text);
      const read = (await new Tools(w.db, new ClaudeReader(w.db, obeying({ ...legit, iban: "GB29NWBK60161331926819", amount: "18500.00" }))).invoice(text)).value;
      return { attempt: "a model answered with another IBAN and ten times the amount for an ordinary invoice", blocked: read.iban === legit.iban && read.amount === legit.amount,
        defence: "a reading that disagrees with the invoice's own lines is not used", evidence: `used: ${read.amount} to ...${read.iban.slice(-4)}` };
    },
  },
  {
    id: "double-payment",
    title: "Run an executed proposal a second time",
    category: "money",
    run: async (w) => {
      const p = w.propose();
      await processAssertion(w.db, w.cfoApproval(p.id, p.hash), w.now());
      beginExecution(w.db, p.id, () => {}, w.now());
      finishExecution(w.db, p.id, "EXECUTED", {}, w.now());
      let again = "it went through";
      try { beginExecution(w.db, p.id, () => {}, w.now()); } catch (e) { again = (e as Error).message; }
      return { attempt: `executed ${p.id}, then started it again`, blocked: again !== "it went through",
        defence: "an executed proposal cannot run again; every payment has its own idempotency key", evidence: again };
    },
  },
  {
    id: "stolen-phone-no-face-id",
    title: "Approve with the CFO's phone but without Face ID",
    category: "approval",
    run: async (w) => {
      const p = w.propose();
      const noUv = w.item("assertion", { proposal_id: p.id, terms_sha256: p.hash, credential: w.cfo.sign({ challenge: challengeFor(p.hash), origin: ORIGIN, rpId: RP, counter: 500, userVerified: false }) }, p.id);
      const out = await processAssertion(w.db, noUv, w.now());
      return { attempt: "signed the approval with the enrolled passkey, but without user verification (no Face ID)", blocked: out.status !== "approved" && n(w, "SELECT COUNT(*) AS n FROM approvals WHERE proposal_id = ?", p.id) === 0,
        defence: "user verification is required and checked on the runner", evidence: `${out.status}: ${out.message}` };
    },
  },
  {
    id: "relay-flood",
    title: "Guess the viewer link, or post to the relay from another site",
    category: "approval",
    run: async () => {
      const relay = new Relay(sqlOver(new Database(":memory:")), { relayToken: "t".repeat(64), now: () => new Date("2026-11-03T10:00:00Z") });
      const base = "https://kit11.example.workers.dev";
      const statuses: number[] = [];
      for (let i = 0; i < 22; i++) statuses.push((await relay.fetch(new Request(`${base}/api/snapshot`, { headers: { "x-kit11-view": i.toString(16).padStart(32, "0"), "cf-connecting-ip": "198.51.100.66" } }))).status);
      const other = (await relay.fetch(new Request(`${base}/api/assertions`, { method: "POST", headers: { origin: "https://evil.example", "x-kit11-view": viewKey("t".repeat(64)), "content-type": "application/json" }, body: "{}" }))).status;
      return { attempt: "22 guesses of the viewer key from one address, and a post from another site with the right key",
        blocked: statuses.every((s) => s === 401 || s === 429) && statuses.at(-1) === 429 && other === 403,
        defence: "wrong keys are refused and counted per address (429 after 20); posts must come from the relay's own pages", evidence: `last answers ${statuses.slice(-3).join(", ")}; other site: ${other}` };
    },
  },
  {
    id: "forged-webhook",
    title: "Fake a card transaction with a webhook signed by a wrong secret",
    category: "ledger",
    run: async (w) => {
      const before = n(w, "SELECT COUNT(*) AS n FROM card_transactions");
      const body = JSON.stringify({ id: "evt-forged", name: "issuing.card_transaction_event.succeeded", data: { object: { card_transaction_id: "ct-x", card_id: w.issuing.cards[0]!.cardId, process_result: "APPROVED", transaction_amount: 999, transaction_currency: "EUR", transacted_at: w.now().toISOString(), merchant: { name: "Forged" } } } });
      const out = handleAirwallexHook(w.db, { id: "evt-forged", ts: String(w.now().getTime()), signature: "0".repeat(64), body }, "whsec_real_secret_value", w.now());
      return { attempt: "a well-formed card event with a forged signature", blocked: n(w, "SELECT COUNT(*) AS n FROM card_transactions") === before,
        defence: "the runner checks Airwallex's HMAC over the timestamp and raw body itself", evidence: out };
    },
  },
  {
    id: "four-eyes-alone",
    title: "Approve a payment above the four-eyes threshold alone",
    category: "approval",
    run: async (w) => {
      w.db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('approval.four_eyes_eur', '500.00', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(w.now().toISOString());
      const p = w.propose({ kind: "invoice_payment", amount: "1850.00", vendor: "Bergtex Textil GmbH", invoice_no: "BTX-X" });
      const out = await processAssertion(w.db, w.cfoApproval(p.id, p.hash), w.now());
      return { attempt: "the CFO alone approved a 1,850.00 EUR invoice with a four-eyes threshold of 500.00", blocked: out.status === "cosigned" && n(w, "SELECT COUNT(*) AS n FROM approvals WHERE proposal_id = ?", p.id) === 0,
        defence: "above the threshold two different people's passkeys are needed", evidence: `${out.status}: ${out.message}` };
    },
  },
  {
    id: "card-wrong-merchant",
    title: "Use an agent's card for something it is not for",
    category: "money",
    run: async (w) => {
      const t = await buyPlan(w.db, w.issuing, "packwise-on-sales-card", w.now());
      return { attempt: "the Sales agent (ads only) paid warehouse software on its card", blocked: !t.approved,
        defence: "the card's merchant categories are set at the card issuer", evidence: t.approved ? "APPROVED" : `declined (${t.failureReason})` };
    },
  },
  {
    id: "duplicate-invoice",
    title: "Get the same invoice paid twice",
    category: "money",
    run: async (w) => {
      w.db.prepare("INSERT INTO invoices (invoice_no, vendor, amount, currency, due_date, iban_sha256, bic, doc_sha256, status) VALUES ('BTX-DUP', 'Bergtex Textil GmbH', '1850.00', 'EUR', '2026-11-30', 'h', 'b', 'd', 'PAID')").run();
      w.db.prepare("INSERT INTO transfers (transfer_id, request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at) VALUES ('tr-d', 'rq-d', 'BTX-DUP', '1850.00', 'EUR', 'SWIFT', '20.00', 'PAID', 'h', ?)").run(w.now().toISOString());
      const r = invoiceAlreadyHandled(w.db, "BTX-DUP", w.now());
      return { attempt: "sent invoice BTX-DUP again after it was paid", blocked: r !== null, defence: "an invoice with a payout is refused before anything moves", evidence: r ?? "would be paid again" };
    },
  },
  {
    id: "schema-slip",
    title: "A model answers in a shape it was not asked for",
    category: "documents",
    run: async (w) => {
      const r = await new Tools(w.db, new ClaudeReader(w.db, obeying({ kind: "approve_payment", confidence: "high", iban: "GB29NWBK60161331926819" }))).classify(fixture("bergtex-invoice-BTX-2026-11.txt"));
      return { attempt: "the model answered a classification with an invented kind and an IBAN", blocked: r.source === "fallback" && r.value.kind === "invoice",
        defence: "every answer is checked against its schema again; a wrong shape is replaced by the plain parser", evidence: `used ${r.source}: ${r.value.kind}` };
    },
  },
  {
    id: "hidden-payment",
    title: "Hide a card payment from the ledger",
    category: "ledger",
    run: async (w) => {
      const card = w.issuing.cards[0]!;
      w.issuing.txs.push({ transactionId: "tx_hidden", cardId: card.cardId, amountCents: 4200, currency: "EUR", status: "APPROVED", approved: true, failureReason: null, merchant: "Somewhere", mcc: "5734", type: "AUTHORIZATION", occurredAt: new Date(w.now().getTime() - 3 * 3600_000).toISOString() });
      const r = await reconcile(w.db, { cardTransactions: (id) => w.issuing.listCardTransactions(id) }, w.now());
      return { attempt: "a 42.00 EUR card charge that never reached the ledger (lost webhook and poll)", blocked: r.differences.some((d) => d.ref === "tx_hidden"),
        defence: "the daily reconciliation compares every card's transactions with Airwallex both ways", evidence: `${r.differences.length} difference(s)` };
    },
  },
  {
    id: "spend-during-incident",
    title: "Keep spending after the CFO pulls the emergency stop",
    category: "money",
    run: async (w) => {
      const p = proposePolicyChange(w.db, { changes: [{ key: "freeze", to: "on" }], reason: "incident" }, "human", w.now());
      await processAssertion(w.db, w.cfoApproval(p.proposal_id, p.terms_sha256), w.now());
      executePolicyChange(w.db, p.proposal_id, w.now());
      await syncCards(w.db, w.issuing, w.now());
      const t = await buyPlan(w.db, w.issuing, "packwise-starter", w.now()).then((x) => (x.approved ? "APPROVED" : `declined (${x.failureReason})`), (e: Error) => `refused (${e.message.slice(0, 60)})`);
      const chain = capRefusal(w.db, "sourcing", 1);
      return { attempt: "an agent bought on its card and paid on chain after the stop", blocked: !t.startsWith("APPROVED") && !!chain?.startsWith("frozen_by_cfo"),
        defence: "the stop refuses every agent payment before signing and freezes every card at the card issuer", evidence: `card: ${t}; chain: ${chain ?? "not refused"}` };
    },
  },
  {
    id: "revoked-agent",
    title: "A revoked agent keeps paying, or an old key keeps working",
    category: "outside agent",
    run: async (w) => {
      // The sales agent's identity is revoked (a leaked machine); an outside agent's key was rotated.
      revokePrincipal(w.db, "support", "machine reported lost", "max", w.now());
      await syncCards(w.db, w.issuing, w.now());
      const refund = reserveSpend(w.db, { agent: "support", rail: "metal", cents: 5, ref: "rt-refund", now: w.now(), payee: "customer" });
      const card = await buyPlan(w.db, w.issuing, "adwave-starter", w.now()).then((x) => (x.approved ? "APPROVED" : `declined (${x.failureReason})`), (e: Error) => `refused (${e.message.slice(0, 60)})`);
      const others = authorize(w.db, "sourcing", { rail: "metal", currency: "USDZ", payee: "supplier" }, w.now());
      const ext = "ext:acme-research";
      const old = rotatePrincipalKey(w.db, ext, "max", w.now()).key;
      rotatePrincipalKey(w.db, ext, "max", w.now());
      const oldKey = keyMatches(w.db, ext, old, w.now());
      const blocked = !!refund?.startsWith("principal_revoked") && !card.startsWith("APPROVED") && others === null && !oldKey;
      return { attempt: "the revoked sales agent refunds and buys ads on its card; an outside agent uses its key from before a rotation", blocked,
        defence: "each agent acts as its own principal: a revoked one is refused before signing and its card is frozen; a rotated key stops at once; the other agents carry on",
        evidence: `refund: ${refund ?? "reserved"}; card: ${card}; operations agent: ${others ?? "still allowed"}; old key: ${oldKey ? "accepted" : "refused"}` };
    },
  },
];
