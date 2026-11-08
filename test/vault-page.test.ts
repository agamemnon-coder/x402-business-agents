// The vault's local page: browse the folders and open the PDFs, read-only, on the loopback host only, no scripts, no
// way out of the vault folder, and a rate limit.
import { readFileSync, rmSync } from "node:fs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncVault } from "../src/vault/build.js";
import { vaultApp } from "../src/vault/page.js";
import { LocalSink } from "../src/vault/sink.js";
import { vaultWorld, type VaultWorld } from "./fakes/vaultWorld.js";

let w: VaultWorld;
let root: string;
let base: string;
let close: () => void;
async function start(rateLimit?: { windowMs: number; limit: number }) {
  const server = vaultApp(root, rateLimit ? { rateLimit } : {}).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  close = () => server.close();
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
beforeEach(async () => {
  w = await vaultWorld({ close: true });
  root = join(w.dir, "vault");
  await syncVault(w.db, new LocalSink(root), { company: "Northwind Outdoor", now: w.now, today: w.now.toISOString().slice(0, 10) });
});
afterEach(() => { close?.(); rmSync(w.dir, { recursive: true, force: true }); });

const INVOICE = "Northwind Outdoor/2026/2026-Q4/Inkoopfacturen/Bergtex Textil GmbH/2026-11-02 BTX-2026-21 EUR 1850.00.pdf";
const url = (p: string) => p.split("/").map(encodeURIComponent).join("/");

describe("the vault page", () => {
  it("lists the folders and opens a PDF, byte for byte, with no scripts allowed", async () => {
    await start();
    const home = await fetch(base + "/");
    expect(home.headers.get("content-security-policy")).toMatch(/default-src 'none'/);
    expect(home.headers.get("content-security-policy")).not.toMatch(/script-src/);
    expect(await home.text()).toContain("Northwind Outdoor");
    const folder = await (await fetch(`${base}/browse/${url("Northwind Outdoor/2026/2026-Q4/Inkoopfacturen/Bergtex Textil GmbH")}`)).text();
    expect(folder).toContain("2026-11-02 BTX-2026-21 EUR 1850.00.pdf");
    expect(folder).not.toMatch(/<script/i);
    const pdf = await fetch(`${base}/file/${url(INVOICE)}`);
    expect(pdf.headers.get("content-type")).toMatch(/application\/pdf/);
    expect(Buffer.compare(Buffer.from(await pdf.arrayBuffer()), readFileSync(join(root, INVOICE)))).toBe(0);
  });

  it("never leaves the vault folder", async () => {
    await start();
    for (const p of ["/file/..%2F..%2Fetc%2Fpasswd", "/file/%2E%2E/%2E%2E/package.json", "/browse/..%2F..", "/file/Northwind%20Outdoor%2F..%2F..%2Fx"]) {
      const res = await fetch(base + p);
      expect([400, 404], p).toContain(res.status);
    }
  });

  it("answers only on the loopback host, and limits how often it can be asked", async () => {
    await start({ windowMs: 60_000, limit: 2 });
    // fetch cannot set Host, so this one goes through node:http (a DNS-rebinding page would send its own host name).
    const evil = await new Promise<number>((r, j) => { const q = request(base + "/", { headers: { Host: "evil.example" } }, (res) => { res.resume(); r(res.statusCode ?? 0); }); q.on("error", j); q.end(); });
    expect(evil).toBe(403);
    // A refused host is turned away before the limiter; two requests pass, the third is over the limit.
    expect((await fetch(base + "/")).status).toBe(200);
    expect((await fetch(base + "/")).status).toBe(200);
    expect((await fetch(base + "/")).status).toBe(429);
  });
});
