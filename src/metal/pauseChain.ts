// 4.2 The chain side of pausing one agent, with the pinned metal-agent CLI and the business owner's key (the only
// key that can revoke or bind). Revoke: the agent's one bound mandate, `mandate revoke`; every later payment under it
// is refused on chain. Resume: Metal cannot replace a revoked mandate, so a fresh credential is bound with the revoked
// one's cap and payees (read back from the chain, never chosen here) and what was left of its budget: the agent's
// lifetime limit on chain stays what the CFO approved. Both are idempotent: a revoke with nothing bound, or a resume with a mandate already bound,
// reports what the chain has and changes nothing.

import { existsSync } from "node:fs";
import { latestRevoked, resumeExpiresIn, type PauseChain } from "../policy/pause.js";
import { keyPath, metalAgent } from "./agentCli.js";
import { credentialFiles, loadCredentialFile, type LoadedMandate, type MandateAgent } from "./mandate.js";
import { readMandateState } from "@metalntwx/metal-pay/mandates";
import { publicClient } from "./chain.js";

const OWNER = "owner-business.key.json";

async function states(agent: MandateAgent): Promise<{ m: LoadedMandate; bound: boolean; revoked: boolean; boundBlock: bigint }[]> {
  const out: { m: LoadedMandate; bound: boolean; revoked: boolean; boundBlock: bigint }[] = [];
  for (const path of credentialFiles(agent)) {
    const m = loadCredentialFile(agent, path);
    const s = await readMandateState(publicClient(), m.principal, m.reference);
    out.push({ m, bound: s.boundBlock > 0n, revoked: s.revoked, boundBlock: s.boundBlock });
  }
  return out;
}

/** "0.1 *USDZ" or "4 *USDZ until expiry" → "0.10" / "4.00". */
function amount(field: string | undefined, what: string): string {
  const m = /^(\d+(?:\.\d{1,2})?) \*USDZ/.exec(field ?? "");
  if (!m) throw new Error(`cannot read the ${what} from the chain's status (${field ?? "missing"})`);
  return Number(m[1]).toFixed(2);
}

export class LivePauseChain implements PauseChain {
  /**
   * @param proposalTag names the resume credential file after the proposal that approved it.
   * @param pausedHash the credential hash the pause revoked (from the audit log's mandate.revoked row): resume puts
   *   back exactly that mandate's limits, never another revoked one (a replace revokes its predecessor too).
   */
  constructor(private readonly proposalTag: (agent: string) => string, private readonly pausedHash: (agent: string) => string | null) {}

  async revoke(agent: string): Promise<{ tx: string | null; credential_hash: string }> {
    const all = await states(agent as MandateAgent);
    const live = all.filter((x) => x.bound && !x.revoked);
    if (live.length === 0) {
      // A retry after a revoke that landed: the revoked mandate bound last is the one the pause revoked (a rebalance's
      // revoked predecessors were bound earlier). Review of 4.2: file order picked an old one.
      const done = latestRevoked(all);
      if (done) return { tx: null, credential_hash: done.m.credentialHash };
      throw new Error(`${agent}: no mandate bound on chain`);
    }
    if (live.length > 1) throw new Error(`${agent}: ${live.length} mandates bound; expected one`);
    const m = live[0]!.m;
    const r = metalAgent(["mandate", "revoke", "--credential", m.credentialPath, "--key", keyPath(OWNER)]);
    return { tx: r.fields.get("transaction")?.[0] ?? null, credential_hash: m.credentialHash };
  }

  async resume(agent: string): Promise<{ tx: string | null; credential_hash: string; spent_before?: string; budget?: string; bound?: boolean }> {
    const all = await states(agent as MandateAgent);
    const live = all.filter((x) => x.bound && !x.revoked);
    // One bound already: either an earlier try of this resume bound it (a resume credential), or the pause's revoke
    // never happened and the old one is still live (nothing was re-granted; review of 4.2).
    if (live.length === 1) return { tx: null, credential_hash: live[0]!.m.credentialHash, bound: /\.resume-[^/]*\.credential\.json$/.test(live[0]!.m.credentialPath) };
    if (live.length > 1) throw new Error(`${agent}: ${live.length} mandates bound; expected one`);
    const hash = this.pausedHash(agent);
    const old = all.find((x) => x.bound && x.revoked && hash !== null && x.m.credentialHash.toLowerCase() === hash.toLowerCase())?.m;
    if (!old) throw new Error(`${agent}: the mandate the pause revoked (${hash ?? "none recorded"}) is not among its revoked credentials`);
    // Metal will not replace a revoked mandate (testnet, 31 October: "already revoked; bind the new credential"), and a
    // fresh binding starts with nothing spent. So the fresh one keeps the cap and gets only what was left of the budget:
    // what the agent may spend over its life stays exactly what the CFO approved.
    const st = metalAgent(["mandate", "status", "--credential", old.credentialPath]);
    const principal = st.fields.get("principal")?.[0];
    const payees = (st.fields.get("payee") ?? []).map((p) => { const [address, ...name] = p.split(" "); return `${address},${name.join(" ")}`; });
    if (!principal || payees.length === 0) throw new Error(`${agent}: cannot read the revoked mandate's principal and payees from the chain`);
    const cap = amount(st.fields.get("per-payment-cap")?.[0], "cap");
    // The fresh mandate ends when the revoked one would have ended; an expired one is not revived (review of 4.2).
    const expiresIn = resumeExpiresIn(Number(/^(\d+)/.exec(st.fields.get("expiry")?.[0] ?? "")?.[1] ?? NaN));
    const budget = amount(st.fields.get("budget")?.[0], "budget");
    const spent = amount(st.fields.get("spent")?.[0], "spent");
    const leftCents = Math.round(Number(budget) * 100) - Math.round(Number(spent) * 100);
    if (leftCents <= 0) throw new Error(`${agent}: nothing left of its ${budget} budget (spent ${spent}); there is nothing to resume`);
    const left = (leftCents / 100).toFixed(2);
    const out = keyPath(`${agent}.${this.proposalTag(agent)}.credential.json`);
    if (!existsSync(out)) {
      metalAgent([
        "mandate", "credential", "create", "--principal", principal, "--cap", cap, "--budget", left,
        ...payees.flatMap((p) => ["--payee", p]), "--expires-in", String(expiresIn),
        "--description", `kit11 ${this.proposalTag(agent)} ${agent} resumed`, "--mandate-key-file", old.keyFile,
        "--key", keyPath(OWNER), "--out", out,
      ]);
    }
    const next = loadCredentialFile(agent as MandateAgent, out);
    const r = metalAgent(["mandate", "bind", "--credential", out, "--key", keyPath(OWNER)]);
    return { tx: r.fields.get("transaction")?.[0] ?? null, credential_hash: next.credentialHash, spent_before: spent, budget: left };
  }
}
