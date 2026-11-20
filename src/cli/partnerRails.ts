// npm run partner-rails -- live: T:0 at every payment, and each agent's payment credential as a token, run live in the
// sandboxes (21 Nov, the owner: "real purpose and depth on the partner APIs"). Test money only, small amounts.
//
//   1. Each of two agents (sourcing, support) gets a Purser token bound to a mandate made from the CFO's policy for it
//      and its own Airwallex Issuing card (a Visa card, sandbox). The card drill's cards of 20 Nov are adopted, as they
//      are at Airwallex (frozen by default).
//   2. Four payments, each booked in T:0 the moment it settles (src/accounting/t0Payments.ts), one entry each:
//      a. the sourcing agent's token pays EUR 1.00 for warehouse software: the card's window opens for that one
//         charge (the merchant's charge is the sandbox's simulation endpoint), Airwallex approves, the card refreezes;
//      b. the support agent's token pays EUR 1.25 for helpdesk software, the same way;
//      c. the Payer agent pays a Stockline invoice of EUR 1.00 by Airwallex transfer to the sandbox beneficiary of the
//         main runs, within the CFO's limit to pay alone (the rule /try's test companies run under, TRY_ALONE_LIMIT;
//         every other company needs the CFO's Face ID), settled by the sandbox's simulation (SENT, then PAID);
//      d. the sourcing agent pays 0.05 test USD on Alta testnet under its own mandate (cap 0.10, budget 0.20, one
//         payee), bound on chain by the owner's key in a test world of its own.
//   3. The token refused outside its mandate, before any call to Airwallex: over the limit a purchase, another
//      merchant category. Then the support agent is revoked: its token is revoked with it and refused; and whoever
//      holds the card's number instead meets a frozen card: Airwallex declines CARD_INACTIVE.
//   4. The reconcile check: each T:0 entry read back from T:0 against the rail's own record read back from the rail.
//   Writes docs/runs/<date>-partner-rails.json and .md (RUN_OUT names another stem). `--md` writes the .md again from
//   the .json, with no network.
//
// Needs PARTNER_RAILS_GO=yes, the Airwallex sandbox key pair, T0_API_KEY and METAL_RPC_URL (an Alta testnet RPC). Its
// ledger and keys live in KIT11_KEYS_DIR (default ../x402-business-agents-keys/partner-rails), never in this repo.
// Budgets: AIRWALLEX_MAX calls (default 45), T0_MAX calls (default 40), ALTA_MAX transactions (default 8). Nothing
// secret is printed or written: no key, no token (its last four only), no card number (its last four only).

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { partnerRailsMarkdown, type PartnerRailsRecord } from "../proof/partnerRailsMd.js";

const OUT_DIR = resolve(process.env.RUN_OUT_DIR ?? resolve(import.meta.dirname, "../../docs/runs"));
const STEM = process.env.RUN_OUT ?? `${new Date().toISOString().slice(0, 10)}-partner-rails`;
if (process.argv.includes("--md")) {
  const rec = JSON.parse(readFileSync(resolve(OUT_DIR, `${STEM}.json`), "utf8")) as PartnerRailsRecord;
  writeFileSync(resolve(OUT_DIR, `${STEM}.md`), partnerRailsMarkdown(rec));
  console.log(`WROTE ${STEM}.md`);
  process.exit(0);
}
if (process.argv[2] !== "live") { console.error("usage: npm run partner-rails -- live | --md"); process.exit(2); }

const refuse = (why: string) => { console.error(`REFUSED  ${why}; nothing was sent`); process.exit(2); };
if (process.env.PARTNER_RAILS_GO !== "yes") refuse("PARTNER_RAILS_GO=yes (the go for this run's sandbox and testnet calls) is not set");
if (!process.env.AIRWALLEX_CLIENT_ID || !process.env.AIRWALLEX_API_KEY) refuse("the Airwallex sandbox key pair is not set");
if (process.env.AIRWALLEX_PLATFORM === "on" || process.env.AIRWALLEX_OAUTH === "on") refuse("AIRWALLEX_PLATFORM and AIRWALLEX_OAUTH must be off (the sandbox key pair only)");
if (!process.env.T0_API_KEY) refuse("T0_API_KEY is not set");
const rpc = process.env.METAL_RPC_URL ?? "";
try { if (!new URL(rpc).hostname.includes("testnet")) refuse("METAL_RPC_URL is not an Alta testnet RPC"); } catch { refuse("METAL_RPC_URL is not a URL"); }
// This run books its own payments itself; the runner's background sink stays out of it.
for (const k of ["T0_ENABLED", "T0_PAYMENTS", "KIT11_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY"]) delete process.env[k];
process.env.KIT11_KEYS_DIR ??= resolve(import.meta.dirname, "../../../x402-business-agents-keys/partner-rails");

const { getAddress, parseEventLogs } = await import("viem");
type Address = import("viem").Address;
type Hex = import("viem").Hex;
const { keyPath, keysDir, metalAgent, field } = await import("../metal/agentCli.js");
const { plainKey } = await import("../metal/keyFiles.js");
const { publicClient, transferUsdz, usdzBalance } = await import("../metal/chain.js");
const { CHAIN_ID, EXPLORER_TX } = await import("../metal/network.js");
const { mandateBindingAbi } = await import("@metalntwx/metal-pay/mandates");
const { baseUnitsToCents, centsToBaseUnits, fromCents } = await import("../lib/money.js");
const { redactSecrets } = await import("../lib/redact.js");
const { openDb } = await import("../db/open.js");
const { Airwallex, SANDBOX_BASE } = await import("../airwallex/client.js");
const { IssuingRest } = await import("../airwallex/issuing.js");
const { storeCard, cardOf } = await import("../policy/cards.js");
const { issueToken, payWithToken, tokenView } = await import("../policy/agentTokens.js");
const { revokePrincipal } = await import("../policy/principals.js");
const { T0Client } = await import("../accounting/t0.js");
const { bookPayment, paymentContext, reconcileBookings } = await import("../accounting/t0Payments.js");
type SettledPayment = import("../accounting/t0Payments.js").SettledPayment;
type T0Booking = import("../accounting/t0Payments.js").T0Booking;
type RailReading = import("../accounting/t0Payments.js").RailReading;
const { TRY_ALONE_LIMIT } = await import("../config/policy.js");
const { jcs } = await import("@metalntwx/metal-pay/mandates");

const say = (s: string) => console.log(redactSecrets(s));
const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const STARTED = new Date();
const dir = keysDir();
const db = openDb(resolve(dir, "ledger.sqlite"));

// ---- Budgets: every call counted, none over ----
const AWX_MAX = Number(process.env.AIRWALLEX_MAX ?? 45), T0_MAX = Number(process.env.T0_MAX ?? 40), ALTA_MAX = Number(process.env.ALTA_MAX ?? 8);
const calls = { airwallex: 0, t0: 0, alta_txs: 0 };
const counted = (k: "airwallex" | "t0", max: number): typeof fetch => (async (...a: Parameters<typeof fetch>) => {
  if (++calls[k] > max) throw new Error(`${k} call budget of ${max} reached; stopped`);
  return fetch(...a);
}) as typeof fetch;
const api = new Airwallex({ clientId: process.env.AIRWALLEX_CLIENT_ID, apiKey: process.env.AIRWALLEX_API_KEY, baseUrl: SANDBOX_BASE, fetchImpl: counted("airwallex", AWX_MAX) });
const issuing = new IssuingRest(api);
const t0 = new T0Client({ apiKey: process.env.T0_API_KEY!, fetch: counted("t0", T0_MAX), retryDelayMs: 2000 });
const altaTx = () => { if (++calls.alta_txs > ALTA_MAX) throw new Error(`Alta transaction budget of ${ALTA_MAX} reached; stopped`); };

const rec: PartnerRailsRecord = {
  run: STEM, mode: "live", started_at: STARTED.toISOString(), finished_at: "",
  code: (() => { try { return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { encoding: "utf8" }).trim(); } catch { return "unknown"; } })(),
  code_clean: (() => { try { return execFileSync("git", ["status", "--porcelain", "--", "src", "cloud/src"], { encoding: "utf8" }).trim() === ""; } catch { return false; } })(),
  labels: {
    test_money: true,
    airwallex: "Airwallex sandbox (api.sandbox.airwallex.com): test money; card charges are the sandbox's simulation endpoint (no merchant charged anything); the transfer is settled by the sandbox's simulation (SENT, then PAID)",
    alta: `Alta (formerly Metal) testnet, chain id ${CHAIN_ID}: test USD (*USDZ)`,
    t0: "T:0's shared sandbox entity (\"T:0 Sandbox\", USD), through its customer API: other teams' entries are in it too",
    token: "A Purser token per agent, bound to a mandate from the CFO's policy and to the agent's own Airwallex Issuing card (a Visa card, sandbox). Not a Visa network token: no Visa Token Service or Airi credential was made in this run",
  },
  tokens: [], payments: [], refusals: [], revoke: null, reconcile: null, calls, checks: [], notes: [],
};
// A note the person running it gives the record (an earlier pass, say), word for word.
if (process.env.PARTNER_RAILS_NOTE) rec.notes.push(redactSecrets(process.env.PARTNER_RAILS_NOTE).slice(0, 800));
const save = () => { rec.finished_at = new Date().toISOString(); writeFileSync(resolve(OUT_DIR, `${STEM}.json`), JSON.stringify(rec, null, 2) + "\n"); writeFileSync(resolve(OUT_DIR, `${STEM}.md`), partnerRailsMarkdown(rec)); };

// The T:0 context once: its accounts for the codes these payments use, its functional currency, the day's EUR rate.
const rateRow = await api.call<{ rate: number | string; rate_details?: { level: string; rate: number }[]; created_at?: string }>("GET", "/fx/rates/current", undefined, { buy_currency: "USD", sell_currency: "EUR", sell_amount: "100.00" });
const eurUsd = Number(rateRow.rate_details?.find((d) => d.level === "CLIENT")?.rate ?? rateRow.rate);
if (!(eurUsd > 0.5 && eurUsd < 2)) throw new Error(`the Airwallex sandbox's EUR to USD rate is not plausible: ${eurUsd}`);
rec.notes.push(`EUR to USD for T:0's functional currency: ${eurUsd} (the Airwallex sandbox's client rate, GET /fx/rates/current, ${rateRow.created_at ?? STARTED.toISOString()}); each entry keeps the EUR amount beside it.`);
const ctx = await paymentContext(t0, ["6100", "5000", "1200", "1210"], (_d, cur) => (cur === "EUR" ? eurUsd : undefined), { sandboxMap: true });
say(`T:0: functional ${ctx.functional}; accounts ${[...ctx.accounts].map(([c, a]) => `${c}->${a.number}`).join(", ")}`);

/** Books a settled payment in T:0 at once, and keeps how long after the rail's answer it was there. */
async function bookNow(key: string, p: SettledPayment, settledAt: Date, extra: Record<string, unknown>): Promise<T0Booking> {
  const out = await bookPayment(db, t0, p, ctx);
  const ms = Date.parse(out.booking.booked_at) - settledAt.getTime();
  rec.payments.push({ key, ...extra, rail: p.rail, rail_ref: p.rail_ref, amount: p.amount, currency: p.currency, agent: p.agent, terms_sha256: p.terms_sha256, counterparty: p.counterparty, description: p.description,
    gl_account: out.booking.gl_account, cost_centre: out.booking.cost_centre, settled_at: settledAt.toISOString(),
    t0: { status: out.status, t0_id: out.booking.t0_id, je_number: out.booking.je_number, booked_at: out.booking.booked_at, ms_after_settled: ms, t0_account: out.booking.t0_account, functional: out.booking.functional } } as never);
  say(`T0       ${key}: booked ${out.booking.t0_id} (${out.booking.je_number}) ${ms} ms after the rail settled; GL ${out.booking.gl_account} -> T:0 ${out.booking.t0_account}, ${out.booking.cost_centre}`);
  return out.booking;
}

try {
  // ---- 1. The agents' cards (adopted from the card drill of 20 Nov) and their tokens ----
  const DRILL: Record<string, string> = { sourcing: "29c779e4-907b-43e5-b420-2f5cffc1ac58", support: "71fa14e1-42be-4da3-9329-cdc15f2b5f65" };
  const tokens: Record<string, string> = {};
  for (const [agent, cardId] of Object.entries(DRILL)) {
    const card = await issuing.getCard(cardId);
    if (card.status !== "INACTIVE") throw new Error(`the ${agent} agent's card is ${card.status} at Airwallex, not frozen; stopped`);
    storeCard(db, agent, card, new Date());
    const t = issueToken(db, agent, new Date(), "partner-rails run");
    tokens[agent] = t.token;
    rec.tokens.push({ agent, token_id: t.token_id, token_last4: t.token.slice(-4), card_last4: t.mandate.card_last4, card_status_at_airwallex: card.status, mandate: t.mandate, mandate_sha256: t.mandate_sha256, status_at_end: "active" } as never);
    say(`TOKEN    ${agent}: ${t.token_id} (…${t.token.slice(-4)}) bound to card ••${t.mandate.card_last4}, EUR ${fromCents(t.mandate.per_purchase_cents)} a purchase, EUR ${fromCents(t.mandate.monthly_cents)} a month, MCC ${t.mandate.mccs.join(",")}`);
  }

  // ---- 2a, 2b. Token payments within the mandate, each booked in T:0 at once ----
  const cardBuys = [
    { key: "a", agent: "sourcing", amountCents: 100, merchant: "Packwise", mcc: "5734", cc: "CC100", what: "warehouse software" },
    { key: "b", agent: "support", amountCents: 125, merchant: "Replyhub", mcc: "7372", cc: "CC200", what: "helpdesk software" },
  ];
  const cardTx: Record<string, { cardId: string; txId: string }> = {};
  for (const b of cardBuys) {
    const r = await payWithToken(db, issuing, tokens[b.agent]!, { amountCents: b.amountCents, currency: "EUR", merchant: b.merchant, mcc: b.mcc }, new Date(), `${b.merchant}, ${b.what}, paid with the ${b.agent} agent's token`);
    if (!r.ok) throw new Error(`the ${b.agent} agent's token was refused within its mandate: ${r.code} ${r.why}`);
    const settled = new Date();
    if (!r.tx.approved) throw new Error(`Airwallex declined the ${b.agent} agent's purchase: ${r.tx.failureReason ?? r.tx.status}`);
    cardTx[b.key] = { cardId: r.tx.cardId, txId: r.tx.transactionId };
    const after = cardOf(db, b.agent)!;
    rec.checks.push({ key: `${b.key}_card_refrozen`, ok: after.status === "INACTIVE", detail: `the ${b.agent} agent's card after the purchase: ${after.status}` });
    const amount = fromCents(b.amountCents);
    await bookNow(b.key, {
      id: `partner-rails-${b.key}-${r.tx.transactionId}`, at: settled.toISOString(), rail: "airwallex_card", rail_ref: r.tx.transactionId, amount, currency: "EUR",
      agent: b.agent, terms_sha256: r.mandate_sha256, counterparty: b.merchant, description: `${b.merchant}: ${b.what}, paid with the ${b.agent} agent's token ${r.token_id}`,
      lines: [{ account: "6100", debit_cents: b.amountCents, credit_cents: 0, cost_centre: b.cc }, { account: "1200", debit_cents: 0, credit_cents: b.amountCents, cost_centre: null }],
    }, settled, { what: `the ${b.agent} agent's token pays ${b.merchant} EUR ${amount} (${b.what}, MCC ${b.mcc})`, token_id: r.token_id, airwallex_status: r.tx.status, card_last4: cardOf(db, b.agent)!.last4, terms_what: "the token's mandate (SHA-256)" });
  }

  // ---- 2c. The Payer agent's Airwallex transfer, within the CFO's limit to pay alone ----
  const transferCents = 100;
  if (TRY_ALONE_LIMIT.currency !== "EUR" || transferCents > Math.round(Number(TRY_ALONE_LIMIT.amount) * 100)) throw new Error("the transfer is not within the CFO's limit to pay alone");
  const BENEFICIARY = "46c2bbca-8b37-4ac9-ad3e-ef975dd35eeb";
  const terms = { kind: "invoice_payment", payee: "Stockline Data GmbH", beneficiary_id: BENEFICIARY, invoice: "SLL-T0-1121", amount: fromCents(transferCents), currency: "EUR", rail: "airwallex_transfer",
    authority: `the Payer agent within the CFO's limit to pay alone (EUR ${TRY_ALONE_LIMIT.amount}, src/config/policy.ts TRY_ALONE_LIMIT)`, run: `${STEM} started ${STARTED.toISOString()}` };
  const termsSha = sha256(jcs(terms as never));
  const h = termsSha.slice(0, 32);
  const requestId = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
  const bal = await api.call<{ currency: string; available_amount: number }[]>("GET", "/balances/current");
  if ((bal.find((x) => x.currency === "EUR")?.available_amount ?? 0) < transferCents / 100) throw new Error("the sandbox's EUR balance is too low");
  const created = await api.call<{ id: string; status: string }>("POST", "/transfers/create", {
    request_id: requestId, beneficiary_id: BENEFICIARY, transfer_amount: transferCents / 100, transfer_currency: "EUR", source_currency: "EUR", transfer_method: "SWIFT",
    reference: "SLL-T0-1121", reason: "goods_purchased", metadata: { approval_sha256: termsSha },
  });
  say(`AWX      transfer ${created.id} ${created.status}`);
  // The sandbox's simulation moves it on; an answer lost on the way (it happened, 20 Nov) is settled by reading it back.
  const { AirwallexAmbiguous } = await import("../airwallex/client.js");
  const moveTo = async (to: "SENT" | "PAID"): Promise<{ id: string; status: string }> => {
    try { return await api.call<{ id: string; status: string }>("POST", `/simulation/transfers/${encodeURIComponent(created.id)}/transition`, { next_status: to }); } catch (e) { if (!(e instanceof AirwallexAmbiguous)) throw e; }
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const t = await api.call<{ id: string; status: string }>("GET", `/transfers/${encodeURIComponent(created.id)}`);
      if (t.status === to || (to === "SENT" && t.status === "PAID")) { rec.notes.push(`The sandbox did not answer the move of transfer ${created.id} to ${to}; read back, it was ${t.status}.`); return t; }
    }
    throw new Error(`the sandbox transfer ${created.id} did not reach ${to}`);
  };
  await moveTo("SENT");
  const paid = await moveTo("PAID");
  const settledC = new Date();
  if (paid.status !== "PAID") throw new Error(`the sandbox transfer is ${paid.status}, not PAID`);
  await bookNow("c", {
    id: `partner-rails-c-${created.id}`, at: settledC.toISOString(), rail: "airwallex_transfer", rail_ref: created.id, amount: fromCents(transferCents), currency: "EUR",
    agent: "payer", terms_sha256: termsSha, counterparty: "Stockline Data GmbH", description: "Stockline Data GmbH invoice SLL-T0-1121, paid by the Payer agent within the CFO's limit to pay alone",
    lines: [{ account: "5000", debit_cents: transferCents, credit_cents: 0, cost_centre: "CC300" }, { account: "1200", debit_cents: 0, credit_cents: transferCents, cost_centre: null }],
  }, settledC, { what: `the Payer agent pays Stockline Data GmbH EUR ${fromCents(transferCents)} by Airwallex transfer, within the CFO's limit to pay alone`, request_id: requestId, terms, terms_what: "the payment's terms (SHA-256 of their canonical JSON), also in the transfer's metadata.approval_sha256" });

  // ---- 2d. The sourcing agent's payment on Alta testnet, under its own mandate ----
  const pc = publicClient();
  if ((await pc.getChainId()) !== CHAIN_ID) throw new Error("the RPC is not Alta testnet");
  const owner = plainKey("owner.key.json");
  const payee = plainKey("payee.key.json");
  const donor = resolve(dir, "../alta-refusals-1120/owner.key.json");
  if ((await usdzBalance(owner.address)) < centsToBaseUnits(40)) {
    if (!existsSync(donor)) throw new Error("no test money for the owner");
    altaTx();
    const tx = await transferUsdz(donor, owner.address, centsToBaseUnits(60));
    rec.notes.push(`Test money for this world's owner: 0.60 *USDZ from the 20 Nov refusals world's owner (${EXPLORER_TX}${tx}).`);
  }
  const acct = metalAgent(["account", "create", "--key", keyPath("owner.key.json")]);
  const account = getAddress(field(acct, "account")) as Address;
  if (acct.fields.get("transaction")?.[0]) { altaTx(); rec.notes.push(`The owner's Alta account ${account} was created (${EXPLORER_TX}${acct.fields.get("transaction")![0]}).`); }
  if ((await usdzBalance(account)) < centsToBaseUnits(20)) {
    altaTx();
    const tx = await transferUsdz(keyPath("owner.key.json"), account, centsToBaseUnits(30));
    rec.notes.push(`The account was funded with 0.30 *USDZ (${EXPLORER_TX}${tx}).`);
  }
  const cred = keyPath("sourcing.credential.json"), credKey = keyPath("sourcing.credential.key.json");
  if (!existsSync(cred)) metalAgent(["mandate", "credential", "create", "--principal", account, "--cap", "0.10", "--budget", "0.20", "--payee", `${payee.address},Stockline (test payee)`, "--expires-in", String(2 * 86400), "--description", "purser partner-rails: the sourcing agent's mandate", "--key", keyPath("owner.key.json"), "--out", cred]);
  let status = metalAgent(["mandate", "status", "--credential", cred]);
  const reference = field(status, "mandate");
  if (status.fields.get("bound")?.[0] !== "yes") {
    altaTx();
    const b = metalAgent(["mandate", "bind", "--credential", cred, "--key", keyPath("owner.key.json")]);
    rec.notes.push(`The sourcing agent's mandate ${reference} (cap 0.10 a payment, budget 0.20, one payee, 2 days) was bound on chain by the owner (${EXPLORER_TX}${b.fields.get("transaction")?.[0] ?? "?"}).`);
    status = metalAgent(["mandate", "status", "--credential", cred]);
  }
  const altaCents = 5;
  const before = await usdzBalance(payee.address);
  altaTx();
  // A payment id of this run's own: the CLI answers an id it has paid before with that earlier transaction (pass 4).
  const pull = metalAgent(["mandate", "pull", "--credential", cred, "--mandate-key-file", credKey, "--to", payee.address, "--amount", fromCents(altaCents), "--payment-id", `${STEM}-alta-${STARTED.getTime()}`], [0]);
  const txHash = pull.fields.get("transaction")?.[0] as Hex | undefined;
  if (!txHash) throw new Error("the Alta payment returned no transaction");
  const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
  const mined = Number((await pc.getBlock({ blockNumber: receipt.blockNumber })).timestamp) * 1000;
  if (mined < STARTED.getTime() - 60_000) throw new Error(`the Alta CLI answered with an earlier payment (${txHash}, mined ${new Date(mined).toISOString()}), not a new one`);
  const settledD = new Date();
  const ev = parseEventLogs({ abi: mandateBindingAbi, eventName: ["MandatePayment"], logs: receipt.logs }).find((l) => l.address.toLowerCase() === account.toLowerCase());
  const evAmount = (ev?.args as { amount?: bigint } | undefined)?.amount;
  if (receipt.status !== "success" || evAmount !== centsToBaseUnits(altaCents)) throw new Error(`the Alta payment did not pay ${fromCents(altaCents)} (status ${receipt.status})`);
  const credSha = sha256(readFileSync(cred));
  await bookNow("d", {
    id: `partner-rails-d-${txHash.slice(0, 18)}`, at: settledD.toISOString(), rail: "metal", rail_ref: txHash, amount: fromCents(altaCents), currency: "USDZ",
    agent: "sourcing", terms_sha256: credSha, counterparty: "Stockline (test payee)", description: `Stock check from Stockline, paid by the sourcing agent under its Alta mandate ${reference}`,
    lines: [{ account: "5000", debit_cents: altaCents, credit_cents: 0, cost_centre: "CC100" }, { account: "1210", debit_cents: 0, credit_cents: altaCents, cost_centre: null }],
  }, settledD, { what: `the sourcing agent pays Stockline 0.05 test USD on Alta testnet under its own mandate`, mandate_reference: reference, account, payee: payee.address, block: Number(receipt.blockNumber), explorer: `${EXPLORER_TX}${txHash}`, terms_what: "SHA-256 of the signed mandate credential (its terms); Alta's own mandate reference beside it" });
  const moved = (await usdzBalance(payee.address)) - before;
  rec.checks.push({ key: "d_payee_received", ok: moved === centsToBaseUnits(altaCents), detail: `the test payee's balance moved by ${fromCents(baseUnitsToCents(moved))}` });

  // ---- 3. Outside the mandate, and after the agent is revoked ----
  const refusal = async (key: string, what: string, agent: string, p: { amountCents: number; currency: string; merchant: string; mcc: string }, want: string) => {
    const n0 = calls.airwallex;
    const r = await payWithToken(db, issuing, tokens[agent]!, p, new Date());
    const ok = !r.ok && r.code === want && calls.airwallex === n0;
    rec.refusals.push({ key, what, by: "purser", expected: want, code: r.ok ? "PAID" : r.code, detail: r.ok ? "PAID: it should have been refused" : r.why, airwallex_calls: calls.airwallex - n0, ok } as never);
    say(`${ok ? "REFUSED " : "UNEXPECT"} ${key}: ${what}: ${r.ok ? "paid" : `${r.code} (${r.why})`}; Airwallex calls ${calls.airwallex - n0}`);
  };
  await refusal("e", "the support agent's token, EUR 60.01: over its EUR 60.00 a purchase", "support", { amountCents: 6001, currency: "EUR", merchant: "Replyhub", mcc: "7372" }, "OVER_PER_PURCHASE");
  await refusal("f", "the support agent's token at a warehouse-software merchant (MCC 5734): not its category", "support", { amountCents: 125, currency: "EUR", merchant: "Packwise", mcc: "5734" }, "MCC_NOT_ALLOWED");
  const revokedAt = new Date();
  revokePrincipal(db, "support", "partner-rails run: the agent's machine reported lost", "partner-rails run", revokedAt);
  const tv = tokenView(db, "support")[0]!;
  for (const t of rec.tokens as { agent: string; status_at_end: string }[]) t.status_at_end = tokenView(db, t.agent)[0]!.status;
  await refusal("g", "the support agent's token after the agent was revoked, EUR 1.25 within the old mandate", "support", { amountCents: 125, currency: "EUR", merchant: "Replyhub", mcc: "7372" }, "TOKEN_REVOKED");
  // Whoever holds the card's number instead: the merchant charges the card directly (the sandbox's simulation).
  const n0 = calls.airwallex;
  const leaked = await issuing.simulateCardCharge({ cardId: cardOf(db, "support")!.card_id, amountCents: 125, currency: "EUR", merchant: "Replyhub", mcc: "7372" });
  const leakOk = !leaked.approved && leaked.failureReason === "CARD_INACTIVE";
  rec.refusals.push({ key: "h", what: "the support agent's card number charged directly, without the token (EUR 1.25): the card is frozen at Airwallex", by: "airwallex", expected: "CARD_INACTIVE", code: leaked.approved ? "APPROVED" : leaked.failureReason ?? leaked.status, detail: `Airwallex ${leaked.status}${leaked.failureReason ? ` ${leaked.failureReason}` : ""} (${leaked.transactionId})`, airwallex_calls: calls.airwallex - n0, ok: leakOk } as never);
  rec.revoke = { agent: "support", at: revokedAt.toISOString(), how: "revokePrincipal (src/policy/principals.ts): the agent's identity revoked, and its tokens with it in the same call", token_id: tv.token_id, token_status: tv.status, revoked_at: tv.revoked_at, card_status_at_airwallex: (await issuing.getCard(cardOf(db, "support")!.card_id)).status };

  // ---- 4. The reconcile check: T:0 against the rails, each read back now ----
  const readRail = async (b: T0Booking): Promise<RailReading | null> => {
    if (b.rail === "airwallex_card") {
      const key = Object.keys(cardTx).find((k) => cardTx[k]!.txId === b.rail_ref)!;
      const tx = (await issuing.listCardTransactions(cardTx[key]!.cardId)).find((t) => t.transactionId === b.rail_ref || t.legacyId === b.rail_ref);
      return tx ? { status: tx.status, settled: tx.approved, amount: fromCents(tx.amountCents), currency: tx.currency, ref: b.rail_ref, at: tx.occurredAt } : null;
    }
    if (b.rail === "airwallex_transfer") {
      const t = await api.call<{ id: string; status: string; transfer_amount: number; transfer_currency: string; metadata?: { approval_sha256?: string } }>("GET", `/transfers/${encodeURIComponent(b.rail_ref)}`);
      rec.checks.push({ key: "c_metadata_terms_hash", ok: t.metadata?.approval_sha256 === b.terms_sha256, detail: `the transfer's metadata.approval_sha256 at Airwallex ${t.metadata?.approval_sha256 === b.terms_sha256 ? "is" : "is NOT"} the terms hash T:0 holds` });
      return { status: t.status, settled: t.status === "PAID", amount: Number(t.transfer_amount).toFixed(2), currency: t.transfer_currency, ref: t.id };
    }
    const r = await pc.getTransactionReceipt({ hash: b.rail_ref as Hex });
    const e = parseEventLogs({ abi: mandateBindingAbi, eventName: ["MandatePayment"], logs: r.logs }).find((l) => l.address.toLowerCase() === account.toLowerCase());
    const amt = (e?.args as { amount?: bigint } | undefined)?.amount;
    return { status: `${r.status}, block ${r.blockNumber}`, settled: r.status === "success" && !!e, amount: amt === undefined ? "?" : fromCents(baseUnitsToCents(amt)), currency: "USDZ", ref: r.transactionHash };
  };
  const recon = await reconcileBookings(db, t0, readRail);
  rec.reconcile = { at: recon.at, ok: recon.ok, rows: recon.rows } as never;
  say(`RECON    ${recon.ok ? "T:0 and every rail agree" : "DISAGREE"}: ${recon.rows.map((r) => `${r.payment_id.slice(0, 22)} ${r.ok ? "ok" : r.checks.filter((c) => !c.ok).map((c) => c.name).join("+")}`).join("; ")}`);

  rec.checks.push(
    { key: "every_payment_booked_in_t0", ok: rec.payments.length === 4 && rec.payments.every((p) => (p as { t0: { t0_id: string } }).t0.t0_id), detail: `${rec.payments.length} of 4 payments booked in T:0` },
    { key: "refused_outside_mandate_0_calls", ok: (rec.refusals as { key: string; ok: boolean }[]).filter((r) => ["e", "f", "g"].includes(r.key)).every((r) => r.ok), detail: "over the limit, another category, and after the revoke: refused by Purser with 0 Airwallex calls" },
    { key: "leaked_card_declined", ok: leakOk, detail: `the card number without the token: ${leaked.approved ? "APPROVED" : leaked.failureReason}` },
    { key: "revoke_revoked_token", ok: tv.status === "revoked", detail: `the support agent's token is ${tv.status} after the agent was revoked` },
    { key: "reconcile_ok", ok: recon.ok, detail: `T:0 against the rails: ${recon.rows.filter((r) => r.ok).length} of ${recon.rows.length} agree` },
  );
} catch (e) {
  rec.notes.push(`STOPPED: ${redactSecrets((e as Error).message).slice(0, 400)}`);
  say(`STOPPED  ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  save();
  say(`WROTE    docs/runs/${STEM}.json and .md; calls: Airwallex ${calls.airwallex}/${AWX_MAX}, T:0 ${calls.t0}/${T0_MAX}, Alta transactions ${calls.alta_txs}/${ALTA_MAX}`);
}
