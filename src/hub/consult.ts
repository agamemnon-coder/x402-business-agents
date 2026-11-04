// Asks the hub for its decision on one proposal, just before the executor dispatch runs it (src/executors/index.ts),
// and records the answer in the audit log (`hub.consulted`), where the gate in beginExecution reads it. The hub's
// answer is data, never an instruction: only a decision under this world's exact run id counts, a decision from
// before the proposal existed is ignored, and every entry is validated (src/hub/client.ts).
//
// A hub `reject` closes the proposal for good (NEEDS_REAPPROVAL: terminal, runs nothing, moves no money). An approve
// changes nothing by itself: the gate still needs the person's approval and Purser's check `pass`.

import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { closeAsStale } from "../policy/approvals.js";
import { hubDecisionsEnabled, hubEndpoint, hubPushEnabled } from "./config.js";
import { fetchDecisions, pushRuns, type DecisionsRead, type HubDeps } from "./client.js";
import type { HubOutcome } from "./gate.js";
import { buildPushBody, lastConsult, runIdOf, worldId } from "./runs.js";

const safeWord = (s: string | undefined) => (s && /^[a-z0-9_-]{1,32}$/i.test(s) ? s : null);

interface Row { proposal_id: string; status: string; terms_sha256: string; created_at: string }

/**
 * Consults the hub for this proposal and records the outcome; returns it, or null when the gate is off or the proposal
 * is not about to begin (the executor refuses or resumes those on its own). `read`: decisions already fetched this
 * moment (the retry loop's one read), instead of reading them again.
 */
export async function consultHub(db: DB, proposalId: string, deps: HubDeps, read?: DecisionsRead): Promise<HubOutcome | null> {
  const env = deps.env ?? process.env;
  if (!hubDecisionsEnabled(env)) return null;
  const p = db.prepare("SELECT proposal_id, status, terms_sha256, created_at FROM proposals WHERE proposal_id = ?").get(proposalId) as Row | undefined;
  if (!p || (p.status !== "APPROVED" && p.status !== "FAILED")) return null;
  const runId = runIdOf(worldId(db), p.proposal_id);
  const got = read ?? await fetchDecisions(deps, hubEndpoint(env));
  const now = (deps.now ?? (() => new Date()))();
  if (!got.ok) {
    // Fallback: the existing approval alone decides, as without the hub. Recorded, so the run shows the hub was not asked.
    audit(db, "system", "hub.consulted", p.proposal_id, { run_id: runId, outcome: "unreachable", reason: got.reason, terms_sha256: p.terms_sha256 }, now);
    deps.log?.(`hub      unreachable (${got.reason}) for ${p.proposal_id}: the Face ID approval alone decides`);
    return "unreachable";
  }
  let d = got.decisions.get(runId);
  let ignored: string | null = null;
  if (d?.at !== undefined && !(Date.parse(d.at) >= Date.parse(p.created_at))) {
    ignored = "decided before the proposal existed, or at no readable time";
    d = undefined;
  }
  const outcome: HubOutcome = d ? d.decision : "none";
  audit(db, "system", "hub.consulted", p.proposal_id, {
    run_id: runId, outcome, terms_sha256: p.terms_sha256,
    ...(d ? { by: safeWord(d.by), at: d.at ?? null } : {}), ...(ignored ? { ignored } : {}),
  }, now);
  if (outcome === "reject") {
    closeAsStale(db, p.proposal_id, { error: "rejected on the hub (Cardputer); nothing runs, a new proposal is needed", by: "hub" }, {}, now);
    deps.log?.(`hub      ${p.proposal_id} rejected on the hub: closed, nothing runs`);
  } else if (outcome === "none") {
    deps.log?.(`hub      ${p.proposal_id} approved with Face ID; waits for the hub's decision`);
  }
  return outcome;
}

/**
 * The runner's tick: proposals approved with Face ID that wait for the hub, for which the hub has now decided, are
 * handed to `execute` once (one read for all of them). A hub that cannot be read now runs nothing here: the fallback
 * applies only to an execution a person just started, never to one started by this loop.
 */
export class HubLoop {
  private readonly inflight = new Set<string>();
  private lastPush = "";

  constructor(private readonly db: DB, private readonly deps: HubDeps, private readonly execute: (db: DB, id: string, read?: DecisionsRead) => Promise<void>) {}

  /** Proposals approved by a person whose last hub answer was "no decision yet". */
  waiting(): string[] {
    const rows = this.db.prepare("SELECT proposal_id, terms_sha256 FROM proposals WHERE status = 'APPROVED' ORDER BY created_at").all() as { proposal_id: string; terms_sha256: string }[];
    return rows.filter((r) => {
      const c = lastConsult(this.db, r.proposal_id);
      return c?.outcome === "none" && c.terms_sha256 === r.terms_sha256 && !this.inflight.has(r.proposal_id);
    }).map((r) => r.proposal_id);
  }

  /** Runs what the hub has decided on. Returns the ids handed to execute (their runs go on in the background). */
  async tick(): Promise<string[]> {
    const env = this.deps.env ?? process.env;
    if (!hubDecisionsEnabled(env)) return [];
    const ids = this.waiting();
    if (ids.length === 0) return [];
    const read = await fetchDecisions(this.deps, hubEndpoint(env));
    if (!read.ok) return [];
    const world = worldId(this.db);
    const decided = ids.filter((id) => read.decisions.has(runIdOf(world, id)));
    for (const id of decided) {
      this.inflight.add(id);
      void this.execute(this.db, id, read).then(
        () => this.deps.log?.(`hub      ${id} executed after the hub's decision`),
        (e: unknown) => this.deps.log?.(`hub      ${id} did not run: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`),
      ).finally(() => this.inflight.delete(id));
    }
    return decided;
  }

  /** Pushes the runs when they changed since the last push (HUB_PUSH_ENABLED). Callers need not wait: it never rejects. */
  pushIfChanged(): Promise<void> {
    const env = this.deps.env ?? process.env;
    if (!hubPushEnabled(env)) return Promise.resolve();
    let key: string;
    try {
      key = JSON.stringify(buildPushBody(this.db, env));
    } catch {
      return Promise.resolve();
    }
    if (key === this.lastPush) return Promise.resolve();
    this.lastPush = key;
    return pushRuns(this.db, this.deps).then((r) => { if (!r.ok) this.lastPush = ""; });
  }
}
