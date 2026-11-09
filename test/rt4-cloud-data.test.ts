// Red team round 4 (cloud, 9 November): the mail quota holds under parallel deliveries; an older push never replaces a
// newer version; a body is never read past its limit; the ledger list never ends early under a date filter; sign-in
// challenges are bounded per company.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MAX_OPEN_CHALLENGES } from "../cloud/src/auth.js";
import { receiveEmail, type InboundEmail } from "../cloud/src/mail.js";
import { testCloud } from "./support/cloud.js";

describe("red team 4, cloud data", () => {
  it("8: sixty deliveries at once never get past the daily quota", async () => {
    const c = testCloud();
    try {
      const t = await c.tenant("acme");
      const put = c.env.blobs.put.bind(c.env.blobs);
      c.env.blobs.put = async (k, b, m) => { await new Promise((r) => setTimeout(r, 5)); return put(k, b, m); };
      const quota = { messagesPerDay: 10, bytesPerDay: 1024 * 1024 };
      const big = "A".repeat(200 * 1024);
      const msgs = Array.from({ length: 60 }, (_, i) => {
        const raw = new Uint8Array(Buffer.from(`From: x@spam.example\r\nTo: acme@in.purser.test\r\nSubject: ${i}\r\n\r\n${big}\r\n`));
        return { from: "x@spam.example", to: "acme@in.purser.test", raw, rawSize: raw.length, setReject: () => {} } as InboundEmail;
      });
      await Promise.all(msgs.map((m) => receiveEmail(c.env.sql, c.env.blobs, m, { domain: "in.purser.test", now: c.clock.now, quota })));
      const rows = await c.env.sql.first<{ n: number; b: number }>("SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS b FROM inbound_mail WHERE tenant_id = ?", [t.id]);
      expect(rows!.n).toBeLessThanOrEqual(10);
      expect(rows!.b).toBeLessThanOrEqual(1024 * 1024);
      expect(rows!.n).toBeGreaterThan(0);
    } finally { c.close(); }
  });

  it("9: a replay of an older push never sets a paid invoice back", async () => {
    const c = testCloud();
    try {
      const t = await c.tenant("acme");
      const pdf = Buffer.from("%PDF-1.4 test");
      const doc = { sha256: createHash("sha256").update(pdf).digest("hex"), filename: "a.pdf", mime: "application/pdf", base64: pdf.toString("base64") };
      const inv = (status: string, updated_at: string) => ({ id: "AP-0001", vendor: "Bergtex", invoice_no: "B1", due_date: "2026-11-30", currency: "EUR", total: "100.00", status, doc_sha256: doc.sha256, received_at: "2026-11-01", updated_at, body: { status, updated_at } });
      const p1 = { documents: [doc], invoices: [inv("ready", "2026-11-02T10:00:00Z")] };
      expect((await c.req("POST", "/v1/sync", { key: t.key, body: p1 })).status).toBe(200);
      expect((await c.req("POST", "/v1/sync", { key: t.key, body: { invoices: [inv("paid", "2026-11-05T10:00:00Z")] } })).status).toBe(200);
      await c.req("POST", "/v1/sync", { key: t.key, body: p1 });
      const g = await c.req("GET", "/v1/invoices/AP-0001", { key: t.key });
      expect(g.json).toMatchObject({ status: "paid", version: 2 });
    } finally { c.close(); }
  });

  it("10: a body without a length is read only up to the limit", async () => {
    const c = testCloud();
    try {
      await c.tenant("acme");
      const MB = 1024 * 1024; let sent = 0;
      const stream = new ReadableStream<Uint8Array>({ pull(ctl) { if (sent >= 50 * MB) { ctl.close(); return; } sent += MB; ctl.enqueue(new Uint8Array(MB).fill(0x41)); } });
      const r = await c.fetch("https://cloud.test/v1/auth/challenge", { method: "POST", body: stream, headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" }, duplex: "half" } as RequestInit);
      expect(r.status).toBe(400);
      expect(sent).toBeLessThan(10 * MB);
    } finally { c.close(); }
  });

  it("ledger list: a date filter that skips a long run of entries still returns the later ones", async () => {
    const c = testCloud();
    try {
      const t = await c.tenant("acme");
      const tid = t.id;
      const put = async (id: number, day: string) => c.env.sql.run("INSERT INTO ledger_entries (tenant_id, entry_id, posting_date, doc_date, description, entry_json, prev_hash, entry_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [tid, id, day, day, "x", JSON.stringify({ entry_id: id }), "0".repeat(64), id.toString(16).padStart(64, "0")]);
      for (let i = 1; i <= 1200; i++) await put(i, "2026-10-01");
      await put(1201, "2026-11-05");
      const page = await c.req("GET", "/v1/ledger/entries?from=2026-11-01", { key: t.key });
      expect((page.json.items as { entry_id: number }[]).map((x) => x.entry_id)).toEqual([1201]);
    } finally { c.close(); }
  });

  it("sign-in challenges: a company has a bounded number open", async () => {
    const c = testCloud({ rate: { windowSec: 60, max: 100_000 } as never });
    try {
      await c.tenant("acme");
      let last = 0;
      for (let i = 0; i <= MAX_OPEN_CHALLENGES; i++) last = (await c.req("POST", "/v1/auth/challenge", { body: { tenant: "acme" }, headers: { "cf-connecting-ip": `198.51.100.${i % 250}` } })).status;
      expect(last).toBe(429);
      const n = await c.env.sql.first<{ n: number }>("SELECT COUNT(*) AS n FROM challenges");
      expect(n!.n).toBeLessThanOrEqual(MAX_OPEN_CHALLENGES);
    } finally { c.close(); }
  });
});
