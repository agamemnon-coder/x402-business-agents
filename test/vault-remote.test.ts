// The vault in Google Drive and OneDrive, against fakes shaped like their documentation: the same tree, the original
// invoices byte for byte, nothing uploaded twice, nothing overwritten, and a verify that reads the files back.
import { readFileSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncVault, verifyVault } from "../src/vault/build.js";
import { driveQuoted, GoogleDriveSink } from "../src/vault/gdrive.js";
import { OneDriveSink } from "../src/vault/onedrive.js";
import { FakeDrive, FakeGraph } from "./fakes/drives.js";
import { vaultWorld, type VaultWorld } from "./fakes/vaultWorld.js";

const C = "Northwind Outdoor";
let w: VaultWorld;
beforeEach(async () => { w = await vaultWorld({ close: true }); });
afterEach(() => rmSync(w.dir, { recursive: true, force: true }));
const opts = () => ({ company: C, now: w.now, today: w.now.toISOString().slice(0, 10) });
const original = () => readFileSync((w.db.prepare("SELECT d.path FROM ap_documents d JOIN ap_invoices i ON i.doc_sha256 = d.sha256 WHERE i.id = ?").get(w.paidId) as { path: string }).path);
const INVOICE = `${C}/2026/2026-Q4/Inkoopfacturen/Bergtex Textil GmbH/2026-11-02 BTX-2026-21 EUR 1850.00.pdf`;

describe("Google Drive", () => {
  it("escapes names in a search the way the search guide says", () => {
    expect(driveQuoted("quinn's paper\\essay")).toBe("'quinn\\'s paper\\\\essay'");
  });

  it("files the same tree under the shared folder, once, and verifies it", async () => {
    const drive = new FakeDrive();
    const sink = new GoogleDriveSink({ token: "test-token", rootFolderId: drive.root, fetch: drive.fetch });
    const first = await syncVault(w.db, sink, opts());
    expect(first.added.length).toBe(8);
    const filed = drive.byPath(INVOICE)!;
    expect(Buffer.compare(filed.content, original())).toBe(0);
    expect(filed.appProperties).toMatchObject({ sha256: first.added.find((a) => a.path === INVOICE)!.sha256 });
    const uploads = drive.calls.filter((c) => c.startsWith("POST /upload")).length;
    const again = await syncVault(w.db, new GoogleDriveSink({ token: "test-token", rootFolderId: drive.root, fetch: drive.fetch }), opts());
    expect(again.added).toEqual([]);
    expect(drive.calls.filter((c) => c.startsWith("POST /upload")).length).toBe(uploads);
    expect((await verifyVault(sink, C, [2026])).bad).toEqual([]);
    await expect(sink.create(INVOICE, Buffer.from("x"), "x")).rejects.toThrow(/nothing is overwritten/);
  });

  it("updates only index.json in place, with a media upload", async () => {
    const drive = new FakeDrive();
    const sink = new GoogleDriveSink({ token: "test-token", rootFolderId: drive.root, fetch: drive.fetch });
    await syncVault(w.db, sink, opts());
    w.db.prepare("UPDATE transfers SET fee_actual = 'EUR 14.00' WHERE status = 'PAID'").run();
    await syncVault(w.db, sink, opts());
    expect(drive.calls.filter((c) => c.startsWith("PATCH")).every((c) => c.endsWith("?uploadType=media"))).toBe(true);
    expect(drive.calls.some((c) => c.startsWith("PATCH"))).toBe(true);
    const index = JSON.parse(drive.byPath(`${C}/2026/index.json`)!.content.toString()) as { files: { path: string }[] };
    expect(index.files.some((f) => f.path.endsWith("(correctie).pdf"))).toBe(true);
  });

  it("needs a token and a folder from the environment", () => {
    expect(() => new GoogleDriveSink({ token: "", rootFolderId: "x" })).toThrow(/KIT11_GDRIVE_TOKEN/);
  });
});

describe("OneDrive / SharePoint", () => {
  it("files the same tree in the drive, once, and verifies it", async () => {
    const graph = new FakeGraph();
    const sink = new OneDriveSink({ token: "test-token", driveId: graph.driveId, fetch: graph.fetch });
    const first = await syncVault(w.db, sink, opts());
    expect(first.added.length).toBe(8);
    const st = await sink.stat(INVOICE);
    expect(st?.sha256).toBe(first.added.find((a) => a.path === INVOICE)!.sha256);
    expect(Buffer.compare((await sink.read(INVOICE))!, original())).toBe(0);
    const puts = graph.calls.filter((c) => c.startsWith("PUT")).length;
    expect((await syncVault(w.db, new OneDriveSink({ token: "test-token", driveId: graph.driveId, fetch: graph.fetch }), opts())).added).toEqual([]);
    expect(graph.calls.filter((c) => c.startsWith("PUT")).length).toBe(puts);
    expect((await verifyVault(sink, C, [2026])).bad).toEqual([]);
    await expect(sink.create(INVOICE, Buffer.from("x"), "x")).rejects.toThrow(/nothing is overwritten/);
  });

  it("needs a token and a drive from the environment", () => {
    expect(() => new OneDriveSink({ token: "t", driveId: "" })).toThrow(/KIT11_GRAPH_DRIVE_ID/);
  });
});
