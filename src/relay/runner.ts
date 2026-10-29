// The runner's side of the relay (tier 2 item 5): one sync call pushes the state when the ledger changed, delivers
// the verdicts on earlier submissions, and collects new ones. Each submission is verified and decided here
// (src/passkey/process.ts); an approval then runs its executor while the syncs go on, and its outcome is reported
// on the same ticket.

import type { DB } from "../db/open.js";
import { processAssertion, processPolicyRequest, processRegistration, type InboxItem } from "../passkey/process.js";
import { expireDue } from "../policy/approvals.js";
import type { RelayConfig } from "./config.js";
import { buildRelayState, stateHash } from "./state.js";

export interface Ack {
  ticket: string;
  status: string;
  message: string;
}

export interface RunnerDeps {
  db: DB;
  cfg: RelayConfig;
  fetch: typeof fetch;
  /** Runs an approved proposal (src/executors). The executor re-checks the approved hash itself. */
  execute: (db: DB, proposalId: string) => Promise<void>;
  log: (line: string) => void;
  now?: () => Date;
  /** The approver's name on passkeys enrolled here. */
  label?: string;
}

export class RelayRunner {
  private lastPushed: string | null = null;
  private acks: Ack[] = [];
  /** Tickets this process already handled, so a slow answer is never handled twice. */
  private readonly handled = new Set<string>();
  private readonly running = new Set<Promise<void>>();
  private readonly now: () => Date;

  constructor(private readonly deps: RunnerDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async syncOnce(): Promise<{ pushed: boolean; inbox: number }> {
    const { db, cfg } = this.deps;
    expireDue(db, this.now());
    const state = buildRelayState(db, { rpId: cfg.rpId, label: this.deps.label }, this.now());
    const hash = stateHash(state);
    const push = hash !== this.lastPushed;
    const acks = this.acks.splice(0);
    let body: { need_state: boolean; inbox: InboxItem[] };
    try {
      const res = await this.deps.fetch(`${cfg.url}/api/runner/sync`, {
        method: "POST",
        headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
        body: JSON.stringify({ state_hash: hash, ...(push ? { state } : {}), acks }),
      });
      if (!res.ok) throw new Error(`the relay answered ${res.status}${res.status === 401 ? " (wrong relay token: redeploy with npm run relay:deploy)" : ""}`);
      body = (await res.json()) as typeof body;
    } catch (e) {
      // Nothing was delivered: keep the verdicts for the next sync.
      this.acks.unshift(...acks);
      throw e;
    }
    // A relay that lost its copy (or never had it) gets the whole state on the next sync.
    this.lastPushed = body.need_state ? null : hash;
    for (const item of body.inbox) await this.handle(item);
    return { pushed: push, inbox: body.inbox.length };
  }

  /** Waits for every executor that is still running (tests, and a clean shutdown). */
  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running]);
  }

  private ack(ticket: string, status: string, message: string): void {
    this.acks.push({ ticket, status, message });
    this.deps.log(`${status.padEnd(8)} ${message}`);
  }

  private async handle(item: InboxItem): Promise<void> {
    if (this.handled.has(item.ticket)) return;
    this.handled.add(item.ticket);
    try {
      await this.process(item);
    } catch (e) {
      // Never leave the phone waiting: an unexpected error is a verdict too (a resend is checked from scratch).
      this.ack(item.ticket, "refused", `the runner could not process this submission (${(e instanceof Error ? e.message : String(e)).slice(0, 200)}); nothing was approved`);
    }
  }

  private async process(item: InboxItem): Promise<void> {
    const { db } = this.deps;
    if (item.kind === "registration") {
      const out = await processRegistration(db, item, { label: this.deps.label ?? "max" }, this.now());
      this.ack(item.ticket, out.status, out.message);
      return;
    }
    const out = item.kind === "policy" ? await processPolicyRequest(db, item, this.now()) : await processAssertion(db, item, this.now());
    this.ack(item.ticket, out.ack ?? out.status, out.message);
    if (out.status !== "approved" || !out.proposalId) return;
    const id = out.proposalId;
    const run = this.deps.execute(db, id).then(
      () => this.ack(item.ticket, "executed", `${id} executed`),
      (e: unknown) => this.ack(item.ticket, "failed", `${id} was approved, but execution stopped: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`),
    );
    this.running.add(run);
    void run.finally(() => this.running.delete(run));
  }
}
