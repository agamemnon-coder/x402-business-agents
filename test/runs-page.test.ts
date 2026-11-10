// /runs and /agents/<id> (competitor gap list, 10 Nov): every live run in one list with its ids, checks and records,
// and one page per Kit 11 agent, every figure read from the records. docs/runs/README.md is the same list, generated.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPages } from "../src/relay/assets.js";
import { AGENT_IDS, agentView } from "../src/redesign/agents.js";
import { REPO_BLOB } from "../src/redesign/metalStory.js";
import { loadRecord, decisionsOf } from "../src/redesign/run.js";
import { MAIN_RUN_GLOSSARY, liveRuns, mdCell, runsReadme } from "../src/redesign/runs.js";
import { loadTrace } from "../src/redesign/trace.js";
import { pageResponse, type Pages } from "../worker/src/core.js";

const pages = buildPages({ ...process.env, TRY_SIGN_ENABLED: "on" }) as Pages;
const text = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/g, " ").replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const get = (path: string) => pageResponse(new Request(`https://kit11.example${path}`), pages);

describe("/runs", () => {
  const rows = liveRuns();

  it("lists the live runs newest first, the last one on top", () => {
    expect(rows.map((r) => r.key)).toEqual(["t0-1", "connected-1", "vic-2", "vic-1", "awx-1", "main-1", "agent-1", "tap-1", "friday-1"]);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1]!.iso >= rows[i]!.iso).toBe(true);
    expect(text(pages.runs!)).toContain(`Last live run: ${rows[0]!.date}`);
  });

  it("takes every id from its record", () => {
    const raw = (f: string) => readFileSync(f, "utf8");
    const main = rows.find((r) => r.key === "main-1")!;
    const trace = loadTrace();
    expect(main.ids.map((i) => i.value)).toContain(trace.payments.find((p) => p.kind === "transfer")!.ref);
    const awx = rows.find((r) => r.key === "awx-1")!;
    for (const i of awx.ids) expect(raw("docs/demo/airwallex-run.json")).toContain(i.value);
    const vic1 = rows.find((r) => r.key === "vic-1")!;
    for (const i of vic1.ids) expect(raw("docs/demo/airi-run.json")).toContain(i.value);
    const tap = rows.find((r) => r.key === "tap-1")!;
    for (const i of tap.ids) expect(raw("docs/runs/visa-tap-live-2026-11-02.json")).toContain(i.value);
    expect(rows.find((r) => r.key === "friday-1")!.ids[0]!.value).toBe(JSON.parse(raw("docs/demo/metal.json")).dispute.case_id);
  });

  it("labels every run's money and links files that exist", () => {
    for (const r of rows) {
      expect(r.money).toMatch(/test money|no money moved|Nothing bought/i);
      for (const f of r.files) if (f.href.startsWith(REPO_BLOB)) expect(existsSync(f.href.slice(REPO_BLOB.length))).toBe(true);
    }
  });

  it("explains main-run.json's fields, each one in the record", () => {
    const rec = JSON.parse(readFileSync("docs/demo/main-run.json", "utf8")) as Record<string, Record<string, unknown>>;
    for (const [k] of MAIN_RUN_GLOSSARY) {
      const [a, b] = k.split(".");
      expect(b ? Object.hasOwn(rec[a!]!, b) : Object.hasOwn(rec, a!)).toBe(true);
    }
  });

  it("escapes a table cell's backslashes before its pipes", () => {
    expect(mdCell("a|b")).toBe("a\\|b");
    expect(mdCell("a\\|b")).toBe("a\\\\\\|b");
    expect(mdCell("C:\\path")).toBe("C:\\\\path");
  });

  it("docs/runs/README.md is the same list (npx tsx src/cli/runs-readme.ts)", () => {
    expect(readFileSync("docs/runs/README.md", "utf8")).toBe(runsReadme());
  });

  it("is served by the Worker under a style-only policy", async () => {
    const r = get("/runs")!;
    expect(r.status).toBe(200);
    expect(r.headers.get("content-security-policy")).toMatch(/script-src|default-src 'none'/);
    expect(await r.text()).toContain("Every live run");
  });
});

describe("/agents/<id>", () => {
  const rec = loadRecord().record, trace = loadTrace();

  it("one page per Kit 11 agent; anything else is not a page", () => {
    expect(AGENT_IDS).toEqual(["sourcing", "support", "treasury"]);
    for (const id of AGENT_IDS) expect(get(`/agents/${id}`)!.status).toBe(200);
    expect(get("/agents/customer")).toBeNull();
    expect(get("/agents/__proto__")).toBeNull();
    expect(get("/agents/Sourcing")).toBeNull();
  });

  it("reads limits, decisions and payments from the records", () => {
    for (const id of AGENT_IDS) {
      const v = agentView(id, rec, trace);
      expect(v.decisions.length).toBe(decisionsOf(rec).filter((d) => d.agent === id).length);
      expect(v.payments.length).toBe(trace.payments.filter((p) => (p as unknown as { origin: { agent?: string } }).origin?.agent === id).length);
      const t = text(pages.agents![id]!.page);
      if (v.card) expect(t).toContain(`····${v.card.last4}`);
      for (const d of v.decisions) if (d.requestId) expect(t).toContain(d.requestId);
      expect(t).toContain(`What Claude decided · ${v.decisions.length}`);
      expect(t).toContain("test money");
    }
    expect(agentView("sourcing", rec, trace).payments.length).toBe(42);
    expect(agentView("support", rec, trace).payments.length).toBe(3);
  });

  it("links and assets work one level down", () => {
    for (const id of AGENT_IDS) {
      const html = pages.agents![id]!.page;
      expect(html).not.toMatch(/(href|src)="(?!https?:|#|\/|data:)/);
      expect(html).not.toMatch(/url\(assets\//);
    }
  });

  it("say none of the site's forbidden words (test/site-v4.test.ts)", () => {
    for (const html of [pages.runs!, ...AGENT_IDS.map((id) => pages.agents![id]!.page)]) expect(text(html)).not.toMatch(/warehouse software|stand-in|\bdry-1\d*|every limit|can['’]t break/i);
  });

  it("are linked from /runs", () => {
    for (const id of AGENT_IDS) expect(pages.runs).toContain(`href="agents/${id}"`);
  });
});
