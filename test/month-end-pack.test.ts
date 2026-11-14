// The month-end pack (Max's last round, 1.3): one zip for the main run, built from the record and its companion only,
// byte for byte the same on every build; its totals agree with the record's books and with reconcile; labelled ("From
// the main run of 3 November, test money.", the companion's label, T:0 as the record words it); nothing private in it;
// a button on the CFO's view and on /proof.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { booksCsv, doubleEntry } from "../src/accounting/books.js";
import { journalCsv } from "../src/accounting/gl.js";
import { monthEndPack, PACK_LINE, PACK_LINK, PACK_NAME, t0Line } from "../src/accounting/monthPack.js";
import { RECORD_UNCHANGED } from "../src/demo/runTrace.js";
import { dosTime, unzipStore, zipStore } from "../src/lib/zip.js";
import { proofPage } from "../src/redesign/proof.js";
import { loadRecord } from "../src/redesign/run.js";
import { countOf, loadTrace } from "../src/redesign/trace.js";
import { buildPages } from "../src/relay/assets.js";
import { DOWNLOADS, PAGE } from "../src/servers/dashboard.js";
import { T0_STATUS } from "../src/submission/deck.js";
import { pageResponse } from "../worker/src/core.js";
import { knownHex, privateFindings } from "./support/privacyScan.js";
import { scriptBlocks } from "./support/scriptBlocks.js";

const { record } = loadRecord();
const trace = loadTrace();
const pack = monthEndPack(record, trace);
const files = Object.fromEntries(unzipStore(pack.zip).map((f) => [f.path.replace(/^[^/]+\//, ""), f.content.toString("utf8")]));
const snap = record.snapshot as unknown as {
  reconciliation: { checked: number; differences: number };
  books: { total_postings: number; cash: { account: string; currency: string; in: string; out: string }[] };
  audit: { rows: number; head: string };
};
/** A CSV of the pack, its label line taken off, as rows of cells (no cell here holds a comma inside quotes but descriptions; split on the header only). */
const body = (name: string) => files[name]!.slice(files[name]!.indexOf("\n") + 1);
const rows = (name: string) => body(name).trimEnd().split(/\r?\n/);

describe("the month-end pack: one zip, the same bytes every time, from the record alone", () => {
  it("is a stored zip of eight files, each checksum right, under one folder", () => {
    expect(pack.name).toBe("purser-month-end-2026-11-03.zip");
    const entries = unzipStore(pack.zip);
    expect(entries.map((e) => e.path)).toEqual(["README.md", "journal.csv", "postings.csv", "payments.csv", "approvals.csv", "audit-chain.csv", "verify.txt", "summary.json"].map((f) => `purser-month-end-2026-11-03/${f}`));
    expect(entries.every((e) => e.crcOk)).toBe(true);
    // The end-of-central-directory record says eight entries, and the zip ends with it.
    expect([pack.zip.readUInt32LE(pack.zip.length - 22), pack.zip.readUInt16LE(pack.zip.length - 12)]).toEqual([0x06054b50, 8]);
  });

  it("is rebuilt byte for byte: twice in this process, and as the pages serve it", () => {
    const again = monthEndPack(loadRecord().record, loadTrace());
    expect(Buffer.compare(again.zip, pack.zip)).toBe(0);
    expect(Buffer.compare(DOWNLOADS[PACK_NAME]!.body, pack.zip)).toBe(0);
    const pages = buildPages();
    expect(pages.images[PACK_NAME]).toEqual({ type: "application/zip", data: pack.zip.toString("base64") });
    // One timestamp for every entry: the companion's generation date, not the clock.
    expect(pack.at).toBe(`${trace.generated}T00:00:00Z`);
    const { time, date } = dosTime(pack.at);
    for (let i = 0; i + 4 <= pack.zip.length && pack.zip.readUInt32LE(i) === 0x04034b50; i += 30 + pack.zip.readUInt16LE(i + 26) + pack.zip.readUInt32LE(i + 18)) expect([pack.zip.readUInt16LE(i + 10), pack.zip.readUInt16LE(i + 12)]).toEqual([time, date]);
    // And the writer itself is deterministic and refuses a repeated path.
    expect(zipStore([{ path: "a.txt", content: "x" }], pack.at).equals(zipStore([{ path: "a.txt", content: "x" }], pack.at))).toBe(true);
    expect(() => zipStore([{ path: "a.txt", content: "x" }, { path: "a.txt", content: "y" }], pack.at)).toThrow(/repeated/);
  });

  it("is served by the Worker at /assets/<name> as a zip", async () => {
    const res = pageResponse(new Request(`https://kit11.example/assets/${PACK_NAME}`), buildPages())!;
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(createHash("sha256").update(Buffer.from(await res.arrayBuffer())).digest("hex")).toBe(createHash("sha256").update(pack.zip).digest("hex"));
  });

  it("is built from the record and its companion: no server call, no key", () => {
    const src = readFileSync("src/accounting/monthPack.ts", "utf8");
    expect(src).not.toMatch(/fetch\(|process\.env|openDb|from "node:(http|https|net)"/);
  });
});

describe("the month-end pack: its contents", () => {
  it("the bookings are the GL export, each line with its rail id and the approval hash behind it", () => {
    const lines = trace.journal.filter((l) => l.source !== "opening");
    const ev = record.ledger!.events;
    const hashOf = (p: string) => ev.find((e) => e.event === "proposal.created" && e.subject === p)!.payload.terms_sha256 as string;
    expect(body("journal.csv")).toBe(journalCsv(lines, [{ name: "approval_sha256", value: (l) => (l.approval ? hashOf(l.approval) : "") }]));
    expect(rows("journal.csv")[0]).toBe("date,source,ref,description,counterparty,agent,cost_centre,gl_account,gl_name,bank_account,amount,currency,proof,approval,rule,approval_sha256");
    // Every line names its rail id; the lines behind a proposal (the SWIFT transfer, its fee, the FX) carry its hash.
    expect(lines.every((l) => l.proof !== "")).toBe(true);
    const approved = lines.filter((l) => l.approval);
    expect(approved.map((l) => l.source).sort()).toEqual(["fx", "fx", "transfer", "transfer"]);
    for (const l of approved) expect(hashOf(l.approval)).toBe(trace.payments.find((p) => p.kind === "transfer")!.approval_sha256);
    expect(body("postings.csv")).toBe(booksCsv(doubleEntry(trace.journal)));
    expect(rows("postings.csv").length - 1).toBe(snap.books.total_postings);
  });

  it("lists the 88 payments, the approvals, and the audit chain with its check", () => {
    const c = countOf(trace);
    expect(rows("payments.csv").length - 1).toBe(c.n);
    expect(rows("approvals.csv").slice(1).map((r) => r.split(",").slice(0, 3).join(","))).toEqual(record.ledger!.proposals.map((p) => `${p.proposal_id},${p.kind},${p.status}`));
    expect(rows("audit-chain.csv")[0]).toBe("seq,prev_hash,row_hash");
    expect(rows("audit-chain.csv").length - 1).toBe(snap.audit.rows);
    expect(rows("audit-chain.csv").at(-1)!.split(",")[2]).toBe(snap.audit.head);
    expect(pack.summary.audit.links).toEqual({ ok: true, rows: snap.audit.rows, head: snap.audit.head });
    expect(files["verify.txt"]).toContain(`412 links, from the genesis to head ${snap.audit.head}, unbroken; the same head and length as recorded.`);
    expect(files["verify.txt"]).toContain("each row's content is not");
  });

  it("its totals agree with reconcile and with the record's books: counts, and money in and out per rail and currency", () => {
    const s = pack.summary, c = countOf(trace);
    expect([s.payments.total, s.reconcile.checked, s.reconcile.differences, s.reconcile.agrees]).toEqual([c.n, snap.reconciliation.checked, 0, true]);
    const cash = (account: string) => snap.books.cash.find((x) => x.account === account)!;
    const m = (rail: string) => s.money.find((x) => x.rail === rail)!;
    expect([m("metal").in, m("metal").out]).toEqual([cash("1210").in, cash("1210").out]);
    const fee = String(record.ledger!.events.find((e) => e.event === "transfer.fee")!.payload.fee).replace(/^EUR /, "");
    expect((Number(m("airwallex_card").out) * 100 + Number(m("airwallex_swift").out) * 100 + Number(fee) * 100) / 100).toBe(Number(cash("1200").out));
    expect(s.books).toMatchObject({ postings: snap.books.total_postings, balanced: true });
    expect(s.books.trial.length).toBe((record.snapshot as unknown as { books: { trial: unknown[] } }).books.trial.length);
  });
});

describe("the month-end pack: its labels", () => {
  it("says, on the pack, where it is from: the main run of 3 November, test money; derived, sanitized, dated; the record unchanged", () => {
    expect(PACK_LINE).toBe("From the main run of 3 November, test money.");
    const readme = files["README.md"]!;
    expect(readme.split("\n").slice(0, 7)).toEqual(["# Purser month-end pack: the main run, 3 November 2026", "", PACK_LINE, "", `${trace.label} ${RECORD_UNCHANGED}`, "", t0Line()]);
    for (const f of ["journal.csv", "postings.csv", "payments.csv", "approvals.csv", "audit-chain.csv"]) expect({ f, first: files[f]!.split(/\r?\n/)[0] }).toEqual({ f, first: `# ${PACK_LINE} ${trace.label} ${RECORD_UNCHANGED}` });
    expect(files["verify.txt"]!.split("\n")[0]).toBe(`${PACK_LINE} ${trace.label} ${RECORD_UNCHANGED}`);
    expect(JSON.parse(files["summary.json"]!)).toMatchObject({ label: trace.label, line: PACK_LINE });
  });

  it("says T:0 as the record words it: 95 entries posted to the sandbox on 10 Nov, with the first id", () => {
    expect(t0Line()).toBe("Posted to T:0's shared sandbox on 10 Nov: 95 journal entries, debits equal credits (first je_prod_z7kTCuZ1iiwad01q).");
    expect(readFileSync("docs/t0.md", "utf8")).toContain(T0_STATUS);
    expect(() => t0Line("T:0 posted everything.")).toThrow();
  });

  it("gives the count with its breakdown: 88 = 86 on Alta + 1 card charge + 1 SWIFT transfer", () => {
    const c = countOf(trace);
    expect(files["README.md"]).toContain(`- Payments: ${c.line}. On Alta: ${c.metalParts}.`);
    expect(c.line).toBe("88 = 86 on Alta + 1 card charge + 1 SWIFT transfer");
  });
});

describe("the month-end pack: nothing private in it", () => {
  const known = knownHex();
  for (const [name, text] of Object.entries(files)) {
    it(`${name}: no IBAN, email, long base64 run, credential, token, key, foreign host or unknown hex`, () => {
      expect({ name, found: privateFindings(text, { ...known, record: true }) }).toEqual({ name, found: [] });
    });
  }
});

describe("the month-end pack: the button", () => {
  it("is on the CFO's view (that view only) and on /proof, a download of the served file", () => {
    expect(PACK_LINK).toBe("Download the month-end pack");
    const a = `<a href="assets/${PACK_NAME}" download>`;
    expect(PAGE).toContain(`${a}${PACK_LINK}</a></p>`);
    expect(PAGE.indexOf(a)).toBeGreaterThan(PAGE.indexOf('id="cfo-links" hidden'));
    const js = scriptBlocks(PAGE).find((b) => b.startsWith("<script>"))!;
    expect(js.slice(js.indexOf("} else if (wantAutonomy && AUTONOMY) {"), js.indexOf("} else if (wantRecorded && RECORDED) {"))).toContain('document.getElementById("cfo-links").hidden = false;');
    const proof = proofPage();
    expect(proof).toContain(`href="assets/${PACK_NAME}" download>`);
    expect(proof.split(PACK_LINK).length - 1).toBe(1);
  });
});
