// The Compliance view in Purser Cloud (27 Nov), on the authority map's pattern: the runner builds a small summary of its
// compliance evidence (src/compliance/evidence.ts complianceSnapshot: counts per framework and control, the map's gaps,
// for the last 30 days) and pushes it with its sync (src/cloudsync/client.ts); the cloud checks it against a strict
// schema and a size cap, keeps the newest per company (cloud/src/compliance.ts), GET /v1/compliance reads it for the
// caller's company only, and the Company page shows it, folded, as text (cloud/src/complianceView.ts). Test data only.
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COMPANY_JS } from "../cloud/src/consoleCompany.js";
import { COMPLIANCE_MAX_BYTES, ComplianceSnapshot } from "../cloud/src/compliance.js";
import { COMPLIANCE_JS } from "../cloud/src/complianceView.js";
import { batchesFor, pushToCloud } from "../src/cloudsync/client.js";
import { HONEST_LINE } from "../src/compliance/controls.js";
import { complianceSnapshot } from "../src/compliance/evidence.js";
import { complianceWorld } from "./support/complianceWorld.js";
import { testCloud, type TestCloud } from "./support/cloud.js";

const NOW = new Date("2026-11-30T12:00:00Z");
let c: TestCloud;
let a: { id: string; key: string };
let b: { id: string; key: string };
const target = (key: string) => ({ url: "https://cloud.test", key, fetch: c.fetch });
const read = async (key: string) => (await c.req("GET", "/v1/compliance", { key })).json as { compliance: unknown; received_at: string | null };
const push = (key: string, snapshot: unknown) => c.req("POST", "/v1/sync", { key, body: { compliance: snapshot } });
const applied = (r: { json: Record<string, unknown> }) => (r.json.applied as Record<string, unknown>).compliance;

beforeEach(async () => {
  c = testCloud();
  a = await c.tenant("northwind");
  b = await c.tenant("other-co");
});
afterEach(() => c.close());

describe("the compliance snapshot", () => {
  it("is the evidence summary of the last 30 days, counts only, with the gaps and the honest line", () => {
    const { db } = complianceWorld();
    const s = complianceSnapshot(db, NOW);
    expect(s.period).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(s.frameworks.map((f) => [f.framework, f.evidence_in_period, f.gap])).toEqual([["eu-ai-act", 8, 0], ["iso-42001", 5, 1], ["soc2", 8, 0], ["dora", 7, 2], ["psd2-sca", 5, 0], ["gdpr", 2, 1], ["eidas", 1, 1], ["nis2", 3, 2], ["iso-27001", 6, 3]]);
    expect(s.controls.find((x) => x.id === "PC-06")).toEqual({ id: "PC-06", name: "Emergency stop and agent stops", status: "records-in-period", records: 2 });
    expect(s.gaps.length).toBe(10); // v1.5.1: 14 until the AI Act Arts. 4, 11(1), 17(1) and GDPR Art. 28 were documented
    expect(s.note).toBe(HONEST_LINE);
    expect(JSON.stringify(s)).not.toMatch(/"(subject|payload|row_hash|seq)"/);
    expect(ComplianceSnapshot.safeParse(JSON.parse(JSON.stringify(s))).success).toBe(true);
  });
});

describe("the compliance snapshot's sync", () => {
  it("goes from the runner's push to the cloud and back by the read API, unchanged", async () => {
    const { db } = complianceWorld();
    expect((await read(a.key)).compliance).toBeNull();
    await pushToCloud(db, target(a.key), NOW, undefined, complianceSnapshot);
    const got = await read(a.key);
    expect(got.compliance).toEqual(JSON.parse(JSON.stringify(complianceSnapshot(db, NOW))));
    expect(got.received_at).toBe(c.clock.now.toISOString());
    // The same counts again change nothing; a newer snapshot replaces it; an older one never does.
    expect(applied(await push(a.key, complianceSnapshot(db, new Date(NOW.getTime() + 1000))))).toEqual({ added: 0, changed: 0, unchanged: 1 });
    const later = complianceSnapshot(db, new Date("2026-12-05T12:00:00Z"));
    expect(applied(await push(a.key, later))).toEqual({ added: 0, changed: 1, unchanged: 0 });
    expect(applied(await push(a.key, complianceSnapshot(db, NOW)))).toEqual({ added: 0, changed: 0, unchanged: 1 });
    expect(((await read(a.key)).compliance as { period: { to: string } }).period.to).toBe("2026-12-05");
  });

  it("rides with the first batch of a push when the caller builds it, and not otherwise", () => {
    const { db } = complianceWorld();
    const empty = { audit: { seq: 0, hash: null }, ledger: { entry_id: 0, hash: null }, documents: [] };
    expect(batchesFor(db, empty, { now: NOW }).filter((x) => "compliance" in x)).toHaveLength(0);
    const batches = batchesFor(db, empty, { now: NOW, compliance: complianceSnapshot });
    expect(batches.filter((x) => "compliance" in x)).toHaveLength(1);
    expect(batches[0]).toHaveProperty("compliance");
  });

  it("refuses an unknown field, a bad status, a bad hash or an over-long text, stores nothing, and caps the size", async () => {
    const good = () => JSON.parse(JSON.stringify(complianceSnapshot(complianceWorld().db, NOW))) as Record<string, unknown> & { controls: Record<string, unknown>[]; gaps: Record<string, unknown>[]; audit: Record<string, unknown> };
    const extra = { ...good(), html: "<b>x</b>" };
    const status = good(); status.controls[0]!.status = "compliant";
    const hash = good(); hash.audit.head = "nope";
    const long = good(); long.gaps[0]!.gap = "x".repeat(5000);
    const row = good(); row.controls[0]!.subject = "P-0001";
    for (const bad of [extra, status, hash, long, row]) {
      const r = await push(a.key, bad);
      expect(r.status, JSON.stringify(r.json)).toBe(400);
    }
    expect((await read(a.key)).compliance).toBeNull();
    const big = good();
    big.gaps = Array.from({ length: 100 }, () => ({ ...big.gaps[0]!, gap: "y".repeat(990) }));
    big.controls = Array.from({ length: 100 }, (_, i) => ({ ...big.controls[0]!, id: `PC-${String(i).padStart(2, "0")}`, name: "z".repeat(190) }));
    expect(JSON.stringify(big).length).toBeGreaterThan(COMPLIANCE_MAX_BYTES);
    expect(ComplianceSnapshot.safeParse(big).success).toBe(false);
  }, 30_000);

  it("is read only by the company that pushed it", async () => {
    const { db } = complianceWorld();
    await push(a.key, complianceSnapshot(db, NOW));
    expect((await read(a.key)).compliance).not.toBeNull();
    expect((await read(b.key)).compliance).toBeNull();
    expect((await c.req("GET", "/v1/compliance", { key: null })).status).toBe(401);
  });
});

describe("the Compliance section on the Company page", () => {
  type N = { tag: string; className: string; text?: string; kids: N[]; append: (...k: (N | string)[]) => void; replaceChildren: (...k: N[]) => void; hidden?: boolean };
  function render(snapshot: unknown) {
    const node = (tag: string): N => {
      const n: N = { tag, className: "", kids: [], append: (...k) => { for (const x of k) n.kids.push(typeof x === "string" ? { tag: "#text", className: "", text: x, kids: [], append() {}, replaceChildren() {} } : x); }, replaceChildren: (...k) => { n.kids = k; } };
      return n;
    };
    const document = { createElement: node, createTextNode: (t: string) => ({ tag: "#text", className: "", text: t, kids: [] }) };
    const ctx: Record<string, unknown> = { document, NL: false, FETCH: () => Promise.resolve({ compliance: snapshot }) };
    runInNewContext(`const el=(tag,cls,kids)=>{const e=document.createElement(tag);if(cls)e.className=cls;for(const k of [].concat(kids??[])){if(k===null||k===undefined||k===false)continue;e.append(typeof k==='string'?document.createTextNode(k):k)}return e};
      const api=(p)=>FETCH(p);` + COMPLIANCE_JS + ";this.box=complianceBox();", ctx);
    return ctx.box as N;
  }
  const texts = (n: N): string[] => (n.tag === "#text" ? [n.text!] : n.kids.flatMap(texts));
  const tags = (n: N): string[] => [n.tag, ...n.kids.flatMap(tags)];

  it("draws the counts, the controls without records and the gaps as text, with the honest line", async () => {
    const s = complianceSnapshot(complianceWorld().db, NOW);
    s.gaps[0]!.gap = "<img src=x onerror=alert(1)>";
    const box = render(s);
    await new Promise((r) => setTimeout(r, 0));
    expect(box.tag).toBe("details");
    expect(box.hidden).toBe(false);
    const words = texts(box).join("\n");
    expect(words).toContain("Compliance evidence");
    expect(words).toContain("EU AI Act: 8 with evidence in the period, 1 mapped with no records, 11 documented, 0 gaps (20 requirements)");
    expect(words).toContain("<img src=x onerror=alert(1)>");
    expect(words).toContain(HONEST_LINE);
    expect(words).toMatch(/PC-12 Rationale record per payment/);
    expect(tags(box)).not.toContain("img");
  });

  it("shows nothing before the runner pushed one", async () => {
    const box = render(null);
    await new Promise((r) => setTimeout(r, 0));
    expect(box.hidden).toBe(true);
  });

  it("is in the Company page's script, which never writes markup", () => {
    expect(COMPANY_JS).toContain(COMPLIANCE_JS.trim());
    expect(COMPANY_JS).toContain("complianceBox()");
    expect(COMPLIANCE_JS).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    expect([...COMPLIANCE_JS.matchAll(/api\('([^']+)'/g)].map((m) => m[1])).toEqual(["/v1/compliance"]);
    expect(COMPLIANCE_JS).not.toMatch(/\b(compliant|certified)\b/i);
  });
});
