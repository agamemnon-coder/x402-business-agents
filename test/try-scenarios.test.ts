// The scenario library (src/try/scenarios/): at least 24 distinct scenarios from blocks, every event in it, the same
// seed always picking the same one, the generated PDFs up to date, and every scenario's right answer equal to what the
// engine's deterministic checks answer with no Claude (the Node engine reads with Purser's parser), played through the
// cloud's own route in a fresh test company each. Nothing reaches the network.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pdfOf } from "../src/e2e/documents.js";
import { decisionOf } from "../src/try/endCard.js";
import { EVENTS } from "../src/try/scenarios/blocks.js";
import { LIBRARY, scenariosFile } from "../src/try/scenarios/library.js";
import { newSeed, parseSeed, pick, SEED_MAX } from "../src/try/scenarios/seed.js";
import { SCENARIOS } from "../cloud/src/try/scenarios.gen.js";
import { ADMIN_TOKEN, testCloud, type TestCloud } from "./support/cloud.js";

describe("the library", () => {
  it("has at least 24 distinct scenarios, with every event in it", () => {
    expect(LIBRARY.length).toBeGreaterThanOrEqual(24);
    expect(new Set(LIBRARY.map((s) => s.id)).size).toBe(LIBRARY.length);
    expect(new Set(LIBRARY.map((s) => s.files.map((f) => f.text).join("\n---\n"))).size).toBe(LIBRARY.length);
    for (const e of EVENTS) expect(LIBRARY.some((s) => s.event === e), e).toBe(true);
    for (const s of LIBRARY) expect(["refuse", "ask", "pay"]).toContain(s.expect.action);
    expect(JSON.stringify(LIBRARY)).not.toMatch(/\blive\b/i);
  });

  it("the generated PDFs are up to date with the texts", async () => {
    const pdfs = await Promise.all(LIBRARY.map((s) => Promise.all(s.files.map(async (f) => (await pdfOf(f.text)).toString("base64")))));
    expect(readFileSync("cloud/src/try/scenarios.gen.ts", "utf8")).toBe(scenariosFile(pdfs));
    expect(SCENARIOS.map((s) => s.id)).toEqual(LIBRARY.map((s) => s.id));
  });

  it("a seed picks the same scenario and company every time; seeds are whole numbers and nothing else", () => {
    for (const seed of [0, 1, 26, 27, 81, 123_456, SEED_MAX]) expect(pick(LIBRARY, seed)).toEqual(pick(LIBRARY, seed));
    expect(pick(LIBRARY, 0).scenario.id).toBe(LIBRARY[0]!.id);
    expect(pick(LIBRARY, LIBRARY.length).company).not.toBe(pick(LIBRARY, 0).company);
    expect(new Set(Array.from({ length: LIBRARY.length }, (_, i) => pick(LIBRARY, i).scenario.id)).size).toBe(LIBRARY.length);
    expect(parseSeed("42")).toBe(42);
    for (const bad of ["", "-1", "1.5", "0x10", "99999999999", "4294967295", null, undefined]) expect(parseSeed(bad)).toBeNull();
    const s = newSeed();
    expect(Number.isInteger(s) && s >= 0 && s <= SEED_MAX).toBe(true);
  });
});

describe("every scenario through the engine, without Claude", () => {
  let c: TestCloud;
  beforeAll(async () => {
    c = testCloud({ engine: true, tryIt: { claude: false } });
    for (const [key, value] of [["starts", "on"], ["starts_per_address_hour", "50"]]) expect((await c.req("POST", "/v1/try/admin", { key: ADMIN_TOKEN, body: { op: "set", key, value } })).status).toBe(200);
  });
  afterAll(() => c.close());

  it("is off while its switch is off", async () => {
    const s = (await c.req("POST", "/v1/try/start", { body: {}, headers: { "cf-connecting-ip": "192.0.2.200" } })).json.session as string;
    expect((await c.req("POST", "/v1/try/scenarios/0", { key: s })).status).toBe(404);
    expect((await c.req("GET", "/v1/try/scenarios/0", { key: s })).status).toBe(404);
  });

  it("answers each scenario's right answer: refuse, ask a person first, or pay after a signature", async () => {
    expect((await c.req("POST", "/v1/try/admin", { key: ADMIN_TOKEN, body: { op: "set", key: "scenarios", value: "on" } })).status).toBe(200);
    const seen: Record<string, string> = {};
    for (let i = 0; i < LIBRARY.length; i++) {
      const s = (await c.req("POST", "/v1/try/start", { body: {}, headers: { "cf-connecting-ip": `192.0.2.${i + 1}` } })).json.session as string;
      const meta = await c.req("GET", `/v1/try/scenarios/${i}`, { key: s });
      expect(meta.json).toMatchObject({ seed: i, id: LIBRARY[i]!.id, files: LIBRARY[i]!.files.length });
      expect(meta.json).not.toHaveProperty("expect");
      const r = await c.req("POST", `/v1/try/scenarios/${i}`, { key: s });
      expect(r.status, `${LIBRARY[i]!.id} ${JSON.stringify(r.json).slice(0, 300)}`).toBe(200);
      const answer = r.json.answer as Parameters<typeof decisionOf>[0];
      seen[LIBRARY[i]!.id] = `${decisionOf(answer).action} (${decisionOf(answer).why})`;
      expect(r.json.decided).toEqual(decisionOf(answer));
      expect(r.json.expect).toEqual(LIBRARY[i]!.expect);
    }
    expect(Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, v.split(" ")[0]]))).toEqual(Object.fromEntries(LIBRARY.map((s) => [s.id, s.expect.action])));
  }, 120_000);
});
