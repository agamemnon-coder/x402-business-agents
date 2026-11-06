// The terms of a Metal mandate as Purser writes them: the arguments to `metal-agent mandate credential create` (the
// principal, the cap per payment, the budget, the payees, how long it lasts, a description). Pure, so the owner signer
// (src/executors/ownerSigner.ts), the bootstrap (src/cli/bootstrap.ts) and /try/sign's policy step (src/try/policy.ts,
// which shows them and runs nothing) build them with the same function. The key and the output file are the caller's.

import { fromCents } from "../lib/money.js";

export interface MandateTermsSpec {
  principal: string;
  /** Most per payment, in *USDZ cents. */
  capCents: number;
  /** Most in all, in *USDZ cents. */
  budgetCents: number;
  payees: { address: string; name: string }[];
  expiresInSeconds: number;
  description: string;
}

export function credentialCreateArgs(s: MandateTermsSpec): string[] {
  return [
    "mandate", "credential", "create",
    "--principal", s.principal,
    "--cap", fromCents(s.capCents), "--budget", fromCents(s.budgetCents),
    ...s.payees.flatMap((p) => ["--payee", `${p.address},${p.name}`]),
    "--expires-in", String(s.expiresInSeconds),
    "--description", s.description,
  ];
}
