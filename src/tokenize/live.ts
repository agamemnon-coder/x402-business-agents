// The live commands of `npm run tokenize` (src/cli/tokenize.ts): preflight, fund, deploy, mint, finance, settle and
// verify, each one process behind its guards (src/tokenize/guard.ts), a call budget for the command and one for the
// whole run, a call log, and the run's journal (src/tokenize/ledger.ts). Every command can be run again after it
// stopped anywhere: a transaction the journal knows is never signed a second time (src/tokenize/client.ts).
//
// Exit codes: 0 done. 1 failed (a transaction reverted on chain, verify found a difference, preflight is not ready).
// 2 refused before anything was signed (a guard, a missing earlier step, a refusal by the ledger checks or by the
// chain's own answer to the estimate). 3 stopped midway (the budget, the network, a receipt not there yet): run the
// same command again.
//
// The tests run these very functions against the in-memory chain (`request`, `settlement`); a live run uses Metal's
// RPC and *USDZ. This file never imports the in-memory chain.

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { BaseError, decodeEventLog, type Abi, type Address } from "viem";
import { CHAIN_ID, EXPLORER_TX, USDZ, rpcUrl } from "../metal/network.js";
import { centsToBaseUnits } from "../lib/money.js";
import { BudgetReached, budgeted, httpRequest, invoiceTokenCalls, nodeSays, SenderBusy, tokenIdOf, txClient, TxReverted, TxUnresolved, WouldRevert, type OnChainInvoice, type Receipt, type Request, type Sent } from "./client.js";
import { discountedPrice, financeToken, mintToken, settleToken, type Step } from "./flow.js";
import { liveRefusals, type LiveCommand } from "./guard.js";
import { createRoleKeys, keyFile, missingRoles, readKey, roleKeys, ROLES, type Role, type RoleKeys } from "./keys.js";
import { openRunLedger, type RunLedger } from "./ledger.js";
import { callsNeeded, fundKey, GAS_ALLOWANCE, inputsOf, planRun, PREFLIGHT_MAX_CALLS, roleNeeds, STEP_TXS, TX_STEPS, type RunPlan, type TxStatus, type TxStep } from "./plan.js";
import { mintRecord, MintRefused, verifyRecord } from "./record.js";

export interface LiveIo { say(line: string): void; err(line: string): void }
export interface LiveOptions {
  env: Record<string, string | undefined>;
  io: LiveIo;
  /** Tests only: the in-memory chain in place of Metal's RPC, and its stand-in token in place of *USDZ. */
  request?: Request;
  settlement?: Address;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  /** The repository's root, for the "keys outside the repository" guard (default: this checkout). */
  repo?: string;
}

/** A refusal before anything was signed: exit code 2. */
export class Refused extends Error {
  constructor(message: string) { super(message); this.name = "Refused"; }
}

/** The call log: one line per request, appended before the request goes out; its line count is the run's total. */
export function callLog(path: string) {
  const lines = () => (existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((l) => l.trim()) : []);
  return { lines, count: () => lines().length, append: (line: string) => appendFileSync(path, `${line}\n`) };
}

const CENT = centsToBaseUnits(1);
/** *USDZ base units as people read them: two decimals for whole cents, six (cut, not rounded) otherwise. */
export function usdzText(u: bigint): string {
  const digits = u % CENT === 0n ? 2 : 6;
  const whole = u / 10n ** 18n, frac = (u % 10n ** 18n).toString().padStart(18, "0").slice(0, digits);
  return `${whole}.${frac}`;
}
const short = (h: string) => `${h.slice(0, 12)}…`;
const stepNote = (how: Sent["how"]) => (how === "sent" ? "" : how === "resumed" ? "  (recorded earlier; its receipt read now, nothing sent again)" : "  (finished earlier; nothing sent)");

interface Ctx {
  cmd: LiveCommand;
  env: Record<string, string | undefined>;
  io: LiveIo;
  ledger: RunLedger;
  rpc: { request: Request; used: () => number; room: () => number };
  calls: ReturnType<typeof invoiceTokenCalls>;
  settlement: Address;
  now: () => Date;
  estimate: boolean;
  statusOf: (key: string) => TxStatus;
}

export async function runLive(cmd: LiveCommand, o: LiveOptions): Promise<number> {
  const { env, io } = o;
  const why = liveRefusals(cmd, env, o.repo);
  if (why.length) { for (const w of why) io.err(`REFUSED  ${w}`); return 2; }
  const now = o.now ?? (() => new Date());
  const total = Number(env.TOKENIZE_CALL_BUDGET_TOTAL);
  const max = cmd === "preflight" ? Math.min(Number(env.TOKENIZE_CALL_BUDGET), PREFLIGHT_MAX_CALLS) : Number(env.TOKENIZE_CALL_BUDGET);
  let ledger: RunLedger;
  try { ledger = openRunLedger(env.TOKENIZE_DB!, { cmd, now }); } catch (e) { io.err(`REFUSED  ${(e as Error).message}`); return 2; }
  const log = callLog(env.TOKENIZE_CALL_LOG!);
  const rpc = budgeted(o.request ?? httpRequest(rpcUrl(env as NodeJS.ProcessEnv)), {
    chainId: CHAIN_ID, max, total, logged: log.count, askChainId: cmd === "preflight",
    onCall: (method, n) => log.append(`${now().toISOString()} ${cmd} ${method} ${n.used}/${n.max} ${n.running}/${n.total}`),
  });
  const estimate = env.TOKENIZE_GAS !== "fixed";
  // One receipt read costs one call: the wait before each read (2.5 s unless TOKENIZE_POLL_MS says otherwise), six reads at most.
  const client = txClient({ request: rpc.request, chainId: CHAIN_ID, journal: ledger.journal, estimate, room: rpc.room, resendReverted: env.TOKENIZE_RESEND_REVERTED === "yes", polls: 6, pollMs: Number(env.TOKENIZE_POLL_MS ?? "2500"), ...(o.sleep ? { sleep: o.sleep } : {}) });
  const c: Ctx = { cmd, env, io, ledger, rpc, calls: invoiceTokenCalls(client), settlement: o.settlement ?? USDZ, now, estimate, statusOf: (key) => ledger.journal.last(key)?.status };
  ledger.put("budget_total", String(total));
  try {
    return await COMMANDS[cmd](c);
  } catch (e) {
    if (e instanceof Refused || e instanceof MintRefused || e instanceof WouldRevert || e instanceof SenderBusy) { io.err(`REFUSED  ${e.message}`); return 2; }
    if (e instanceof TxReverted) { io.err(`FAILED   ${e.label} reverted on chain: ${EXPLORER_TX}${e.hash}. Nothing is sent again for it unless TOKENIZE_RESEND_REVERTED=yes`); return 1; }
    if (e instanceof TxUnresolved) { io.err(`STOPPED  ${e.message}`); return 3; }
    if (e instanceof BudgetReached) { io.err(`STOPPED  ${e.message}. Run the command again with budget left: recorded transactions are never sent twice`); return 3; }
    if (e instanceof BaseError) { io.err(`STOPPED  a request to the RPC failed (${nodeSays(e)}). Run the command again: it continues from the journal`); return 3; }
    io.err(`FAILED   ${nodeSays(e)}`);
    return 1;
  } finally {
    io.say(`(${rpc.used()} Metal RPC calls in this command; ${log.count()} of ${total} in the call log)`);
    ledger.close();
  }
}

// ---- Shared pieces -------------------------------------------------------------------------------------------------

const offlinePlan = (c: Ctx): RunPlan => planRun(inputsOf(c.env));

/** The four role keys; never created here. Their addresses are written to the ledger once and must stay the same. */
function keysOf(c: Ctx): RoleKeys {
  const dir = c.env.KIT11_KEYS_DIR!;
  const missing = missingRoles(dir);
  if (missing.length) throw new Refused(`no key for ${missing.join(", ")} in KIT11_KEYS_DIR: run \`npm run tokenize -- fund\` first (it creates the four test keys and funds them)`);
  const keys = keyOrRefuse(() => roleKeys(dir));
  rememberRoles(c, keys);
  return keys;
}

/** A key file that cannot be used is a refusal: nothing was sent. */
function keyOrRefuse<T>(read: () => T): T {
  try { return read(); } catch (e) { throw new Refused((e as Error).message); }
}

type RoleAddresses = Record<Role, Address>;
const rolesOf = (c: Ctx): RoleAddresses | null => { const r = c.ledger.get("roles"); return r ? (JSON.parse(r) as RoleAddresses) : null; };

function rememberRoles(c: Ctx, keys: RoleKeys): void {
  const now = Object.fromEntries(ROLES.map((r) => [r, keys[r].address])) as RoleAddresses;
  const known = rolesOf(c);
  if (!known) { c.ledger.put("roles", JSON.stringify(now)); return; }
  const changed = ROLES.filter((r) => known[r].toLowerCase() !== now[r].toLowerCase());
  if (changed.length) throw new Refused(`KIT11_KEYS_DIR holds another key for ${changed.join(", ")} than this run's ledger recorded; nothing sent`);
}

const stateOf = (c: Ctx, key: string, missing: string): string => { const v = c.ledger.get(key); if (!v) throw new Refused(missing); return v; };

/** Stop before the first request when the budgets cannot cover the least this step still needs. */
function gate(c: Ctx, need: number, what: string): void {
  const room = c.rpc.room();
  if (room < need) throw new Refused(`${what} needs at least ${need} more Metal RPC calls and the budgets allow ${room} (TOKENIZE_CALL_BUDGET for this command, TOKENIZE_CALL_BUDGET_TOTAL less the call log); nothing sent`);
}
const gateStep = (c: Ctx, step: TxStep | "verify") => gate(c, callsNeeded(step, c.statusOf, { estimate: c.estimate }), c.cmd);

const show = (c: Ctx) => (s: Step) => c.io.say(`done     ${s.step}  ${EXPLORER_TX}${s.hash}${stepNote(s.how)}`);

/** One event of Purser's token contract from a receipt's logs. */
function eventOf(abi: Abi, receipt: Receipt, contract: Address, name: string): Record<string, unknown> {
  for (const l of receipt.logs) {
    if (l.address.toLowerCase() !== contract.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi, data: l.data, topics: l.topics as [`0x${string}`, ...`0x${string}`[]] }) as unknown as { eventName: string; args: Record<string, unknown> };
      if (ev.eventName === name) return ev.args;
    } catch { /* another contract's or another event's log */ }
  }
  throw new Error(`the receipt of ${receipt.transactionHash} holds no ${name} event`);
}

interface Funding { at: string; by: "fund" | "preflight"; ok: boolean; roles: Record<Role, { address: Address; holds: string; enough: string }> }

function recordFunding(c: Ctx, by: Funding["by"], keys: RoleAddresses, holds: Record<Role, bigint>, plan: RunPlan): Funding {
  const needs = roleNeeds(plan, c.statusOf);
  const f: Funding = {
    at: c.now().toISOString(), by, ok: ROLES.every((r) => holds[r] >= needs[r].enough),
    roles: Object.fromEntries(ROLES.map((r) => [r, { address: keys[r], holds: holds[r].toString(), enough: needs[r].enough.toString() }])) as Funding["roles"],
  };
  c.ledger.put("funding", JSON.stringify(f));
  return f;
}

function sayInvoice(c: Ctx, plan: RunPlan): void {
  const inv = plan.invoice, cur = inv.currency, amount = `${cur} ${(inv.amountCents / 100).toFixed(2)}`;
  c.io.say(`INVOICE  ${inv.proposalId} (${inv.kind}) ${inv.invoiceNo} ${amount}: approved by passkey ${plan.approval.fingerprint} on ${plan.approval.verifiedAt}; signed terms ${short(inv.termsSha256)}`);
  c.io.say(`DOCUMENT its SHA-256 ${short(inv.documentSha256)} is the one in the signed terms`);
  c.io.say(`AMOUNTS  face value ${usdzText(plan.faceValue)} *USDZ (${amount} ÷ ${plan.divisor}; test money, no exchange rate); price ${usdzText(plan.price)} *USDZ (${plan.discountBps / 100}% discount); the financier is simulated`);
}

const fundingOf = (c: Ctx): Funding | null => { const f = c.ledger.get("funding"); return f ? (JSON.parse(f) as Funding) : null; };

/** The steps still to run, each with the fewest requests it needs; true when the whole run's budget covers them. */
function sayCallPlan(c: Ctx): boolean {
  let left = 0;
  for (const step of [...TX_STEPS, "verify" as const]) {
    const done = step === "verify" ? !!c.ledger.get("verify") : step === "fund" ? !!fundingOf(c)?.ok : STEP_TXS[step].every((t) => c.statusOf(t.key) === "success");
    const n = done ? 0 : callsNeeded(step, c.statusOf, { estimate: c.estimate });
    left += n;
    const txs = step === "verify" ? "1 read of the chain's record" : STEP_TXS[step].map((t) => `${t.what.toLowerCase()}${c.statusOf(t.key) === "success" ? " (done)" : ""}`).join("; ");
    c.io.say(`PLAN     ${step.padEnd(8)} ${done ? "done" : `${step === "fund" ? "at most" : "at least"} ${n} calls`}: ${txs}`);
  }
  const used = callLog(c.env.TOKENIZE_CALL_LOG!).count(), total = Number(c.env.TOKENIZE_CALL_BUDGET_TOTAL);
  c.io.say(`PLAN     total    ${left} calls still to make when every receipt is there on its first read; ${used} in the call log; TOKENIZE_CALL_BUDGET_TOTAL ${total} leaves ${Math.max(0, total - used)}: ${total - used >= left ? "enough" : "NOT enough"}`);
  return total - used >= left;
}

// ---- The commands --------------------------------------------------------------------------------------------------

/** No transaction; at most six counted reads: the chain id, the four role balances, and the donor's when one is named. */
async function preflight(c: Ctx): Promise<number> {
  const plan = offlinePlan(c);
  sayInvoice(c, plan);
  const dir = c.env.KIT11_KEYS_DIR!;
  const missing = missingRoles(dir);
  const keys = Object.fromEntries(ROLES.filter((r) => !missing.includes(r)).map((r) => [r, keyOrRefuse(() => readKey(keyFile(dir, r))).address])) as Partial<RoleAddresses>;
  if (!missing.length) rememberRoles(c, keyOrRefuse(() => roleKeys(dir)));
  const donor = c.env.TOKENIZE_DONOR_KEY ? keyOrRefuse(() => readKey(c.env.TOKENIZE_DONOR_KEY!)) : null;
  const needs = roleNeeds(plan, c.statusOf);

  const id = Number(BigInt((await c.rpc.request({ method: "eth_chainId" })) as string));
  if (id !== CHAIN_ID) { c.io.err(`FAILED   the RPC answers for chain ${id}, not Metal testnet (${CHAIN_ID})`); return 1; }
  c.io.say(`CHAIN    id ${id}: Metal testnet`);
  const holds: Partial<Record<Role, bigint>> = {};
  let shortfall = 0n;
  for (const r of ROLES) {
    const address = keys[r];
    if (!address) { c.io.say(`ROLE     ${r.padEnd(9)} no key yet (fund creates it); needs ${usdzText(needs[r].target)} *USDZ`); shortfall += needs[r].target; continue; }
    const h = await c.calls.balanceOf(c.settlement, address);
    holds[r] = h;
    const ok = h >= needs[r].enough;
    if (!ok) shortfall += needs[r].target - h;
    c.io.say(`ROLE     ${r.padEnd(9)} ${address} holds ${usdzText(h)} *USDZ${ok ? ": ok" : `, needs ${usdzText(needs[r].target)}: short; fund sends ${usdzText(needs[r].target - h)}`}`);
  }
  let donorOk = true;
  if (shortfall > 0n && donor) {
    const h = await c.calls.balanceOf(c.settlement, donor.address);
    donorOk = h >= shortfall + GAS_ALLOWANCE;
    c.io.say(`DONOR    ${donor.address} holds ${usdzText(h)} *USDZ; fund would send ${usdzText(shortfall)}: ${donorOk ? "ok" : "NOT enough"}`);
  }
  const funded = !missing.length && ROLES.every((r) => (holds[r] ?? 0n) >= needs[r].enough);
  if (funded) recordFunding(c, "preflight", keys as RoleAddresses, holds as Record<Role, bigint>, plan);
  const budgetOk = sayCallPlan(c);
  if (!funded) { c.io.say(`NOT READY  ${missing.length ? `no key yet for ${missing.join(", ")}; ` : ""}run \`npm run tokenize -- fund\`${donorOk ? "" : " with a donor that holds enough"}`); return 1; }
  if (!budgetOk) { c.io.say("NOT READY  the four roles hold what they need, but TOKENIZE_CALL_BUDGET_TOTAL does not cover the steps still to run"); return 1; }
  c.io.say("READY    the four roles hold what they need and the budget covers the steps still to run; nothing was sent");
  return 0;
}

/** Creates the missing role keys, reads the four balances, prints the plan, then sends each shortfall from the donor. */
async function fund(c: Ctx): Promise<number> {
  const plan = offlinePlan(c);
  const donor = keyOrRefuse(() => readKey(c.env.TOKENIZE_DONOR_KEY!));
  const made = createRoleKeys(c.env.KIT11_KEYS_DIR!);
  const keys = keysOf(c);
  if (made.length) c.io.say(`KEYS     created ${made.join(", ")} in KIT11_KEYS_DIR (mode 600)`);
  if (ROLES.some((r) => keys[r].address === donor.address)) throw new Refused("TOKENIZE_DONOR_KEY is one of the run's own role keys");
  sayInvoice(c, plan);
  const needs = roleNeeds(plan, c.statusOf);
  gate(c, ROLES.length, "fund (reading the four balances)");

  const holds = {} as Record<Role, bigint>;
  for (const r of ROLES) holds[r] = await c.calls.balanceOf(c.settlement, keys[r].address);
  const todo: { role: Role; amount: bigint; open: boolean }[] = [];
  for (const r of ROLES) {
    const status = c.statusOf(fundKey(r));
    const enough = holds[r] >= needs[r].enough;
    if (status === "signed") { todo.push({ role: r, amount: 0n, open: true }); c.io.say(`PLAN     ${r.padEnd(9)} ${keys[r].address} holds ${usdzText(holds[r])}; a funding transfer is recorded without a receipt: its receipt is read first`); continue; }
    if (enough) { c.io.say(`PLAN     ${r.padEnd(9)} ${keys[r].address} holds ${usdzText(holds[r])} *USDZ: enough, skipped`); continue; }
    if (status === "success") throw new Refused(`the ${r} holds ${usdzText(holds[r])} *USDZ, less than the ${usdzText(needs[r].target)} it needs, although this ledger already recorded a funding transfer to it; nothing is sent again from this ledger`);
    todo.push({ role: r, amount: needs[r].target - holds[r], open: false });
    c.io.say(`PLAN     ${r.padEnd(9)} ${keys[r].address} holds ${usdzText(holds[r])} *USDZ, needs ${usdzText(needs[r].target)}: send ${usdzText(needs[r].target - holds[r])} *USDZ`);
  }
  // A recorded transfer without a receipt is settled before any new one is signed: a new one must not take its nonce.
  todo.sort((a, b) => Number(b.open) - Number(a.open));
  const sum = todo.reduce((s, t) => s + t.amount, 0n);
  const fresh = todo.filter((t) => !t.open).length;
  if (fresh) {
    c.io.say(`PLAN     ${fresh} transfer${fresh === 1 ? "" : "s"}, ${usdzText(sum)} *USDZ in all, from the donor ${donor.address}`);
    const again = todo.filter((t) => c.statusOf(fundKey(t.role)) === "reverted").length;
    gate(c, 2 + 2 * fresh + again + todo.filter((t) => t.open).length, "fund (the donor's balance and nonce, then a send and a receipt read per transfer)");
    const donorHolds = await c.calls.balanceOf(c.settlement, donor.address);
    if (donorHolds < sum + GAS_ALLOWANCE) throw new Refused(`the donor holds ${usdzText(donorHolds)} *USDZ; the transfers need ${usdzText(sum)} plus gas; nothing sent`);
  }
  for (const t of todo) {
    const sent = await c.calls.transfer(donor, c.settlement, keys[t.role].address, t.amount, { key: fundKey(t.role), label: `fund the ${t.role}'s key` });
    // A transfer recorded earlier may have landed before or after the balance was read above: read it again.
    holds[t.role] = sent.how === "sent" ? holds[t.role] + t.amount : await c.calls.balanceOf(c.settlement, keys[t.role].address);
    c.io.say(`done     ${sent.label}  ${EXPLORER_TX}${sent.hash}${stepNote(sent.how)}`);
  }
  const f = recordFunding(c, "fund", Object.fromEntries(ROLES.map((r) => [r, keys[r].address])) as RoleAddresses, holds, plan);
  if (!f.ok) throw new Refused(`a role still holds less than it needs (${ROLES.filter((r) => holds[r] < needs[r].enough).join(", ")}); run fund again`);
  c.io.say(`FUNDED   issuer ${keys.issuer.address}, creditor ${keys.creditor.address}, financier (simulated) ${keys.financier.address}, payer ${keys.payer.address}`);
  return 0;
}

async function deploy(c: Ctx): Promise<number> {
  const keys = keysOf(c);
  const f = fundingOf(c);
  if (!f?.ok || ROLES.some((r) => f.roles[r].address.toLowerCase() !== keys[r].address.toLowerCase()))
    throw new Refused("this run's ledger does not show the four roles funded: run `npm run tokenize -- fund` first (or `preflight`, when the keys were funded another way); nothing sent");
  gateStep(c, "deploy");
  const { address, sent } = await c.calls.deploy(keys.issuer, c.settlement);
  c.ledger.put("contract", address);
  c.io.say(`DEPLOYED PurserInvoiceToken ${address}  ${EXPLORER_TX}${sent.hash}  (issuer ${keys.issuer.address}, settles in *USDZ)${stepNote(sent.how)}`);
  return 0;
}

const recordJson = (r: OnChainInvoice) => JSON.stringify(r, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v));

/** The chain record as the ledger checks give it now, with the salt kept in this run's own ledger. */
function recordNow(c: Ctx, plan: RunPlan, payer: Address, creditor: Address): OnChainInvoice {
  let salt = c.ledger.get("ref_salt");
  if (!salt) { salt = randomBytes(32).toString("hex"); c.ledger.put("ref_salt", salt); }
  return mintRecord(plan.invoice, { document: plan.document, creditor, payer, salt: Buffer.from(salt, "hex"), debtorName: plan.debtor, faceValue: plan.faceValue });
}

async function mint(c: Ctx): Promise<number> {
  const keys = keysOf(c);
  const contract = stateOf(c, "contract", "no contract yet: run deploy first") as Address;
  const plan = offlinePlan(c);
  const record = recordNow(c, plan, keys.payer.address, keys.creditor.address);
  // What was signed stays what the ledger says was minted: after a mint is recorded, other inputs are refused.
  const prepared = c.ledger.get("record");
  const minted = c.statusOf("mint");
  if ((minted === "signed" || minted === "success") && prepared !== recordJson(record)) throw new Refused("the invoice, the document or the settings differ from the mint this ledger already recorded; nothing sent");
  c.ledger.put("record", recordJson(record));
  c.ledger.put("invoice", JSON.stringify({ proposal_id: plan.invoice.proposalId, kind: plan.invoice.kind, invoice_no: plan.invoice.invoiceNo, amount_cents: plan.invoice.amountCents, currency: plan.invoice.currency, terms_sha256: plan.invoice.termsSha256, document_sha256: plan.invoice.documentSha256, divisor: plan.divisor }));
  gateStep(c, "mint");
  const { tokenId } = await mintToken(c.calls, keys.issuer, contract, keys.creditor.address, record, show(c));
  c.ledger.put("token_id", tokenId.toString());
  c.ledger.put("face_value", record.faceValue.toString());
  c.io.say(`MINTED   token ${record.documentHash} to the creditor ${keys.creditor.address}; face value ${usdzText(record.faceValue)} *USDZ (test money, invoice amount ÷ ${plan.divisor})`);
  return 0;
}

async function finance(c: Ctx): Promise<number> {
  const keys = keysOf(c);
  const contract = stateOf(c, "contract", "no contract yet: run deploy first") as Address;
  const tokenId = BigInt(stateOf(c, "token_id", "no token yet: run mint first"));
  const faceValue = BigInt(stateOf(c, "face_value", "no token yet: run mint first"));
  const bps = inputsOf(c.env).discountBps;
  // The price of the first attempt stays the price: the offer on chain carries it.
  const price = c.ledger.get("price") && c.statusOf("offer") ? BigInt(c.ledger.get("price")!) : discountedPrice(faceValue, bps);
  if (!c.statusOf("offer")) { c.ledger.put("price", price.toString()); c.ledger.put("discount_bps", String(bps)); }
  gateStep(c, "finance");
  const steps = await financeToken(c.calls, { creditor: keys.creditor, financier: keys.financier }, contract, c.settlement, tokenId, price, show(c));
  const ev = eventOf(c.calls.abi, steps[2]!.receipt, contract, "Financed") as { seller: Address; financier: Address; price: bigint };
  c.ledger.put("financed", JSON.stringify({ seller: ev.seller, financier: ev.financier, price: ev.price.toString(), tx: steps[2]!.hash }));
  c.io.say(`FINANCED the simulated financier ${ev.financier} paid ${usdzText(ev.price)} *USDZ to the creditor ${ev.seller} and holds the token (the contract's Financed event)`);
  return 0;
}

async function settle(c: Ctx): Promise<number> {
  const keys = keysOf(c);
  const contract = stateOf(c, "contract", "no contract yet: run deploy first") as Address;
  const tokenId = BigInt(stateOf(c, "token_id", "no token yet: run mint first"));
  const faceValue = BigInt(stateOf(c, "face_value", "no token yet: run mint first"));
  gateStep(c, "settle");
  const steps = await settleToken(c.calls, keys.payer, contract, c.settlement, tokenId, faceValue, show(c));
  const ev = eventOf(c.calls.abi, steps[1]!.receipt, contract, "Settled") as { holder: Address; faceValue: bigint };
  c.ledger.put("settled", JSON.stringify({ holder: ev.holder, face_value: ev.faceValue.toString(), tx: steps[1]!.hash }));
  c.io.say(`SETTLED  the debtor's wallet paid ${usdzText(ev.faceValue)} *USDZ to the holder ${ev.holder}; token burned (the contract's Settled event)`);
  return 0;
}

/** One read: the chain's record against the record recomputed from the source ledger, the document and this run's ledger. */
async function verify(c: Ctx): Promise<number> {
  const contract = stateOf(c, "contract", "no contract yet: run deploy first") as Address;
  const tokenId = BigInt(stateOf(c, "token_id", "no token yet: run mint first"));
  const roles = rolesOf(c);
  if (!roles || !c.ledger.get("ref_salt")) throw new Refused("this run's ledger holds no roles or reference salt: it did not mint this token");
  const plan = offlinePlan(c);
  const expected = recordNow(c, plan, roles.payer, roles.creditor);
  gateStep(c, "verify");
  const onChain = await c.calls.invoiceOf(contract, tokenId);
  const mismatches = verifyRecord(onChain, expected);
  const idIsHash = tokenIdOf(expected.documentHash) === tokenId;
  c.ledger.put("verify", JSON.stringify({ at: c.now().toISOString(), ok: mismatches.length === 0 && idIsHash, mismatches, token_id_is_document_hash: idIsHash, settled_on_chain: onChain.settled }));
  if (mismatches.length || !idIsHash) { c.io.err(`MISMATCH ${[...mismatches, ...(idIsHash ? [] : ["the token id is not the document hash"])].join("; ")}`); return 1; }
  c.io.say(`VERIFIED token id = document hash; the chain record matches the ledger and the document${onChain.settled ? "; the chain marks it settled" : ""}`);
  return 0;
}

const COMMANDS: Record<LiveCommand, (c: Ctx) => Promise<number>> = { preflight, fund, deploy, mint, finance, settle, verify };
