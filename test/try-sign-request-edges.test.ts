// /try/sign's desk (worker/src/trySign.ts) at its door, before any world is looked at: paths that are not its own, a body
// past 16 KB whether or not it says its length (a body sent without one is counted as it arrives and cut off), a body
// that is not a JSON object, a malformed step or attempt, an address with too many refused signatures this hour, a
// token that is not one; and anything unexpected inside answers a fixed 500 with no exception text.
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { TrySignDesk, networkKey } from "../worker/src/trySign.js";
import type { Sql } from "../worker/src/core.js";
import { BASE, TEST_RATE, call, sqlOver, t0 } from "./support/trySign.js";

function deskOf(o: { talk?: boolean; failOn?: RegExp } = {}) {
  const db = new Database(":memory:");
  const inner = sqlOver(db);
  const sql: Sql = { exec: (q, ...b) => { if (o.failOn?.test(q)) throw new Error("SQLITE_BUSY: /var/data/secret.db is locked"); return inner.exec(q, ...b); } };
  const d = new TrySignDesk(sql, { now: () => t0, rate: TEST_RATE, ...(o.talk ? { talk: "off" as const } : {}) });
  return { d, db };
}
const post = (d: TrySignDesk, sub: string, body: BodyInit | null, headers: Record<string, string> = {}, ip = "203.0.113.50") =>
  d.fetch(new Request(`${BASE}/api/try-sign/${sub}`, { method: "POST", headers: { origin: BASE, "cf-connecting-ip": ip, ...headers }, body, ...(body instanceof ReadableStream ? { duplex: "half" } : {}) } as RequestInit));
const errorOf = async (r: Response) => ((await r.json()) as { error: string }).error;

describe("what is not the desk's", () => {
  it("another path is not found, and a GET is not taken", async () => {
    const { d } = deskOf();
    expect((await d.fetch(new Request(`${BASE}/api/other`, { method: "POST" }))).status).toBe(404);
    expect((await d.fetch(new Request(`${BASE}/api/try-sign/admin`, { method: "POST" }))).status).toBe(404);
    const r = await call(d, "world", {}, { method: "GET" });
    expect(r.status).toBe(405);
  });
});

describe("a body the desk does not read", () => {
  it("past 16 KB by its stated length: refused before reading", async () => {
    const { d } = deskOf();
    const r = await post(d, "world", "{}", { "content-length": "16385" });
    expect(r.status).toBe(413);
    expect(await errorOf(r)).toBe("too large");
  });

  it("past 16 KB with no length, as it arrives: cut off", async () => {
    const { d } = deskOf();
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) { if (sent >= 64 * 1024) { c.close(); return; } sent += 4096; c.enqueue(new Uint8Array(4096).fill(0x20)); },
    });
    const r = await post(d, "world", stream);
    expect(r.status).toBe(413);
    // It stopped reading soon after the limit, not at the end of what was sent.
    expect(sent).toBeLessThan(64 * 1024);
  });

  it("not JSON, or JSON that is not an object", async () => {
    const { d } = deskOf();
    expect(await errorOf(await post(d, "world", "{not json"))).toBe("send JSON");
    expect(await errorOf(await post(d, "world", "[1,2]"))).toBe("send a JSON object");
    expect(await errorOf(await post(d, "world", "null"))).toBe("send a JSON object");
  });

  it("a step the agents do not have, an attempt too long, an unknown key: each says what to send", async () => {
    const { d } = deskOf({ talk: true });
    const token = "A".repeat(43);
    expect(await errorOf(await call(d, "agents", { token, step: "pay" }))).toBe("send the world's token, and a step if you like: read, check, quote, advise, ready");
    expect(await errorOf(await call(d, "talk", { token, attempt: "x".repeat(281 * 4) }))).toBe("send the world's token and your attempt, at most 280 characters");
    expect(await errorOf(await call(d, "chain", { token, extra: 1 }))).toBe("send the world's token only");
    expect(await errorOf(await call(d, "world", { token }))).toBe("send an empty JSON object");
    // Without the talk step switched on, its path is not there at all.
    expect((await call(deskOf().d, "talk", { token, attempt: "hi" })).status).toBe(404);
  });
});

describe("limits per address", () => {
  it("an address with 30 refused signatures this hour is turned away before its body is read", async () => {
    const { d, db } = deskOf();
    const ip = "198.51.100.77";
    const insert = db.prepare("INSERT INTO ts_hits (ip, kind, at) VALUES (?, 'fail', ?)");
    for (let i = 0; i < 30; i++) insert.run(ip, t0.getTime() - 60_000);
    const r = await post(d, "world", "{not json", {}, ip);
    expect(r.status).toBe(429);
    expect(await errorOf(r)).toBe("too many refused signatures from this address; wait an hour");
    // Another address is not.
    expect((await post(d, "world", "{}", {}, "198.51.100.78")).status).toBe(201);
  });

  it("the network of an address: IPv4 by its /24, IPv6 by its /48", () => {
    expect(networkKey("198.51.100.77")).toBe("198.51.100.0/24");
    expect(networkKey("2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1::/48");
    expect(networkKey("unknown")).toBe("unknown");
  });
});

describe("a token that cannot be a world's", () => {
  it("a string of another shape, or one no world has, is no world: 410; anything but a string is malformed", async () => {
    const { d } = deskOf();
    for (const token of ["short", "A".repeat(42) + "!", "A".repeat(43)]) {
      const r = await call(d, "chain", { token });
      expect(r.status, token).toBe(410);
      expect(await r.json()).toMatchObject({ expired: true });
    }
    for (const token of [42, null, ["A".repeat(43)]]) {
      const r = await call(d, "chain", { token });
      expect(r.status).toBe(400);
      expect(await errorOf(r)).toBe("send the world's token only");
    }
  });
});

describe("anything unexpected inside", () => {
  it("answers a fixed 500 that names nothing of the cause", async () => {
    const { d } = deskOf({ failOn: /INSERT INTO ts_worlds/ });
    const r = await call(d, "world", {});
    expect(r.status).toBe(500);
    const text = await r.text();
    expect(JSON.parse(text)).toEqual({ error: "the test world could not answer this; nothing was signed or run. Try again" });
    expect(text).not.toMatch(/SQLITE|secret|var\/data/);
  });
});
