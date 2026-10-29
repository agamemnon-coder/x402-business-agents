// The dashboard: numbers from the ledger, pending/expired logic, plain-text rendering, and a read-only server.
import { readFileSync } from "node:fs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { buildSnapshot, parseReview, summarize } from "../src/dashboard/snapshot.js";
import { openDb, type DB } from "../src/db/open.js";
import { TERMS_SCHEMA, type Terms } from "../src/lib/terms.js";
import { openEnrolment, recordPasskey } from "../src/passkey/ledger.js";
import { createProposal } from "../src/policy/approvals.js";
import { dashboardApp } from "../src/servers/dashboard.js";
import { setSetting } from "../src/world/settings.js";

const B = "0x00000000000000000000000000000000000000b1";
const C = "0x00000000000000000000000000000000000000c1";
const S = "0x00000000000000000000000000000000000000f1";
const W = "0x00000000000000000000000000000000000000e1";
const TX = "0x" + "ab".repeat(32);
const XSS = `<img src=x onerror="alert(1)"><script>alert(2)</script>`;
const t0 = new Date("2026-10-29T06:30:00Z");

/** A ledger shaped like rehearsal 2: 40 ticks at 0.05 then 10 at 0.07, supplier 0.02 then 0.04, 3 refunds, one sweep. */
function ledger(): DB {
  const db = openDb(":memory:");
  const acct = db.prepare("INSERT INTO metal_accounts (address, role) VALUES (?, ?)");
  for (const [a, r] of [[B, "business"], [C, "customer"], [S, "supplier"], [W, "sweep"]]) acct.run(a, r);
  const bound = (agent: string, cap: string, budget: string, payee: string) => audit(db, "owner-signer", "mandate.bound", agent, { cap, budget, payee, principal: B, tx: TX });
  bound("sourcing", "0.03", "10.00", S);
  bound("support", "0.10", "4.00", C);
  bound("treasury", "6.00", "6.00", W);
  bound("customer", "0.10", "5.00", B);
  audit(db, "owner-signer", "mandate.replaced", "treasury", { cap: "4.00", budget: "4.00", proposal_id: "P-0002", step: "1", credential_hash: "0x1", tx: TX });
  audit(db, "owner-signer", "mandate.replaced", "sourcing", { cap: "0.04", budget: "12.00", proposal_id: "P-0002", step: "2", credential_hash: "0x2", tx: TX });
  const up = db.prepare("INSERT INTO upstream_purchases (price_cents, outcome, refusal_reason, created_at) VALUES (?, ?, ?, ?)");
  const sale = db.prepare("INSERT INTO sales (sale_id, route, price_cents, payer, request_url, request_params_json, status, created_at) VALUES (?, 'GET /v1/fx-tick', ?, ?, 'u', ?, 'DELIVERED', ?)");
  for (let seq = 1; seq <= 50; seq++) {
    up.run(seq <= 40 ? 2 : 4, "PAID", null, t0.toISOString());
    sale.run(seq, seq <= 40 ? 5 : 7, C, JSON.stringify({ seq: String(seq) }), t0.toISOString());
  }
  up.run(0, "REFUSED", "mandate_cap_exceeded", t0.toISOString());
  audit(db, "sourcing", "upstream.refused", "51", { seq: 41, reason: "mandate_cap_exceeded" });
  for (const id of [7, 10, 13]) {
    db.prepare("INSERT INTO refunds (sale_id, payment_id, amount_cents, to_address, outcome, tx_hash) VALUES (?, ?, 5, ?, 'PAID', ?)").run(id, `refund-${id}`, C, TX);
  }
  db.prepare("INSERT INTO sweeps (payment_id, amount_cents, outcome, tx_hash, created_at) VALUES ('sweep-1', 135, 'PAID', ?, ?)").run(TX, t0.toISOString());
  return db;
}

describe("dashboard snapshot", () => {
  it("derives each agent's budget and spend from the ledger, summed across replaced credentials", () => {
    const s = buildSnapshot(ledger(), t0);
    expect(s.budgets.agents.map((a) => [a.agent, a.cap, a.budget, a.spent, a.remaining, a.payee, a.credentials])).toEqual([
      ["sourcing", "0.04", "12.00", "1.20", "10.80", "Feedstock Labs", 2],
      ["support", "0.10", "4.00", "0.15", "3.85", "Kestrel Quant", 1],
      ["treasury", "4.00", "4.00", "1.35", "2.65", "Tidemark sweep wallet", 2],
    ]);
    expect(s.budgets.counterparty).toMatchObject({ agent: "customer", spent: "2.70", budget: "5.00", payee: "Tidemark Data" });
    expect([s.budgets.allocated, s.budgets.limit]).toEqual(["20.00", "20.00"]);
    expect(s.treasury.metal).toMatchObject({ sales: "2.70", upstream: "1.20", refunds: "0.15", net: "1.35", swept: "1.35" });
    expect(s.audit).toMatchObject({ rows: 7, intact: true });
  });

  it("reads free EUR and USD headroom from the latest balance snapshot and the floors, negative included", () => {
    const db = ledger();
    setSetting(db, "treasury", "eur_floor", "500.00");
    setSetting(db, "treasury", "eur_obligations", "9995005.91");
    setSetting(db, "treasury", "usd_floor", "10019177.63");
    const snap = db.prepare("INSERT INTO balance_snapshots (taken_at, label, json) VALUES (?, ?, ?)");
    snap.run(t0.toISOString(), "old", JSON.stringify({ EUR: { availableCents: 1 }, USD: { availableCents: 1 } }));
    snap.run(t0.toISOString(), "post-exec:P-0006", JSON.stringify({ EUR: { availableCents: 999_551_244 }, USD: { availableCents: 1_002_166_423 } }));
    expect(buildSnapshot(db, t0).treasury.airwallex).toMatchObject({
      label: "post-exec:P-0006", eur: { available: "9995512.44", free: "6.53" }, usd: { headroom: "2486.60" },
    });
    snap.run(t0.toISOString(), "short", JSON.stringify({ EUR: { availableCents: 999_550_529 }, USD: { availableCents: 0 } }));
    expect(buildSnapshot(db, t0).treasury.airwallex!.eur.free).toBe("-0.62");
  });

  it("lists pending proposals live first, marks the ones past expiry without writing, and parses the review", () => {
    const db = ledger();
    const terms = (id: string, expires: string): Terms => ({
      schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: id, expires_at: expires, dispute_id: "D-1", customer: C,
      refunds: [{ sale_id: "5", amount: "0.05" }, { sale_id: "6", amount: "0.05" }],
    } as unknown as Terms);
    createProposal(db, { terms: terms("P-0001", "2026-10-29T06:20:00Z"), createdBy: "support" }, new Date("2026-10-29T06:10:00Z"));
    createProposal(db, { terms: terms("P-0002", "2026-10-29T07:20:00Z"), createdBy: "support", explanation: "[claude-opus-5-5] REJECT: No evidence for it." }, t0);
    const s = buildSnapshot(db, t0);
    expect(s.pending.map((p) => [p.proposal_id, p.expired])).toEqual([["P-0002", false], ["P-0001", true]]);
    expect(s.pending[0]).toMatchObject({ title: "Refund batch", summary: expect.stringMatching(/^Refund 2 sales, 0\.10 USDZ in total/), review: { model: "claude-opus-5-5", recommendation: "reject", text: "No evidence for it." } });
    // Read-only: the stale one is still PENDING_APPROVAL in the ledger.
    expect(db.prepare("SELECT status FROM proposals WHERE proposal_id = 'P-0001'").get()).toEqual({ status: "PENDING_APPROVAL" });
  });

  it("summarizes each kind in plain words, including terms from before the fee ceiling", () => {
    const inv = { vendor: "Lizenzhaus", amount: "1850.00", invoice_no: "LIC-1", iban_last4: "3000", method: "SWIFT", conversion: { sell_amount: "416.59", buy_amount: "370.00", client_rate: "1.1259" } };
    expect(summarize("invoice_payment", JSON.stringify({ ...inv, fee_max: "20.00" }))).toBe("Pay Lizenzhaus EUR 1850.00 for invoice LIC-1 by SWIFT to IBAN …3000; first convert USD 416.59 to EUR 370.00 at 1.1259; fee at most EUR 20.00");
    expect(summarize("invoice_payment", JSON.stringify({ ...inv, conversion: null, fee: "12.85" }))).toMatch(/paid from free EUR; fee about EUR 12\.85$/);
    expect(summarize("mandate_replace", JSON.stringify({ option: "B", query_price: "0.07", margin: "0.03", upstream_price: "0.04", total_budget: "20.00", steps: [{ agent: "treasury", cap: "4.00", budget: "4.00" }] })))
      .toBe("Option B: sell at 0.07 (margin 0.03 on 0.04); treasury cap 4.00, budget 4.00; total 20.00");
    expect(summarize("invoice_payment", "{not json")).toBe("terms unreadable");
    expect(parseReview("plain note")).toEqual({ model: null, recommendation: "note", text: "plain note" });
  });

  it("lists refusals newest first in plain words and keeps hostile text as text", () => {
    const db = ledger();
    audit(db, "treasury", "invoice.escalated", "LIC-EVIL", { reason: XSS });
    audit(db, "human", "approval.too_late", "P-0005", { approver: "max", expires_at: "x", method: "cli", terms_sha256: "ab" });
    const s = buildSnapshot(db, t0);
    expect(s.refusals.map((r) => [r.what, r.agent])).toEqual([["Late approval refused", "human"], ["Invoice escalated", "treasury"], ["Supplier purchase refused", "sourcing"]]);
    expect(s.refusals[1]!.reason).toBe(`Invoice LIC-EVIL escalated to a person: ${XSS}`);
    expect(s.refusals[2]!.reason).toBe("Purchase of tick #41 refused on chain: over the mandate's per-payment cap");
  });

  it("names the passkey approvals need, and says when none is enrolled", () => {
    const db = ledger();
    expect(buildSnapshot(db, t0).passkey).toEqual({ credential: null, label: null, enrolled_at: null, enrolment_open: false });
    const { window } = openEnrolment(db, { rpId: "kit11.example.workers.dev", origin: "https://kit11.example.workers.dev" }, t0);
    expect(buildSnapshot(db, t0).passkey).toMatchObject({ credential: null, enrolment_open: true });
    recordPasskey(db, { window, credentialId: "AbCdEf123456", publicKey: "pk", counter: 0, transports: null, aaguid: null, registrationJson: "{}", label: "max" }, t0);
    expect(buildSnapshot(db, t0).passkey).toEqual({ credential: "AbCdEf12", label: "max", enrolled_at: t0.toISOString(), enrolment_open: false });
  });

  it("reads a ledger from before passkeys without failing", () => {
    const db = ledger();
    db.exec("DROP TABLE passkey_assertions; DROP TABLE passkeys; DROP TABLE passkey_enrolments;");
    expect(buildSnapshot(db, t0).passkey).toEqual({ credential: null, label: null, enrolled_at: null, enrolment_open: false });
  });

  it("describes passkey events, and lists a refused passkey approval as a refusal", () => {
    const db = ledger();
    audit(db, "human", "passkey.enrolled", "AbCdEf123456", { label: "max", window_id: "E-1" });
    audit(db, "system", "passkey.refused", "P-0002", { reason: "Unexpected authentication response challenge", credential: "AbCdEf12" });
    audit(db, "system", "passkey.enrol_refused", null, { reason: "wrong enrolment code" });
    audit(db, "human", "proposal.approved", "P-0002", { approver: "max (passkey AbCdEf12)", method: "passkey", terms_sha256: "cadd01e7ff", passkey: { credential_id: "AbCdEf123456", assertion_sha256: "ab" } });
    const s = buildSnapshot(db, t0);
    expect(s.refusals.slice(0, 2).map((r) => [r.what, r.reason])).toEqual([
      ["Passkey enrolment refused", "Passkey enrolment refused: wrong enrolment code"],
      ["Passkey approval refused", "Passkey approval of P-0002 refused: Unexpected authentication response challenge"],
    ]);
    expect(s.feed.slice(0, 4).map((f) => [f.text, f.tone])).toEqual([
      ["Max · Face ID approved P-0002", "approval"],
      ["Passkey enrolment refused: wrong enrolment code", "refusal"],
      ["Passkey approval of P-0002 refused: Unexpected authentication response challenge", "refusal"],
      ["max enrolled passkey AbCdEf12; approvals now need it", "ok"],
    ]);
  });

  it("shows the CFO policy: the limit beside each mandate, every change in the feed, its refusals in plain words", () => {
    const db = ledger();
    setSetting(db, "human", "cap.sourcing", "0.03");
    audit(db, "human", "policy.changed", "cap.sourcing", { key: "cap.sourcing", label: "Sourcing agent: most per payment", from: "", to: "0.03", proposal_id: "P-0004" });
    audit(db, "sourcing", "upstream.refused", "52", { seq: 42, reason: "policy_cap_exceeded: 0.04 is over the sourcing limit of 0.03" });
    const s = buildSnapshot(db, t0);
    expect(s.budgets.agents.map((a) => [a.agent, a.policy_cap])).toEqual([["sourcing", "0.03"], ["support", null], ["treasury", null]]);
    expect(s.feed[1]).toMatchObject({ text: "CFO policy: Sourcing agent: most per payment changed from no extra limit to 0.03 (P-0004)", tone: "approval" });
    expect(s.refusals[0]).toMatchObject({ what: "Supplier purchase refused", reason: "Purchase of tick #42 refused by the CFO policy before signing: 0.04 is over the sourcing limit of 0.03" });
    expect(summarize("policy_change", JSON.stringify({ changes: [{ label: "Sourcing agent: most per payment", from: "", to: "0.03" }, { label: "EUR reserve floor", from: "500.00", to: "800.00" }] })))
      .toBe("Sourcing agent: most per payment: no extra limit → 0.03; EUR reserve floor: 500.00 → 800.00");
  });

  it("shows a blocked invoice as possible fraud, the model's explanation, and a Face ID rejection by name", () => {
    const db = ledger();
    audit(db, "treasury", "invoice.fraud_suspected", "LIC-2027-01", {
      reason: "possible invoice fraud: …", vendor: "Lizenzhaus Beispiel GmbH", amount: "1850.00", currency: "EUR", iban_last4: "1000",
      signals: [{ code: "bank_details_changed", blocks: true, detail: "the invoice asks for IBAN ...1000 (LT) and BIC CBVILT2XXXX; on file: IBAN ...3000 (DE) and BIC COBADEFFXXX" },
        { code: "pressure_language", blocks: false, detail: "the invoice pushes for speed" }],
    });
    audit(db, "claude", "claude.read", "explain_invoice_fraud", { model: "claude-opus-5-5", output: { recommendation: "do_not_pay" } });
    audit(db, "human", "proposal.rejected", "P-0004", { approver: "max (passkey k_EWzUuv)", method: "passkey", terms_sha256: "30d24528" });
    const s = buildSnapshot(db, t0);
    expect(s.refusals[1]).toMatchObject({
      what: "Invoice blocked: possible fraud", agent: "treasury",
      reason: "Invoice LIC-2027-01 from Lizenzhaus Beispiel GmbH for EUR 1850.00 blocked: the invoice asks for IBAN ...1000 (LT) and BIC CBVILT2XXXX; on file: IBAN ...3000 (DE) and BIC COBADEFFXXX. Nothing was paid; a person must verify with the supplier by phone",
    });
    expect(s.feed[1]).toMatchObject({ text: "Claude explained the blocked invoice to the CFO: do not pay (advisory)", model: "Opus" });
    expect(s.feed[0]).toMatchObject({ text: "Max · Face ID rejected P-0004", tone: "refusal" });
  });

  it("shows who approved with a passkey as the person and Face ID", () => {
    const db = ledger();
    const terms = { schema: TERMS_SCHEMA, kind: "dev_test", proposal_id: "P-0001", expires_at: "2026-10-29T07:00:00Z", label: "DEV TEST" } as unknown as Terms;
    createProposal(db, { terms, createdBy: "system" }, t0);
    db.prepare("UPDATE proposals SET status = 'EXECUTED' WHERE proposal_id = 'P-0001'").run();
    db.prepare("INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, created_at) VALUES ('P-0001', 'APPROVED', 'x', 'max (passkey k_EWzUuv)', 'passkey', 'x', ?)").run(t0.toISOString());
    expect(buildSnapshot(db, t0).decisions[0]).toMatchObject({ proposal_id: "P-0001", title: "Dev test (moves no money)", by: "Max · Face ID" });
  });

  it("turns audit rows into feed lines with model chips, checked tx links and Airwallex ids", () => {
    const db = ledger();
    audit(db, "system", "claude.read", "classify_document", { model: "claude-haiku-5-5", output: { kind: "price_notice" } });
    audit(db, "awx-executor", "transfer.created", "tr-1", { amount: "EUR 1850.00", tx: "javascript:alert(1)" });
    audit(db, "system", "something.new", "x", {});
    const f = buildSnapshot(db, t0).feed;
    expect(f[0]).toMatchObject({ event: "something.new", text: "something.new x", tone: "info" });
    expect(f[1]).toMatchObject({ text: "SWIFT transfer of EUR 1850.00 created, approval hash in its metadata", awx_id: "tr-1", tx: null });
    expect(f[2]).toMatchObject({ model: "Haiku", text: "Claude classified an incoming document as price notice" });
    expect(f.find((x) => x.event === "mandate.bound")).toMatchObject({ tx: TX });
  });
});

const PAGE = readFileSync(new URL("../src/dashboard/page.html", import.meta.url), "utf8");

describe("dashboard page", () => {
  it("never turns data into HTML", () => {
    expect(PAGE).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/);
    expect(PAGE).toMatch(/textContent|createTextNode/);
    // Relative URLs only, so another host can serve the same file.
    expect(PAGE).toContain(`fetch("api/snapshot"`);
    expect(PAGE).toContain(`"approve/" + encodeURIComponent(`);
  });

  it("shows which passkey approvals need, and calls a relay whose runner went quiet stale", () => {
    expect(PAGE).toContain('id="passkey"');
    expect(PAGE).toMatch(/d\.passkey/);
    expect(PAGE).toMatch(/relay\.age_ms > RUNNER_STALE_MS/);
  });
});

describe("dashboard server", () => {
  const servers: { close: () => void }[] = [];
  afterEach(() => { while (servers.length) servers.pop()!.close(); });

  async function serve(db: DB) {
    const server = dashboardApp(db, { approvalsUrl: "http://127.0.0.1:4200/", now: () => t0 }).listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", () => r()));
    servers.push(server);
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it("serves the snapshot as JSON and a page with no ledger data in it, under a strict CSP", async () => {
    const db = ledger();
    createProposal(db, { terms: { schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: "P-0007", expires_at: "2099-01-01T00:00:00Z", refunds: [] } as Terms, createdBy: "support" }, t0);
    const base = await serve(db);
    const snap = await fetch(`${base}/api/snapshot`);
    expect(snap.headers.get("content-type")).toMatch(/application\/json/);
    expect(((await snap.json()) as { pending: { proposal_id: string }[] }).pending[0]!.proposal_id).toBe("P-0007");
    const page = await fetch(`${base}/`);
    const html = await page.text();
    expect(html).toBe(PAGE);
    expect(html).not.toContain("P-0007");
    expect(page.headers.get("content-security-policy")).toMatch(/default-src 'none'; script-src 'sha256-[^']+'; style-src 'sha256-[^']+'; connect-src 'self'/);
  });

  it("hands approvals to the approval page and refuses odd ids and foreign hosts", async () => {
    const base = await serve(ledger());
    const r = await fetch(`${base}/approve/P-0007`, { redirect: "manual" });
    expect([r.status, r.headers.get("location")]).toEqual([302, "http://127.0.0.1:4200/#P-0007"]);
    expect((await fetch(`${base}/approve/javascript:alert(1)`, { redirect: "manual" })).status).toBe(400);
    // fetch drops a custom Host header, so ask with node:http as a rebinding page would arrive.
    const status = await new Promise<number>((done, fail) => {
      request(`${base}/api/snapshot`, { headers: { host: "evil.example" } }, (res) => { res.resume(); done(res.statusCode ?? 0); }).on("error", fail).end();
    });
    expect(status).toBe(403);
  });
});
