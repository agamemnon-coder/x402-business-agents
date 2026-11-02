// dry-179's order of events, end to end on fakes (2 November). 22:01:37 Treasury files P-0002/P-0003 (two price
// options, each replacing the sourcing and treasury mandates, spent as at the proposal). 22:01:47 on a routine wake
// Treasury sweeps 0.45 from its own mandate. 22:02:37 P-0002 is approved 2 of 2 (four eyes). 22:02:39 the executor
// refused it: "treasury: spent moved from 0.00 to 0.45 since the proposal; a new one is needed".
// Now the sweep is held before signing while the replace is open, so the spend does not move, and P-0002 executes. The
// executor's guard is untouched: a spend that moves anyway (here: on the chain behind the ledger's back) still fails it.
// The chain (mandate states) and the metal-agent CLI are fakes; the ledger, the approvals and four eyes are real.
import { beforeEach, describe, expect, it, vi } from "vitest";
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

  it("the executor's guard is as strict as it was: a spend that moved anyway still stops the replace, and the stopped replace holds nothing", async () => {
    const [p2] = propose();
    approveBy(p2!, "test-cfo");
    approveBy(p2!, "test-controller");
    // The spend moves outside every path Purser holds (as the sweep did in dry-179).
    h.chain.set(T0.reference, { ...h.chain.get(T0.reference)!, spent: units(45) });
    await expect(executeMandateReplace(db, p2!.id)).rejects.toThrow("treasury: spent moved from 0.00 to 0.45 since the proposal; a new one is needed");
    expect(h.cli.filter((a) => a[1] === "replace")).toEqual([]);
    // As in dry-179, the guard's transaction rolled back: P-0002 is still APPROVED (until it expires), with its stop
    // recorded. A replace that stopped keeps no hold: only P-0003, still waiting for the CFO, holds the mandate now.
    expect(status(db, p2!.id)).toBe("APPROVED");
    expect(db.prepare("SELECT subject, json_extract(payload_json, '$.error') AS error FROM audit_log WHERE event = 'proposal.execution_stopped'").all())
      .toEqual([{ subject: "P-0002", error: "treasury: spent moved from 0.00 to 0.45 since the proposal; a new one is needed" }]);
    // P-0003 still waits for the CFO, so the treasury mandate stays held for it; once that closes too, nothing holds.
    expect(replaceHoldRefusal(db, "treasury")).toBe("replace_pending: mandate replace P-0003 pending; spending waits until it is executed or closed");
    db.prepare("UPDATE proposals SET status = 'REJECTED' WHERE proposal_id = 'P-0003'").run();
    expect(replaceHoldRefusal(db, "treasury")).toBeNull();
  });
});

describe("a replace whose execution stopped holds nothing, without waiting for its expiry", () => {
  it("only P-0002 open, stopped by the guard: the treasury mandate is free at once; run again later, it holds while it runs", async () => {
    const [p2, p3] = propose();
    db.prepare("UPDATE proposals SET status = 'REJECTED' WHERE proposal_id = ?").run(p3!.id);
    approveBy(p2!, "test-cfo");
    approveBy(p2!, "test-controller");
    h.chain.set(T0.reference, { ...h.chain.get(T0.reference)!, spent: units(45) });
    await expect(executeMandateReplace(db, p2!.id)).rejects.toThrow(/spent moved/);
    expect(replaceHoldRefusal(db, "treasury")).toBeNull();
    expect(replaceHoldRefusal(db, "sourcing")).toBeNull();
    // Run again by a restart (resumeInterrupted re-runs approved proposals): held again from the attempt on, and it
    // stops again on the same guard, lifting the hold again.
    const { resumeInterrupted } = await import("../src/policy/saga.js");
    const seen: (string | null)[] = [];
    await resumeInterrupted(db, async (d, id) => { seen.push(replaceHoldRefusal(d, "treasury")); await executeMandateReplace(d, id); });
    expect(seen).toEqual([expect.stringMatching(/^replace_pending: mandate replace P-0002 pending/)]);
    expect(replaceHoldRefusal(db, "treasury")).toBeNull();
  });

  it("a proposal not yet approved records no stop when someone tries to run it, so its later approval still holds", async () => {
    const [p2, p3] = propose();
    db.prepare("UPDATE proposals SET status = 'REJECTED' WHERE proposal_id = ?").run(p3!.id);
    await expect(executeMandateReplace(db, p2!.id)).rejects.toThrow(/not approved/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'proposal.execution_stopped'").get()).toEqual({ n: 0 });
    approveBy(p2!, "test-cfo");
    approveBy(p2!, "test-controller");
    expect(replaceHoldRefusal(db, "treasury")).toMatch(/^replace_pending: mandate replace P-0002 pending/);
  });
});

describe("review of fix-dry179: what lifts the hold, and what does not", () => {
  it("a chain-read error before the guard (a network blip) records no stop: the hold stays until the replace runs or closes", async () => {
    const [p2, p3] = propose();
    db.prepare("UPDATE proposals SET status = 'REJECTED' WHERE proposal_id = ?").run(p3!.id);
    approveBy(p2!, "test-cfo");
    approveBy(p2!, "test-controller");
    h.readFails = 1;
    await expect(executeMandateReplace(db, p2!.id)).rejects.toThrow(/ECONNRESET/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'proposal.execution_stopped'").get()).toEqual({ n: 0 });
    expect(replaceHoldRefusal(db, "treasury")).toMatch(/^replace_pending: mandate replace P-0002 pending/);
    // Run again, it executes: nothing moved meanwhile.
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

  it("a resumed replace that its guard stops again records the stop, so an EXECUTING leftover does not hold for ever", async () => {
    const [p2, p3] = propose();
    db.prepare("UPDATE proposals SET status = 'REJECTED' WHERE proposal_id = ?").run(p3!.id);
    approveBy(p2!, "test-cfo");
    approveBy(p2!, "test-controller");
    h.onReplace = () => { throw new Error("process killed"); };
    await expect(executeMandateReplace(db, p2!.id)).rejects.toThrow(/process killed/);
    db.prepare("UPDATE proposals SET status = 'EXECUTING' WHERE proposal_id = ?").run(p2!.id);
    // Meanwhile the treasury spend moved on chain: the resume's guard refuses, as strict as ever.
    h.chain.set(T0.reference, { ...h.chain.get(T0.reference)!, spent: units(45) });
    h.onReplace = () => null;
    const { resumeInterrupted } = await import("../src/policy/saga.js");
    const out = await resumeInterrupted(db, (d, id) => executeMandateReplace(d, id));
    expect(out).toEqual([{ id: "P-0002", outcome: expect.stringMatching(/spent moved from 0\.00 to 0\.45/) }]);
    expect(status(db, p2!.id)).toBe("EXECUTING");
    expect(replaceHoldRefusal(db, "treasury")).toBeNull();
  });

  it("a second run of a replace that is already running records no stop (the first run keeps the hold)", async () => {
    const [p2, p3] = propose();
    db.prepare("UPDATE proposals SET status = 'REJECTED' WHERE proposal_id = ?").run(p3!.id);
    approveBy(p2!, "test-cfo");
    approveBy(p2!, "test-controller");
    db.prepare("UPDATE proposals SET status = 'EXECUTING' WHERE proposal_id = ?").run(p2!.id);
    await expect(executeMandateReplace(db, p2!.id)).rejects.toThrow(/is EXECUTING, not approved/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'proposal.execution_stopped'").get()).toEqual({ n: 0 });
    expect(replaceHoldRefusal(db, "treasury")).toMatch(/^replace_pending: /);
  });
});
