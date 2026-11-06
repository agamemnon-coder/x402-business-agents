// /trace (Max's last round, 1.2): any of the main run's payments, step by step. The count is computed (88 = 86 on Metal +
// 1 card charge + 1 SWIFT transfer, not Max's 87: 87 is the payments inside the limits, counts.alone; the SWIFT
// transfer went through a proposal); every chain is complete or says which step it lacks and why; every id and link
// matches the main run's record; the companion record (docs/demo/main-run-trace.json) agrees with the record and with
// reconcile, carries its label, and holds nothing private.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { doubleEntry, trialBalance } from "../src/accounting/books.js";
import { checkChainLinks, GENESIS } from "../src/audit/log.js";
import { CFO_VIEW_URL } from "../src/config/brand.js";
import { secretsIn } from "../src/demo/runLedger.js";
import { RECORD_UNCHANGED, TRACE_FILE, traceLabel, type PaymentKind } from "../src/demo/runTrace.js";
import { fromCents, toCents } from "../src/lib/money.js";
import { EXPLORER_TX } from "../src/metal/network.js";
import { proofPage } from "../src/redesign/proof.js";
import { loadRecord, payments } from "../src/redesign/run.js";
import { chainLines, chains, countOf, HEADER_SECOND, headerLine, loadTrace, STEP_TITLES, TRACE_LINK, TRACE_URL, tracePage } from "../src/redesign/trace.js";
import { buildPages } from "../src/relay/assets.js";
import { PAGE, TRACE_CSP } from "../src/servers/dashboard.js";
import { pageResponse } from "../worker/src/core.js";
import { scriptBlocks } from "./support/scriptBlocks.js";

const { record } = loadRecord();
const trace = loadTrace();
const all = chains(record, trace);
const html = tracePage(record, trace);
const raw = readFileSync(TRACE_FILE, "utf8");
const decode = (s: string) => s.split("&#39;").join("'").split("&quot;").join('"').split("&amp;").join("&");
type Rec = typeof record & { snapshot: Record<string, unknown> };
const snap = (record as Rec).snapshot as unknown as {
  reconciliation: { checked: number; differences: number };
  feed: { seq: number; event: string; tx: string | null; awx_id: string | null }[];
  flows: { at: string; kind: string; amount: string; unit: string; rail: string; count?: number; request?: string; refused?: unknown; proof: { full?: string | null } }[];
  books: { balanced: boolean; total_postings: number; trial: Record<string, string>[]; cash: Record<string, string>[]; postings: Record<string, string>[] };
  audit: { rows: number; head: string; intact: boolean };
  counts: { alone: number };
};
const ev = record.ledger!.events;
const byId = new Map(trace.payments.map((p) => [p.id, p]));

describe("/trace: the count, computed from the record", () => {
  const c = countOf(trace), pay = payments(record);

  it("is 88 = 86 on Metal + 1 card charge + 1 SWIFT transfer, each part equal to the main run's record", () => {
    expect([c.metal, c.sales, c.purchases, c.refunds, c.sweeps, c.cards, c.transfers]).toEqual([pay.onChain, pay.sales, pay.purchases, pay.refunds, pay.sweeps, pay.cards, pay.transfers]);
    expect(c.n).toBe(c.metal + c.cards + c.transfers);
    // 87, the number Max wrote, is the payments inside the limits (counts.alone); the SWIFT transfer is the 88th.
    expect(c.metal + c.cards).toBe(snap.counts.alone);
    // And reconcile checked exactly these 88 flows, with no difference.
    expect([c.n, pay.reconciled, snap.reconciliation.differences]).toEqual([snap.reconciliation.checked, snap.reconciliation.checked, 0]);
    expect(c.line).toBe(`${c.n} = ${c.metal} on Metal + 1 card charge + 1 SWIFT transfer`);
    expect(c.metalParts).toBe(pay.metalParts);
  });

  it("the header says it, and each number in it is the computed one", () => {
    const header = headerLine(c);
    expect(header).toBe(`Pick any of the ${c.n} payments (${c.metal} on Metal + ${c.cards} card charge + ${c.transfers} SWIFT transfer).`);
    const nums = [...header.matchAll(/\d+/g)].map((m) => Number(m[0]));
    expect(nums).toEqual([c.n, c.metal, c.cards, c.transfers]);
    expect(nums).toEqual([88, 86, 1, 1]);
    expect(decode(html)).toContain(`${header} ${HEADER_SECOND}`);
    expect(decode(html)).toContain(`On Metal: ${pay.metalParts}.`);
  });
});

describe("/trace: every payment's chain", () => {
  it("lists all 88, each once, each with the eight steps in order", () => {
    expect(all.length).toBe(88);
    expect(new Set(all.map((x) => x.payment.id)).size).toBe(88);
    for (const x of all) expect({ id: x.payment.id, keys: x.steps.map((s) => s.key) }).toEqual({ id: x.payment.id, keys: Object.keys(STEP_TITLES) });
  });

  it("is complete, or says plainly which step is not there and why; never a step that did not happen", () => {
    for (const x of all) {
      for (const s of x.steps) {
        expect({ id: x.payment.id, step: s.key, text: s.text.length > 20 }).toEqual({ id: x.payment.id, step: s.key, text: true });
        if (s.status === "none") expect({ id: x.payment.id, step: s.key, why: /^No |^The record names no|^The executor's rows do not/.test(s.text) }).toEqual({ id: x.payment.id, step: s.key, why: true });
      }
      const st = Object.fromEntries(x.steps.map((s) => [s.key, s.status]));
      // Only a payment that went through a proposal has a signature and a hash for the executor to check.
      const proposed = x.payment.kind === "transfer";
      expect({ id: x.payment.id, signature: st.signature, execution: st.execution }).toEqual({ id: x.payment.id, signature: proposed ? "shown" : "none", execution: proposed ? "shown" : "none" });
      // Everything else is there for every payment: policy, decision, limit or proposal, rail, booking, audit row.
      for (const k of ["policy", "decision", "limit", "rail", "booking", "audit"] as const) expect({ id: x.payment.id, k, st: st[k] }).toEqual({ id: x.payment.id, k, st: "shown" });
    }
  });

  it("names the lock that held each payment inside its limit, and the proposal for the one that was not", () => {
    const lock = (id: string) => all.find((x) => x.payment.id === id)!.steps.find((s) => s.key === "limit")!;
    const want: Record<PaymentKind, RegExp> = { sale: /customer's mandate on Metal/, purchase: /^Metal's mandate on chain$/, refund: /^Metal's mandate on chain$/, sweep: /^Metal's mandate on chain$/, card: /^Airwallex's card controls$/, transfer: /^P-\d{4}$/ };
    for (const p of trace.payments) {
      const s = lock(p.id);
      expect({ id: p.id, ok: want[p.kind].test(s.ids[0]?.value ?? "") }).toEqual({ id: p.id, ok: true });
      if (p.kind !== "transfer") {
        // The amount is inside the cap the step names.
        const [amount, cap] = [...s.text.matchAll(/\d+\.\d{2}/g)].map((m) => toCents(m[0]));
        expect({ id: p.id, inside: amount! <= cap! }).toEqual({ id: p.id, inside: true });
      }
    }
  });

  it("the SWIFT transfer: proposal, Face ID, the executor's rows carry the signed hash, the Airwallex id with its approval_sha256", () => {
    const x = all.find((c) => c.payment.kind === "transfer")!, p = x.payment;
    const created = ev.find((e) => e.event === "proposal.created" && e.subject === p.proposal_id)!;
    const approved = ev.find((e) => e.event === "proposal.approved" && e.subject === p.proposal_id)!;
    const transfer = ev.find((e) => e.event === "transfer.created")!;
    expect([p.rail_id, p.approval_sha256, p.proposal_id]).toEqual([transfer.subject, transfer.payload.approval_sha256, "P-0005"]);
    expect([created.payload.terms_sha256, approved.payload.terms_sha256]).toEqual([p.approval_sha256, p.approval_sha256]);
    const step = (k: string) => x.steps.find((s) => s.key === k)!;
    expect(step("signature").ids.map((i) => i.value)).toEqual([approved.payload.approver, approved.ts, p.approval_sha256]);
    expect(step("execution").text).toMatch(/fx\.converted \(seq 362\), transfer\.created \(seq 363\), transfer\.fee \(seq 367\)/);
    expect(step("rail").ids).toEqual([{ label: "Airwallex id", value: transfer.subject }, { label: "approval_sha256", value: p.approval_sha256 }]);
    expect(step("decision").ids.map((i) => i.value)).toEqual([(created.payload.origin as Record<string, string>).agent, (created.payload.origin as Record<string, string>).model, (created.payload.origin as Record<string, string>).request_id]);
  });
});

describe("/trace: every id and link matches the main run's record", () => {
  it("each Metal payment links its own tx to the explorer, and every tx the record names for a payment is the same one", () => {
    for (const x of all.filter((c) => c.payment.rail === "metal")) expect(x.steps.find((s) => s.key === "rail")!.ids).toEqual([{ label: "tx", value: x.payment.rail_id, href: `${EXPLORER_TX}${x.payment.rail_id}` }]);
    // The feed's payment rows (seq, tx), the ledger's (refunds, sweep, card, transfer) and the dispute's evidence (sale id, tx).
    const kindOf: Record<string, PaymentKind> = { "sale.delivered": "sale", "upstream.paid": "purchase", "card.charge_approved": "card" };
    let seen = 0;
    for (const f of snap.feed.filter((r) => r.event in kindOf)) {
      const p = trace.payments.find((x) => x.audit.seq === f.seq)!;
      expect({ seq: f.seq, kind: p.kind, id: p.rail_id }).toEqual({ seq: f.seq, kind: kindOf[f.event], id: f.tx ?? f.awx_id });
      seen++;
    }
    for (const e of ev.filter((r) => ["refund.paid", "sweep.paid"].includes(r.event))) {
      const p = trace.payments.find((x) => x.audit.seq === e.seq)!;
      expect([p.rail_id, (p.origin as Record<string, string>).request_id]).toEqual([e.payload.tx, (e.payload.origin as Record<string, string>).request_id]);
      seen++;
    }
    const dispute = record.ledger!.disputes[0]!.evidence as { sale_id: number; tx: string }[];
    for (const d of dispute) { expect(byId.get(`sale-${d.sale_id}`)!.rail_id).toBe(d.tx); seen++; }
    expect(seen).toBeGreaterThan(40);
  });

  it("the record's groups of payments are the companion's payments: same count, same sum, same newest tx, per group", () => {
    const kinds: Record<string, PaymentKind> = { sale: "sale", upstream: "purchase", refund: "refund", sweep: "sweep" };
    const groups = snap.flows.filter((f) => f.rail === "metal" && !f.refused && f.kind in kinds);
    for (const kind of Object.keys(kinds)) {
      const mine = groups.filter((g) => g.kind === kind).sort((a, b) => a.at.localeCompare(b.at));
      const paid = trace.payments.filter((p) => p.kind === kinds[kind]).sort((a, b) => a.at.localeCompare(b.at));
      let from = 0;
      for (const g of mine) {
        const n = g.count ?? 1, part = paid.slice(from, from + n);
        from += n;
        expect({ kind, at: g.at, n: part.length, sum: fromCents(part.reduce((s, p) => s + toCents(p.amount), 0)), last: part.at(-1)?.rail_id }).toEqual({ kind, at: g.at, n, sum: g.amount, last: g.proof.full });
      }
      expect({ kind, all: from }).toEqual({ kind, all: paid.length });
    }
    // The card charge and the SWIFT transfer: the record's own Airwallex ids.
    for (const [kind, rail] of [["card", "airwallex_card"], ["transfer", "airwallex_swift"]] as const) {
      const f = snap.flows.filter((x) => x.rail === rail);
      expect(trace.payments.filter((p) => p.kind === kind).map((p) => [p.rail_id, p.amount])).toEqual(f.map((x) => [x.proof.full, x.amount]));
    }
  });

  it("the decisions: each agent's request id is the one the record gives for that payment", () => {
    for (const f of snap.flows.filter((x) => x.request && !x.refused && x.kind !== "licence")) {
      const p = trace.payments.find((x) => x.rail_id === f.proof.full)!;
      const step = all.find((c) => c.payment.id === p.id)!.steps.find((s) => s.key === "decision")!;
      expect({ tx: f.proof.full, request: step.ids.find((i) => i.label === "request id")?.value }).toEqual({ tx: f.proof.full, request: f.request });
    }
  });

  it("the booking lines are the books': the record's last postings, its trial balance and its cash, from the companion's journal", () => {
    const postings = doubleEntry(trace.journal);
    expect(postings.length).toBe(snap.books.total_postings);
    const view = postings.slice(-snap.books.postings.length).reverse().map((p) => ({ entry: p.entry, date: p.date, account: p.account, account_name: p.account_name, debit: p.debit_cents ? fromCents(p.debit_cents) : "", credit: p.credit_cents ? fromCents(p.credit_cents) : "", currency: p.currency, cost_centre: p.cost_centre, description: p.description }));
    expect(view).toEqual(snap.books.postings);
    const signed = (c: number) => (c < 0 ? `-${fromCents(-c)}` : fromCents(c));
    expect(trialBalance(postings).map((t) => ({ account: t.account, name: t.name, currency: t.currency, debit: fromCents(t.debit_cents), credit: fromCents(t.credit_cents), balance: signed(t.balance_cents) })))
      .toEqual(snap.books.trial.map((t) => ({ account: t.account, name: t.name, currency: t.currency, debit: t.debit, credit: t.credit, balance: t.balance })));
    // Every payment has its own line(s) in the books, and every journal line that is a payment belongs to one.
    for (const x of all) expect({ id: x.payment.id, entries: x.steps.find((s) => s.key === "booking")!.ids.length }).toEqual({ id: x.payment.id, entries: x.payment.kind === "transfer" ? 2 : 1 });
  });

  it("money in and out per rail and currency equals the record's books, and reconcile's 88", () => {
    const sum = (f: (p: (typeof trace.payments)[number]) => boolean) => fromCents(trace.payments.filter(f).reduce((s, p) => s + toCents(p.amount), 0));
    const cash = (account: string) => snap.books.cash.find((c) => c.account === account)!;
    // Metal (1210): in = the sales; out = the purchases, refunds and the sweep.
    expect([sum((p) => p.kind === "sale"), sum((p) => ["purchase", "refund", "sweep"].includes(p.kind))]).toEqual([cash("1210").in, cash("1210").out]);
    // Airwallex EUR (1200): out = the card charge, the transfer and its fee (EUR 13.42, on the transfer's booking).
    const fee = ev.find((e) => e.event === "transfer.fee")!.payload.fee as string;
    expect(fromCents(toCents(sum((p) => p.currency === "EUR")) + toCents(fee.replace(/^EUR /, "")))).toBe(cash("1200").out);
    expect(trace.payments.length).toBe(snap.reconciliation.checked);
  });

  it("each payment's audit row is a row of the chain; the chain's published links run from the genesis to the record's head", () => {
    expect([trace.audit.rows, trace.audit.head, trace.audit.intact]).toEqual([snap.audit.rows, snap.audit.head, snap.audit.intact]);
    const check = checkChainLinks(trace.audit.links);
    expect(check).toEqual({ ok: true, rows: 412, head: snap.audit.head });
    expect(trace.audit.links[0]!.prev_hash).toBe(GENESIS);
    // Per row, only its seq, prev_hash and row_hash: nothing else from the row.
    for (const l of trace.audit.links) expect(Object.keys(l)).toEqual(["seq", "prev_hash", "row_hash"]);
    for (const x of all) {
      const link = trace.audit.links.find((l) => l.seq === x.payment.audit.seq)!;
      expect(x.steps.find((s) => s.key === "audit")!.ids).toEqual([{ label: "row_hash", value: link.row_hash }, { label: "prev_hash", value: link.prev_hash }]);
    }
    // The ledger rows the record keeps for these payments have the same seq.
    for (const e of ev.filter((r) => ["refund.paid", "sweep.paid", "card.charge_approved", "transfer.created"].includes(r.event))) expect(trace.payments.some((p) => p.audit.seq === e.seq && p.audit.event === e.event)).toBe(true);
    // A broken link is caught.
    const bad = trace.audit.links.map((l) => (l.seq === 200 ? { ...l, prev_hash: "f".repeat(64) } : l));
    expect(checkChainLinks(bad)).toEqual({ ok: false, seq: 200, reason: "prev_hash does not match the previous row" });
  });

  it("says what the published chain proves and what it does not", () => {
    const c = chainLines(trace);
    expect(c.proves).toContain(`${snap.audit.rows} rows, head ${snap.audit.head.slice(0, 8)}…, intact`);
    expect(c.proves).toContain("(checked when this page was built)");
    expect(c.doesNot).toBe("The rows themselves contain credentials and are not published, so no row_hash can be recomputed from public files: the linkage and the head are checkable, each row's content is not.");
    for (const line of [c.proves, c.doesNot]) expect(decode(html)).toContain(line);
  });
});

describe("the companion record: labelled, and nothing private in it or on /trace", () => {
  it("carries the label with its generation date, and says the main run's record is unchanged", () => {
    expect(trace.generated).toMatch(/^2026-11-(0[3-9]|[12]\d|30)$/);
    expect(trace.label).toBe(traceLabel(trace.generated));
    expect(trace.label).toBe(`Derived from the main run's ledger (3 Nov), sanitized, generated ${trace.generated}.`);
    expect(decode(html)).toContain(`${trace.label} ${RECORD_UNCHANGED}`);
    expect(RECORD_UNCHANGED).toBe("The main run's record is unchanged.");
  });

  const TEXTS: [string, string][] = [["the companion", raw], ["/trace", html]];
  // Every 64-hex value must be a hash or a transaction the files name as one; every 40-hex value an address in the record.
  const known64 = new Set<string>(), known40 = new Set<string>();
  const leaves = (v: unknown, key = ""): [string, string][] => Array.isArray(v) ? v.flatMap((x) => leaves(x, key)) : v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => leaves(x, k)) : [[key, String(v)]];
  for (const [key, value] of leaves(JSON.parse(raw))) if (/^(tx|rail_id|row_hash|prev_hash|head|mandate_hash|approval_sha256|proof)$/.test(key)) for (const m of value.matchAll(/[0-9a-f]{64}/gi)) known64.add(m[0].toLowerCase());
  const rec = readFileSync("docs/demo/main-run.json", "utf8");
  for (const m of rec.matchAll(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g)) known40.add(m[0].toLowerCase());

  for (const [name, text] of TEXTS) {
    it(`${name}: no IBAN, email, long base64 run, credential, token, key or unknown hex`, () => {
      const PATTERNS: [string, RegExp][] = [
        ["an IBAN", /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}\b/],
        ["an email address", /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/],
        ["a JWT", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
        ["a PEM block", /-----BEGIN [A-Z ]*-----/],
        ["an API key", /\bsk-(ant-)?[A-Za-z0-9_-]{16,}|\bkey_[A-Za-z0-9]{12,}|\b(pk|rk|sk)_(live|test)_[A-Za-z0-9]{8,}/],
        ["a bearer token", /\bBearer\s+[A-Za-z0-9._-]{12,}/i],
        ["a credential or assertion field", /"(credential_id|credentialId|assertion|assertion_sha256|attestation|attestationObject|clientDataJSON|authenticatorData|signature|public_key|beneficiary_id|iban|passkey|email|email_sha256|token|secret|private_key|view_key|nonce)"\s*:/i],
        ["a passkey label", /\(passkey [A-Za-z0-9_-]+\)/],
      ];
      for (const [what, re] of PATTERNS) expect({ name, what, found: re.exec(text)?.[0] ?? null }).toEqual({ name, what, found: null });
      // The record's own check (no relay host, viewer key, token or key); a page names the project's own site in its preview tags.
      if (name === "the companion") expect(secretsIn(text)).toEqual([]);
      const hosts = new Set([...text.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)].map((m) => m[1]!));
      expect({ name, hosts: [...hosts].filter((h) => !["testnet.metalntwx.com", "kit11.max-31b.workers.dev", "www.w3.org"].includes(h)) }).toEqual({ name, hosts: [] });
      // A long base64 or base64url run (40+): only hex hashes, transactions and addresses are that long here.
      const explorer = new RegExp(`${EXPLORER_TX.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")}0x[0-9a-f]{64}`, "g");
      const runs = [...text.replace(explorer, " ").matchAll(/[A-Za-z0-9+/_=-]{40,}/g)].map((m) => m[0]).filter((s) => !/^(0x)?[0-9a-fA-F]+$/.test(s.replace(/^[^0-9a-fA-Fx]+/, "")));
      expect({ name, runs }).toEqual({ name, runs: [] });
      const unknown64 = [...new Set([...text.matchAll(/(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])/g)].map((m) => m[0].toLowerCase()))].filter((h) => !known64.has(h));
      expect({ name, unknown64 }).toEqual({ name, unknown64: [] });
      const unknown40 = [...new Set([...text.matchAll(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g)].map((m) => m[0].toLowerCase()))].filter((h) => !known40.has(h));
      expect({ name, unknown40 }).toEqual({ name, unknown40: [] });
    });
  }

  it("the companion's 64-hex values are the record's own where the record names them", () => {
    const recHex = new Set([...rec.matchAll(/0x[0-9a-f]{64}/g)].map((m) => m[0]));
    const paymentTx = new Set(trace.payments.filter((p) => p.rail === "metal").map((p) => p.rail_id));
    // 86 Metal payments, each its own transaction; those the record also names are equal by construction of the set.
    expect(paymentTx.size).toBe(86);
    expect([...recHex].filter((h) => paymentTx.has(h)).length).toBeGreaterThan(30);
  });
});

describe("/trace: the page and its links", () => {
  it("is a page with no script, under a style-only policy, served by the Worker at /trace", () => {
    expect(scriptBlocks(html)).toEqual([]);
    expect(TRACE_CSP).toMatch(/^default-src 'none'; style-src 'sha256-[^']+'; font-src 'self'/);
    expect(TRACE_CSP).not.toMatch(/script-src|unsafe-inline/);
    const pages = buildPages();
    expect(pages.trace).toBe(tracePage());
    const res = pageResponse(new Request("https://kit11.example/trace"), pages)!;
    expect([res.status, res.headers.get("content-security-policy")]).toEqual([200, TRACE_CSP]);
  });

  it("has one picker link and one section per payment; the SWIFT transfer's chain shows when none is picked", () => {
    for (const x of all) {
      expect({ id: x.payment.id, links: html.split(`href="#${x.payment.id}"`).length - 1, sections: html.split(`id="${x.payment.id}"`).length - 1 }).toEqual({ id: x.payment.id, links: 1, sections: 1 });
    }
    expect(html).toMatch(/<section class="card pay first" id="transfer-03360bfa"/);
    expect(html.split(" pay first").length - 1).toBe(1);
  });

  it("is linked as \"Trace any payment\" from the CFO view and from /proof, and the URL is /trace", () => {
    expect([TRACE_LINK, TRACE_URL]).toEqual(["Trace any payment", "trace"]);
    expect(decode(proofPage())).toContain(`href="trace">`);
    expect(decode(proofPage()).split(TRACE_LINK).length - 1).toBe(1);
    // On the CFO view (the dashboard page at /?autonomy): under its line, shown on that view only.
    expect(PAGE).toContain(`<p class="cfolinks" id="cfo-links" hidden><a href="trace">${TRACE_LINK}</a></p>`);
    const js = scriptBlocks(PAGE).find((b) => b.startsWith("<script>"))!;
    const autonomy = js.indexOf("} else if (wantAutonomy && AUTONOMY) {"), next = js.indexOf("} else if (wantRecorded && RECORDED) {");
    expect(js.slice(autonomy, next)).toContain('document.getElementById("cfo-links").hidden = false;');
    expect(js.slice(next)).not.toContain('"cfo-links"');
    expect(CFO_VIEW_URL).toBe("./?autonomy");
  });
});

describe("the count, said the same way wherever it appears", () => {
  it("claims.md and the release notes give 88 with its breakdown, as computed", () => {
    const c = countOf(trace);
    for (const file of ["docs/claims.md", "docs/submission/release-notes.md"]) {
      const text = readFileSync(file, "utf8").replace(/\s+/g, " ");
      expect({ file, line: text.includes(c.line) }).toEqual({ file, line: true });
      // Wherever the 88 payments are named, the breakdown follows.
      for (const m of text.matchAll(/\b88 payments\b/g)) expect({ file, at: m.index, next: text.slice(m.index!, m.index! + 120).includes(`(${c.line}`) }).toEqual({ file, at: m.index, next: true });
    }
    const row = readFileSync("docs/claims.md", "utf8").split("\n").find((l) => l.startsWith("| `/trace`"))!;
    expect(row).toContain(c.line);
    expect(row).toContain(`(the ${c.metal}: ${c.metalParts})`);
    expect(row).toContain(trace.label);
  });
});
