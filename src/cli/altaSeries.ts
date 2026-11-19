// npm run alta-series: a series of mandate-checked payments on Alta (formerly Metal) testnet, in its own test world
// (KIT11_KEYS_DIR, default ../x402-business-agents-keys/alta-series; never inside this repo). Test money only.
//   0. the owner's plain key (faucet when it holds under 3.00), a one-owner Alta account (metal-agent account create),
//      funded to 1.50; a gas-only key that owns nothing pays the recorded refusals' gas (as src/metal/recordRefusal.ts);
//   1. an agent mandate on the account: cap 0.10 a payment, budget 1.00 over its life, one payee (the test payee);
//   2. 20 payments by the agent's mandate key alone (`mandate pull`, the facilitator submits), 1.00 in all, one of them
//      exactly the cap; between them three payments the mandate does not allow, each sent with --record-refusal so Alta's
//      Mandate Binding itself refuses it in a transaction: one cent over the cap, a payee the mandate does not name, and
//      one cent once the budget is spent;
//   3. each transaction's receipt read back: its MandatePayment or MandateRefused event (decoded with the pinned SDK's
//      ABI), and the payee's and the account's balances before and after, so a refusal is shown to have moved nothing;
//   4. the mandate's status as the chain has it (spent, payments).
// Purser's own policy would refuse the three before signing (src/policy/holds.ts); here they go to the chain on purpose.
// Keys are never printed. Writes docs/runs/<date>-alta-series.json (RUN_OUT names another file).

import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAddress, parseEventLogs, type Address, type Hex } from "viem";

process.env.KIT11_KEYS_DIR ??= resolve(import.meta.dirname, "../../../x402-business-agents-keys/alta-series");
const { keyPath, metalAgent, field } = await import("../metal/agentCli.js");
const { plainKey } = await import("../metal/keyFiles.js");
const { publicClient, transferUsdz, usdzBalance } = await import("../metal/chain.js");
const { fundTestWallet } = await import("../metal/testFunds.js");
const { CHAIN_ID, EXPLORER_TX } = await import("../metal/network.js");
const { mandateBindingAbi, reasonName } = await import("@metalntwx/metal-pay/mandates");
const { baseUnitsToCents, centsToBaseUnits, fromCents } = await import("../lib/money.js");
const { redactSecrets } = await import("../lib/redact.js");

/** The 20 payments, in cents: 1.00 in all, each within the 0.10 cap, the first exactly the cap. */
export const SERIES_CENTS = [10, 5, 3, 7, 4, 6, 2, 8, 5, 5, 1, 9, 4, 6, 3, 7, 5, 5, 2, 3] as const;
const CAP_CENTS = 10, BUDGET_CENTS = 100;
// 19 Nov, first pass: the plan summed to 1.01 (its last payment was 0.04), so payment 20 was refused before sending and the
// "over the budget" cent was paid. The plan is checked before anything is sent.
const planned = SERIES_CENTS.reduce((n, c) => n + c, 0);
if (planned !== BUDGET_CENTS || SERIES_CENTS.some((c) => c > CAP_CENTS)) throw new Error(`the plan sums to ${fromCents(planned)}, not the budget ${fromCents(BUDGET_CENTS)}, or a payment is over the cap`);
// --finish: in a world whose series stopped short of the budget, one payment of what is left of it (within the cap),
// then the one cent over the budget, sent with --record-refusal. Writes <RUN>-finish.json.
const FINISH = process.argv.includes("--finish");
const RUN = `${process.env.RUN_OUT ?? `${new Date().toISOString().slice(0, 10)}-alta-series`}${FINISH ? "-finish" : ""}`;
const ID = process.env.SERIES_ID ?? "alta-series-1119";

const pc = publicClient();
const say = (s: string) => console.log(redactSecrets(s));
type Kind = "setup" | "payment" | "over-mandate";
interface Step {
  n: number; kind: Kind; step: string; outcome: "done" | "paid" | "refused on chain" | "UNEXPECTED"; tx: string | null; block: number | null;
  amount?: string; to?: string; event?: string; reason?: string; payee_delta?: string; account_delta?: string; spent_after?: string; detail: string;
}
const steps: Step[] = [];
const record = (s: Omit<Step, "n">) => {
  steps.push({ n: steps.length + 1, ...s });
  say(`${s.outcome.padEnd(16)} ${s.step}${s.tx ? `  ${EXPLORER_TX}${s.tx}` : ""}  ${s.detail}`);
};

// 0. The world's keys and the account.
const owner = plainKey("owner.key.json");
const payee = plainKey("payee.key.json");
const stranger = plainKey("stranger.key.json");
const gas = plainKey("gas-sponsor.key.json");
if ((await usdzBalance(owner.address)) < centsToBaseUnits(300)) {
  const how = await fundTestWallet(owner.address, 300, { label: "alta-series owner" });
  say(`owner funded (${how})`);
}
const acct = metalAgent(["account", "create", "--key", keyPath("owner.key.json")]);
const account = getAddress(field(acct, "account")) as Address;
const created = acct.fields.get("transaction")?.[0] ?? null;
if (created) record({ kind: "setup", step: "create the owner's Alta account (one owner)", outcome: "done", tx: created, block: null, detail: `account ${account}` });
else say(`account ${account} exists`);
if ((await usdzBalance(account)) < centsToBaseUnits(120)) {
  const tx = await transferUsdz(keyPath("owner.key.json"), account, centsToBaseUnits(150) - (await usdzBalance(account)));
  record({ kind: "setup", step: "fund the account to 1.50 test USD", outcome: "done", tx, block: null, detail: "" });
}
if ((await usdzBalance(gas.address)) < centsToBaseUnits(20)) {
  const tx = await transferUsdz(keyPath("owner.key.json"), gas.address, centsToBaseUnits(50));
  record({ kind: "setup", step: "fund the gas-only key with 0.50 (it pays the recorded refusals' gas, owns nothing)", outcome: "done", tx, block: null, detail: "" });
}

// 1. The mandate.
const cred = keyPath("agent.credential.json");
const mandateKey = keyPath("agent.credential.key.json");
if (!existsSync(cred)) {
  metalAgent(["mandate", "credential", "create", "--principal", account, "--cap", fromCents(CAP_CENTS), "--budget", fromCents(BUDGET_CENTS),
    "--payee", `${payee.address},Stockline (test payee)`, "--expires-in", String(7 * 86400), "--description", "purser alta series 19 Nov", "--key", keyPath("owner.key.json"), "--out", cred]);
}
let status = metalAgent(["mandate", "status", "--credential", cred]);
const reference = field(status, "mandate");
if (status.fields.get("bound")?.[0] !== "yes") {
  const b = metalAgent(["mandate", "bind", "--credential", cred, "--key", keyPath("owner.key.json")]);
  record({ kind: "setup", step: `bind the agent's mandate: cap ${fromCents(CAP_CENTS)} a payment, budget ${fromCents(BUDGET_CENTS)}, one payee`, outcome: "done", tx: b.fields.get("transaction")?.[0] ?? null, block: null, detail: `mandate ${reference}` });
}

// 2 and 3. The series, read back.
/** The mandate event a transaction carries from the account, decoded with the pinned SDK's ABI. */
async function readBack(tx: Hex) {
  const r = await pc.getTransactionReceipt({ hash: tx });
  const ev = parseEventLogs({ abi: mandateBindingAbi, eventName: ["MandatePayment", "MandateRefused"], logs: r.logs }).find((l) => l.address.toLowerCase() === account.toLowerCase());
  const a = ev?.args as { to?: Address; amount?: bigint; reason?: number; spent?: bigint } | undefined;
  return { status: r.status, block: Number(r.blockNumber), event: ev?.eventName ?? null, to: a?.to ?? null, amount: a?.amount ?? null, reason: ev?.eventName === "MandateRefused" ? reasonName(a!.reason as never) : null, spent: a?.spent ?? null };
}
const usd = (units: bigint) => `${units < 0n ? "-" : ""}${fromCents(baseUnitsToCents(units < 0n ? -units : units))}`;

async function pull(label: string, kind: Kind, to: Address, cents: number, paymentId: string) {
  const [p0, a0] = [await usdzBalance(to), await usdzBalance(account)];
  const args = ["mandate", "pull", "--credential", cred, "--mandate-key-file", mandateKey, "--to", to, "--amount", fromCents(cents), "--payment-id", paymentId];
  if (kind === "over-mandate") args.push("--record-refusal", "--key", keyPath("gas-sponsor.key.json"));
  const res = metalAgent(args, [0, 1, 3, 4]);
  const tx = (res.fields.get("transaction")?.[0] ?? null) as Hex | null;
  const said = res.fields.get("outcome")?.[0] ?? `exit ${res.code}`;
  if (!tx) {
    record({ kind, step: label, outcome: "UNEXPECTED", tx: null, block: null, amount: fromCents(cents), to, detail: `UNEXPECTED: no transaction (${said}${res.fields.get("reason")?.[0] ? `: ${res.fields.get("reason")![0]}` : ""})` });
    return;
  }
  const rb = await readBack(tx);
  const [p1, a1] = [await usdzBalance(to), await usdzBalance(account)];
  const base = { kind, step: label, tx, block: rb.block, amount: fromCents(cents), to, event: rb.event ?? "none", payee_delta: usd(p1 - p0), account_delta: usd(a1 - a0), ...(rb.spent !== null ? { spent_after: usd(rb.spent) } : {}) };
  if (kind === "payment") {
    const ok = rb.status === "success" && rb.event === "MandatePayment" && p1 - p0 === centsToBaseUnits(cents) && rb.amount === centsToBaseUnits(cents);
    record({ ...base, outcome: ok ? "paid" : "UNEXPECTED", detail: ok ? `paid; the payee received ${usd(p1 - p0)}; spent ${rb.spent !== null ? usd(rb.spent) : "?"} of ${fromCents(BUDGET_CENTS)}` : `UNEXPECTED: ${said}, event ${rb.event}, payee +${usd(p1 - p0)}` });
  } else {
    const ok = rb.status === "success" && rb.event === "MandateRefused" && p1 === p0 && a1 === a0;
    record({ ...base, ...(rb.reason ? { reason: rb.reason } : {}), outcome: ok ? "refused on chain" : "UNEXPECTED", detail: ok ? `Alta's Mandate Binding refused it in this transaction (${rb.reason}); the payee and the account moved 0.00` : `UNEXPECTED: ${said}, event ${rb.event}, payee ${usd(p1 - p0)}, account ${usd(a1 - a0)}` });
  }
}

const OVER: Record<number, () => Promise<void>> = {
  5: () => pull(`over the cap: the agent asks to pay ${fromCents(CAP_CENTS + 1)} (cap ${fromCents(CAP_CENTS)})`, "over-mandate", payee.address, CAP_CENTS + 1, `${ID}-over-cap`),
  12: () => pull("a payee the mandate does not name: the agent asks to pay 0.05 to a stranger's address", "over-mandate", stranger.address, 5, `${ID}-other-payee`),
  20: () => pull(`over the budget: the budget's ${fromCents(BUDGET_CENTS)} is spent; the agent asks for 0.01 more`, "over-mandate", payee.address, 1, `${ID}-over-budget${FINISH ? "-finish" : ""}`),
};
if (FINISH) {
  const spent = /^([\d.]+) /.exec(status.fields.get("spent")?.[0] ?? "")?.[1];
  const left = spent === undefined ? -1 : BUDGET_CENTS - Math.round(Number(spent) * 100);
  if (left < 0 || left > CAP_CENTS) throw new Error(`--finish needs what is left of the budget within the cap; the chain says spent ${status.fields.get("spent")?.[0] ?? "?"}`);
  const done = Number(status.fields.get("payments")?.[0] ?? NaN);
  if (left > 0) await pull(`payment ${done + 1}: ${fromCents(left)} to the test payee, what is left of the budget`, "payment", payee.address, left, `${ID}-finish-rest`);
  await OVER[20]!();
} else for (const [i, cents] of SERIES_CENTS.entries()) {
  await pull(`payment ${i + 1} of ${SERIES_CENTS.length}: ${fromCents(cents)} to the test payee${cents === CAP_CENTS ? " (exactly the cap)" : ""}`, "payment", payee.address, cents, `${ID}-p${String(i + 1).padStart(2, "0")}`);
  await OVER[i + 1]?.();
}

// 4. The mandate as the chain has it.
status = metalAgent(["mandate", "status", "--credential", cred]);
const chainSays = { bound: status.fields.get("bound")?.[0] ?? null, revoked: status.fields.get("revoked")?.[0] ?? null, spent: status.fields.get("spent")?.[0] ?? null, payments: status.fields.get("payments")?.[0] ?? null };
say(`mandate status: bound ${chainSays.bound}, revoked ${chainSays.revoked}, spent ${chainSays.spent}, payments ${chainSays.payments}`);

const paid = steps.filter((s) => s.kind === "payment" && s.outcome === "paid");
const refused = steps.filter((s) => s.kind === "over-mandate" && s.outcome === "refused on chain");
const unexpected = steps.filter((s) => s.outcome === "UNEXPECTED");
const out = {
  run: RUN, ran_at: new Date().toISOString(), network: "Alta (formerly Metal) testnet", chain_id: CHAIN_ID, test_money: true,
  made_by: "npm run alta-series (src/cli/altaSeries.ts)",
  account, owner: owner.address, payee: payee.address, stranger: stranger.address, gas_only_key: gas.address,
  mandate: { reference, cap: fromCents(CAP_CENTS), budget: fromCents(BUDGET_CENTS), payees: [payee.address] },
  summary: {
    payments_paid: paid.length, payments_planned: FINISH ? null : SERIES_CENTS.length, paid_total: fromCents(paid.reduce((n, s) => n + Math.round(Number(s.amount) * 100), 0)),
    over_mandate_attempts: steps.filter((s) => s.kind === "over-mandate").length, refused_on_chain: refused.length, unexpected: unexpected.length,
  },
  mandate_status_after: chainSays,
  steps,
};
const file = resolve(process.env.RUN_OUT_DIR ?? resolve(import.meta.dirname, "../../docs/runs"), `${RUN}.json`);
writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
say(`\n${paid.length}${FINISH ? "" : ` of ${SERIES_CENTS.length}`} paid (${out.summary.paid_total}); ${refused.length} of ${out.summary.over_mandate_attempts} over-mandate attempts refused on chain; ${unexpected.length} unexpected; ${file}`);
process.exit(unexpected.length ? 1 : 0);
