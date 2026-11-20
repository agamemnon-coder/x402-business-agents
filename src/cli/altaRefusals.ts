// npm run alta-refusals: the mandate refusals the 19 Nov series did not send (that one sent over the cap, another payee
// and over the budget), each sent to Alta (formerly Metal) testnet on purpose so Alta's Mandate Binding itself refuses it
// in a transaction. Its own test world (KIT11_KEYS_DIR, default ../x402-business-agents-keys/alta-refusals-1120; never
// inside this repo). Test money only; keys are never printed.
//   A. one mandate, cap 0.10, budget 1.00, one payee, at most 4 payments: 2 payments; a payment signed by a key that is
//      not the mandate's (expected BadSignature); 2 more payments; a fifth payment (expected OverOccurrences); the owner
//      revokes the mandate; one more payment (expected Revoked).
//   B. a mandate that starts tomorrow: one payment today (expected OutsideRecurrence: not started yet).
//   C. a mandate that expires 3 minutes after it is issued: one payment inside it, then, once expired, one more
//      (expected Expired).
// Each transaction's receipt is read back: its MandatePayment or MandateRefused event (decoded with the pinned SDK's
// ABI) and the payee's and the account's balances before and after, so a refusal is shown to have moved nothing.
// Here they go to the chain on purpose, so the chain's own refusal is on record.
// Writes docs/runs/<date>-alta-refusals.json and .md (RUN_OUT names another stem); --md writes the .md again from the .json.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAddress, parseEventLogs, type Address, type Hex } from "viem";
import { altaRefusalsMarkdown, type AltaRefusalsRecord } from "../proof/altaRefusalsMd.js";

const OUT_DIR = resolve(process.env.RUN_OUT_DIR ?? resolve(import.meta.dirname, "../../docs/runs"));
// --md: the run log written again from the record (RUN_OUT names its stem); no network, no keys.
if (process.argv.includes("--md")) {
  const stem = process.env.RUN_OUT ?? `${new Date().toISOString().slice(0, 10)}-alta-refusals`;
  const rec = JSON.parse(readFileSync(resolve(OUT_DIR, `${stem}.json`), "utf8")) as AltaRefusalsRecord;
  writeFileSync(resolve(OUT_DIR, `${stem}.md`), altaRefusalsMarkdown(rec));
  console.log(`WROTE ${stem}.md`);
  process.exit(0);
}

process.env.KIT11_KEYS_DIR ??= resolve(import.meta.dirname, "../../../x402-business-agents-keys/alta-refusals-1120");
const rpc = process.env.METAL_RPC_URL ?? "";
if (!rpc) { console.error("REFUSED  METAL_RPC_URL (an Alta testnet RPC) is not set; nothing was sent"); process.exit(2); }
try { if (!new URL(rpc).hostname.includes("testnet")) { console.error("REFUSED  METAL_RPC_URL is not an Alta testnet RPC; nothing was sent"); process.exit(2); } } catch { console.error("REFUSED  METAL_RPC_URL is not a URL"); process.exit(2); }
const { keyPath, metalAgent, field } = await import("../metal/agentCli.js");
const { plainKey, mandateKey } = await import("../metal/keyFiles.js");
const { publicClient, transferUsdz, usdzBalance } = await import("../metal/chain.js");
const { fundTestWallet } = await import("../metal/testFunds.js");
const { CHAIN_ID, EXPLORER_TX } = await import("../metal/network.js");
const { mandateBindingAbi, reasonName } = await import("@metalntwx/metal-pay/mandates");
const { baseUnitsToCents, centsToBaseUnits, fromCents } = await import("../lib/money.js");
const { redactSecrets } = await import("../lib/redact.js");

const RUN = process.env.RUN_OUT ?? `${new Date().toISOString().slice(0, 10)}-alta-refusals`;
const ID = process.env.SERIES_ID ?? "alta-refusals-1120";
const RAN_AT = new Date().toISOString();
const pc = publicClient();
if ((await pc.getChainId()) !== CHAIN_ID) { console.error(`REFUSED  the RPC is not Alta testnet (chain id ${CHAIN_ID}); nothing was sent`); process.exit(2); }
const say = (s: string) => console.log(redactSecrets(s));

type Kind = "setup" | "payment" | "refusal";
interface Step {
  n: number; mandate: string; kind: Kind; step: string; outcome: "done" | "paid" | "refused on chain" | "refused before sending" | "UNEXPECTED"; tx: string | null; block: number | null;
  amount?: string; to?: string; event?: string; expected?: string; reason?: string; reason_as_expected?: boolean; payee_delta?: string; account_delta?: string; spent_after?: string; detail: string;
}
const steps: Step[] = [];
const record = (s: Omit<Step, "n">) => { steps.push({ n: steps.length + 1, ...s }); say(`${s.outcome.padEnd(16)} [${s.mandate}] ${s.step}${s.tx ? `  ${EXPLORER_TX}${s.tx}` : ""}  ${s.detail}`); };

// The world's keys and the account.
const owner = plainKey("owner.key.json");
const payee = plainKey("payee.key.json");
const gas = plainKey("gas-sponsor.key.json");
const intruder = await mandateKey("intruder.mandate.key.json");
if ((await usdzBalance(owner.address)) < centsToBaseUnits(300)) say(`owner funded (${await fundTestWallet(owner.address, 300, { label: "alta-refusals owner" })})`);
const acct = metalAgent(["account", "create", "--key", keyPath("owner.key.json")]);
const account = getAddress(field(acct, "account")) as Address;
const created = acct.fields.get("transaction")?.[0] ?? null;
if (created) record({ mandate: "-", kind: "setup", step: "create the owner's Alta account (one owner)", outcome: "done", tx: created, block: null, detail: `account ${account}` });
if ((await usdzBalance(account)) < centsToBaseUnits(50)) {
  const tx = await transferUsdz(keyPath("owner.key.json"), account, centsToBaseUnits(100) - (await usdzBalance(account)));
  record({ mandate: "-", kind: "setup", step: "fund the account to 1.00 test USD", outcome: "done", tx, block: null, detail: "" });
}
if ((await usdzBalance(gas.address)) < centsToBaseUnits(20)) {
  const tx = await transferUsdz(keyPath("owner.key.json"), gas.address, centsToBaseUnits(50));
  record({ mandate: "-", kind: "setup", step: "fund the gas-only key with 0.50 (it pays the recorded refusals' gas, owns nothing)", outcome: "done", tx, block: null, detail: "" });
}

interface Mandate { name: string; cred: string; key: string; reference: string; terms: string; starts: string | null; expiry: string | null }
function mandate(name: string, terms: string, extra: string[]): Mandate {
  const cred = keyPath(`${name}.credential.json`);
  if (!existsSync(cred)) {
    metalAgent(["mandate", "credential", "create", "--principal", account, "--cap", "0.10", "--budget", "1.00", "--payee", `${payee.address},Stockline (test payee)`,
      ...extra, "--description", `purser alta refusals 20 Nov, mandate ${name}`, "--key", keyPath("owner.key.json"), "--out", cred]);
  }
  const st = metalAgent(["mandate", "status", "--credential", cred]);
  const m = { name, cred, key: keyPath(`${name}.credential.key.json`), reference: field(st, "mandate"), terms, starts: st.fields.get("starts")?.[0] ?? null, expiry: st.fields.get("expiry")?.[0] ?? null };
  if (st.fields.get("bound")?.[0] !== "yes") {
    const b = metalAgent(["mandate", "bind", "--credential", cred, "--key", keyPath("owner.key.json")]);
    record({ mandate: name, kind: "setup", step: `bind mandate ${name}: ${terms}`, outcome: "done", tx: b.fields.get("transaction")?.[0] ?? null, block: null, detail: `mandate ${m.reference}` });
  }
  return m;
}

async function readBack(tx: Hex) {
  const r = await pc.getTransactionReceipt({ hash: tx });
  const ev = parseEventLogs({ abi: mandateBindingAbi, eventName: ["MandatePayment", "MandateRefused"], logs: r.logs }).find((l) => l.address.toLowerCase() === account.toLowerCase());
  const a = ev?.args as { amount?: bigint; reason?: number; spent?: bigint } | undefined;
  return { status: r.status, block: Number(r.blockNumber), event: ev?.eventName ?? null, amount: a?.amount ?? null, reason: ev?.eventName === "MandateRefused" ? reasonName(a!.reason as never) : null, spent: a?.spent ?? null };
}
const usd = (units: bigint) => `${units < 0n ? "-" : ""}${fromCents(baseUnitsToCents(units < 0n ? -units : units))}`;

/** One pull under mandate m: a payment it allows, or (with `expected`) one it does not, sent so the chain refuses it. */
async function pull(m: Mandate, label: string, cents: number, paymentId: string, expected?: string, keyFile = m.key) {
  const [p0, a0] = [await usdzBalance(payee.address), await usdzBalance(account)];
  const args = ["mandate", "pull", "--credential", m.cred, "--mandate-key-file", keyFile, "--to", payee.address, "--amount", fromCents(cents), "--payment-id", paymentId];
  if (expected) args.push("--record-refusal", "--key", keyPath("gas-sponsor.key.json"));
  const kind: Kind = expected ? "refusal" : "payment";
  let res;
  try { res = metalAgent(args, [0, 1, 3, 4]); } catch (e) {
    // 20 Nov: the pinned metal-agent CLI (0.3.3) refuses a mandate key that is not the credential's before it signs or
    // sends anything ("… is not this mandate's key"), so a payment signed by another key never reaches the chain from it.
    if (expected && /is not this mandate's key/.test((e as Error).message)) {
      record({ mandate: m.name, kind, step: label, outcome: "refused before sending", tx: null, block: null, amount: fromCents(cents), expected,
        detail: "refused by the pinned metal-agent CLI before signing: the key is not this mandate's key; nothing was sent, so the chain's own signature check was not reached" });
      return;
    }
    record({ mandate: m.name, kind, step: label, outcome: "UNEXPECTED", tx: null, block: null, amount: fromCents(cents), ...(expected ? { expected } : {}), detail: `UNEXPECTED: the CLI did not send it (${redactSecrets((e as Error).message).slice(0, 300)})` });
    return;
  }
  const tx = (res.fields.get("transaction")?.[0] ?? null) as Hex | null;
  const said = res.fields.get("outcome")?.[0] ?? `exit ${res.code}`;
  if (!tx) {
    record({ mandate: m.name, kind, step: label, outcome: "UNEXPECTED", tx: null, block: null, amount: fromCents(cents), ...(expected ? { expected } : {}), detail: `UNEXPECTED: no transaction (${said}${res.fields.get("reason")?.[0] ? `: ${res.fields.get("reason")![0]}` : ""})` });
    return;
  }
  const rb = await readBack(tx);
  const [p1, a1] = [await usdzBalance(payee.address), await usdzBalance(account)];
  const base = { mandate: m.name, kind, step: label, tx, block: rb.block, amount: fromCents(cents), to: payee.address, event: rb.event ?? "none", payee_delta: usd(p1 - p0), account_delta: usd(a1 - a0), ...(rb.spent !== null ? { spent_after: usd(rb.spent) } : {}) };
  if (!expected) {
    const ok = rb.status === "success" && rb.event === "MandatePayment" && p1 - p0 === centsToBaseUnits(cents);
    record({ ...base, outcome: ok ? "paid" : "UNEXPECTED", detail: ok ? `paid; the payee received ${usd(p1 - p0)}` : `UNEXPECTED: ${said}, event ${rb.event}, payee +${usd(p1 - p0)}` });
  } else {
    const ok = rb.status === "success" && rb.event === "MandateRefused" && p1 === p0 && a1 === a0;
    record({ ...base, expected, ...(rb.reason ? { reason: rb.reason, reason_as_expected: rb.reason === expected } : {}), outcome: ok ? "refused on chain" : "UNEXPECTED",
      detail: ok ? `Alta's Mandate Binding refused it in this transaction (${rb.reason}${rb.reason === expected ? "" : `; expected ${expected}`}); the payee and the account moved 0.00` : `UNEXPECTED: ${said}, event ${rb.event}, payee ${usd(p1 - p0)}, account ${usd(a1 - a0)}` });
  }
}

// A. At most 4 payments; a stranger's key; revoked.
const A = mandate("A", "cap 0.10 a payment, budget 1.00, one payee, at most 4 payments, 7 days", ["--expires-in", String(7 * 86400), "--max-occurrences", "4"]);
await pull(A, "payment 1 of 4: 0.05 to the test payee", 5, `${ID}-a1`);
await pull(A, "payment 2 of 4: 0.05 to the test payee", 5, `${ID}-a2`);
await pull(A, "signed by a key that is not the mandate's: 0.05 to the test payee", 5, `${ID}-a-badsig`, "BadSignature", intruder.file);
await pull(A, "payment 3 of 4: 0.05 to the test payee", 5, `${ID}-a3`);
await pull(A, "payment 4 of 4: 0.05 to the test payee", 5, `${ID}-a4`);
await pull(A, "a fifth payment, the mandate allows 4: 0.05 to the test payee", 5, `${ID}-a5`, "OverOccurrences");
const rv = metalAgent(["mandate", "revoke", "--credential", A.cred, "--key", keyPath("owner.key.json")]);
record({ mandate: "A", kind: "setup", step: "the owner revokes mandate A", outcome: "done", tx: rv.fields.get("transaction")?.[0] ?? null, block: null, detail: "" });
await pull(A, "after the revoke: 0.01 to the test payee", 1, `${ID}-a-revoked`, "Revoked");

// B. Not started yet.
const B = mandate("B", "cap 0.10, budget 1.00, one payee, starting 24 hours after it was issued", ["--starts-in", String(86400), "--expires-in", String(7 * 86400)]);
await pull(B, "before the mandate's start: 0.01 to the test payee", 1, `${ID}-b-early`, "OutsideRecurrence");

// C. Expired.
const C = mandate("C", "cap 0.10, budget 1.00, one payee, expiring 3 minutes after it was issued", ["--expires-in", "180"]);
await pull(C, "inside the 3 minutes: 0.01 to the test payee", 1, `${ID}-c1`);
const st = metalAgent(["mandate", "status", "--credential", C.cred]);
const expiresLine = st.fields.get("expiry")?.[0] ?? null;
const expiresAt = expiresLine && /^\d+ /.test(expiresLine) ? Number(expiresLine.split(" ")[0]) * 1000 : NaN;
const waitMs = Number.isFinite(expiresAt) ? Math.max(0, expiresAt - Date.now()) + 30_000 : 210_000;
say(`waiting ${Math.round(waitMs / 1000)} s for mandate C to expire (${expiresLine ?? "expiry not printed; 3.5 minutes"})`);
await new Promise((r) => setTimeout(r, waitMs));
await pull(C, "after the mandate expired: 0.01 to the test payee", 1, `${ID}-c-expired`, "Expired");

const statusOf = (m: Mandate) => { const s = metalAgent(["mandate", "status", "--credential", m.cred]); return { mandate: m.name, reference: m.reference, terms: m.terms, starts: m.starts, expiry: m.expiry, bound: s.fields.get("bound")?.[0] ?? null, revoked: s.fields.get("revoked")?.[0] ?? null, spent: s.fields.get("spent")?.[0] ?? null, payments: s.fields.get("payments")?.[0] ?? null }; };
const mandates = [A, B, C].map(statusOf);
const paid = steps.filter((s) => s.kind === "payment" && s.outcome === "paid");
const refused = steps.filter((s) => s.kind === "refusal" && s.outcome === "refused on chain");
const unexpected = steps.filter((s) => s.outcome === "UNEXPECTED");
const notSent = steps.filter((s) => s.outcome === "refused before sending");
const out = {
  run: RUN, ran_at: RAN_AT, finished_at: new Date().toISOString(), network: "Alta (formerly Metal) testnet", chain_id: CHAIN_ID, test_money: true,
  made_by: "npm run alta-refusals (src/cli/altaRefusals.ts)",
  account, owner: owner.address, payee: payee.address, gas_only_key: gas.address,
  mandates,
  summary: {
    payments_paid: paid.length, paid_total: fromCents(paid.reduce((n, s) => n + Math.round(Number(s.amount) * 100), 0)),
    refusals_planned: steps.filter((s) => s.kind === "refusal").length, refusals_sent: steps.filter((s) => s.kind === "refusal" && s.tx).length,
    refused_before_sending: notSent.length, refused_on_chain: refused.length, reasons: refused.map((s) => s.reason),
    reasons_as_expected: refused.filter((s) => s.reason_as_expected).length, unexpected: unexpected.length,
    transactions: steps.filter((s) => s.tx).length,
  },
  steps,
};
writeFileSync(resolve(OUT_DIR, `${RUN}.json`), `${JSON.stringify(out, null, 2)}\n`);
writeFileSync(resolve(OUT_DIR, `${RUN}.md`), altaRefusalsMarkdown(out as AltaRefusalsRecord));
say(`\n${paid.length} paid (${out.summary.paid_total}); ${refused.length} of ${out.summary.refusals_sent} refused on chain (${out.summary.reasons.join(", ")}); ${notSent.length} refused before sending; ${out.summary.reasons_as_expected} with the expected reason; ${unexpected.length} unexpected; ${out.summary.transactions} transactions`);
process.exit(unexpected.length ? 1 : 0);
