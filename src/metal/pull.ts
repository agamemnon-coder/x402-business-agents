// One `mandate pull` under an agent's mandate, by payment id: the refund and sweep executors call this. metal-agent
// pays a payment id at most once ("already paid, nothing sent" on a repeat), which is what lets a crashed refund or
// sweep be retried with the same id. Tests and the chaos test pass their own Puller with the same promise.

import type { Address } from "viem";
import { fromCents } from "../lib/money.js";
import { metalAgent } from "./agentCli.js";
import { activeMandate, type MandateAgent } from "./mandate.js";

export type PullOutcome = "PAID" | "REFUSED" | "PENDING" | "HELD";
export interface PullResult { outcome: PullOutcome; tx: string | null; reason: string | null; already: boolean }
export type Puller = (a: { agent: MandateAgent; to: Address; amountCents: number; paymentId: string }) => Promise<PullResult>;

const EXIT: Record<number, PullOutcome> = { 0: "PAID", 1: "REFUSED", 3: "PENDING", 4: "HELD" };

export const livePull: Puller = async (a) => {
  const m = await activeMandate(a.agent);
  const res = metalAgent(
    ["mandate", "pull", "--credential", m.credentialPath, "--mandate-key-file", m.keyFile, "--to", a.to, "--amount", fromCents(a.amountCents), "--payment-id", a.paymentId],
    [0, 1, 3, 4],
  );
  return {
    outcome: EXIT[res.code]!,
    tx: res.fields.get("transaction")?.[0] ?? null,
    reason: res.fields.get("reason")?.[0] ?? null,
    already: /^already (paid|held), nothing sent/m.test(res.out),
  };
};
