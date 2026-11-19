// The Airwallex API coverage table (src/proof/awxCoverage.ts, npm run airwallex:coverage): the static scan, the reading
// of run records and tests, and the classification, each on small fixtures; then the committed report against the rules.

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  classify, coverageMarkdown, normalizePath, parseJsonl, recordDate, recordMentions, scanCode, scanTest, type LiveMention, type TestHit,
} from "../src/proof/awxCoverage.js";

describe("normalizePath: a path as a template", () => {
  it("drops the origin, /api/v1, the query and a trailing slash, and folds ids", () => {
    expect(normalizePath("/transfers/create")).toBe("/transfers/create");
    expect(normalizePath("/api/v1/transfers/create")).toBe("/transfers/create");
    expect(normalizePath("https://api.sandbox.airwallex.com/api/v1/balances/current?x=1")).toBe("/balances/current");
    expect(normalizePath("/issuing/cards/{id}/update")).toBe("/issuing/cards/{id}/update");
    expect(normalizePath("/transfers/4074d684-4704-406c-a527-2832753baf4f")).toBe("/transfers/{id}");
    expect(normalizePath("/accounts/acct_SC-QD89fOneAeqaRFgOymw")).toBe("/accounts/{id}");
    expect(normalizePath("/accounts?request_id={id}")).toBe("/accounts");
    expect(normalizePath("/deposits/")).toBe("/deposits");
  });
  it("is null for another service's path, a relative path or a double slash", () => {
    for (const p of ["/v1/messages", "/try/sign", "/passkeys", "documents/purchase_invoices/1.json", "ledger_accounts.json", "/transfers//create", "", "/"]) expect(normalizePath(p), p).toBeNull();
  });
});

const CODE = `
import { Airwallex } from "./client.js";
const api = new Airwallex(cfg);
// api.call("POST", "/webhooks/create") in a comment is not a call
export async function pay(id: string) {
  await api.call<{ id: string }>("POST", "/transfers/create", { request_id: "r" });
  await api.call("POST", "/transfers/create", {});                       // the same endpoint again: one row
  await api.call("GET", \`/transfers/\${encodeURIComponent(id)}\`);
  await this.raw("POST", \`/issuing/cards/\${id}/update\`, {});
  await this.authed("GET", "/api/v1/balances/current");
  await fetch(\`\${this.base}/authentication/login\`, { method: "POST", headers: {} });
  await get("/deposits", { page_num: "0" });
  await tryGet(\`/fx/quotes/\${id}\`);
  await listFind(get, "/fx/conversions", {}, () => true);
  await api.call("GET", path);                                           // dynamic: listed, not guessed
  await moneybird.call("GET", "ledger_accounts.json");                   // not Airwallex
  await site("POST", "/try/sign");                                       // Purser's own route
  call(null, "GET", \`\${API_BASE}/issuing/cards\`);                     // a record's row, not a call (method second)
  add("0", "preflight", "GET", "/webhooks", 1, 1, "why", "code");        // a budget line, not a call
  getVia(api);                                                           // a name that only starts with get
}
`;

describe("scanCode: the call sites in one file", () => {
  const s = scanCode(CODE, "src/fixture.ts");
  const found = s.sites.map((x) => `${x.method} ${x.path}`);
  it("finds every idiom the code uses to call Airwallex", () => {
    expect(found).toEqual([
      "POST /transfers/create", "POST /transfers/create", "GET /transfers/{id}", "POST /issuing/cards/{id}/update", "GET /balances/current",
      "POST /authentication/login", "GET /deposits", "GET /fx/quotes/{id}", "GET /fx/conversions",
    ]);
    expect(s.sites[0]).toMatchObject({ file: "src/fixture.ts", line: 6 });
  });
  it("lists a path held in a variable as dynamic, and counts no other service, no record row and no comment", () => {
    expect(s.dynamic).toEqual([{ file: "src/fixture.ts", line: 15, method: "GET", expr: 'call("GET", path)' }]);
    expect(found.some((f) => f.includes("webhooks") || f.includes("/try/") || f.includes("/issuing/cards") && !f.includes("update"))).toBe(false);
  });
  it("lists no dynamic site in a file that calls Airwallex nowhere with a literal path", () => {
    expect(scanCode(`await client.call("GET", path); await moneybird.call("POST", url);`, "src/erp.ts")).toEqual({ sites: [], dynamic: [] });
  });
});

describe("scanTest: a test names a method and a path together", () => {
  const T = `
    await api.call("POST", "/webhooks/create", {});
    expect(sandbox.calls).toContain("POST /issuing/cards/create");
    const route = { method: "GET", path: "/issuing/cards/{id}" };
    if (method === "POST" && path === "/issuing/cardholders/create") return ok();
    expect(url).toBe("/api/v1/transfers/create");             // a path alone: not counted
    if (path === "/deposits" && (m === "GET" || m === "POST")) return x; // two methods: not counted
  `;
  const hits = scanTest(T, "test/x.test.ts").map((h) => `${h.method} ${h.path}`);
  it("counts a call, a METHOD /path string, an object and a stand-in's route", () => {
    expect([...new Set(hits)].sort()).toEqual(["GET /issuing/cards/{id}", "POST /issuing/cardholders/create", "POST /issuing/cards/create", "POST /webhooks/create"]);
  });
});

describe("recordMentions: the calls a run record holds", () => {
  it("reads call-log lines, skipping other services, and dates each by its own time", () => {
    const lines = parseJsonl([
      '{"at":"2026-11-10T07:06:02.180Z","service":"airwallex","method":"POST","endpoint":"/authentication/login"}',
      '{"at":"2026-11-10T07:06:04.823Z","service":"claude","method":"POST","endpoint":"/v1/messages"}',
      '{"at":"2026-11-10T07:06:05.000Z","service":"t0","method":"GET","endpoint":"/transfers"}',
      "not json",
      '{"at":"2026-11-12T14:18:25.673Z","method":"POST","endpoint":"/accounts/create","pid":1}',
    ].join("\n"));
    const m = lines.flatMap((l) => recordMentions(l, "docs/runs/x/calls.jsonl"));
    expect(m.map((x) => `${x.method} ${x.path} ${x.at}`)).toEqual(["POST /authentication/login 2026-11-10T07:06:02.180Z", "POST /accounts/create 2026-11-12T14:18:25.673Z"]);
  });
  it("reads a per-endpoint count and a 'METHOD /path' string, dated by the record", () => {
    const rec = { run: "r", ran_at: "2026-11-15T09:31:44.370Z", calls: { airwallex: [{ endpoint: "POST /fx/quotes/create", calls: 2 }] }, method: "POST /api/v1/simulation/issuing/create, twice on one card" };
    expect(recordMentions(rec, "docs/runs/r.json").map((x) => `${x.method} ${x.path} ${x.at}`)).toEqual(["POST /fx/quotes/create 2026-11-15", "POST /simulation/issuing/create 2026-11-15"]);
  });
  it("takes the date from the file name when the record has none, and skips a record with neither", () => {
    expect(recordDate({}, "docs/runs/2026-11-13-x.json")).toBe("2026-11-13");
    expect(recordMentions({ endpoint: "GET /balances/current" }, "docs/runs/undated.json")).toEqual([]);
  });
});

describe("classify: one row per endpoint, the strongest evidence wins", () => {
  const scan = scanCode(CODE, "src/fixture.ts");
  const live: LiveMention[] = [
    { method: "POST", path: "/transfers/create", record: "docs/runs/b.json", at: "2026-11-12T10:00:00Z", how: "" },
    { method: "POST", path: "/transfers/create", record: "docs/runs/a.json", at: "2026-11-07", how: "" },
    { method: "GET", path: "/webhooks", record: "docs/runs/a.json", at: "2026-11-07", how: "" },
  ];
  const tests: TestHit[] = [
    { method: "POST", path: "/transfers/create", file: "test/a.test.ts", line: 3, how: "" },
    { method: "GET", path: "/deposits", file: "test/b.test.ts", line: 9, how: "" },
    { method: "GET", path: "/deposits", file: "test/b.test.ts", line: 12, how: "" },
  ];
  const c = classify(scan, tests, live, { sourceFiles: 1, testFiles: 2, records: 2 });
  const row = (k: string) => c.endpoints.find((e) => e.endpoint === k)!;
  it("counts each endpoint once, however many sites call it", () => {
    expect(c.endpoints.filter((e) => e.endpoint === "POST /transfers/create")).toHaveLength(1);
    expect(row("POST /transfers/create").sites).toEqual(["src/fixture.ts:6", "src/fixture.ts:7"]);
    expect(c.totals.endpoints).toBe(8);
    expect(c.totals.live + c.totals.testedOnly + c.totals.codeOnly).toBe(c.totals.endpoints);
  });
  it("marks LIVE with the earliest record, TESTED ONLY with the first test, the rest CODE ONLY", () => {
    expect(row("POST /transfers/create")).toMatchObject({ status: "LIVE", firstLive: { date: "2026-11-07", record: "docs/runs/a.json" }, liveRecords: ["docs/runs/a.json", "docs/runs/b.json"], testFiles: 1 });
    expect(row("GET /deposits")).toMatchObject({ status: "TESTED ONLY", firstTest: "test/b.test.ts:9", testFiles: 1, firstLive: null });
    expect(row("GET /fx/quotes/{id}").status).toBe("CODE ONLY");
    expect(c.totals).toMatchObject({ live: 1, testedOnly: 1, codeOnly: 6, liveAndTested: 1, dynamicSites: 1 });
  });
  it("lists a recorded endpoint the scan did not find apart, outside the totals", () => {
    expect(c.recordsOnly).toEqual([{ endpoint: "GET /webhooks", firstLive: { date: "2026-11-07", at: "2026-11-07", record: "docs/runs/a.json" }, records: ["docs/runs/a.json"] }]);
    const md = coverageMarkdown(c);
    expect(md).toContain("| LIVE (sandbox): in a committed run record | 1 (1 of them also named by a test) |");
    expect(md).toContain("`GET /webhooks`");
  });
});

describe("the committed report (docs/evidence/airwallex-api-coverage.json)", () => {
  const c = JSON.parse(readFileSync(new URL("../docs/evidence/airwallex-api-coverage.json", import.meta.url), "utf8")) as ReturnType<typeof classify>;
  it("adds up, and every record and file it names exists", () => {
    const t = c.totals;
    expect(t.live + t.testedOnly + t.codeOnly).toBe(t.endpoints);
    expect(new Set(c.endpoints.map((e) => e.endpoint)).size).toBe(c.endpoints.length);
    for (const e of c.endpoints) {
      expect(e.status === "LIVE", e.endpoint).toBe(e.firstLive !== null);
      for (const r of e.liveRecords) expect(existsSync(new URL(`../${r}`, import.meta.url)), r).toBe(true);
      for (const s of e.sites) expect(existsSync(new URL(`../${s.split(":")[0]}`, import.meta.url)), s).toBe(true);
    }
  });
  it("marks the signed payout LIVE from a record of the 7 November awx-1 run", () => {
    const t = c.endpoints.find((e) => e.endpoint === "POST /transfers/create")!;
    expect(t.status).toBe("LIVE");
    expect(t.liveRecords).toContain("docs/demo/airwallex-run.json");
  });
});
