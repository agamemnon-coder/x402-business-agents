// One `mandate pull` under an agent's mandate, by payment id: the refund and sweep executors call this. metal-agent
// pays a payment id at most once ("already paid, nothing sent" on a repeat), which is what lets a crashed refund or
// sweep be retried with the same id. Tests and the chaos test pass their own Puller with the same promise.
//
// metal-agent knows a payment id only under the mandate it was sent under (its pulls are kept in
// ~/.metal-agent/pulls/<mandate reference>/): "a retry ... under a credential that renewed or replaced it, signs a new
// payout" (metal-agent 0.3.3, `mandate pull`). So a retry after a mandate replace first asks the old credential how its
// pull ended. Only when that pull was refused (a replaced mandate is revoked, so one not yet landed is refused) is the
// payment sent under the mandate bound now; a pull that paid, was held or is still pending is reported, never paid
// again (Metal review, 6 November: docs/metal-review.md).

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Address } from "viem";
import { fromCents } from "../lib/money.js";
import { keysDir, metalAgent, type CliResult } from "./agentCli.js";
import { activeMandate, credentialFiles, loadCredentialFile, type LoadedMandate, type MandateAgent } from "./mandate.js";

export type PullOutcome = "PAID" | "REFUSED" | "PENDING" | "HELD";
export interface PullResult { outcome: PullOutcome; tx: string | null; reason: string | null; already: boolean }
export type Puller = (a: { agent: MandateAgent; to: Address; amountCents: number; paymentId: string }) => Promise<PullResult>;

const EXIT: Record<number, PullOutcome> = { 0: "PAID", 1: "REFUSED", 3: "PENDING", 4: "HELD" };

/** Where metal-agent keeps a payment id's pull under one mandate: `pendingPullsPath(reference)` and `keptPath` in metal-agent 0.3.3. */
export function keptPullDir(home: string, reference: string, paymentId: string): string {
  return join(home, ".metal-agent", "pulls", reference, `payment-${createHash("sha256").update(paymentId).digest("hex")}`);
}

export interface PullDeps {
  /** The agent's one mandate the chain has bound now. */
  active: (agent: MandateAgent) => Promise<Pick<LoadedMandate, "credentialPath" | "keyFile" | "reference">>;
  /** Every credential the agent holds a file for: the bound one, and those replaced or revoked before it. */
  all: (agent: MandateAgent) => Pick<LoadedMandate, "credentialPath" | "keyFile" | "reference">[];
  /** Whether metal-agent keeps a pull for this payment id under the mandate with this reference. */
  kept: (reference: string, paymentId: string) => boolean;
  run: (args: string[], okCodes: number[]) => CliResult;
}

const liveDeps: PullDeps = {
  active: activeMandate,
  all: (agent) => credentialFiles(agent).map((p) => loadCredentialFile(agent, p)),
  kept: (reference, paymentId) => existsSync(keptPullDir(join(keysDir(), "home"), reference, paymentId)),
  run: metalAgent,
};

export function pullWith(deps: PullDeps): Puller {
  return async (a) => {
    const send = (m: Pick<LoadedMandate, "credentialPath" | "keyFile">): PullResult => {
      const res = deps.run(
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
    const now = await deps.active(a.agent);
    for (const old of deps.all(a.agent)) {
      if (old.reference.toLowerCase() === now.reference.toLowerCase() || !deps.kept(old.reference, a.paymentId)) continue;
      // Sent before under a credential since replaced: the same command under it reads how that pull ended.
      const before = send(old);
      if (before.outcome !== "REFUSED") return before;
    }
    return send(now);
  };
}

export const livePull: Puller = pullWith(liveDeps);

/**
 * One pull under one known mandate, with no look-up of credentials replaced before it: the passkey account's flows
 * (npm run owners -- pay, npm run passkey-owners), where each mandate has its one credential. `run` starts the CLI.
 */
export function pullUnder(m: Pick<LoadedMandate, "credentialPath" | "keyFile" | "reference">, run: PullDeps["run"] = metalAgent): Puller {
  return pullWith({ active: async () => m, all: () => [m], kept: () => false, run });
}
