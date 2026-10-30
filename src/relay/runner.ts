// The runner's side of the relay (tier 2 item 5): one sync call pushes the state when the ledger changed, delivers
// the verdicts on earlier submissions, and collects new ones. Each submission is verified and decided here
// (src/passkey/process.ts); an approval then runs its executor while the syncs go on, and its outcome is reported
// on the same ticket.

import { signApprovals, type DisplayKey } from "./sign.js";
import { redactSecrets } from "../lib/redact.js";
import type { DB } from "../db/open.js";
import { processAssertion, processPolicyRequest, processRegistration, type InboxItem } from "../passkey/process.js";
import { expireDue } from "../policy/approvals.js";
import type { RelayConfig } from "./config.js";
import { buildRelayState, stateHash } from "./state.js";
import type { RelayedHook } from "../policy/cardHooks.js";

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
  /** Signs the approvals the phone decides on (M3). Without it the phone refuses to sign anything. */
  signer?: DisplayKey;
  /** Handles one Airwallex webhook the relay kept (src/policy/cardHooks.ts) and says what happened. Without it the
   *  runner leaves them on the relay. */
  onHook?: (hook: RelayedHook) => string;
  /** Drafts rules from the CFO's words (P2, src/policy/fromText.ts) and says what became of them. Without it the
   *  runner refuses such texts. */
  draftPolicy?: (text: string) => Promise<{ proposalId: string | null; message: string }>;
  /** Ask Purser: answers a chat message from the phone, proposing a task card when it fits the policy. */
  ask?: (text: string, ticket: string) => Promise<{ proposalId: string | null; reply: string }>;
}

export class RelayRunner {
  private lastPushed: string | null = null;
  private acks: Ack[] = [];
  private hookAcks: string[] = [];
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
    const state = buildRelayState(db, { rpId: cfg.rpId, label: this.deps.label, relayToken: cfg.token }, this.now());
    const hash = stateHash(state);
    const push = hash !== this.lastPushed;
    const acks = this.acks.splice(0);
    const hookAcks = this.hookAcks.splice(0);
    let body: { need_state: boolean; inbox: InboxItem[]; hooks?: RelayedHook[] };
    try {
      // The signature is randomised, so the state hash above leaves it out: an idle runner still pushes nothing.
      const sent = push && this.deps.signer ? { ...state, approvals: signApprovals(state.approvals, this.deps.signer) } : state;
      const res = await this.deps.fetch(`${cfg.url}/api/runner/sync`, {
        method: "POST",
        headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
        body: JSON.stringify({ state_hash: hash, ...(push ? { state: sent } : {}), acks, hook_acks: hookAcks }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`the relay answered ${res.status}${res.status === 401 ? " (wrong relay token: redeploy with npm run relay:deploy)" : ""}`);
      body = (await res.json()) as typeof body;
    } catch (e) {
      // Nothing was delivered: keep the verdicts for the next sync.
      this.acks.unshift(...acks);
      this.hookAcks.unshift(...hookAcks);
      throw e;
    }
    // A relay that lost its copy (or never had it) gets the whole state on the next sync.
    this.lastPushed = body.need_state ? null : hash;
    for (const item of body.inbox) await this.handle(item);
    if (this.deps.onHook) {
      for (const h of body.hooks ?? []) {
        if (this.hookAcks.includes(h.id)) continue;
        this.deps.log(`hook     ${redactSecrets(this.deps.onHook(h))}`);
        // Handled (recorded, or refused for a reason a resend cannot change): the relay may drop it.
        this.hookAcks.push(h.id);
      }
    }
    return { pushed: push, inbox: body.inbox.length };
  }

  /** Waits for every executor that is still running (tests, and a clean shutdown). */
  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running]);
  }

  private ack(ticket: string, status: string, raw: string): void {
    // A verdict goes to the relay and the phone, and to the log: never with a credential in it.
    const message = redactSecrets(raw);
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

  /**
   * The CFO's words go to Opus beside the syncs, so a slow model never holds up an approval. The ticket stays queued
   * on the relay until the answer: a runner restarted meanwhile reads it again.
   */
  private draft(item: InboxItem): void {
    const draftPolicy = this.deps.draftPolicy;
    let text: unknown;
    try {
      text = (JSON.parse(item.body) as { text?: unknown }).text;
    } catch {
      text = undefined;
    }
    if (!draftPolicy || typeof text !== "string") {
      this.ack(item.ticket, "refused", draftPolicy ? "malformed submission" : "this runner does not draft rules from text");
      return;
    }
    const run = draftPolicy(text).then(
      (r) => this.ack(item.ticket, r.proposalId ? "drafted" : "refused", r.message),
      (e: unknown) => this.ack(item.ticket, "refused", `the runner could not draft rules from this text (${(e instanceof Error ? e.message : String(e)).slice(0, 200)}); nothing changed`),
    );
    this.running.add(run);
    void run.finally(() => this.running.delete(run));
  }

  /** Ask Purser: the reply goes back on the ticket; a task card proposal then waits for Face ID like any other. */
  private answer(item: InboxItem): void {
    const ask = this.deps.ask;
    let text: unknown;
    try {
      text = (JSON.parse(item.body) as { text?: unknown }).text;
    } catch {
      text = undefined;
    }
    if (!ask || typeof text !== "string") {
      this.ack(item.ticket, "refused", ask ? "malformed submission" : "this runner does not take chat messages");
      return;
    }
    const run = ask(text, item.ticket).then(
      (r) => this.ack(item.ticket, "answered", r.reply),
      (e: unknown) => this.ack(item.ticket, "refused", `Purser could not answer (${(e instanceof Error ? e.message : String(e)).slice(0, 200)}); nothing changed`),
    );
    this.running.add(run);
    void run.finally(() => this.running.delete(run));
  }

  private async process(item: InboxItem): Promise<void> {
    const { db } = this.deps;
    if (item.kind === "registration") {
      const out = await processRegistration(db, item, { label: this.deps.label ?? "max" }, this.now());
      this.ack(item.ticket, out.status, out.message);
      return;
    }
    if (item.kind === "policy_text") {
      this.draft(item);
      return;
    }
    if (item.kind === "ask") {
      this.answer(item);
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
