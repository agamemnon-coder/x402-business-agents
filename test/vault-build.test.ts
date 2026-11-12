// Filing into the vault: the fixed tree, the originals byte for byte, an index with every hash, nothing written twice,
// nothing overwritten (a changed document is a correction beside the original), and a verify that finds tampering.
import { createHash } from "node:crypto";
import { chmodSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncVault, verifyVault } from "../src/vault/build.js";
import { quarterOf } from "../src/vault/layout.js";
import { LocalSink } from "../src/vault/sink.js";
import { vaultWorld, type VaultWorld } from "./fakes/vaultWorld.js";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const C = "Northwind Outdoor";

let w: VaultWorld;
let root: string;
let sink: LocalSink;
beforeEach(async () => {
  w = await vaultWorld({ close: true });
  root = join(w.dir, "vault");
  sink = new LocalSink(root);
});
afterEach(() => rmSync(w.dir, { recursive: true, force: true }));

const opts = () => ({ company: C, now: w.now, today: w.now.toISOString().slice(0, 10) });

describe("filing into the vault", () => {
  it("writes the fixed tree: originals byte for byte, the receipt, the month report and pack, the export, the suppliers list and the index", async () => {
    const out = await syncVault(w.db, sink, opts());
    const year = w.month.slice(0, 4);
    const q = quarterOf(`${w.month}-01`);
    const paidOn = (w.db.prepare("SELECT paid_at FROM ap_invoices WHERE id = ?").get(w.paidId) as { paid_at: string }).paid_at.slice(0, 10);
    const expected = [
      `${C}/2026/2026-Q4/Inkoopfacturen/Bergtex Textil GmbH/2026-11-02 BTX-2026-21 EUR 1850.00.pdf`,
      `${C}/2026/2026-Q4/Inkoopfacturen/_Geblokkeerd/Bergtex Textil GmbH/2026-11-02 BTX-2026-22 EUR 1850.00.pdf`,
      `${C}/${paidOn.slice(0, 4)}/${quarterOf(paidOn)}/Betalingen/${paidOn} Bergtex Textil GmbH BTX-2026-21.pdf`,
      `${C}/${year}/${q}/Rapporten/${w.month} Maandrapport.pdf`,
      // Closing the month also files its month pack and the accountant's export of its journal (src/ledger/pack.ts,
      // src/ledger/accountantExport.ts).
      `${C}/${year}/${q}/Rapporten/${w.month} Maandpakket.pdf`,
      `${C}/${year}/${q}/Rapporten/${w.month} Journaal voor de accountant.csv`,
      `${C}/${year}/${q}/Rapporten/${w.month} Journaal voor de accountant.json`,
      `${C}/${year}/Leveranciers ${opts().today}.pdf`,
    ];
    for (const p of expected) expect(existsSync(join(root, p)), p).toBe(true);
    expect(out.added.map((a) => a.path).sort()).toEqual([...expected].sort());

    // The original invoice, byte for byte, read-only.
    const doc = w.db.prepare("SELECT d.path, d.sha256 FROM ap_documents d JOIN ap_invoices i ON i.doc_sha256 = d.sha256 WHERE i.id = ?").get(w.paidId) as { path: string; sha256: string };
    const filed = readFileSync(join(root, expected[0]!));
    expect(Buffer.compare(filed, readFileSync(doc.path))).toBe(0);
    expect(sha(filed)).toBe(doc.sha256);
    expect(statSync(join(root, expected[0]!)).mode & 0o222).toBe(0);

    // The index lists every file with its hash.
    const index = JSON.parse(readFileSync(join(root, `${C}/2026/index.json`), "utf8")) as { files: { path: string; sha256: string; key: string }[] };
    const e = index.files.find((f) => f.path === expected[0]);
    expect(e).toMatchObject({ sha256: doc.sha256, key: `invoice:${w.paidId}` });
  });

  it("does nothing the second time, and a dry run writes nothing", async () => {
    const dry = await syncVault(w.db, sink, { ...opts(), dryRun: true });
    expect(dry.added.length).toBeGreaterThan(0);
    expect(existsSync(root)).toBe(false);
    await syncVault(w.db, sink, opts());
    const again = await syncVault(w.db, sink, opts());
    expect(again.added).toEqual([]);
  });

  it("never overwrites: changed data becomes a correction beside the original", async () => {
    const first = await syncVault(w.db, sink, opts());
    const receipt = first.added.find((a) => a.key === `receipt:${w.paidId}`)!;
    const before = readFileSync(join(root, receipt.path));
    // A late correction in the payment ledger: the fee Airwallex reported changes.
    w.db.prepare("UPDATE transfers SET fee_actual = 'EUR 14.00' WHERE status = 'PAID'").run();
    const second = await syncVault(w.db, sink, opts());
    const month = first.added.find((a) => a.kind === "month")!;
    // The receipt and the month report (its fees) both changed; each gets a correction, the originals stay.
    expect(second.added.map((a) => a.path).sort()).toEqual([receipt.path, month.path].map((p) => p.replace(/\.pdf$/, " (correctie).pdf")).sort());
    expect(second.added.every((a) => a.correction)).toBe(true);
    expect(Buffer.compare(readFileSync(join(root, receipt.path)), before)).toBe(0);
  });

  it("refuses to file an original whose bytes no longer match the hash on record", async () => {
    const doc = w.db.prepare("SELECT d.path FROM ap_documents d JOIN ap_invoices i ON i.doc_sha256 = d.sha256 WHERE i.id = ?").get(w.paidId) as { path: string };
    chmodSync(doc.path, 0o644);
    writeFileSync(doc.path, "tampered");
    await expect(syncVault(w.db, sink, opts())).rejects.toThrow(/does not match/);
  });

  it("verify re-hashes every file against the index and names the one that changed", async () => {
    const out = await syncVault(w.db, sink, opts());
    expect((await verifyVault(sink, C, [2026])).bad).toEqual([]);
    const victim = out.added[0]!.path;
    chmodSync(join(root, victim), 0o644);
    writeFileSync(join(root, victim), "changed");
    const v = await verifyVault(sink, C, [2026]);
    expect(v.bad).toEqual([{ path: victim, problem: "hash differs" }]);
  });

  it("keeps every path inside the vault folder", async () => {
    await expect(sink.create("../outside.pdf", Buffer.from("x"), sha(Buffer.from("x")))).rejects.toThrow(/outside the vault/);
  });
});
