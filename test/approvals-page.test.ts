import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { TERMS_SCHEMA, termsHash, type Terms } from "../src/lib/terms.js";
import { createProposal } from "../src/policy/approvals.js";
import { approvalsApp } from "../src/servers/approvals.js";

const TX = "0x" + "ab".repeat(32);
const farFuture = "2099-01-01T00:00:00Z";

function mkTerms(over: Record<string, unknown> = {}): Terms {
  return { schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: "P-0001", expires_at: farFuture, total: "0.60", ...over } as Terms;
}

const servers: { close: () => void }[] = [];
afterEach(() => { while (servers.length) servers.pop()!.close(); });

async function setup(terms: Terms = mkTerms(), explanation?: string, execute: (db: DB, id: string) => Promise<void> = async () => {}) {
  const db = openDb(":memory:");
  createProposal(db, { terms, createdBy: "support", explanation });
  const exec = vi.fn(execute);
  const server = approvalsApp(db, { approver: "max", execute: exec }).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (id: string, form: Record<string, string>) =>
    fetch(`${base}/proposals/${id}/decision`, {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form),
    });
  const status = () => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(terms.proposal_id) as { status: string }).status;
  return { db, exec, base, post, status, hash: termsHash(terms) };
}

describe("approvals page", () => {
  it("shows the full hash, every term, nested values, the advisory label and tx links", async () => {
    const terms = mkTerms({ payee: { name: "Acme", refs: ["r1", TX] }, items: [{ sku: "a", amount: "0.30" }] });
    const { base, hash } = await setup(terms, "Looks routine.");
    const html = await (await fetch(base + "/")).text();
    expect(html).toContain(hash.slice(0, 8));
    expect(html).toContain(hash.slice(8));
    for (const s of ["refund_batch", "0.60", "Acme", "r1", "sku", "0.30", "PENDING_APPROVAL"]) expect(html).toContain(s);
    expect(html).toContain("Advisory review by Claude (not used for any amount)");
    expect(html).toContain("Looks routine.");
    expect(html).toContain(`href="https://testnet.metalntwx.com/tx/${TX}"`);
    expect(html).not.toContain("Terms changed");
  });

  it("warns when the stored terms no longer match the recorded hash", async () => {
    const { db, base } = await setup();
    db.prepare("UPDATE proposals SET terms_json = ?").run(JSON.stringify(mkTerms({ total: "6.00" })));
    expect(await (await fetch(base + "/")).text()).toContain("Terms changed");
  });

  it("refuses a wrong prefix and leaves the proposal pending", async () => {
    const { base, post, status, exec } = await setup();
    const res = await post("P-0001", { prefix: "00000000", decision: "approve" });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("typed prefix does not match");
    expect(status()).toBe("PENDING_APPROVAL");
    expect(exec).not.toHaveBeenCalled();
    expect(await (await fetch(base + "/")).text()).toContain('name="prefix"');
  });

  it("approves on the right prefix and runs the executor once", async () => {
    const { db, post, status, exec, hash } = await setup();
    const res = await post("P-0001", { prefix: hash.slice(0, 8).toUpperCase(), note: "ok", decision: "approve" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(/^\/\?msg=/);
    expect(status()).toBe("APPROVED");
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith(db, "P-0001");
    const a = db.prepare("SELECT decision, approver, method, note FROM approvals").get();
    expect(a).toEqual({ decision: "APPROVED", approver: "max", method: "web", note: "ok" });
    // A second decision on the same proposal is refused and runs nothing.
    expect((await post("P-0001", { prefix: hash.slice(0, 8), decision: "approve" })).status).toBe(409);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("records a rejection without running the executor", async () => {
    const { post, status, exec, hash } = await setup();
    expect((await post("P-0001", { prefix: hash.slice(0, 8), decision: "reject" })).status).toBe(303);
    expect(status()).toBe("REJECTED");
    expect(exec).not.toHaveBeenCalled();
  });

  it("answers 409 for an expired proposal and 404 for an unknown one", async () => {
    const { post, status, exec, hash } = await setup(mkTerms({ expires_at: "2020-01-01T00:00:00Z" }));
    expect((await post("P-0001", { prefix: hash.slice(0, 8), decision: "approve" })).status).toBe(409);
    expect(status()).toBe("EXPIRED");
    expect((await post("P-9999", { prefix: hash.slice(0, 8), decision: "approve" })).status).toBe(404);
    expect(exec).not.toHaveBeenCalled();
  });

  it("answers 500 with the escaped message when the executor fails", async () => {
    const { post, hash } = await setup(mkTerms(), undefined, async () => { throw new Error("rail <down>"); });
    const res = await post("P-0001", { prefix: hash.slice(0, 8), decision: "approve" });
    expect(res.status).toBe(500);
    const html = await res.text();
    expect(html).toContain("rail &lt;down&gt;");
    expect(html).not.toContain("rail <down>");
  });

  it("rejects a bad decision value", async () => {
    const { post, status, hash } = await setup();
    expect((await post("P-0001", { prefix: hash.slice(0, 8), decision: "maybe" })).status).toBe(400);
    expect(status()).toBe("PENDING_APPROVAL");
  });

  it("escapes HTML in term values and keys", async () => {
    const evil = `<script>alert(1)</script>`;
    const { base } = await setup(mkTerms({ memo: evil, [`<b>k</b>`]: "v" }), `<img src=x onerror=alert(1)>`);
    const html = await (await fetch(base + "/")).text();
    expect(html).not.toContain(evil);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;b&gt;k&lt;/b&gt;");
    expect(html).not.toContain("<img src=x");
  });

  it("refuses a non-loopback Host header", async () => {
    const { base } = await setup();
    // fetch forbids overriding Host, so use the raw http client.
    const { request } = await import("node:http");
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(base + "/", { headers: { host: "evil.example" } }, (r) => { r.resume(); resolve(r.statusCode ?? 0); });
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  });
});
