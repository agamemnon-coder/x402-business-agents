// Metal QA (1 November): Purser refuses a payment over the mandate's cap before anything is signed (src/policy/holds.ts),
// so Metal itself never saw the price-rise purchase. That control stays. Beside it, the first such refusal under a
// mandate is now also put to Metal: `mandate pull --record-refusal` has Metal's Mandate Binding check the same payment
// against the mandate on chain and record its refusal in a transaction, with Metal's own reason. It is only sent when
// the amount is over the cap written in that mandate's credential, which a bound mandate cannot change: Metal will
// refuse it, so nothing can be paid by it.

import type { Address } from "viem";
import { extractTerms, readMandateState } from "@metalntwx/metal-pay/mandates";
import { keyPath, metalAgent } from "./agentCli.js";
import { publicClient } from "./chain.js";
import type { LoadedMandate } from "./mandate.js";
import { centsToBaseUnits, fromCents } from "../lib/money.js";

export interface RecordedRefusal { tx: string | null; reason: string }

export async function recordCapRefusalOnChain(m: LoadedMandate, to: Address, cents: number, paymentId: string, gasKey = keyPath("owner-business.key.json")): Promise<RecordedRefusal> {
  const cap = extractTerms(m.credential).constraints.perPaymentCap;
  if (centsToBaseUnits(cents) <= cap) throw new Error(`${fromCents(cents)} is not over this mandate's cap; Metal would pay it, so nothing is sent`);
  const state = await readMandateState(publicClient(), m.principal, m.reference);
  if (state.boundBlock === 0n || state.revoked) throw new Error("this mandate is not bound (or is revoked); nothing to record against");
  const r = metalAgent(["mandate", "pull", "--credential", m.credentialPath, "--mandate-key-file", m.keyFile, "--to", to, "--amount", fromCents(cents),
    "--payment-id", paymentId, "--record-refusal", "--key", gasKey], [0, 1]);
  const reason = r.fields.get("refused")?.[0] ?? r.fields.get("reason")?.[0] ?? "";
  if (!reason) throw new Error(`Metal did not report a refusal (exit ${r.code}); check the pull ${paymentId}`);
  return { tx: r.fields.get("transaction")?.[0] ?? null, reason };
}
