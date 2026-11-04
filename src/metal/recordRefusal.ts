// Metal QA (1 November): Purser refuses a payment over the mandate's cap before anything is signed (src/policy/holds.ts),
// so Metal itself never saw the price-rise purchase. That control stays. Beside it, the first such refusal under a
// mandate is now also put to Metal: `mandate pull --record-refusal` has Metal's Mandate Binding check the same payment
// against the mandate on chain and record its refusal in a transaction, with Metal's own reason. It is only sent when
// the amount is over the cap written in that mandate's credential, which a bound mandate cannot change: Metal will
// refuse it, so nothing can be paid by it. The transaction's gas is paid by a gas-only key that owns nothing (Max,
// 1 November: no agent's path uses an owner key); the payment itself is the agent's own mandate signature.

import { fundTestWallet } from "./testFunds.js";
import type { Address } from "viem";
import { extractTerms, readMandateState } from "@metalntwx/metal-pay/mandates";
import { existsSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { keyPath, metalAgentAsync, type CliResult } from "./agentCli.js";
import { publicClient, readKeyFile } from "./chain.js";
import type { LoadedMandate } from "./mandate.js";
import { centsToBaseUnits, fromCents } from "../lib/money.js";

export interface RecordedRefusal { tx: string | null; reason: string }

/** Key files being created in this process: two recordings at once create the key once (a failed creation is retried). */
const creating = new Map<string, Promise<string>>();
function gasKeyCreated(file: string): Promise<string> {
  // The creation in flight first: its file may already exist half-written.
  let p = creating.get(file);
  if (p) return p;
  if (existsSync(file)) return Promise.resolve(file);
  p = metalAgentAsync(["key", "create", "--out", file]).then(() => file).finally(() => creating.delete(file));
  creating.set(file, p);
  return p;
}

/** The gas-only key (created once per world, topped up from the faucet when low): it pays gas, it owns nothing. */
export async function refusalGasKey(): Promise<string> {
  const file = await gasKeyCreated(keyPath("gas-sponsor.key.json"));
  const address = privateKeyToAccount(readKeyFile(file).privateKey).address;
  // The faucet, or with KIT11_RECYCLE=on spare test money from finished dry runs (src/metal/testFunds.ts).
  await fundTestWallet(address, 10, { label: "gas sponsor (Metal refusal recorder)" });
  return file;
}

/** onPullStart: called right before the CLI is started (the caller stamps it: from then on the pull may reach Metal). */
export async function recordCapRefusalOnChain(m: LoadedMandate, to: Address, cents: number, paymentId: string, gasKey?: string, onPullStart?: () => void): Promise<RecordedRefusal> {
  const cap = extractTerms(m.credential).constraints.perPaymentCap;
  if (centsToBaseUnits(cents) <= cap) throw new Error(`${fromCents(cents)} is not over this mandate's cap; Metal would pay it, so nothing is sent`);
  const state = await readMandateState(publicClient(), m.principal, m.reference);
  if (state.boundBlock === 0n || state.revoked) throw new Error("this mandate is not bound (or is revoked); nothing to record against");
  const key = gasKey ?? await refusalGasKey();
  // The caller's last check before anything is sent (its claim still open, its hold still held): an error here is
  // thrown as is, never as "pull sent", because nothing was started.
  onPullStart?.();
  let r: CliResult;
  try {
    // Asynchronous: the world's process keeps serving the suppliers and the seller while Metal records it (agent run 1).
    // The customer's request that met the refusal still waits for it (at most the CLI's 180 s timeout).
    r = await metalAgentAsync(["mandate", "pull", "--credential", m.credentialPath, "--mandate-key-file", m.keyFile, "--to", to, "--amount", fromCents(cents),
      "--payment-id", paymentId, "--record-refusal", "--key", key], [0, 1]);
  } catch (e) {
    // From here on the pull may have reached Metal: the caller treats this as an incident, not a quiet failure.
    throw new Error(`pull sent: ${(e as Error).message}`, { cause: e });
  }
  const reason = r.fields.get("refused")?.[0] ?? r.fields.get("reason")?.[0] ?? "";
  if (!reason) throw new Error(`Metal did not report a refusal (exit ${r.code}); check the pull ${paymentId}`);
  return { tx: r.fields.get("transaction")?.[0] ?? null, reason };
}
