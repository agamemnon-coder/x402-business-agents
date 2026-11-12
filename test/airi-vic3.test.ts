// vic-3 (docs/runs/vic-3-plan.md): the conductor's seven purchases on the labelled stand-ins and scripted fakes. No
// network: the stand-in Airi client, the stand-in checkout and a scripted Claude client only.
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { AIRI_RAIL, airiTerms } from "../src/airi/purchase.js";
import { StandInAiriClient, StandInCheckout } from "../src/airi/standIn.js";
import type { CheckoutAnswer } from "../src/airi/client.js";
import { BUDGETS, DRY_LABEL, NOT_REFUSED_FINDING, STAND_IN_MODEL, plantChange, runVic3, standInClaude, vic3LiveRefusals, vic3Markdown, vic3RunnerProblems, type Vic3Deps, type Vic3Record } from "../src/airi/vic3.js";
import { assertNoSecrets } from "../src/airi/vic1.js";
import { openDb, type DB } from "../src/db/open.js";
import { decide, resuming } from "../src/policy/approvals.js";

const ON = { KIT11_AIRI_RAIL: "on" };
const T0 = new Date("2026-11-13T10:00:00Z");
afterEach(() => { resuming.clear(); });

/** A scripted Claude: every call answers `pay` on the given rails in turn (airi_vic by default), with a request id. */
function claude(rails: string[] = []) {
  let n = 0;
  const client = { beta: { messages: { create: async () => {
    n += 1;
    const rail = rails[n - 1] ?? AIRI_RAIL;
    return { id: `msg_${n}`, model: "claude-haiku-5-5", role: "assistant", stop_reason: "tool_use", _request_id: `req_test_${n}`, usage: { input_tokens: 900, output_tokens: 60 },
      content: [{ type: "tool_use", id: `tu_${n}`, name: "pay", input: { rail, reason: "the merchant takes only this rail" } }] };
  } } } } as unknown as Anthropic;
  return { client, calls: () => n };
}

/** A stand-in checkout with a hook per call, so a test can change one answer. */
class Hooked extends StandInCheckout {
  constructor(private readonly hook: { pay?: (ref: string) => CheckoutAnswer | null; meta?: (m: Record<string, string> | null) => Record<string, string> | null } = {}) { super(); }
  override async pay(reference: string, ref: string, file: string): Promise<CheckoutAnswer> {
    return this.hook.pay?.(ref) ?? super.pay(reference, ref, file);
  }
  override async readMetadata(reference: string) {
    const m = await super.readMetadata(reference);
    return this.hook.meta ? this.hook.meta(m) : m;
  }
}

function world(o: Partial<Vic3Deps> & { airiScript?: ConstructorParameters<typeof StandInAiriClient>[0] } = {}) {
  const db: DB = openDb(":memory:");
  const airi = new StandInAiriClient(o.airiScript ?? {});
  const checkout = (o.checkout as StandInCheckout | undefined) ?? new StandInCheckout();
  const tmpRoot = mkdtempSync(join(tmpdir(), "vic3-test-"));
  const links: string[] = [];
  const lines: string[] = [];
  let tick = 0;
  const deps: Vic3Deps = {
    db, mode: "dry", airi, checkout, claude: standInClaude(), env: ON, tmpRoot, sleep: async () => {},
    showPasskeyUrl: (url) => { links.push(url); },
    log: (l) => { assertNoSecrets(l); lines.push(l); },
    now: () => new Date(T0.getTime() + (tick++) * 1000),
    awaitCfo: async (id) => {
      const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
      decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "dry-run stand-in (not Max)", method: "cli" }, T0);
      return "APPROVED";
    },
    ...o,
  };
  return { db, airi, checkout, deps, tmpRoot, links, lines };
}

const step = (r: Vic3Record, s: string) => r.purchases.find((p) => p.step === s)!;
const ops = (airi: StandInAiriClient) => airi.calls.map((c) => c.op);
const leftovers = (dir: string) => readdirSync(dir);

describe("vic-3 on the stand-ins (the dry run)", () => {
  it("runs A..F2 in order; every check passes; the record is labelled STAND-IN", async () => {
    const w = world();
    const r = await runVic3(w.deps);
    expect(r.purchases.map((p) => p.step)).toEqual(["A", "B", "C", "D", "E", "F1", "F2"]);
    expect(Object.entries(r.checks).filter(([, c]) => !c.ok)).toEqual([]);
    expect(r.mode).toBe("dry");
    expect(r.label).toBe(DRY_LABEL);
    expect(r.label).toMatch(/^STAND-IN/);
    expect(r.stopped).toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/"by":"claude"/);
  });

  it("the agent's rail choice for A, B and F1 only: three rails offered, the Airi rail chosen, by the stand-in model", async () => {
    const w = world();
    const r = await runVic3(w.deps);
    for (const s of ["A", "B", "F1"]) {
      const c = step(r, s).rail_choice!;
      expect(c.menu.map((m) => m.rail)).toEqual(["metal_x402", "airwallex_card", AIRI_RAIL]);
      expect(c).toMatchObject({ by: "stand-in", chosen: AIRI_RAIL, model: STAND_IN_MODEL });
      expect(c.request_id).toMatch(/^standin-req-/);
    }
    for (const s of ["C", "D", "E", "F2"]) expect(step(r, s).rail_choice).toBeNull();
    expect(r.budgets.anthropic.used).toBe(3);
  });

  it("C, D and E make 0 Airi, 0 Airwallex and 0 Anthropic calls, and are refused by Purser", async () => {
    const r = await runVic3(world().deps);
    for (const s of ["C", "D", "E"]) expect(step(r, s).calls).toEqual({ anthropic: 0, airwallex: 0, airi: 0 });
    expect(step(r, "C").outcome).toMatchObject({ status: "refused", by: "purser", code: "PURSER_ABOVE_HARD_CAP" });
    expect(step(r, "D").outcome).toMatchObject({ status: "refused", by: "purser", code: "PURSER_MERCHANT_NOT_ALLOWED" });
    expect(step(r, "E").outcome).toMatchObject({ status: "refused", refusal: expect.stringMatching(/terms do not match the approved hash/) });
  });

  it("B: the hash is in the mandate, read back equal BEFORE the credential; in the PaymentIntent's metadata, read back equal", async () => {
    const w = world();
    const r = await runVic3(w.deps);
    const b = step(r, "B");
    expect(b.terms_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(b.read_back.mandate).toEqual({ terms_sha256_in_mandate: b.terms_sha256, equal: true, before_credential: true });
    expect(b.read_back.payment_intent).toMatchObject({ payment_intent_id: b.payment_intent_id, expected: b.terms_sha256, read_back: b.terms_sha256, proposal_read_back: b.proposal_id, equal: true });
    // In Airi's own order: create, read back, then the credential.
    const forB = w.airi.calls.filter((c) => c.args.includes(b.mandate_id!)).map((c) => c.op);
    expect(forB.indexOf("mandate list")).toBeLessThan(forB.indexOf("mandate get-credential"));
  });

  it("F1 and F2: the answers are kept as they came; an accepted F is a PASS with the finding that only Purser enforces the binding", async () => {
    const r = await runVic3(world().deps);
    const f1 = step(r, "F1"), f2 = step(r, "F2");
    expect(f1.negative_test).toMatchObject({ result: "PASS", finding: `STAND-IN (the stand-in checkout's answer, not the Airwallex sandbox's): ${NOT_REFUSED_FINDING}`, airwallex: { outcome: "SUCCEEDED", amount: "40.00" } });
    expect(f1.request).toMatchObject({ amount: "10.00" });
    expect(f2.negative_test).toMatchObject({ result: "PASS", finding: expect.stringContaining(NOT_REFUSED_FINDING), airwallex: { outcome: "SUCCEEDED" } });
    expect(f2.payment_intent_id).not.toBe(step(r, "B").payment_intent_id);
    expect(f2.calls.airi).toBe(0);
  });

  it("a refused F is recorded with the checkout's code, as the Airwallex sandbox's answer (not Visa's)", async () => {
    const checkout = new Hooked({ pay: (ref) => (ref.startsWith("vic3-F") ? { outcome: "DECLINED", reference: "x", code: "card_not_valid_for_amount" } : null) });
    const r = await runVic3(world({ checkout, mode: "live", claude: claude().client }).deps);
    expect(step(r, "F1").negative_test!.finding).toBe("the Airwallex sandbox declined it: card_not_valid_for_amount");
    expect(step(r, "F2").negative_test!.finding).toBe("the Airwallex sandbox declined it: card_not_valid_for_amount");
    expect(JSON.stringify(r)).not.toMatch(/Visa (refused|declined|approved)/i);
  });

  it("B's kept credential and every credential directory are deleted after F2", async () => {
    const w = world();
    const r = await runVic3(w.deps);
    expect(r.credential_deleted).toBe(true);
    expect(leftovers(w.tmpRoot)).toEqual([]);
  });

  it("the credential directories are deleted when the run throws midway too", async () => {
    const w = world();
    let n = 0;
    w.deps.awaitCfo = async (id) => { if (++n === 2) throw new Error("relay gone"); const p = w.db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string }; decide(w.db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "dry-run stand-in (not Max)", method: "cli" }, T0); return "APPROVED"; };
    await expect(runVic3(w.deps)).rejects.toThrow("relay gone");
    expect(leftovers(w.tmpRoot)).toEqual([]);
  });

  it("no link, no card number in the record or the log; the links went to the console sink only", async () => {
    const w = world();
    const r = await runVic3(w.deps);
    expect(() => assertNoSecrets(JSON.stringify(r))).not.toThrow();
    expect(w.links).toHaveLength(3);
    for (const l of w.links) { expect(JSON.stringify(r)).not.toContain(l); expect(w.lines.join("\n")).not.toContain(l); }
  });
});

describe("vic-3 read-back cannot be bypassed", () => {
  it("B's mandate read back with another hash: no credential is asked for B, the mandate is cancelled, F2 does not run", async () => {
    const w = world({ airiScript: { stored: (desc) => (desc.startsWith("vic-3 B") ? desc.replace(/terms:[0-9a-f]{64}/, `terms:${"0".repeat(64)}`) : desc) } });
    const r = await runVic3(w.deps);
    const b = step(r, "B");
    expect(b.outcome).toMatchObject({ status: "refused", by: "purser", code: "PURSER_MANDATE_HASH_MISMATCH" });
    expect(b.read_back.mandate).toMatchObject({ equal: false });
    expect(w.airi.calls.filter((c) => c.op === "mandate get-credential" && c.args.includes(b.mandate_id!))).toEqual([]);
    expect(ops(w.airi)).toContain("mandate cancel");
    expect(step(r, "F2").outcome).toMatchObject({ status: "not_run" });
    expect(r.checks.b_mandate_read_back_equal_before_credential!.ok).toBe(false);
    expect(b.failed_attempts.length).toBeGreaterThan(0);
  });

  it("the PaymentIntent's metadata read back different: marked not equal, kept as a failed attempt", async () => {
    const checkout = new Hooked({ meta: (m) => (m ? { ...m, purser_terms_sha256: "f".repeat(64) } : m) });
    const r = await runVic3(world({ checkout }).deps);
    expect(step(r, "B").read_back.payment_intent).toMatchObject({ equal: false, read_back: "f".repeat(64) });
    expect(r.checks.b_payment_intent_read_back_equal!.ok).toBe(false);
    expect(step(r, "B").failed_attempts).toEqual(expect.arrayContaining([expect.objectContaining({ equal: false })]));
  });

  it("F1's mandate read back without its hash: no credential, no PaymentIntent", async () => {
    const w = world({ airiScript: { stored: (desc) => (desc.startsWith("vic-3 F1") ? "changed" : desc) } });
    const r = await runVic3(w.deps);
    const f1 = step(r, "F1");
    expect(f1.outcome).toMatchObject({ status: "not_run", at: "mandate read-back" });
    expect(f1.payment_intent_id).toBeNull();
    expect(w.airi.calls.filter((c) => c.op === "mandate get-credential" && c.args.includes(f1.mandate_id!))).toEqual([]);
  });
});

describe("vic-3 with Claude (scripted, no network)", () => {
  it("records by claude, the model and each request id; 3 Anthropic calls in all; an accepted F is a PASS with the finding as it is", async () => {
    const c = claude();
    const w = world({ mode: "live", claude: c.client });
    const r = await runVic3(w.deps);
    expect(c.calls()).toBe(3);
    expect(step(r, "F1").negative_test).toMatchObject({ result: "PASS", finding: NOT_REFUSED_FINDING });
    expect(["A", "B", "F1"].map((s) => step(r, s).rail_choice)).toEqual([
      expect.objectContaining({ by: "claude", model: "claude-haiku-5-5", request_id: "req_test_1", chosen: AIRI_RAIL }),
      expect.objectContaining({ by: "claude", request_id: "req_test_2" }),
      expect.objectContaining({ by: "claude", request_id: "req_test_3" }),
    ]);
  });

  it("a wrong rail first is refused by code, nothing paid; the second answer pays", async () => {
    const c = claude(["airwallex_card"]);
    const r = await runVic3(world({ mode: "live", claude: c.client }).deps);
    expect(step(r, "A").rail_choice).toMatchObject({ by: "claude", chosen: AIRI_RAIL, request_id: "req_test_2", refused: [{ rail: "airwallex_card" }] });
    expect(c.calls()).toBe(4);
  });

  it("without Claude, code's fallback pays nothing and says so", async () => {
    const r = await runVic3(world({ mode: "live", claude: null }).deps);
    expect(step(r, "A").rail_choice).toMatchObject({ by: "code", chosen: null, note: expect.stringContaining("code's fallback") });
    expect(r.checks.a_rail_chosen_by_the_agent!.ok).toBe(false);
  });
});

describe("vic-3 hard call budgets", () => {
  it("are 6 Anthropic, 20 Airwallex, 24 airi-cli", () => {
    expect(BUDGETS).toEqual({ anthropic: 6, airwallex: 20, airi: 24 });
  });

  it("the dry run stays within them", async () => {
    const r = await runVic3(world().deps);
    expect(r.budgets.anthropic.used).toBeLessThanOrEqual(6);
    expect(r.budgets.airwallex.used).toBeLessThanOrEqual(20);
    expect(r.budgets.airi.used).toBeLessThanOrEqual(24);
  });

  for (const [by, max] of [["airi", 6], ["airwallex", 2], ["anthropic", 1]] as const) {
    it(`over the ${by} budget: the next call is not sent, the run stops and records why; credentials deleted`, async () => {
      const c = claude();
      const w = world({ mode: "live", claude: c.client, budgets: { [by]: max } });
      const r = await runVic3(w.deps);
      expect(r.stopped).toMatch(new RegExp(`the ${by} call budget of ${max} is spent`));
      expect(r.budgets[by].used).toBe(max);
      if (by === "airi") expect(w.airi.calls).toHaveLength(max);
      if (by === "airwallex") expect(w.checkout.seen).toHaveLength(max);
      if (by === "anthropic") expect(c.calls()).toBe(max);
      expect(r.checks.within_budgets!.ok).toBe(false);
      expect(leftovers(w.tmpRoot)).toEqual([]);
    });
  }
});

describe("vic-3 pieces", () => {
  it("E's planted change is labelled in the ledger before the terms are rewritten", () => {
    const w = world();
    w.db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, status, created_by, created_at, expires_at) VALUES ('P-9', 'airi_purchase', ?, 'x', 'APPROVED', 'sourcing', ?, ?)").run(JSON.stringify(airiTerms({ agent: "sourcing", paymentMethodId: "pm", merchantName: "m", merchantUrl: "https://m.example", merchantCountry: "NL", amount: "30.00", currency: "EUR", items: [{ name: "i", unitPrice: "30.00", quantity: "1" }], description: "d" }, "P-9", "2026-11-13T10:30:00Z")), T0.toISOString(), T0.toISOString());
    const ch = plantChange(w.db, "P-9", T0);
    expect(ch.altered_sha256).not.toBe(ch.signed_sha256);
    const row = w.db.prepare("SELECT payload_json FROM audit_log WHERE event = 'vic3.redteam_change'").get() as { payload_json: string };
    expect(JSON.parse(row.payload_json)).toMatchObject({ label: expect.stringContaining("our own planted change") });
  });

  it("the runner beside a live run must hold no Airi rail and no Airwallex keys", () => {
    const lock = { pid: 1, host: "h" } as never;
    expect(vic3RunnerProblems(null, () => null, "h")).toEqual([expect.stringContaining("no runner")]);
    expect(vic3RunnerProblems(lock, () => ({ rail: "on", airwallexKeys: true, metal: false }), "h")).toHaveLength(2);
    expect(vic3RunnerProblems(lock, () => ({ rail: null, airwallexKeys: false, metal: false }), "h")).toEqual([]);
  });
});

describe("vic-3 live guards and the page", () => {
  const ok = { KIT11_AIRI_RAIL: "on", VIC3_GO: "yes", KIT11_DB: "data/vic-3.sqlite", KIT11_KEYS_DIR: "/home/x/.purser/vic-3", AIRWALLEX_CLIENT_ID: "set", AIRWALLEX_API_KEY: "set", AIRWALLEX_CALL_BUDGET: "20", AIRWALLEX_CALL_LOG: "/tmp/calls.log", KIT11_ANTHROPIC_API_KEY: "set" };
  it("refuses without KIT11_AIRI_RAIL=on or without VIC3_GO=yes; starts with both", () => {
    expect(vic3LiveRefusals("live", ok)).toEqual([]);
    expect(vic3LiveRefusals("live", { ...ok, KIT11_AIRI_RAIL: undefined })).toEqual([expect.stringContaining("KIT11_AIRI_RAIL=on")]);
    expect(vic3LiveRefusals("live", { ...ok, VIC3_GO: "no" })).toEqual([expect.stringContaining("VIC3_GO=yes")]);
    expect(vic3LiveRefusals("preflight", { ...ok, VIC3_GO: undefined })).toEqual([expect.stringContaining("VIC3_GO=yes")]);
  });
  it("refuses an Airwallex budget above 20, a Metal URL, another world's ledger, no Claude key", () => {
    expect(vic3LiveRefusals("live", { ...ok, AIRWALLEX_CALL_BUDGET: "21" })).toEqual([expect.stringContaining("from 1 to 20")]);
    expect(vic3LiveRefusals("live", { ...ok, METAL_RPC_URL: "x" })).toHaveLength(1);
    expect(vic3LiveRefusals("live", { ...ok, KIT11_DB: "data/vic-1.sqlite" })).toHaveLength(1);
    expect(vic3LiveRefusals("live", { ...ok, KIT11_ANTHROPIC_API_KEY: undefined })).toHaveLength(1);
  });
  it("the dry page says STAND-IN on every purchase and check row, and names no Visa decision", async () => {
    const md = vic3Markdown(await runVic3(world().deps));
    expect(md.split("\n")[0]).toBe("# vic-3: STAND-IN dry run, not live");
    const rows = md.split("\n").filter((l) => /^\| (STAND-IN )?(A|B|C|D|E|F1|F2|[a-z0-9_]+) \|/.test(l) && !l.startsWith("| Check"));
    expect(rows.length).toBe(7 + 14);
    for (const l of rows) expect(l).toMatch(/^\| STAND-IN /);
    expect(md).not.toMatch(/Visa (refused|declined|approved)/i);
  });
});
