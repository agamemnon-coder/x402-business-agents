// The local approvals page (src/servers/approvals.ts) on terms and forms it rarely meets: empty values are named, not
// left blank; a list of records with different keys is a nested table; terms that cannot be read are shown raw with
// the reason and never as unchanged; a repeated form field, a wrong hash prefix and an expired proposal each decide
// nothing and say why.
import type { AddressInfo } from "node:net";
import { request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { TERMS_SCHEMA, type Terms } from "../src/lib/terms.js";
import { createProposal } from "../src/policy/approvals.js";
import { approvalsApp } from "../src/servers/approvals.js";

const servers: { close: () => void }[] = [];
afterEach(() => { while (servers.length) servers.pop()!.close(); });

async function page(terms: Record<string, unknown>, o: { now?: Date } = {}) {
  const db = openDb(":memory:");
  createProposal(db, { terms: { schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: "P-0001", expires_at: "2099-01-01T00:00:00Z", total: "0.60", ...terms } as Terms, createdBy: "support" }, o.now);
  const server = approvalsApp(db, { approver: "max", execute: async () => {} }).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const html = async () => (await fetch(`${base}/`)).text();
  const post = async (body: string) => {
    const csrf = /<meta name="csrf" content="([^"]+)">/.exec(await html())![1]!;
    const full = `csrf=${csrf}&${body}`;
    return new Promise<{ status: number; text: string }>((resolve, reject) => {
      const req = request(`${base}/proposals/P-0001/decision`, { method: "POST", headers: { origin: base, "content-type": "application/x-www-form-urlencoded", "content-length": String(Buffer.byteLength(full)) } }, (r) => {
        let text = "";
        r.setEncoding("utf8").on("data", (c: string) => (text += c)).on("end", () => resolve({ status: r.statusCode ?? 0, text }));
      });
      req.on("error", reject);
      req.end(full);
    });
  };
  return { db, html, post };
}

describe("the approvals page's terms", () => {
  it("names empty values, and shows a list of records with different keys as nested tables", async () => {
    const { html } = await page({ note: null, tags: [], extra: {}, memo: "", steps: [{ a: "1" }, { b: "2" }], deep: [{ x: { y: "z" } }] });
    const h = await html();
    for (const s of ['<span class="muted">null</span>', "(empty list)", "(empty object)", "&quot;&quot; (empty text)"]) expect(h).toContain(s);
    expect(h).toContain('<th scope="row">[1]</th>');
    expect(h).not.toContain('<table class="terms grid"><thead><tr><th scope="col">a</th>');
  });

  it("terms that cannot be read are shown raw with the reason, and marked changed", async () => {
    const { db, html } = await page({});
    db.prepare("UPDATE proposals SET terms_json = '{\"broken\": ' WHERE proposal_id = 'P-0001'").run();
    const h = await html();
    expect(h).toContain("<pre>{&quot;broken&quot;: </pre>");
    expect(h).toContain("Terms changed");
  });
});

describe("the approvals page's form", () => {
  it("a field sent twice is a malformed form; a wrong prefix and an expired proposal decide nothing", async () => {
    const { post, db } = await page({});
    const twice = await post("prefix=a&prefix=b&decision=approve");
    expect(twice.status).toBe(400);
    expect(twice.text).toContain("malformed form: prefix and note must be single text fields");
    const wrong = await post("prefix=zzzzzzzz&decision=approve");
    expect(wrong.status).toBe(400);
    expect((db.prepare("SELECT status FROM proposals").get() as { status: string }).status).toBe("PENDING_APPROVAL");
  });

  it("an expired proposal is said to be expired, with nothing recorded", async () => {
    const { post, db } = await page({ expires_at: "2026-01-01T00:00:00Z" }, { now: new Date("2025-12-31T23:00:00Z") });
    const hash = (db.prepare("SELECT terms_sha256 FROM proposals").get() as { terms_sha256: string }).terms_sha256;
    const r = await post(`prefix=${hash.slice(0, 8)}&decision=approve`);
    expect(r.status).toBe(409);
    expect(r.text).toContain('<p class="flash err" role="alert">P-0001 is EXPIRED, not waiting for approval</p>');
    expect(db.prepare("SELECT COUNT(*) AS n FROM approvals").get()).toEqual({ n: 0 });
  });
});
