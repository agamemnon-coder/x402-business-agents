// Why Purser holds or refuses, on /try (14 Nov, owner and a tester): the reason big and first, the evidence side by side,
// the rule from the code, the details folded. The words are WHY and TAMPER (cloud/src/tryCopy.ts), the picker is the
// page's own plain script (WHY_JS, run here as the page runs it), and the evidence is the engine's answer: the five
// samples go through the cloud's routes on the Node engine, as the visitor's taps send them.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TAMPER, WHY } from "../cloud/src/tryCopy.js";
import { tryPage } from "../cloud/src/tryPage.js";
import { WHY_JS } from "../cloud/src/try/why.js";
import { TWIN_DAYS, UNUSUAL_FACTOR } from "../src/ap/checkerCore.js";
import { CHECKER_HOLD, CHECKER_REJECT } from "../src/ap/checkerAgent.js";
import { PAY_LATER } from "../src/ap/payerAgent.js";
import { SAMPLE_SOURCES } from "../src/engine/tryWorld.js";
import { ADMIN_TOKEN, testCloud, type TestCloud } from "./support/cloud.js";

type Row = [string, string, string];
interface Why { tone: string; code: string; head: string; rows: Row[]; said: string; rule: string; words: string[] }
interface Kit {
  whyOf(W: typeof WHY, up: unknown, fmt: { money(c: string, a: string): string; date(s: string): string }): Why | null;
  tamperRows(signed: Record<string, string>, sent: Record<string, string>, changed: unknown, labels: Record<string, string>, fmt: { money(c: string, a: string): string }): [string, string, string][];
}
const kit = new Function(`${WHY_JS}\nreturn whyKit;`)() as Kit;
const fmt = { money: (c: string, a: string) => `${c} ${a}`, date: (s: string) => s.slice(0, 10) };
const inv = (findings: unknown[], o: Record<string, unknown> = {}) => ({ kind: "invoice", invoice: { id: "AP-0009", status: "needs_review", status_words: "Needs review", payable: false, vendor: "Bergtex Textil GmbH", invoice_no: "BTX-9", currency: "EUR", total: "100.00", issue_date: "2026-11-01", paid_at: null, findings, ...o } });

describe("one place maps every finding code to plain words", () => {
  // Every code the engine can return, read from its sources: a new code without words fails here.
  const sources = ["src/ap/checkerCore.ts", "src/ap/inbox.ts", "src/ap/scan.ts", "src/ap/pay.ts", "src/policy/fraudCore.ts"].map((f) => readFileSync(f, "utf8")).join("\n");
  const codes = new Set([...sources.matchAll(/code: "([a-z_]+)"/g)].map((m) => m[1]!));
  codes.delete("unknown_vendor"); // never a finding: new_supplier says it
  for (const c of [CHECKER_HOLD, CHECKER_REJECT, PAY_LATER]) codes.add(c);

  it("has words for each code the engine returns, and no others", () => {
    expect([...codes].sort()).toEqual(Object.keys(WHY.codes).filter((k) => codes.has(k) || k === "possible_fraud").sort());
    expect(Object.keys(WHY.codes).filter((k) => !codes.has(k))).toEqual([]);
  });

  for (const code of Object.keys(WHY.codes)) {
    it(`${code}: its headline first, its rule, the engine's sentence as the evidence when there is no side by side`, () => {
      const level = code === "possible_fraud" || code === "duplicate" || code === "sum_mismatch" || code === "iban_invalid" || code === "bank_details_invalid" || code === "payee_blocked" || code === "checker_reject" ? "block"
        : code === "new_supplier" ? "wait" : ["unusual_amount", "overdue", "bank_change_language", "pressure_language", "payment_not_planned", PAY_LATER].includes(code) ? "warn" : "review";
      const w = kit.whyOf(WHY, inv([{ level, code, message: `the engine's own words for ${code}` }]), fmt)!;
      const c = WHY.codes[code]!;
      expect(w.code).toBe(code);
      expect(w.head).toBe(c.head);
      expect(w.head).toMatch(/^(Held|Refused|Flagged|Planned)\b.*\.$/);
      expect(w.rule).toBe(c.rule ?? "");
      if (code === "new_supplier") expect(w.rows).toEqual([[WHY.onInvoice, "Bergtex Textil GmbH", "Bergtex Textil GmbH"], [WHY.onFile, WHY.notOnFile, ""]]);
      else { expect(w.rows).toEqual([]); expect(w.said).toBe(`The engine's own words for ${code}.`); }
      expect(w.words).toEqual([`The engine's own words for ${code}.`]);
      expect(w.tone).toBe(c.head.startsWith("Refused") ? "refuse" : level === "warn" ? "flag" : "hold");
    });
  }

  it("takes its numbers from the code's own constants", () => {
    expect(WHY.codes.possible_duplicate!.rule).toBe(`The same supplier and the same total within ${TWIN_DAYS} days: likely the same invoice under another number, so a person must look.`);
    expect(TWIN_DAYS).toBe(45);
    expect(WHY.codes.unusual_amount!.rule).toContain(`More than ${UNUSUAL_FACTOR} times`);
  });

  it("shows the most severe finding first, and every finding's own words in the fold", () => {
    const w = kit.whyOf(WHY, inv([{ level: "warn", code: "overdue", message: "the due date 2026-10-01 has passed" }, { level: "block", code: "sum_mismatch", message: "the subtotal 80.00 plus tax 16.80 is 96.80, not the total 100.00" }]), fmt)!;
    expect([w.code, w.head, w.said]).toEqual(["sum_mismatch", WHY.codes.sum_mismatch!.head, "The subtotal 80.00 plus tax 16.80 is 96.80, not the total 100.00."]);
    expect(w.words).toEqual(["The due date 2026-10-01 has passed.", "The subtotal 80.00 plus tax 16.80 is 96.80, not the total 100.00."]);
  });

  it("a code it does not know: a person must look, in the engine's words", () => {
    const w = kit.whyOf(WHY, inv([{ level: "review", code: "something_new", message: "a new check said so" }]), fmt)!;
    expect([w.head, w.said, w.rule]).toEqual([WHY.other.head, "A new check said so.", ""]);
  });

  it("ready to pay, or its terms already waiting for the signature: no reason to show", () => {
    expect(kit.whyOf(WHY, inv([], { payable: true, status: "ready" }), fmt)).toBeNull();
    expect(kit.whyOf(WHY, inv([], { payable: false, proposal: { status: "PENDING_APPROVAL" } }), fmt)).toBeNull();
  });
});

describe("the refused payment: signed beside asked", () => {
  const labels = { amount: "Amount", beneficiary_name: "Payee", iban_last4: "Account ending" };
  const signed = { amount: "1850.00", currency: "EUR", beneficiary_name: "Bergtex Textil GmbH", iban_last4: "3000" };
  it("one row per field the visitor changed, whichever it is", () => {
    expect(kit.tamperRows(signed, { ...signed, amount: "1850.01" }, ["amount"], labels, fmt)).toEqual([["Amount", "EUR 1850.00", "EUR 1850.01"]]);
    expect(kit.tamperRows(signed, { ...signed, iban_last4: "9999" }, null, labels, fmt)).toEqual([["Account ending", "…3000", "…9999"]]);
    expect(kit.tamperRows(signed, { ...signed, beneficiary_name: "Someone Else" }, [{ field: "beneficiary_name" }], labels, fmt)).toEqual([["Payee", "Bergtex Textil GmbH", "Someone Else"]]);
    expect(kit.tamperRows(signed, { ...signed, amount: "2000.00", iban_last4: "1111" }, null, labels, fmt)).toEqual([["Amount", "EUR 1850.00", "EUR 2000.00"], ["Account ending", "…3000", "…1111"]]);
  });
  it("says it plainly", () => {
    expect(TAMPER.head).toBe("Refused: the terms changed after you signed.");
    expect(TAMPER.line).toBe("{method} signs the exact terms. Change one cent and the signature no longer matches, so nothing is paid.");
    expect(TAMPER.proof).toBe("Show the proof");
  });
  it("the page draws the reason first and folds the stamp, the layers and the fingerprints under Show the proof", () => {
    const html = tryPage("n0nce", { origin: "https://purser-try.example", rpId: "purser-try.example" });
    expect(html).toContain("const card=el('section','why refuse card refusal shake',[el('p','head',[icon('triangle-alert',22),el('span','',X.head)]),d,el('p','rule',cap1(fill(X.line,{method:method()})))]);");
    expect(html).toContain("const proof=el('details','',[el('summary','',X.proof),el('p','stamp',Y.stamp)]);");
    expect(html).toContain("proof.append(line(Y.signed,h.a),line(Y.sent,h.b));");
  });
});

describe("the five samples, as the engine answers them", () => {
  let c: TestCloud;
  const up: Record<string, unknown> = {};
  beforeAll(async () => {
    c = testCloud({ engine: true, tryIt: {} });
    await c.req("POST", "/v1/try/admin", { key: ADMIN_TOKEN, body: { op: "set", key: "starts", value: "on" } });
    const s = (await c.req("POST", "/v1/try/start", { body: {}, headers: { "cf-connecting-ip": "198.51.100.77" } })).json.session as string;
    for (const src of SAMPLE_SOURCES) up[src.key] = (await c.req("POST", `/v1/engine/samples/${src.key}`, { key: s })).json;
  }, 120_000);
  afterAll(() => c.close());
  const today = new Date().toISOString().slice(0, 10);

  it("a supplier's invoice: ready, no reason shown", () => {
    expect(kit.whyOf(WHY, up.clean, fmt)).toBeNull();
  });

  it("the same file again: held, already paid, the paid original beside this copy's fingerprint", () => {
    const u = up.again as { sha256: string };
    const w = kit.whyOf(WHY, up.again, fmt)!;
    expect(w.head).toBe("Held: this invoice was already paid.");
    expect(w.rows).toEqual([
      [WHY.earlierPaid, `Bergtex Textil GmbH · BTX-2026-17 · EUR 1620.00 · paid ${today}`, ""],
      [WHY.thisOne, `The same file, fingerprint ${u.sha256.slice(0, 12)}…`, ""],
    ]);
    expect(w.rule).toBe(WHY.again.rule);
  });

  it("a paid invoice under a new number: held, the paid original and this one side by side, the rule with its days", () => {
    const w = kit.whyOf(WHY, up.renumbered, fmt)!;
    expect(w.head).toBe("Held: this may be an invoice already paid.");
    expect(w.rows[0]).toEqual([WHY.earlierPaid, `Bergtex Textil GmbH · BTX-2026-17 · EUR 1620.00 · paid ${today}`, ""]);
    expect(w.rows[1]![0]).toBe(WHY.thisOne);
    expect(w.rows[1]![1]).toMatch(/^Bergtex Textil GmbH · BTX-2026-17A · EUR 1620\.00 · dated \d{4}-\d{2}-\d{2}$/);
    expect(w.rows[1]![2]).toBe("BTX-2026-17A"); // only the number differs: it is marked
    expect(w.rule).toBe(`The same supplier and the same total within ${TWIN_DAYS} days: likely the same invoice under another number, so a person must look.`);
  });

  it("new bank details: held, the account asked beside the one on file", () => {
    const w = kit.whyOf(WHY, up.bank, fmt)!;
    expect(w.head).toBe("Held: the bank details changed.");
    expect(w.rows).toHaveLength(2);
    expect(w.rows[0]![0]).toBe(WHY.onInvoice); expect(w.rows[0]![1]).toMatch(/^IBAN \.\.\.4931 \(DE\)/); expect(w.rows[0]![2]).toBe(w.rows[0]![1]);
    expect(w.rows[1]![0]).toBe(WHY.onFile); expect(w.rows[1]![1]).toMatch(/^IBAN \.\.\.3000/); expect(w.rows[1]![2]).toBe("");
    expect(w.rule).toBe(WHY.codes.possible_fraud!.rule);
    expect(w.tone).toBe("hold");
  });

  it("a new supplier: held, its name beside not on file, the rule", () => {
    const w = kit.whyOf(WHY, up.unknown, fmt)!;
    expect(w.head).toBe("Held: this supplier is not on file yet.");
    expect(w.rows).toEqual([[WHY.onInvoice, "Zeeland Verpakkingen B.V.", "Zeeland Verpakkingen B.V."], [WHY.onFile, WHY.notOnFile, ""]]);
    expect(w.rule).toBe(WHY.codes.new_supplier!.rule);
  });
});
