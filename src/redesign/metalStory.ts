// The top of /metal (C2, 6 November): one screen with the main run's Metal story, every claim one click from Metal's
// testnet explorer. A mandate on chain per agent; the payments, each its own transaction; #24 refused on chain; the
// mandate replace after the CFO's Face ID. Every figure, hash and address is read here from the main run's record
// (docs/demo/main-run.json), never typed in. Below it, folded and dated, what Purser ran on Metal beyond the kit in
// separate runs, each with its run record: never presented as the main run.

import { readFileSync } from "node:fs";
import { payments, type AgentId, type Proof, type RunRecord } from "./run.js";

export const EXPLORER_HOST = "testnet.metalntwx.com";
export const EXPLORER = `https://${EXPLORER_HOST}`;

/**
 * A link to one transaction or one address on Metal's testnet explorer, and nothing else: parsed as a URL and its
 * host compared exactly (never matched as a pattern, so a look-alike host such as metalntwx.com.evil.test fails).
 */
export function explorerLink(href: string | null | undefined): { kind: "tx" | "address"; id: string } | null {
  let u: URL;
  try { u = new URL(href ?? ""); } catch { return null; }
  if (u.protocol !== "https:" || u.hostname !== EXPLORER_HOST || u.port || u.username || u.password || u.search || u.hash) return null;
  const tx = /^\/tx\/(0x[0-9a-fA-F]{64})$/.exec(u.pathname);
  if (tx) return { kind: "tx", id: tx[1]! };
  const address = /^\/address\/(0x[0-9a-fA-F]{40})$/.exec(u.pathname);
  return address ? { kind: "address", id: address[1]! } : null;
}
export const REPO_BLOB = "https://github.com/agamemnon-coder/x402-business-agents/blob/main/";
/** The main run's payment-by-payment check against the chain (`npm run data-qa`, 3 November). */
export const MAIN_RUN_CHECK = "docs/runs/2026-11-03-main-run-data-qa.md";

const txLink = (tx: string, label = `tx ${tx.slice(0, 6)}…${tx.slice(-4)}`): Proof => ({ label, href: `${EXPLORER}/tx/${tx}` });
const isTx = (s: unknown): s is string => typeof s === "string" && /^0x[0-9a-fA-F]{64}$/.test(s);

/** The parts of the record this page reads that RunRecord does not type. */
interface MetalRecord extends RunRecord {
  snapshot: RunRecord["snapshot"] & {
    world: { business: string; customer: string };
    budgets: { agents: { agent: string; payee: string; cap: string; budget: string; last_tx: string | null }[] };
  };
}

export interface StoryMandate { agent: AgentId; cap: string; budget: string; payee: string; proof: Proof; how: "bound" | "paid under it" }
export interface MetalStory {
  mandates: StoryMandate[];
  payments: { total: number; sales: number; purchases: number; refunds: number; sweeps: number; account: Proof; checked: Proof };
  refusal: { seq: string; amount: string; cap: string; code: string; proof: Proof; agent: string; mandate: string } | null;
  replace: { proposal: string; signers: string[]; steps: { agent: AgentId; cap: string; budget: string; proof: Proof }[]; revoked: { seq: string; code: string } | null } | null;
}

/** The main run's Metal story, from its record alone. */
export function metalStory(record: RunRecord): MetalStory {
  const r = record as MetalRecord, s = r.snapshot, rows = r.ledger?.events ?? [];
  const replaced = rows.filter((e) => e.event === "mandate.replaced" && isTx(e.payload.tx));
  // Each agent's mandate as it stands at the end: the replace that bound it, or (no replace in the run) its latest payment.
  const mandates = s.budgets.agents.flatMap((b): StoryMandate[] => {
    const bound = replaced.filter((e) => e.subject === b.agent).at(-1);
    const tx = bound ? String(bound.payload.tx) : b.last_tx;
    if (!isTx(tx)) return [];
    return [{ agent: b.agent as AgentId, cap: b.cap, budget: b.budget, payee: b.payee, proof: txLink(tx), how: bound ? "bound" : "paid under it" }];
  });
  const pay = payments(r);
  const onChain = rows.find((e) => e.event === "upstream.refused_on_chain" && isTx(e.payload.tx));
  const letThrough = onChain ? rows.find((e) => e.event === "upstream.let_through" && e.subject === onChain.subject) : undefined;
  const proposal = String(replaced[0]?.payload.proposal_id ?? "");
  const approved = rows.find((e) => e.event === "proposal.approved" && e.subject === proposal);
  const revoked = s.refusals.find((x) => /revoked by a replacement/.test(x.reason));
  return {
    mandates,
    payments: {
      total: pay.onChain, sales: pay.sales, purchases: pay.purchases, refunds: pay.refunds, sweeps: pay.sweeps,
      account: { label: "Northwind's account", href: `${EXPLORER}/address/${s.world.business}` },
      checked: { label: "checked one by one", href: `${REPO_BLOB}${MAIN_RUN_CHECK}` },
    },
    refusal: onChain ? {
      seq: String(onChain.payload.seq ?? onChain.subject ?? ""), amount: String(onChain.payload.amount ?? ""), cap: String(letThrough?.payload.bound_cap ?? ""),
      code: /^[a-z_]+/.exec(String(onChain.payload.metal_reason ?? ""))?.[0] ?? "", proof: txLink(String(onChain.payload.tx)),
      agent: String((onChain.payload.origin as { agent?: unknown } | undefined)?.agent ?? onChain.subject ?? ""), mandate: String(onChain.payload.mandate ?? ""),
    } : null,
    replace: proposal ? {
      proposal,
      signers: String(approved?.payload.approver ?? "").split(/\s*\+\s*/).filter(Boolean),
      steps: replaced.filter((e) => e.payload.proposal_id === proposal).map((e) => ({ agent: e.subject as AgentId, cap: String(e.payload.cap ?? ""), budget: String(e.payload.budget ?? ""), proof: txLink(String(e.payload.tx)) })),
      revoked: revoked ? { seq: /#(\d+)/.exec(revoked.reason)?.[1] ?? "", code: "mandate_revoked" } : null,
    } : null,
  };
}

/** Metal's event for a refusal it records on chain, as metal-pay's Mandate Binding ABI names it (docs/metal-qa-2026-11-01-week.md). */
export const REFUSAL_EVENT = "MandateRefused";

/**
 * What a juror sees on the explorer for the refusal on chain (jury review, 7 Nov, #3): the explorer shows the transaction
 * as "finalized · unknown method", with one undecoded log. Metal's MandateRefused(ref, to, l3aDigest, agentKey, amount,
 * reason) has `ref` indexed, so topic 1 is the mandate the record names; the amount is in the log's data. The mandate and
 * the amount come from the record's upstream.refused_on_chain row; null when it does not name them.
 */
export function refusalNote(r: MetalStory["refusal"]): string | null {
  if (!r || !/^0x[0-9a-f]{64}$/i.test(r.mandate) || !r.amount || !r.agent) return null;
  return `On the explorer: log #0 is Metal's ${REFUSAL_EVENT} event (undecoded there); topic 1 is the ${r.agent[0]!.toUpperCase()}${r.agent.slice(1)} mandate ${r.mandate.slice(0, 8)}…${r.mandate.slice(-4)} and its data carries ${r.amount}.`;
}

/**
 * What Purser ran on Metal beyond the kit, each in its own test world on its own day, with its run record. The day and
 * the record are written here; what ran and its transactions come from the records (docs/demo/metal.json, built from
 * the run logs, and docs/runs/passkey-owners.json). Tests check each date against its record.
 */
export const SEPARATE_RUNS = [
  { id: "four-eyes", date: "2026-10-30", record: "docs/runs/2026-10-30-four-eyes.md" },
  { id: "passkey-owners", date: "2026-11-01", record: "docs/runs/passkey-owners.json" },
  { id: "clearing", date: "2026-10-29", record: "docs/runs/2026-10-29-clearing.md" },
  { id: "clearing-load", date: "2026-10-30", record: "docs/runs/2026-10-30-clearing-load.md" },
  { id: "receive", date: "2026-10-30", record: "docs/metal-award.md#5-receive-policy-and-quarantine-built-into-purser-30-october" },
  { id: "compliance", date: "2026-10-30", record: "docs/runs/2026-10-30-compliance-policy.md" },
] as const;

export interface SeparateRun { id: string; date: string; title: string; what: string; proofs: Proof[]; record: Proof }

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const dayOf = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));

export function separateRuns(): SeparateRun[] {
  const metal = JSON.parse(read("docs/demo/metal.json")) as { features: { id: string; title: string; figure: string; source: string; proofs: Proof[] }[] };
  const owners = JSON.parse(read("docs/runs/passkey-owners.json")) as { stand_in: string; threshold: number; steps: { step: string; outcome: string; tx: string | null }[] };
  const feature = (id: string) => metal.features.find((f) => f.id === id);
  return SEPARATE_RUNS.flatMap((run): SeparateRun[] => {
    const record = { label: "run record", href: `${REPO_BLOB}${run.record}` };
    const day = dayOf(run.date);
    if (run.id === "passkey-owners") {
      const pick = (re: RegExp) => owners.steps.find((x) => re.test(x.step) && isTx(x.tx));
      const steps = [pick(/^bind .* CFO's passkey alone/), pick(/^bind .* both passkeys/), pick(/^revoke .* both passkeys/)].filter((x) => x !== undefined);
      return [{ id: run.id, date: run.date, title: "Passkeys as the account's owners", what: `${day}: a ${owners.threshold}-of-${owners.threshold} account whose owners are two passkeys, signed on chain through Metal's authorizeMandateCall; ${owners.stand_in}`,
        proofs: steps.map((x) => txLink(x.tx!, `${x.step.replace(/^(bind|revoke) the agent's mandate with /, "$1, ")}: ${x.outcome}`)), record }];
    }
    if (run.id === "clearing-load") {
      const load = /A load test on [^)]*\) (.+?)\.?$/.exec(feature("clearing")?.source ?? "")?.[1];
      return load ? [{ id: run.id, date: run.date, title: "Clearing under load", what: `${day}: ${load}`, proofs: [], record }] : [];
    }
    const f = feature(run.id);
    if (!f) return [];
    return [{ id: run.id, date: run.date, title: f.title, what: `${day}: ${f.figure}`, proofs: f.proofs.filter((p) => explorerLink(p.href)?.kind === "tx"), record }];
  });
}
