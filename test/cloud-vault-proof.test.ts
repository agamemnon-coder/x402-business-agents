// "Verify this proof" in the console's folder view (master list 476), as the very text the page runs, over a vault
// filed from the test world: an untouched file verifies, one changed byte fails; a receipt's Face ID hash is checked
// against the signed approval and the ledger entries that name one; a correction is shown beside the file it corrects,
// which is kept. No network.
import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VAULT_VIEW_JS } from "../cloud/src/vaultView.js";
import { syncVault, type YearIndex } from "../src/vault/build.js";
import { yearIndexPath } from "../src/vault/layout.js";
import { LocalSink } from "../src/vault/sink.js";
import { receiptData } from "../src/vault/data.js";
import { ledgerRows } from "../src/ledger/core.js";
import { vaultWorld, type VaultWorld } from "./fakes/vaultWorld.js";

interface Check { what: string; state: "ok" | "failed" | "not_checked" }
interface Proof { ok: boolean; failed: number; checks: Check[] }
const V = new Function(`${VAULT_VIEW_JS}\nreturn { proofSha256, verifyProof, correctionsOf };`)() as {
  proofSha256(b: Uint8Array): Promise<string>;
  verifyProof(p: unknown): Proof;
  correctionsOf(f: unknown[]): { path: string; corrects: string; number: number; original_kept: boolean }[];
};
const C = "Test Company BV";
let w: VaultWorld;
let index: YearIndex;
let root: string;

beforeAll(async () => {
  w = await vaultWorld({ close: true });
  root = join(w.dir, "vault");
  await syncVault(w.db, new LocalSink(root), { company: C, now: w.now, today: w.now.toISOString().slice(0, 10) });
  index = JSON.parse(readFileSync(join(root, yearIndexPath(C, Number(w.month.slice(0, 4)))), "utf8")) as YearIndex;
}, 60_000);
afterAll(() => rmSync(w.dir, { recursive: true, force: true }));

const bytesOf = (path: string) => new Uint8Array(readFileSync(join(root, path)));
const states = (p: Proof) => Object.fromEntries(p.checks.map((c) => [c.what, c.state]));

describe("Verify this proof", () => {
  it("hashes the bytes in the browser's own way, as Node does", async () => {
    const f = index.files[0]!;
    expect(await V.proofSha256(bytesOf(f.path))).toBe(createHash("sha256").update(bytesOf(f.path)).digest("hex"));
  });

  it("verifies an untouched invoice against the vault's hash and the invoice's document hash, and fails on one changed byte", async () => {
    const f = index.files.find((x) => x.kind === "invoice" && !x.path.includes("_Geblokkeerd"))!;
    const doc = w.db.prepare("SELECT doc_sha256 FROM ap_invoices WHERE id = ?").get(w.paidId) as { doc_sha256: string };
    const bytes = bytesOf(f.path);
    const good = V.verifyProof({ file: f, bytes_sha256: await V.proofSha256(bytes), document: doc, entries: ledgerRows(w.db) });
    expect(good.ok).toBe(true);
    expect(states(good)).toMatchObject({ file: "ok", document: "ok" });
    const bad = bytes.slice();
    const at = Math.floor(bad.length / 2);
    bad[at] = bad[at]! ^ 0x01;
    const changed = V.verifyProof({ file: f, bytes_sha256: await V.proofSha256(bad), document: doc, entries: ledgerRows(w.db) });
    expect(changed.ok).toBe(false);
    expect(states(changed)).toMatchObject({ file: "failed", document: "failed" });
  });

  it("checks a receipt's Face ID hash against the signed approval and any ledger entry that names one", async () => {
    const f = index.files.find((x) => x.kind === "receipt")!;
    const r = receiptData(w.db, w.paidId)!;
    const signed = { terms_sha256: r.terms_sha256, approved_sha256: r.approval!.signed_sha256, decision: "APPROVED", method: r.approval!.method };
    const sha = await V.proofSha256(bytesOf(f.path));
    const ok = V.verifyProof({ file: f, bytes_sha256: sha, signed, entries: ledgerRows(w.db) });
    expect(states(ok)).toMatchObject({ file: "ok", face_id: "ok", ledger_approval: "not_checked" });
    expect(ok.ok).toBe(true);
    // A ledger entry naming another approval hash fails the proof; one naming this hash passes.
    const named = (h: string) => [{ entry_id: 99, approval_sha256: h }];
    expect(states(V.verifyProof({ file: f, bytes_sha256: sha, signed, entries: named(r.terms_sha256) }))).toMatchObject({ ledger_approval: "ok" });
    const other = V.verifyProof({ file: f, bytes_sha256: sha, signed, entries: named("ef".repeat(32)) });
    expect(other.ok).toBe(false);
    // The signed hash must be the terms hash, and the approval an approval.
    expect(V.verifyProof({ file: f, bytes_sha256: sha, signed: { ...signed, approved_sha256: "ab".repeat(32) }, entries: [] }).ok).toBe(false);
    expect(V.verifyProof({ file: f, bytes_sha256: sha, signed: { ...signed, decision: "REJECTED" }, entries: [] }).ok).toBe(false);
    // Nothing to compare with is "not checked", never passed.
    expect(states(V.verifyProof({ file: f, bytes_sha256: sha, entries: [] }))).toMatchObject({ face_id: "not_checked" });
  });

  it("never passes a file without a proper hash on record", async () => {
    expect(V.verifyProof({ file: { kind: "month", sha256: "x" }, bytes_sha256: "x", entries: [] }).ok).toBe(false);
  });
});

describe("corrections", () => {
  it("pairs each correction with the file it corrects, which is kept", () => {
    const files = [
      { path: "C/2026/2026-Q4/Rapporten/2026-11 Maandrapport.pdf", sha256: "a".repeat(64) },
      { path: "C/2026/2026-Q4/Rapporten/2026-11 Maandrapport (correctie).pdf", sha256: "b".repeat(64) },
      { path: "C/2026/2026-Q4/Rapporten/2026-11 Maandrapport (correctie 2).pdf", sha256: "c".repeat(64) },
      { path: "C/2026/Leveranciers 2026-11-12 (correctie).pdf", sha256: "d".repeat(64) },
    ];
    expect(V.correctionsOf(files).map((c) => [c.path.split("/").at(-1), c.corrects.split("/").at(-1), c.number, c.original_kept])).toEqual([
      ["2026-11 Maandrapport (correctie).pdf", "2026-11 Maandrapport.pdf", 1, true],
      ["2026-11 Maandrapport (correctie 2).pdf", "2026-11 Maandrapport.pdf", 2, true],
      ["Leveranciers 2026-11-12 (correctie).pdf", "Leveranciers 2026-11-12.pdf", 1, false],
    ]);
    expect(V.correctionsOf(index.files)).toEqual([]);
  });
});
