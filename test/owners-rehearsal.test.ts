// The live run on the passkey account, rehearsed start to end against the in-process stand-ins: preflight, setup from
// a donor key, the bind (proposed, signed by both passkeys through the runner's own passkey processing, relayed by the
// executor behind the call budget), a payment inside the mandate, a payment over the cap refused on chain, the replace
// that raises the cap (two approvals, relayed), the refused amount paid, the revoke, status, and the record.
// Breaks if:
//   (a) the call log does not hold exactly what the stand-in chain received, or a step logs another number of calls
//       than the plan preflight prints;
//   (b) the budget does not stop the run at the very request over it, or a raised budget makes the run send again
//       what it had sent;
//   (c) a crash between a send and its receipt leads to a second send;
//   (d) a proposal past its fifteen minutes can still be signed or run, or a fresh one cannot;
//   (e) the record says anything else than the audit rows, or holds a credential.
// Software passkeys, the stand-in chain and a stand-in for the CLI's network commands; no network.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hex } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { centsToBaseUnits } from "../src/lib/money.js";
import { EXPLORER_TX, USDZ } from "../src/metal/network.js";
import { countByStep, OwnersBudgetSpent, readOwnersCalls } from "../src/metal/ownersBudget.js";
import { cliCommand, ownersPlan, pay, planTotals, preflight, propose, proposeReplace, proposeRevoke, setup, status } from "../src/metal/ownersFlow.js";
import { recordRun, renderOwnersRecord, type OwnersRecord } from "../src/metal/ownersRecord.js";
import { ACCOUNT_FACTORY, PASSKEY_VERIFIER } from "../src/metal/passkeyRelay.js";
import { ownersWorld, T0, type TestWorld } from "./support/ownersWorld.js";

// Each proposal's credential is made by the real pinned CLI (offline), a child process: slow on a loaded machine.
vi.setConfig({ testTimeout: 60_000 });

// Settings a live run has, with values that must never reach a log, a row or the record.
const SECRETS = {
  METAL_RPC_URL: "https://rpc.rehearsal.example/v1/REHEARSALENDPOINTKEY0123456789abcdef",
  KIT11_RELAY_URL: "https://kit11-rehearsal-relay.example.workers.dev",
  KIT11_RELAY_TOKEN: "rehearsal-relay-token-0123456789abcdef0123456789abcdef",
};
const POLLS = 4;
let w: TestWorld;
let out: string;
afterEach(() => { w?.close(); if (out) rmSync(out, { recursive: true, force: true }); });

async function world(o: Parameters<typeof ownersWorld>[0] = {}): Promise<TestWorld> {
  w = await ownersWorld({ env: SECRETS, pollsMs: Array<number>(POLLS).fill(1), ...o });
  w.node.code.set(PASSKEY_VERIFIER.toLowerCase(), "0x60");
  out = mkdtempSync(join(tmpdir(), "owners-rehearsal-"));
  return w;
}
/** A minute passes: every step of the run has its own time in the ledger. */
const tick = (minutes = 1) => { w.clock.now = new Date(w.clock.now.getTime() + minutes * 60_000); };
const lines = () => readOwnersCalls(w.log);
const used = () => lines().length;
const rows = (event: string, subject?: string) => (w.db.prepare("SELECT seq, ts, subject, payload_json FROM audit_log WHERE event = ? ORDER BY seq").all(event) as { seq: number; ts: string; subject: string; payload_json: string }[])
  .map((r) => ({ seq: r.seq, ts: r.ts, subject: r.subject, p: JSON.parse(r.payload_json) as Record<string, unknown> })).filter((r) => subject === undefined || r.subject === subject);
const statusOf = (id: string) => (w.db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;
const termsOf = (id: string) => w.db.prepare("SELECT terms_json, terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_json: string; terms_sha256: string };
/** The signed transactions the stand-in chain received, as their raw bytes, in order. */
const rawsReceived = () => w.node.requests.filter((r) => r.method === "eth_sendRawTransaction").map((r) => r.params[0] as Hex);

/** (a), at any point of any run: what the log holds is what the chain received, request by request, and one line per run of the CLI. */
function logIsWhatWasSent(): void {
  const log = lines();
  expect(log.filter((c) => !c.method.startsWith("cli:")).map((c) => c.method)).toEqual(w.node.methods());
  expect(log.filter((c) => c.method.startsWith("cli:")).map((c) => c.method)).toEqual(w.cliRuns.map((run) => `cli:${cliCommand(run)}`));
  for (const method of new Set(w.node.methods())) expect(log.filter((c) => c.method === method), method).toHaveLength(w.node.methods().filter((m) => m === method).length);
}
/** (b), (c): no signed transaction reached the chain twice. */
function nothingSentTwice(): void {
  const raws = rawsReceived();
  expect(new Set(raws).size).toBe(raws.length);
  expect(w.node.sent().map((t) => t.raw)).toEqual(raws);
}
/** Both passkeys sign on their phones, a minute apart, and the runner relays: the account runs the call. */
async function signAndRelay(id: string): Promise<Hex> {
  tick();
  expect(await w.sign(id, 0)).toMatchObject({ status: "cosigned" });
  tick();
  expect(await w.sign(id, 1)).toMatchObject({ status: "approved" });
  tick();
  return w.relay(id);
}
/** The record, written as the command writes it, with what the runner states. */
function record(over: Record<string, string> = {}): { record: OwnersRecord; json: string; md: string; said: string[] } {
  const said: string[] = [];
  const r = recordRun(w.db, { ...w.d.env, OWNERS_DEVICE_CFO: "iPhone 15 Pro", OWNERS_DEVICE_CONTROLLER: "a second phone", ...over }, (l) => said.push(l), out);
  return { ...r, said };
}
/** (e), for any record: nothing in it but what a row or the log holds, and no credential. */
function recordHoldsOnlyRows(r: OwnersRecord, page: string): void {
  const everyTx = new Set(["owners.tx_sent", "owners.sent", "owners.paid", "owners.refused_on_chain"].flatMap((e) => rows(e).map((x) => String(x.p.tx))));
  for (const s of r.steps) {
    if (s.tx) { expect(everyTx.has(s.tx), s.step).toBe(true); expect(s.explorer).toBe(`${EXPLORER_TX}${s.tx}`); } else expect(s.explorer).toBeNull();
    if (s.outcome === "not run") expect([s.at, s.tx]).toEqual([null, null]);
  }
  for (const p of r.proposals) {
    expect(p.status, p.proposal_id).toBe(statusOf(p.proposal_id));
    expect(p.terms_sha256).toBe(rows("proposal.created", p.proposal_id)[0]!.p.terms_sha256);
    expect(p.terms_sha256).toBe(termsOf(p.proposal_id).terms_sha256);
    expect(p.onchain_digest).toBe((JSON.parse(termsOf(p.proposal_id).terms_json) as { onchain_digest: string }).onchain_digest);
  }
  expect(r.calls.used).toBe(used());
  const all = `${JSON.stringify(r)}\n${page}`;
  const keyFiles = [w.d.env.OWNERS_DONOR_KEY!, join(w.keys, "passkey-sponsor.key.json"), join(w.keys, "supplier.key.json")];
  for (const file of keyFiles) expect(all, file).not.toContain((JSON.parse(readFileSync(file, "utf8")) as { privateKey: string }).privateKey.slice(2));
  for (const secret of [SECRETS.METAL_RPC_URL, "REHEARSALENDPOINTKEY", "rpc.rehearsal.example", SECRETS.KIT11_RELAY_TOKEN, SECRETS.KIT11_RELAY_URL, "kit11-rehearsal-relay", w.d.env.OWNERS_DONOR_KEY!, w.keys, w.log]) expect(all, secret).not.toContain(secret);
}

describe("the live run, rehearsed", () => {
  it("(a) and (e): the whole planned run logs exactly what it sends, step by step as the plan says, and its record is what the audit rows say", async () => {
    await world({ budget: 60 });
    const plan = ownersPlan({ funding: "donor", polls: POLLS, replace: { capCents: 10, budgetCents: 50 } });
    const planned = (name: string) => plan.find((s) => s.step === name)!;
    // Every receipt is there on the first poll, so each step logs the plan's lower number.
    const ran: { plan: string; log: string }[] = [];
    let at = 0;
    const step = async <T>(name: string, logStep: string, run: () => Promise<T>): Promise<T> => {
      tick();
      const r = await run();
      const mine = lines().slice(at);
      expect(mine.filter((c) => !c.method.startsWith("cli:")), `${name}: requests`).toHaveLength(planned(name).requests.min);
      expect(mine.filter((c) => c.method.startsWith("cli:")), `${name}: CLI runs`).toHaveLength(planned(name).cli_runs);
      expect(new Set(mine.map((c) => c.step)), name).toEqual(new Set(mine.length ? [logStep] : []));
      at = used();
      ran.push({ plan: name, log: logStep });
      return r;
    };

    // 1. Preflight: three reads, the plan, nothing sent.
    const pre = await step("1 preflight", "preflight", () => preflight(w.again(), POLLS));
    expect(pre.ok).toBe(true);
    expect(w.node.sent()).toEqual([]);
    // 2, 3. Both passkeys were enrolled through the runner's own passkey processing (the world's start): no call.
    expect(rows("passkey.enrolled").map((r) => r.p.label)).toEqual(["max", "controller"]);
    expect([planned("2 the owner's passkey"), planned("3 the second approver")].map((s) => [s.requests, s.cli_runs, s.transactions])).toEqual(Array(2).fill([{ min: 0, max: 0 }, 0, []]));
    // 4. Setup, funded from the donor key.
    const { account } = await step("4 setup", "setup", () => setup(w.again()));
    // 5. The bind: proposed, signed by both passkeys, relayed by the executor behind the budget.
    const bind = await step("5 propose the bind", "propose", () => propose(w.again()));
    const bindId = bind.proposal.proposal_id;
    expect(await w.sign(bindId, 0)).toMatchObject({ status: "cosigned" });
    tick();
    expect(await w.sign(bindId, 1)).toMatchObject({ status: "approved" });
    const bindTx = await step("5 the runner relays it", `execute ${bindId}`, () => w.relay(bindId));
    // 6. 0.05 inside the mandate is paid; 0.06 is refused on chain.
    const first = await step("6 pay", "pay", () => pay(w.again()));
    expect(first.inside).toMatchObject({ outcome: "PAID" });
    expect(first.over).toMatchObject({ refused: true, reason: expect.stringMatching(/^mandate_cap_exceeded/) });
    // 7. The owners raise the cap; the refused amount is paid.
    const replace = await step("7 propose the replace", "propose-replace", () => proposeReplace(w.again(), { capCents: 10, budgetCents: 50 }));
    const replaceId = replace.proposal.proposal_id;
    expect(await w.sign(replaceId, 0)).toMatchObject({ status: "cosigned" });
    tick();
    expect(await w.sign(replaceId, 1)).toMatchObject({ status: "approved" });
    const replaceTx = await step("7 the runner relays it", `execute ${replaceId}`, () => w.relay(replaceId));
    const second = await step("7 pay again", "pay", () => pay(w.again()));
    expect(second.afterRefusal).toMatchObject({ amount: "0.06", outcome: "PAID", refused: { tx: first.over!.tx, proposal_id: bindId } });
    // 8. The revoke.
    const revoke = await step("8 propose the revoke", "propose-revoke", () => proposeRevoke(w.again()));
    const revokeId = revoke.proposal.proposal_id;
    expect(await w.sign(revokeId, 0)).toMatchObject({ status: "cosigned" });
    tick();
    expect(await w.sign(revokeId, 1)).toMatchObject({ status: "approved" });
    const revokeTx = await step("8 the runner relays it", `execute ${revokeId}`, () => w.relay(revokeId));
    // 9. Status, then the record, which calls nothing.
    expect(await step("9 status", "status", () => status(w.again()))).toMatchObject({ bound: true, revoked: true });
    tick();
    const deviations = join(w.dir, "deviations.txt");
    writeFileSync(deviations, `the relay ${SECRETS.KIT11_RELAY_URL}/approve/${bindId} was opened twice\nthe endpoint ${SECRETS.METAL_RPC_URL} answered slowly once\n`);
    const [requestsBefore, linesBefore] = [w.node.requests.length, used()];
    const written = record({ OWNERS_DEVIATIONS: deviations });
    expect(w.node.requests).toHaveLength(requestsBefore);
    expect(used()).toBe(linesBefore);
    expect(planned("9 record")).toMatchObject({ requests: { min: 0, max: 0 }, cli_runs: 0, transactions: [] });

    // (a) The log is what the chain received, per method and in order; per step it is the plan; in all, the plan's total.
    logIsWhatWasSent();
    nothingSentTwice();
    const byLogStep = new Map<string, { requests: number; cli_runs: number }>();
    for (const s of ran) { const x = byLogStep.get(s.log) ?? { requests: 0, cli_runs: 0 }; byLogStep.set(s.log, { requests: x.requests + planned(s.plan).requests.min, cli_runs: x.cli_runs + planned(s.plan).cli_runs }); }
    expect(countByStep(lines())).toEqual([...byLogStep.entries()].map(([step, n]) => ({ step, ...n })));
    expect(ran.map((s) => s.plan)).toEqual(plan.map((s) => s.step).filter((s) => !/^(2|3) |record$/.test(s)));
    const totals = planTotals(plan);
    expect(used()).toBe(totals.lines.min);
    expect(totals).toEqual({ transactions: 9, cli_runs: 3, lines: { min: 36, max: 54 } });
    // Nine transactions: six Purser signed itself (the three of setup, the three account calls) and three inside the CLI
    // (the two payments and the recorded refusal).
    expect(w.node.sent().length + w.cliRuns.length).toBe(totals.transactions);
    expect(w.node.sent().map((t) => t.to.toLowerCase())).toEqual([USDZ, ACCOUNT_FACTORY, USDZ, account, account, account].map((x) => x.toLowerCase()));
    expect([bindTx, replaceTx, revokeTx]).toEqual(w.node.sent().slice(3).map((t) => t.hash));

    // (e) The record, field by field against the audit rows.
    const r = written.record;
    const made = rows("owners.account_created")[0]!;
    expect(r).toMatchObject({ network: "Metal testnet", chain_id: 63825, account: made.p.account, threshold: Number(made.p.threshold), verifier: made.p.verifier, stand_in: null });
    expect(r.account).toBe(account);
    const enrolled = rows("passkey.enrolled");
    expect(r.owners).toEqual([
      { role: "CFO", label: "max", fingerprint: enrolled[0]!.p.fingerprint, enrolled_at: enrolled[0]!.ts, virtual: false, device: "iPhone 15 Pro", device_basis: "as stated by the owner" },
      { role: "second approver", label: "controller", fingerprint: enrolled[1]!.p.fingerprint, enrolled_at: enrolled[1]!.ts, virtual: false, device: "a second phone", device_basis: "as stated by the owner" },
    ]);
    // The steps, in the order the audit rows give them: the scene.
    const [setupDone, executed, paid, refused] = [rows("owners.tx_done"), rows("owners.executed"), rows("owners.paid"), rows("owners.refused_on_chain")];
    const proposalSteps = (id: string) => {
      const [filed, approved, ran_] = [rows("proposal.created", id)[0]!, rows("proposal.approved", id)[0]!, executed.find((x) => x.subject === id)!];
      return [["proposal", "filed", null, filed.ts], ["approvals", "2 of 2 approvals", null, approved.ts], ["relay", "executed", ran_.p.tx, ran_.ts]];
    };
    expect(r.steps.map((s) => [s.kind, s.outcome, s.tx, s.at])).toEqual([
      ...setupDone.map((d) => ["setup", "done", d.p.tx, d.ts]),
      ...proposalSteps(bindId),
      ["payment", "paid", paid[0]!.p.tx, paid[0]!.ts],
      ["refusal", "refused on chain", refused[0]!.p.tx, refused[0]!.ts],
      ...proposalSteps(replaceId),
      ["payment", "paid", paid[1]!.p.tx, paid[1]!.ts],
      ...proposalSteps(revokeId),
    ]);
    expect(r.steps.map((s) => s.at)).toEqual([...r.steps.map((s) => s.at)].sort());
    expect(new Set(r.steps.map((s) => s.at)).size).toBeGreaterThan(10);
    expect(executed.map((x) => x.p.tx)).toEqual([bindTx, replaceTx, revokeTx]);
    expect([paid[0]!.p.tx, refused[0]!.p.tx, paid[1]!.p.tx]).toEqual([first.inside!.tx, first.over!.tx, second.afterRefusal!.tx]);
    expect(r.steps.find((s) => s.kind === "refusal")).toMatchObject({
      step: "0.06 to Stockline, over the mandate's 0.05 cap", payment_id: refused[0]!.subject, detail: `Metal's reason: ${String(refused[0]!.p.reason)}`,
      paid_later: { payment_id: paid[1]!.subject, tx: paid[1]!.p.tx, explorer: `${EXPLORER_TX}${String(paid[1]!.p.tx)}`, at: paid[1]!.ts, under_proposal: replaceId, cap_then: "0.05", cap_now: "0.10" },
    });
    expect(r.steps.filter((s) => s.kind === "payment")[1]).toMatchObject({
      step: `the Sourcing agent pays 0.06 to Stockline: the amount Metal refused before, under the mandate ${replaceId} bound`,
      after_refusal: { payment_id: refused[0]!.subject, tx: refused[0]!.p.tx, under_proposal: bindId, cap_then: "0.05", cap_now: "0.10" },
    });
    // The refusal and the later payment of the same amount, linked by the rows, with the replace between them.
    expect(r.refused_then_paid).toEqual([{
      amount: "0.06", payee_name: "Stockline",
      refused: { at: refused[0]!.ts, tx: refused[0]!.p.tx, explorer: `${EXPLORER_TX}${String(refused[0]!.p.tx)}`, reason: refused[0]!.p.reason, cap: "0.05", under_proposal: bindId },
      raised_by: { proposal_id: replaceId, what: "replace", was_cap: "0.05", cap: "0.10", at: executed[1]!.ts, tx: replaceTx, explorer: `${EXPLORER_TX}${replaceTx}` },
      paid: { at: paid[1]!.ts, tx: paid[1]!.p.tx, explorer: `${EXPLORER_TX}${String(paid[1]!.p.tx)}`, cap: "0.10", under_proposal: replaceId },
    }]);
    expect((paid[1]!.p.after_refusal as { payment_id: string }).payment_id).toBe(refused[0]!.subject);
    // The proposals: ids, hashes, the digest both passkeys signed, who approved and when.
    expect(r.proposals.map((p) => [p.proposal_id, p.what, p.status, p.tx])).toEqual([[bindId, "bind", "EXECUTED", bindTx], [replaceId, "replace", "EXECUTED", replaceTx], [revokeId, "revoke", "EXECUTED", revokeTx]]);
    for (const [p, filed] of [[r.proposals[0]!, bind], [r.proposals[1]!, replace], [r.proposals[2]!, revoke]] as const) {
      const id = p.proposal_id;
      expect(p).toMatchObject({ terms_sha256: filed.proposal.terms_sha256, onchain_digest: filed.terms.onchain_digest, expires_at: filed.terms.expires_at, mandate: filed.terms.action.mandate, created_at: rows("proposal.created", id)[0]!.ts, explorer: `${EXPLORER_TX}${p.tx}`, not_counted: [] });
      expect(p.approvals).toEqual([
        { by: "max", role: "CFO", fingerprint: enrolled[0]!.p.fingerprint, at: rows("proposal.cosigned", id)[0]!.ts, of: "1 of 2" },
        { by: "controller", role: "second approver", fingerprint: enrolled[1]!.p.fingerprint, at: rows("proposal.approved", id)[0]!.ts, of: "2 of 2" },
      ]);
      expect((rows("proposal.cosigned", id)[0]!.p.passkey as { credential_id: string }).credential_id).toBe(enrolled[0]!.subject);
      expect((rows("proposal.approved", id)[0]!.p.passkey as { credential_id: string }).credential_id).toBe(enrolled[1]!.subject);
    }
    expect(r.proposals[1]).toMatchObject({ cap: "0.10", budget: "0.50", replaces: bind.terms.action.mandate, was_cap: "0.05", was_budget: "0.50" });
    // The calls: by method and by step, as the log holds them, against the budget.
    const log = lines();
    expect(r.calls).toMatchObject({ budget: 60, used: log.length, left: 60 - log.length, by_step: countByStep(log) });
    expect(r.calls.by_method).toEqual(Object.fromEntries([...new Set(log.map((c) => c.method))].map((m) => [m, log.filter((c) => c.method === m).length])));
    expect(r.calls.by_method["cli:mandate pull"]).toBe(3);
    expect(r.calls.note).toMatch(/cli:<command> line is one whole run of the metal-agent CLI; the requests it makes inside are not counted/);
    // Times are the rows' own: the run's first owners row, and its last.
    expect(r.ran_at).toBe(rows("owners.tx_sent")[0]!.ts);
    expect(r.last_row_at).toBe(rows("proposal.executed", revokeId)[0]!.ts);
    expect(r.ran_at).not.toBe(r.last_row_at);
    // What the runner stated, without the addresses it quoted.
    expect(r.deviations).toEqual(["the relay [address removed] was opened twice", "the endpoint [rpc-url] answered slowly once"]);
    // The files are the record; the last line is the one the runbook quotes.
    expect(written.json).toBe(join(out, `${T0.toISOString().slice(0, 10)}-faceid-onchain.json`));
    expect(JSON.parse(readFileSync(written.json, "utf8"))).toEqual(r);
    expect(readFileSync(written.md, "utf8")).toBe(renderOwnersRecord(r));
    expect(written.said.at(-1)).toBe(`RECORD           ${written.json} and ${written.md} written from ${r.written_from.audit_rows} audit rows and ${log.length} call-log lines; no call was made`);
    // Every row it was written from: 4 of the two enrolments, 7 of setup, 7 for each of the three proposals, 6 of the payments.
    expect(r.written_from.audit_rows).toBe(4 + 7 + 3 * 7 + 6);
    recordHoldsOnlyRows(r, readFileSync(written.md, "utf8"));
    expect(readFileSync(written.md, "utf8")).toMatch(/## Refused, then paid\n\n0\.06 to Stockline:\n1\. .*refused on chain under the 0\.05 cap of P-0001 .*\n2\. .*both owners signed P-0002, and the account ran it: replace, cap 0\.05 → 0\.10 .*\n3\. .*paid under the 0\.10 cap of P-0002 /);
  });

  it("(b): the budget stops the run at the very request over it, and with a raised budget the run carries on without sending anything again", async () => {
    await world();
    await preflight(w.again(), POLLS);
    // Setup may make eight more calls: the ninth, the send that creates the account, is the one over the budget.
    let budget = used() + 8;
    await expect(setup(w.again({ budget }))).rejects.toThrow(OwnersBudgetSpent);
    expect(used()).toBe(budget);
    expect(w.node.requests).toHaveLength(budget);
    expect(w.node.methods().slice(3)).toEqual(["eth_getCode", "eth_getTransactionCount", "eth_sendRawTransaction", "eth_getTransactionReceipt", "eth_call", "eth_getCode", "eth_estimateGas", "eth_getTransactionCount"]);
    expect(rawsReceived()).toHaveLength(1);
    logIsWhatWasSent();
    // Raised: the transfer already made is not made again, the creation goes out once.
    const { account } = await setup(w.again({ budget: 200 }));
    expect(w.node.sent()).toHaveLength(3);
    expect(w.node.balances.get(account.toLowerCase())).toBe(centsToBaseUnits(60));
    nothingSentTwice();

    // The relay of the bind, stopped by the budget between its send and its receipt.
    const { proposal } = await propose(w.again());
    const id = proposal.proposal_id;
    await w.signBoth(id);
    w.node.state.receiptAfter = 1; // the receipt is there on the second poll
    budget = used() + 4;
    await expect(w.relay(id, { budget })).rejects.toThrow(/owners call budget of \d+ is spent.*eth_getTransactionReceipt.*was not sent.*stays executing/);
    expect(used()).toBe(budget);
    expect(w.node.requests).toHaveLength(budget);
    expect(lines().slice(-4).map((c) => c.method)).toEqual(["eth_estimateGas", "eth_getTransactionCount", "eth_sendRawTransaction", "eth_getTransactionReceipt"]);
    expect(statusOf(id)).toBe("EXECUTING");
    const sent = rows("owners.sent", id)[0]!.p.tx as Hex;
    expect(w.node.sent().at(-1)!.hash).toBe(sent);
    // Raised: the runner's next start reads the receipt of the transaction it recorded, and signs nothing.
    const before = w.node.requests.length;
    expect(await w.relay(id, { resume: true, budget: 200 })).toBe(sent);
    expect(w.node.methods().slice(before)).toEqual(["eth_getTransactionReceipt"]);
    expect(statusOf(id)).toBe("EXECUTED");
    expect(rows("owners.sent", id)).toHaveLength(1);
    w.node.state.receiptAfter = 0;

    // A relay the budget cannot cover does not start; a payment's CLI run over the budget does not start either.
    const second = await propose(w.again(), { capCents: 10, budgetCents: 50 });
    await w.signBoth(second.proposal.proposal_id);
    const [requests, runs] = [w.node.requests.length, w.cliRuns.length];
    await expect(w.relay(second.proposal.proposal_id, { budget: used() + 3 })).rejects.toThrow(/needs 4 calls and the owners call budget of \d+ has 3 left; nothing was sent/);
    await expect(pay(w.again({ budget: used() }))).rejects.toThrow(OwnersBudgetSpent);
    expect(w.node.requests).toHaveLength(requests);
    expect(w.cliRuns).toHaveLength(runs);
    const paidNow = await pay(w.again({ budget: 200 }));
    expect(paidNow.inside).toMatchObject({ outcome: "PAID" });
    logIsWhatWasSent();
    nothingSentTwice();
    // The record of the stopped and resumed run: one transaction per step, and the calls it really took.
    const r = record().record;
    expect(r.steps.filter((s) => s.kind === "setup").map((s) => s.outcome)).toEqual(["done", "done", "done"]);
    expect(r.steps.filter((s) => s.kind === "relay").map((s) => [s.proposal_id, s.outcome, s.tx])).toEqual([[id, "executed", sent], [second.proposal.proposal_id, "not run", null]]);
    expect(r.proposals.map((p) => p.status)).toEqual(["EXECUTED", "EXECUTING"]);
    recordHoldsOnlyRows(r, renderOwnersRecord(r));
  });

  it("(c): a crash between a send and its receipt never leads to a second send: in setup, in the relay, and in a payment", async () => {
    await world();
    // Setup: the answer to the creation's send is lost; the node has the transaction, the run does not know.
    let sends = 0;
    const real = w.node.rpc;
    w.node.rpc = async (a) => { if (a.method === "eth_sendRawTransaction" && ++sends === 2) w.node.state.sendFault = "lose-answer"; return real(a); };
    await expect(setup(w.again({ pollsMs: [1] }))).rejects.toThrow(/socket hang up/);
    expect(rows("owners.account_created")).toEqual([]);
    await setup(w.again());
    expect(w.node.sent()).toHaveLength(3);
    nothingSentTwice();

    // The relay: the runner stops after the send, before any receipt. Its next start waits for the recorded hash.
    const { proposal } = await propose(w.again());
    const id = proposal.proposal_id;
    await w.signBoth(id);
    w.node.state.receiptAfter = Infinity;
    await expect(w.relay(id)).rejects.toThrow(/no receipt yet.*stays executing.*nothing is sent twice/);
    const recorded = rows("owners.sent", id)[0]!.p.tx as Hex;
    expect(w.node.sent().at(-1)).toMatchObject({ hash: recorded, mined: false });
    expect(statusOf(id)).toBe("EXECUTING");
    w.node.state.receiptAfter = 0;
    const before = w.node.requests.length;
    expect(await w.relay(id, { resume: true })).toBe(recorded);
    expect(w.node.methods().slice(before)).toEqual(["eth_getTransactionReceipt"]);
    expect(w.node.sent().filter((t) => t.to.toLowerCase() === proposal.terms_json.match(/"account":"(0x[0-9a-fA-F]{40})"/)![1]!.toLowerCase())).toHaveLength(1);
    expect(rows("owners.sent", id)).toHaveLength(1);
    expect(statusOf(id)).toBe("EXECUTED");
    nothingSentTwice();

    // A payment: the process stops after the CLI paid and before the ledger has it. The same payment id is asked again, and pays once.
    const d = w.again();
    await expect(pay({ ...d, cli: (args, ok) => { d.cli(args, ok); throw new Error("the process stopped here"); } })).rejects.toThrow(/stopped here/);
    expect(rows("owners.paid")).toEqual([]);
    const paid = await pay(w.again());
    expect(paid.inside).toMatchObject({ outcome: "PAID" });
    expect(rows("owners.paid")).toEqual([expect.objectContaining({ subject: `owners-${id}-inside`, p: expect.objectContaining({ already: true }) })]);
    const mandate = (JSON.parse(termsOf(id).terms_json) as { action: { mandate: string } }).action.mandate.toLowerCase();
    expect(w.node.mandates.get(mandate)).toMatchObject({ spent: centsToBaseUnits(5), occurrences: 1n });
    logIsWhatWasSent();
    nothingSentTwice();
    const r = record().record;
    expect(r.steps.filter((s) => s.tx).map((s) => s.tx)).toEqual([...new Set(r.steps.filter((s) => s.tx).map((s) => s.tx))]);
    recordHoldsOnlyRows(r, renderOwnersRecord(r));
  });

  it("(d): a proposal past its fifteen minutes is refused, at the signature and at the relay, and a fresh one works", async () => {
    await world();
    await setup(w.again());
    // Signed too late: sixteen minutes after it was proposed, the first passkey's signature counts for nothing.
    const late = await propose(w.again());
    tick(16);
    const answer = await w.sign(late.proposal.proposal_id, 0);
    expect(answer).toMatchObject({ status: "too_late", message: expect.stringMatching(/expired at .*nothing was approved/) });
    expect(rows("proposal.cosigned")).toEqual([]);
    expect(statusOf(late.proposal.proposal_id)).toBe("EXPIRED");
    await expect(w.relay(late.proposal.proposal_id)).rejects.toThrow(/EXPIRED, not approved/);
    // Signed in time by both, but relayed too late: the approval is void, and nothing is sent.
    const slow = await propose(w.again());
    await w.signBoth(slow.proposal.proposal_id);
    tick(16);
    const sentBefore = w.node.sent().length;
    await expect(w.relay(slow.proposal.proposal_id)).rejects.toThrow(/expired at .*approval void/);
    expect(statusOf(slow.proposal.proposal_id)).toBe("EXPIRED");
    expect(w.node.sent()).toHaveLength(sentBefore);
    expect(rows("owners.sent")).toEqual([]);
    // A fresh one, signed and relayed within its minutes, runs.
    const fresh = await propose(w.again());
    expect(Date.parse(fresh.terms.expires_at) - w.clock.now.getTime()).toBe(15 * 60_000);
    const tx = await signAndRelay(fresh.proposal.proposal_id);
    expect(statusOf(fresh.proposal.proposal_id)).toBe("EXECUTED");
    expect(w.node.sent().at(-1)!.hash).toBe(tx);
    logIsWhatWasSent();
    nothingSentTwice();
    // The record shows each as it ended: two expired (one never approved, one approved twice and never run), one executed.
    const r = record().record;
    expect(r.proposals.map((p) => [p.proposal_id, p.status, p.approvals.length, p.tx])).toEqual([
      [late.proposal.proposal_id, "EXPIRED", 0, null], [slow.proposal.proposal_id, "EXPIRED", 2, null], [fresh.proposal.proposal_id, "EXECUTED", 2, tx],
    ]);
    expect(r.proposals[0]!.not_counted).toEqual([{ at: rows("approval.too_late")[0]!.ts, why: `a signature by max arrived after the terms ran out (${late.terms.expires_at}) and was not counted` }]);
    const outcomes = (id: string) => r.steps.filter((s) => s.proposal_id === id).map((s) => [s.kind, s.outcome]);
    expect(outcomes(late.proposal.proposal_id)).toEqual([["proposal", "filed"], ["approvals", "expired: no approval counted"], ["relay", "not run"]]);
    expect(outcomes(slow.proposal.proposal_id)).toEqual([["proposal", "filed"], ["approvals", "2 of 2 approvals"], ["relay", "not run"]]);
    expect(outcomes(fresh.proposal.proposal_id)).toEqual([["proposal", "filed"], ["approvals", "2 of 2 approvals"], ["relay", "executed"]]);
    recordHoldsOnlyRows(r, renderOwnersRecord(r));
  });
});
