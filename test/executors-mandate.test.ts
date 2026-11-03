// Mandate replacement (src/executors/mandateReplace.ts) and the owner's signer (src/executors/ownerSigner.ts): an
// approved mandate_replace runs its steps in the approved order (shrink treasury before growing sourcing), never above
// the 20.00 total, only while the chain is still as it was proposed, once per step even across a crash; unapproved or
// altered terms sign nothing. The chain (mandate states) and the metal-agent CLI are fakes; the ledger and the approval
// flow are real. No network.
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliResult } from "../src/metal/agentCli.js";

type Cred = { agent: string; path: string; hash: string; reference: string; principal: string };
type State = { boundBlock: bigint; revoked: boolean; spent: bigint };
const h = vi.hoisted(() => ({
  dir: "",
  creds: [] as Cred[],
  chain: new Map<string, State>(),
  cli: [] as string[][],
  failReplaceOf: null as string | null,
}));

const cliOut = (lines: string[]): CliResult => {
  const fields = new Map<string, string[]>();
  for (const l of lines) { const i = l.indexOf(" "); fields.set(l.slice(0, i), [...(fields.get(l.slice(0, i)) ?? []), l.slice(i + 1)]); }
  return { code: 0, fields, out: lines.join("\n") };
};

vi.mock("../src/metal/agentCli.js", () => ({
  keyPath: (name: string) => join(h.dir, name),
  metalAgent: (args: string[]) => {
    h.cli.push(args);
    const arg = (k: string) => args[args.indexOf(k) + 1]!;
    if (args[1] === "replace") {
      const next = h.creds.find((c) => c.path === arg("--credential"))!;
      const old = h.creds.find((c) => c.path === arg("--replaces"))!;
      if (h.failReplaceOf === next.path) throw new Error("metal-agent mandate replace exited 2: rpc unreachable");
      const o = h.chain.get(old.reference)!;
      h.chain.set(old.reference, { ...o, revoked: true });
      h.chain.set(next.reference, { boundBlock: 50n, revoked: false, spent: o.spent }); // spend carries over
      return cliOut([`transaction 0xreplace-${next.agent}`]);
    }
    if (args[1] === "credential") {
      writeFileSync(arg("--out"), "{}");
      return cliOut(["credential written"]);
    }
    throw new Error(`unexpected metal-agent ${args.join(" ")}`);
  },
}));
vi.mock("../src/metal/chain.js", () => ({ publicClient: () => ({}) }));
vi.mock("@metalntwx/metal-pay/mandates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@metalntwx/metal-pay/mandates")>()),
  readMandateState: async (_pc: unknown, _principal: string, reference: string) => h.chain.get(reference) ?? { boundBlock: 0n, revoked: false, spent: 0n },
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
const { issueReplacementCredential, replaceMandate } = await import("../src/executors/ownerSigner.js");
const { openDb } = await import("../src/db/open.js");
const { createProposal, decide } = await import("../src/policy/approvals.js");
const { TERMS_SCHEMA } = await import("../src/lib/terms.js");
const { getSetting } = await import("../src/world/settings.js");
type DB = ReturnType<typeof openDb>;

const PRINCIPAL = "0x00000000000000000000000000000000000000b1";
const units = (cents: number) => BigInt(cents) * 10n ** 16n;
function cred(agent: string, tag: string, state?: Partial<State>): Cred {
  const c = { agent, path: `/keys/${agent}.${tag}.credential.json`, hash: `0x${agent}${tag}`.padEnd(66, "0"), reference: `ref-${agent}-${tag}`, principal: PRINCIPAL };
  h.creds.push(c);
  if (state) h.chain.set(c.reference, { boundBlock: 0n, revoked: false, spent: 0n, ...state });
  return c;
}

let db: DB;
let T0: Cred, T1: Cred, S0: Cred, S1: Cred;
let n = 0;

function step(order: string, agent: string, next: Cred, old: Cred, cap: string, budget: string, spent: string) {
  return { order, agent, principal: PRINCIPAL, cap, budget, payees: [], expires_at: "2099-01-01T00:00:00Z", credential_hash: next.hash, replaces_credential_hash: old.hash, spent_at_proposal: spent };
}
function propose(over: Record<string, unknown> = {}, steps?: unknown[]) {
  const id = `P-M${++n}`;
  const terms = {
    schema: TERMS_SCHEMA, kind: "mandate_replace", proposal_id: id, expires_at: "2099-01-01T00:00:00Z",
    option: "raise", query_price: "0.07", upstream_price: "0.04", margin: "0.03", total_budget: "20.00",
    // Listed out of order on purpose; "9" before "10" only when sorted as numbers.
    steps: steps ?? [step("10", "sourcing", S1, S0, "0.04", "12.00", "3.00"), step("9", "treasury", T1, T0, "4.00", "4.00", "1.00")],
    evidence: [], ...over,
  };
  const p = createProposal(db, { terms: terms as never, createdBy: "treasury" });
  return { id, sha: p.terms_sha256 };
}
const approve = (p: { id: string; sha: string }) => decide(db, { proposalId: p.id, decision: "APPROVED", typedPrefix: p.sha.slice(0, 8), approver: "max", method: "cli" });
const status = (id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;
const replaces = () => h.cli.filter((a) => a[1] === "replace").map((a) => a[a.indexOf("--credential") + 1]);
const bound = (c: Cred) => { const s = h.chain.get(c.reference); return !!s && s.boundBlock > 0n && !s.revoked; };

beforeEach(() => {
  h.dir = mkdtempSync(join(tmpdir(), "owner-keys-"));
  h.creds = [];
  h.chain = new Map();
  h.cli = [];
  h.failReplaceOf = null;
  db = openDb(":memory:");
  T0 = cred("treasury", "v0", { boundBlock: 10n, spent: units(100) });
  T1 = cred("treasury", "v1");
  S0 = cred("sourcing", "v0", { boundBlock: 10n, spent: units(300) });
  S1 = cred("sourcing", "v1");
});

describe("executeMandateReplace", () => {
  it("replaces in the approved numeric order, treasury before sourcing, and finishes the proposal", async () => {
    const p = propose();
    const sibling = propose({ option: "keep-price", query_price: "0.05" }); // replaces the same mandates
    const unrelated = propose({ option: "other" }, [step("1", "treasury", T1, cred("treasury", "vX"), "1.00", "1.00", "0.00")]);
    approve(p);
    await executeMandateReplace(db, p.id);
    // Fails if: the sort by Number(order) is removed or becomes a string sort (sourcing would grow before treasury shrinks).
    expect(replaces()).toEqual([T1.path, S1.path]);
    expect(h.cli[0]).toEqual(["mandate", "replace", "--credential", T1.path, "--replaces", T0.path, "--key", join(h.dir, "owner-business.key.json")]);
    expect([bound(T1), bound(S1), bound(T0), bound(S0)]).toEqual([true, true, false, false]);
    expect(status(p.id)).toBe("EXECUTED");
    expect(db.prepare("SELECT step_no, status, external_ref FROM executions ORDER BY id").all()).toEqual([
      { step_no: 9, status: "DONE", external_ref: "0xreplace-treasury" }, { step_no: 10, status: "DONE", external_ref: "0xreplace-sourcing" },
    ]);
    // Fails if: the new sell price is not set with the mandates it was approved with.
    expect(getSetting(db, "sell_price", "")).toBe("0.07");
    // Fails if: supersedeSiblings is dropped (the other option could still be approved against obsolete mandates) or
    // supersedes a proposal that replaces other mandates.
    expect(status(sibling.id)).toBe("SUPERSEDED");
    expect(status(unrelated.id)).toBe("PENDING_APPROVAL");
  });

  it("signs nothing for a proposal that was not approved", async () => {
    const p = propose();
    // Fails if: beginExecution is bypassed (the owner key would replace mandates nobody approved).
    await expect(executeMandateReplace(db, p.id)).rejects.toThrow(`${p.id} is PENDING_APPROVAL, not approved`);
    expect(h.cli).toEqual([]);
  });

  it("signs nothing when the stored terms were changed after approval", async () => {
    const p = propose();
    approve(p);
    const t = JSON.parse((db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(p.id) as { terms_json: string }).terms_json);
    t.steps[0].budget = "16.00";
    db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = ?").run(JSON.stringify(t), p.id);
    // Fails if: the approved-hash check is removed.
    await expect(executeMandateReplace(db, p.id)).rejects.toThrow("terms do not match the approved hash");
    expect(h.cli).toEqual([]);
  });

  it("refuses a total above 20.00 before any replace, and closes the proposal with the reason (dry-179: it can never run)", async () => {
    const p = propose({ total_budget: "20.01" });
    approve(p);
    // Fails if: the TOTAL_BUDGET_CENTS precondition is removed.
    await expect(executeMandateReplace(db, p.id)).rejects.toThrow("total 20.01 exceeds the limit");
    expect(h.cli).toEqual([]);
    // dry-179 (a): before, it stayed APPROVED with no row in the ledger; now it is closed, terminal, with the reason.
    expect(status(p.id)).toBe("NEEDS_REAPPROVAL");
    expect(db.prepare("SELECT json_extract(payload_json, '$.error') AS error FROM audit_log WHERE event = 'proposal.needs_reapproval' AND subject = ?").get(p.id)).toEqual({ error: "total 20.01 exceeds the limit" });
  });

  it("refuses when the bound mandate is no longer the one the proposal replaces", async () => {
    const p = propose();
    approve(p);
    const other = cred("treasury", "v9", { boundBlock: 20n, spent: units(100) });
    h.chain.set(T0.reference, { ...h.chain.get(T0.reference)!, revoked: true });
    expect(bound(other)).toBe(true);
    // Fails if: the active-hash precondition is removed (the owner would replace a mandate nobody looked at).
    await expect(executeMandateReplace(db, p.id)).rejects.toThrow("treasury: the bound mandate is no longer the one this proposal replaces");
    expect(h.cli).toEqual([]);
  });

  it("refuses when spend moved since the proposal", async () => {
    const p = propose();
    approve(p);
    h.chain.set(S0.reference, { ...h.chain.get(S0.reference)!, spent: units(304) });
    // Fails if: the spent precondition is removed (budgets were sized for spend that no longer holds).
    await expect(executeMandateReplace(db, p.id)).rejects.toThrow("sourcing: spent moved from 3.00 to 3.04 since the proposal; a new one is needed");
    expect(h.cli).toEqual([]);
  });

  it("marks a crash FAILED, and a re-run finishes the job without replacing a step twice", async () => {
    const p = propose();
    approve(p);
    h.failReplaceOf = S1.path;
    await expect(executeMandateReplace(db, p.id)).rejects.toThrow(/rpc unreachable/);
    // Fails if: the catch that records FAILED is removed (the proposal would stay EXECUTING and never re-run).
    expect(status(p.id)).toBe("FAILED");
    expect(db.prepare("SELECT step_no, status FROM executions ORDER BY id").all()).toEqual([{ step_no: 9, status: "DONE" }, { step_no: 10, status: "STARTED" }]);
    h.failReplaceOf = null;
    await executeMandateReplace(db, p.id);
    // Fails if: DONE steps are not skipped, or a bound replacement does not count as done in the precondition.
    expect(replaces()).toEqual([T1.path, S1.path, S1.path]);
    expect(status(p.id)).toBe("EXECUTED");
    expect(db.prepare("SELECT COUNT(*) AS n FROM executions").get()).toEqual({ n: 2 });
  });

  it("does not replace a step whose new credential is already bound (a crash after the replace)", async () => {
    const p = propose();
    approve(p);
    h.chain.set(T0.reference, { ...h.chain.get(T0.reference)!, revoked: true });
    h.chain.set(T1.reference, { boundBlock: 40n, revoked: false, spent: units(100) });
    await executeMandateReplace(db, p.id);
    // Fails if: isBound(next) is not checked before replaceMandate (the owner would send a replace that must fail).
    expect(replaces()).toEqual([S1.path]);
    expect(db.prepare("SELECT step_no, external_ref FROM executions ORDER BY id").all()).toEqual([{ step_no: 9, external_ref: null }, { step_no: 10, external_ref: "0xreplace-sourcing" }]);
  });

  it("refuses a step naming a credential the keys directory does not hold", async () => {
    const p = propose({}, [step("1", "treasury", { ...T1, hash: `0x${"de".repeat(32)}` }, T0, "4.00", "4.00", "1.00")]);
    approve(p);
    // Fails if: byHash stops throwing for an unknown hash.
    await expect(executeMandateReplace(db, p.id)).rejects.toThrow(/treasury: no credential file with hash 0xdede/);
    expect(h.cli).toEqual([]);
  });
});

describe("the owner's signer", () => {
  const spec = {
    agent: "sourcing" as const, principal: PRINCIPAL as `0x${string}`, capCents: 4, budgetCents: 1200,
    payees: [{ address: "0x00000000000000000000000000000000000000f1" as `0x${string}`, name: "Stockline" }], description: "after the price rise",
  };

  it("issues a replacement credential with the exact limits, signed by the owner key, reusing the agent's key", () => {
    const out = issueReplacementCredential(spec, "P-0007", "/keys/sourcing.key.json");
    expect(out).toBe(join(h.dir, "sourcing.P-0007.credential.json"));
    // Fails if: cap, budget, payee, expiry or the issuer key change (the credential would grant other limits).
    expect(h.cli).toEqual([[
      "mandate", "credential", "create", "--principal", PRINCIPAL, "--cap", "0.04", "--budget", "12.00",
      "--payee", "0x00000000000000000000000000000000000000f1,Stockline", "--expires-in", String(40 * 24 * 60 * 60),
      "--description", "after the price rise", "--mandate-key-file", "/keys/sourcing.key.json",
      "--key", join(h.dir, "owner-business.key.json"), "--out", out,
    ]]);
    expect(existsSync(out)).toBe(true);
  });

  it("keeps an existing credential file instead of issuing another", () => {
    writeFileSync(join(h.dir, "sourcing.P-0007.credential.json"), "{}");
    // Fails if: the existsSync check is removed (a second, different credential would be issued for the same proposal).
    expect(issueReplacementCredential(spec, "P-0007", "/keys/sourcing.key.json")).toBe(join(h.dir, "sourcing.P-0007.credential.json"));
    expect(h.cli).toEqual([]);
  });

  it("reports the replace transaction", () => {
    // Fails if: the transaction line is not read back (the execution record would lose its on-chain reference).
    expect(replaceMandate(T1.path, T0.path)).toEqual({ tx: "0xreplace-treasury", out: "transaction 0xreplace-treasury" });
  });
});
