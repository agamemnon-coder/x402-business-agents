// dry-179's order of events, end to end on fakes (2 November). 22:01:37 Treasury files P-0002/P-0003 (two price
// options, each replacing the sourcing and treasury mandates, spent as at the proposal). 22:01:47 on a routine wake
// Treasury sweeps 0.45 from its own mandate. 22:02:37 P-0002 is approved 2 of 2 (four eyes). 22:02:39 the executor
// refused it: "treasury: spent moved from 0.00 to 0.45 since the proposal; a new one is needed".
// Now the sweep is held before signing while the replace is open, so the spend does not move, and P-0002 executes. The
// executor's guard is untouched: a spend that moves anyway (here: on the chain behind the ledger's back) still fails it.
// The chain (mandate states) and the metal-agent CLI are fakes; the ledger, the approvals and four eyes are real.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import type { CliResult } from "../src/metal/agentCli.js";
import type { Puller } from "../src/metal/pull.js";

type Cred = { agent: string; path: string; hash: string; reference: string; principal: string };
type State = { boundBlock: bigint; revoked: boolean; spent: bigint };
const h = vi.hoisted(() => ({ dir: "", creds: [] as Cred[], chain: new Map<string, State>(), cli: [] as string[][], heldAtStep: [] as (string | null)[], onReplace: null as null | (() => string | null), readFails: 0 }));

const cliOut = (lines: string[]): CliResult => {
  const fields = new Map<string, string[]>();
  for (const l of lines) { const i = l.indexOf(" "); fields.set(l.slice(0, i), [...(fields.get(l.slice(0, i)) ?? []), l.slice(i + 1)]); }
  return { code: 0, fields, out: lines.join("\n") };
};
vi.mock("../src/metal/agentCli.js", () => ({
  keyPath: (name: string) => `${h.dir}/${name}`,
  metalAgent: (args: string[]) => {
    h.cli.push(args);
    const arg = (k: string) => args[args.indexOf(k) + 1]!;
    if (args[1] === "replace") {
      h.heldAtStep.push(h.onReplace?.() ?? null);
      const next = h.creds.find((c) => c.path === arg("--credential"))!;
      const old = h.creds.find((c) => c.path === arg("--replaces"))!;
      const o = h.chain.get(old.reference)!;
      h.chain.set(old.reference, { ...o, revoked: true });
      h.chain.set(next.reference, { boundBlock: 50n, revoked: false, spent: o.spent }); // the spend carries over
      return cliOut([`transaction 0xreplace-${next.agent}`]);
    }
    throw new Error(`unexpected metal-agent ${args.join(" ")}`);
  },
}));
vi.mock("../src/metal/chain.js", () => ({ publicClient: () => ({}) }));
vi.mock("@metalntwx/metal-pay/mandates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@metalntwx/metal-pay/mandates")>()),
  readMandateState: async (_pc: unknown, _principal: string, reference: string) => {
    if (h.readFails > 0) { h.readFails--; throw new Error("fetch failed: ECONNRESET (the RPC)"); }
    return h.chain.get(reference) ?? { boundBlock: 0n, revoked: false, spent: 0n };
  },
}));
vi.mock("../src/metal/mandate.js", () => {
  const load = (agent: string, path: string) => {
    const c = h.creds.find((x) => x.agent === agent && x.path === path)!;
    return { agent, credentialPath: c.path, credentialHash: c.hash, principal: c.principal, reference: c.reference, keyFile: `${agent}.key.json` };
  };
  return {
    credentialFiles: (agent: string) => h.creds.filter((c) => c.agent === agent).map((c) => c.path),
    loadCredentialFile: load,
    activeMandate: async (agent: string) => {
      const live = h.creds.filter((c) => c.agent === agent && (h.chain.get(c.reference)?.boundBlock ?? 0n) > 0n && !h.chain.get(c.reference)!.revoked);
      if (live.length !== 1) throw new Error(`${agent}: expected one bound mandate, found ${live.length}`);
      return load(agent, live[0]!.path);
    },
  };
});

const { executeMandateReplace } = await import("../src/executors/mandateReplace.js");
const { openDb } = await import("../src/db/open.js");
const { audit } = await import("../src/audit/log.js");
const { createProposal, decide } = await import("../src/policy/approvals.js");
const { approvalHashOf } = await import("../src/metal/ownersExecute.js");
const { TERMS_SCHEMA } = await import("../src/lib/terms.js");
const { executeSweep } = await import("../src/agents/sweep.js");
const { replaceHoldRefusal } = await import("../src/policy/replaceHold.js");
type DB = ReturnType<typeof openDb>;

const PRINCIPAL = "0x00000000000000000000000000000000000000b1";
const SWEEP = "0x00000000000000000000000000000000000000aa" as Address;
const units = (cents: number) => BigInt(cents) * 10n ** 16n;
function cred(agent: string, tag: string, state?: Partial<State>): Cred {
  const c = { agent, path: `/keys/${agent}.${tag}.credential.json`, hash: `0x${agent}${tag}`.padEnd(66, "0"), reference: `ref-${agent}-${tag}`, principal: PRINCIPAL };
  h.creds.push(c);
  if (state) h.chain.set(c.reference, { boundBlock: 0n, revoked: false, spent: 0n, ...state });
  return c;
}
const step = (order: string, agent: string, next: Cred, old: Cred, cap: string, budget: string, spent: string) =>
  ({ order, agent, principal: PRINCIPAL, cap, budget, payees: [], expires_at: "2099-01-01T00:00:00Z", credential_hash: next.hash, replaces_credential_hash: old.hash, spent_at_proposal: spent });
const status = (db: DB, id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;

let db: DB;
let T0: Cred, T1: Cred, S0: Cred, S1: Cred;
const env = { ...process.env };
afterEach(() => { process.env = { ...env }; });
beforeEach(() => {
  h.dir = "/tmp/none";
  h.creds = [];
  h.chain = new Map();
  h.cli = [];
  h.heldAtStep = [];
  h.readFails = 0;
  db = openDb(":memory:");
  h.onReplace = () => replaceHoldRefusal(db, "treasury");
  // Four eyes on, as in the dry run: a mandate change takes two different people's passkeys.
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('approval.four_eyes_eur', '1000.00', 'now')").run();
  audit(db, "owner-signer", "mandate.bound", "treasury", { cap: "6.00", budget: "6.00" });
  audit(db, "owner-signer", "mandate.bound", "sourcing", { cap: "0.03", budget: "10.00" });
  T0 = cred("treasury", "v0", { boundBlock: 10n, spent: units(0) });
  T1 = cred("treasury", "v1");
  S0 = cred("sourcing", "v0", { boundBlock: 10n, spent: units(30) });
  S1 = cred("sourcing", "v1");
  // 0.45 of earnings on the business account (nine sales at 0.05).
  for (let i = 0; i < 9; i++) db.prepare("INSERT INTO sales (route, price_cents, payer, request_url, request_params_json, status, created_at) VALUES ('GET /v1/stock', 5, '0xc1', 'u', '{}', 'DELIVERED', 'now')").run();
});

/** Treasury files the two price options (22:01:37); each replaces the treasury and sourcing mandates. */
function propose(): { id: string; sha: string }[] {
  return ([["P-0002", "0.05"], ["P-0003", "0.06"]] as const).map(([id, price]) => {
    const terms = { schema: TERMS_SCHEMA, kind: "mandate_replace", proposal_id: id, expires_at: new Date(Date.now() + 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
      option: id === "P-0002" ? "A" : "B", query_price: price, upstream_price: "0.04", margin: "0.01", total_budget: "20.00",
      steps: [step("1", "treasury", T1, T0, "5.50", "5.50", "0.00"), step("2", "sourcing", S1, S0, "0.04", "10.50", "0.30")], evidence: [] };
    const p = createProposal(db, { terms: terms as never, createdBy: "treasury" });
    return { id, sha: p.terms_sha256 };
  });
}
/** One replace proposal with the given steps (four eyes applies), for the cases besides Treasury's two options. */
function propose2(id: string, steps: unknown[]): string {
  const terms = { schema: TERMS_SCHEMA, kind: "mandate_replace", proposal_id: id, expires_at: new Date(Date.now() + 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    option: "A", query_price: "0.05", upstream_price: "0.04", margin: "0.01", total_budget: "20.00", steps, evidence: [] };
  createProposal(db, { terms: terms as never, createdBy: "treasury" });
  return id;
}
/** One person's Face ID (a passkey signing the approval hash). */
function approveBy(p: { id: string; sha: string }, person: string) {
  const row = db.prepare("SELECT kind, terms_json, terms_sha256 FROM proposals WHERE proposal_id = ?").get(p.id) as { kind: string; terms_json: string; terms_sha256: string };
  return decide(db, { proposalId: p.id, decision: "APPROVED", typedPrefix: p.sha.slice(0, 8), approver: `${person} (passkey ${person.slice(-4)})`, method: "passkey", signedSha256: approvalHashOf(row), passkey: { credentialId: `cred-${person}`, assertionSha256: `a-${person}` } });
}
/** The sweep's pull: sending it moves the treasury mandate's spend on chain, as it did in dry-179. */
function sweepPull(sent: string[]): Puller {
  return async (r) => {
    sent.push(r.paymentId);
    const s = h.chain.get(T0.reference)!;
    h.chain.set(T0.reference, { ...s, spent: s.spent + units(r.amountCents) });
    return { outcome: "PAID", tx: `0x${"ee".repeat(32)}`, reason: null, already: false };
  };
}

describe("dry-179's order of events, with the replace hold", () => {
  it("propose, then the sweep is held, then 2 of 2, then the replace executes; the sweep runs after it", async () => {
    const [p2, p3] = propose();
    // 22:01:47: Treasury's routine wake sweeps the earnings. Held before signing: nothing pulled, the spend unchanged.
    const sent: string[] = [];
    const held = await executeSweep(db, "sweep-20261102-1", 45, SWEEP, sweepPull(sent));
    expect(held).toMatchObject({ outcome: "REFUSED", reason: "replace_pending: mandate replace P-0002 and P-0003 pending; spending waits until it is executed or closed" });
    expect(sent).toEqual([]);
    expect(h.chain.get(T0.reference)!.spent).toBe(0n);
    // 22:02:32 and 22:02:37: four eyes, 1 of 2 then 2 of 2 on the same terms hash. Still held while approved, not run.
    expect(approveBy(p2!, "test-cfo")).toBe("PENDING_APPROVAL");
    expect(replaceHoldRefusal(db, "treasury")).toMatch(/^replace_pending: /);
    expect(approveBy(p2!, "test-controller")).toBe("APPROVED");
    expect(replaceHoldRefusal(db, "treasury")).toMatch(/^replace_pending: /);
    // 22:02:39: the replace executes (the guard's spent check passes: nothing moved), P-0003 is superseded.
    await executeMandateReplace(db, p2!.id);
    expect(status(db, p2!.id)).toBe("EXECUTED");
    expect(status(db, p3!.id)).toBe("SUPERSEDED");
    expect(h.cli.filter((a) => a[1] === "replace")).toHaveLength(2);
    // Held while it ran: each step was signed with the treasury mandate still on hold.
    expect(h.heldAtStep).toEqual([expect.stringMatching(/^replace_pending: mandate replace P-0002/), expect.stringMatching(/^replace_pending: mandate replace P-0002/)]);
    // The hold lifts: the same sweep now goes through, under the new treasury mandate.
    expect(replaceHoldRefusal(db, "treasury")).toBeNull();
    expect(await executeSweep(db, "sweep-20261102-1", 45, SWEEP, sweepPull(sent))).toMatchObject({ outcome: "PAID" });
    expect(sent).toEqual(["sweep-20261102-1"]);
  });

  it("the executor's guard is as strict as it was: a spend that moved anyway still stops the replace (and nothing is signed)", async () => {
    const [p2] = propose();
    approveBy(p2!, "test-cfo");
    approveBy(p2!, "test-controller");
    // The spend moves outside every path Purser holds (as the sweep did in dry-179).
    h.chain.set(T0.reference, { ...h.chain.get(T0.reference)!, spent: units(45) });
    await expect(executeMandateReplace(db, p2!.id)).rejects.toThrow("treasury: spent moved from 0.00 to 0.45 since the proposal; a new one is needed");
    expect(h.cli.filter((a) => a[1] === "replace")).toEqual([]);
  });
});

const SPENT_MOVED = "treasury: spent moved from 0.00 to 0.45 since the proposal; a new one is needed";
const needsRows = () => (db.prepare("SELECT subject, payload_json FROM audit_log WHERE event = 'proposal.needs_reapproval' ORDER BY seq").all() as { subject: string; payload_json: string }[]).map((r) => ({ subject: r.subject, ...JSON.parse(r.payload_json) as Record<string, unknown> }));
function treasurySim() {
  return {
    mandates: async () => [{ agent: "sourcing", capCents: 3, budgetCents: 1000, spentCents: 30 }, { agent: "support", capCents: 10, budgetCents: 400, spentCents: 0 }, { agent: "treasury", capCents: 600, budgetCents: 600, spentCents: 45 }] as never,
    proposePriceRise: async () => [], client: null, sweep: async () => ({ ok: true, text: "" }), planInvoice: async () => ({ ok: true, text: "" }),
  };
}

describe("dry-179 item (a): an approved replace its guard stops is closed in the ledger, with its reason", () => {
  it("the reason is recorded, P-0002 and its sibling P-0003 are closed, the hold lifts, Treasury is told; a fresh replace then executes", async () => {
    process.env.KIT11_AGENTS = "on"; process.env.KIT11_AUTONOMY = "on";
    const [p2, p3] = propose();
    const other = propose2("P-0009", [step("1", "treasury", T1, cred("treasury", "vX"), "1.00", "1.00", "0.00")]);
    approveBy(p2!, "test-cfo");
    approveBy(p2!, "test-controller");
    h.chain.set(T0.reference, { ...h.chain.get(T0.reference)!, spent: units(45) });
    await expect(executeMandateReplace(db, p2!.id)).rejects.toThrow(SPENT_MOVED);
    // A terminal state with the reason in the ledger: P-0002 can never be approved or run again.
    expect(status(db, p2!.id)).toBe("NEEDS_REAPPROVAL");
    // Its other option replaces the same mandates from the same spend: it could never run either, so it is closed too.
    expect(status(db, p3!.id)).toBe("NEEDS_REAPPROVAL");
    // A replace of other mandates is not touched.
    expect(status(db, other)).toBe("PENDING_APPROVAL");
    expect(needsRows()).toEqual([
      expect.objectContaining({ subject: "P-0002", error: SPENT_MOVED, stopped: "before its first step" }),
      expect.objectContaining({ subject: "P-0003", error: `${SPENT_MOVED} (found when P-0002, another option of the same change, was run)`, sibling_of: "P-0002" }),
    ]);
    expect(() => approveBy(p3!, "test-cfo")).toThrow(/is NEEDS_REAPPROVAL, not waiting for approval/);
    // The hold lifts (P-0009 holds only the mandate it names: treasury).
    expect(replaceHoldRefusal(db, "sourcing")).toBeNull();
    db.prepare("UPDATE proposals SET status = 'REJECTED' WHERE proposal_id = ?").run(other);
    expect(replaceHoldRefusal(db, "treasury")).toBeNull();
    // Treasury is woken with the facts, and its position states them.
    const { pending } = await import("../src/autonomy/bus.js");
    expect(pending(db, "treasury").events).toEqual([expect.objectContaining({ kind: "mandate_replace.stopped", payload: expect.objectContaining({ proposal_id: "P-0002", closed: ["P-0003"], reason: SPENT_MOVED }) })]);
    const { treasuryProfile } = await import("../src/autonomy/teamProfiles.js");
    const prof = treasuryProfile(30 * 60_000, { runFlow: () => ({ ok: true, text: "" }), sim: treasurySim() });
    const pos = await prof.observe(db);
    expect(pos).toContain(`Mandate replace P-0002 was approved, but code did not run it: ${SPENT_MOVED}. It is closed; P-0003, another option of the same change, is closed with it.`);
    expect(pos).toContain("No mandate replace waits for the CFO now: if an agent is still blocked by its mandate, a new rebalance (design_rebalance) is needed; code plans it from the spend as it is now.");
    // A fresh replace, proposed from the spend as it is now, is approved 2 of 2 and executes.
    const p4 = propose2("P-0004", [step("1", "treasury", T1, T0, "5.50", "5.50", "0.45"), step("2", "sourcing", S1, S0, "0.04", "10.50", "0.30")]);
    const sha = (db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(p4) as { terms_sha256: string }).terms_sha256;
    approveBy({ id: p4, sha }, "test-cfo");
    approveBy({ id: p4, sha }, "test-controller");
    await executeMandateReplace(db, p4);
    expect(status(db, p4)).toBe("EXECUTED");
    // The old failure is no longer stated once a newer replace was proposed.
    expect(await prof.observe(db)).not.toContain("did not run it");
  });

  it("the feed and Watch name the reason", async () => {
    const [p2, p3] = propose();
    approveBy(p2!, "test-cfo");
    approveBy(p2!, "test-controller");
    h.chain.set(T0.reference, { ...h.chain.get(T0.reference)!, spent: units(45) });
    await expect(executeMandateReplace(db, p2!.id)).rejects.toThrow(SPENT_MOVED);
    const { describe: feedLine } = await import("../src/dashboard/snapshot.js");
    const rows = db.prepare("SELECT * FROM audit_log WHERE event = 'proposal.needs_reapproval' ORDER BY seq").all() as never[];
    expect(rows.map((r) => feedLine(r, () => undefined).text)).toEqual([
      `${p2!.id} was approved, but code did not run it: ${SPENT_MOVED}. It is closed; a new proposal is needed`,
      `${p3!.id} is closed: ${SPENT_MOVED} (found when ${p2!.id}, another option of the same change, was run). A new proposal is needed`,
    ]);
    const { stoppedFace } = await import("../src/redesign/run.js");
    const row = db.prepare("SELECT ts, event, subject, payload_json FROM audit_log WHERE event = 'proposal.needs_reapproval' ORDER BY seq LIMIT 1").get() as { ts: string; event: string; subject: string; payload_json: string };
    expect(stoppedFace({ ts: row.ts, event: row.event, subject: row.subject, payload: JSON.parse(row.payload_json) as Record<string, unknown> }, "Mandate change (option A)"))
      .toEqual({ k: "face", at: row.ts, id: p2!.id, title: "Mandate change (option A)", status: "STOPPED", signers: [], reason: SPENT_MOVED });
  });

  it("a resume after a crash mid-step that its guard refuses is not closed: it stays EXECUTING and held, for a person (health alerts)", async () => {
    const [p2, p3] = propose();
    db.prepare("UPDATE proposals SET status = 'REJECTED' WHERE proposal_id = ?").run(p3!.id);
    approveBy(p2!, "test-cfo");
    approveBy(p2!, "test-controller");
    // The crash: inside the first step's CLI call (its tx may have been broadcast), the proposal is left EXECUTING.
    h.onReplace = () => { throw new Error("process killed"); };
    await expect(executeMandateReplace(db, p2!.id)).rejects.toThrow(/process killed/);
    db.prepare("UPDATE proposals SET status = 'EXECUTING' WHERE proposal_id = ?").run(p2!.id);
    h.chain.set(T0.reference, { ...h.chain.get(T0.reference)!, spent: units(45) });
    h.onReplace = () => null;
    const { resumeInterrupted } = await import("../src/policy/saga.js");
    const out = await resumeInterrupted(db, (d, id) => executeMandateReplace(d, id));
    expect(out).toEqual([{ id: "P-0002", outcome: expect.stringMatching(/spent moved from 0\.00 to 0\.45/) }]);
    expect(status(db, p2!.id)).toBe("EXECUTING");
    expect(needsRows()).toEqual([]);
    expect(db.prepare("SELECT json_extract(payload_json, '$.steps_started') AS n FROM audit_log WHERE event = 'proposal.guard_refused'").get()).toEqual({ n: 1 });
    expect(replaceHoldRefusal(db, "treasury")).toMatch(/^replace_pending: /);
  });

  it("nothing is closed for a proposal not approved, a second run while one is running, or a chain read that failed", async () => {
    const [p2, p3] = propose();
    db.prepare("UPDATE proposals SET status = 'REJECTED' WHERE proposal_id = ?").run(p3!.id);
    await expect(executeMandateReplace(db, p2!.id)).rejects.toThrow(/not approved/);
    expect(status(db, p2!.id)).toBe("PENDING_APPROVAL");
    approveBy(p2!, "test-cfo");
    approveBy(p2!, "test-controller");
    // A chain read that fails (a network blip): the replace can still run, so it stays APPROVED and holds.
    h.readFails = 1;
    await expect(executeMandateReplace(db, p2!.id)).rejects.toThrow(/ECONNRESET/);
    expect(status(db, p2!.id)).toBe("APPROVED");
    expect(replaceHoldRefusal(db, "treasury")).toMatch(/^replace_pending: mandate replace P-0002 pending/);
    // A second call while it runs (status EXECUTING, not a resume): refused, nothing closed, the hold kept.
    db.prepare("UPDATE proposals SET status = 'EXECUTING' WHERE proposal_id = ?").run(p2!.id);
    await expect(executeMandateReplace(db, p2!.id)).rejects.toThrow(/is EXECUTING, not approved/);
    expect(status(db, p2!.id)).toBe("EXECUTING");
    expect(needsRows()).toEqual([]);
    expect(replaceHoldRefusal(db, "treasury")).toMatch(/^replace_pending: /);
    // Run for real once its status is back to approved: nothing moved, it executes.
    db.prepare("UPDATE proposals SET status = 'APPROVED' WHERE proposal_id = ?").run(p2!.id);
    await executeMandateReplace(db, p2!.id);
    expect(status(db, p2!.id)).toBe("EXECUTED");
  });

  it("a replace left EXECUTING by a crash holds past its expiry until it is resumed and finished", async () => {
    const [p2, p3] = propose();
    db.prepare("UPDATE proposals SET status = 'REJECTED' WHERE proposal_id = ?").run(p3!.id);
    approveBy(p2!, "test-cfo");
    approveBy(p2!, "test-controller");
    // The crash: the first step's CLI call never returns, the proposal is left EXECUTING.
    h.onReplace = () => { throw new Error("process killed"); };
    await expect(executeMandateReplace(db, p2!.id)).rejects.toThrow(/process killed/);
    db.prepare("UPDATE proposals SET status = 'EXECUTING' WHERE proposal_id = ?").run(p2!.id);
    expect(replaceHoldRefusal(db, "treasury", new Date(Date.now() + 2 * 3_600_000))).toMatch(/^replace_pending: mandate replace P-0002 pending/);
    // The restart resumes it from its last finished step; then the hold lifts.
    h.onReplace = () => replaceHoldRefusal(db, "treasury");
    const { resumeInterrupted } = await import("../src/policy/saga.js");
    await resumeInterrupted(db, (d, id) => executeMandateReplace(d, id));
    expect(status(db, p2!.id)).toBe("EXECUTED");
    expect(replaceHoldRefusal(db, "treasury", new Date(Date.now() + 2 * 3_600_000))).toBeNull();
  });
});

describe("review 2 of fix-dry179: never close a replace that ran a step, nor on a stale read", () => {
  it("a retry of a FAILED replace that already ran a step is not closed or called 'not run'; the hold stays while it is open", async () => {
    const [p2, p3] = propose();
    db.prepare("UPDATE proposals SET status = 'REJECTED' WHERE proposal_id = ?").run(p3!.id);
    approveBy(p2!, "test-cfo");
    approveBy(p2!, "test-controller");
    // Step 1 (treasury) is bound, then the sourcing step fails: FAILED, half replaced.
    let n = 0;
    h.onReplace = () => { if (++n === 2) throw new Error("rpc unreachable"); return null; };
    await expect(executeMandateReplace(db, p2!.id)).rejects.toThrow(/rpc unreachable/);
    expect(status(db, p2!.id)).toBe("FAILED");
    // Still held: a step of it is on chain.
    expect(replaceHoldRefusal(db, "sourcing")).toMatch(/^replace_pending: mandate replace P-0002 pending/);
    // The sourcing spend moves anyway (outside Purser): the retry's guard refuses, as strict as ever, but nothing is closed.
    h.chain.set(S0.reference, { ...h.chain.get(S0.reference)!, spent: units(34) });
    h.onReplace = () => null;
    await expect(executeMandateReplace(db, p2!.id)).rejects.toThrow(/sourcing: spent moved from 0\.30 to 0\.34/);
    expect(status(db, p2!.id)).toBe("FAILED");
    expect(needsRows()).toEqual([]);
    const refused = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'proposal.guard_refused'").get() as { payload_json: string };
    expect(JSON.parse(refused.payload_json)).toMatchObject({ error: expect.stringMatching(/sourcing: spent moved/), steps_started: 2 });
    const { describe: feedLine } = await import("../src/dashboard/snapshot.js");
    expect(feedLine(db.prepare("SELECT * FROM audit_log WHERE event = 'proposal.guard_refused'").get() as never, () => undefined).text).toMatch(/^P-0002: its execution was refused after 2 of its steps had started: sourcing: spent moved .*a person resolves it/);
  });

  it("a read lower than the spend at proposal (a stale RPC node) refuses, but closes nothing: the replace and its sibling stay open", async () => {
    const [p2, p3] = propose();
    approveBy(p2!, "test-cfo");
    approveBy(p2!, "test-controller");
    // Spent only goes up: 0.20 against 0.30 at proposal is a stale read, not a move.
    h.chain.set(S0.reference, { ...h.chain.get(S0.reference)!, spent: units(20) });
    await expect(executeMandateReplace(db, p2!.id)).rejects.toThrow(/sourcing: spent moved from 0\.30 to 0\.20/);
    expect([status(db, p2!.id), status(db, p3!.id)]).toEqual(["APPROVED", "PENDING_APPROVAL"]);
    expect(needsRows()).toEqual([]);
    // The node catches up: the same approval runs.
    h.chain.set(S0.reference, { ...h.chain.get(S0.reference)!, spent: units(30) });
    await executeMandateReplace(db, p2!.id);
    expect(status(db, p2!.id)).toBe("EXECUTED");
  });

  it("a sibling the same facts do not refuse stays open (filed later, from the spend as it is now)", async () => {
    const [p2] = propose();
    approveBy(p2!, "test-cfo");
    approveBy(p2!, "test-controller");
    h.chain.set(T0.reference, { ...h.chain.get(T0.reference)!, spent: units(45) });
    const fresh = propose2("P-0004", [step("1", "treasury", T1, T0, "5.50", "5.50", "0.45"), step("2", "sourcing", S1, S0, "0.04", "10.50", "0.30")]);
    await expect(executeMandateReplace(db, p2!.id)).rejects.toThrow(SPENT_MOVED);
    expect(status(db, p2!.id)).toBe("NEEDS_REAPPROVAL");
    expect(status(db, "P-0003")).toBe("NEEDS_REAPPROVAL");
    expect(status(db, fresh)).toBe("PENDING_APPROVAL");
  });

  it("a failure while recording the guard's refusal still throws the guard's reason and leaves a trace", async () => {
    const [p2] = propose();
    approveBy(p2!, "test-cfo");
    approveBy(p2!, "test-controller");
    h.chain.set(T0.reference, { ...h.chain.get(T0.reference)!, spent: units(45) });
    // Recording fails: the executions table it reads first is gone.
    db.exec("DROP TABLE executions");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(executeMandateReplace(db, p2!.id)).rejects.toThrow(SPENT_MOVED);
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/^P-0002: the guard's refusal could not be recorded: /));
    err.mockRestore();
    // Nothing closed (the safe old behaviour), and the ledger says why.
    expect(status(db, p2!.id)).toBe("APPROVED");
    const row = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'proposal.guard_refusal_unrecorded' AND subject = ?").get(p2!.id) as { payload_json: string };
    expect(JSON.parse(row.payload_json)).toMatchObject({ error: SPENT_MOVED, why: expect.stringMatching(/executions/) });
  });
});
