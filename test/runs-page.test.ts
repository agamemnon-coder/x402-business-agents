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
    expect(rows.map((r) => r.key)).toEqual(["two-locks-1", "platform-e2e-1", "t0-1", "connected-1", "vic-2", "vic-1", "awx-1", "main-1", "agent-1", "tap-1", "friday-1"]);
    // The connected-accounts row, held to its run log: every id and amount on it is in the log.
    const cx = rows.find((r) => r.key === "connected-1")!;
    const cxLog = readFileSync("docs/runs/2026-11-10-connected-accounts-sandbox.md", "utf8");
    for (const id of cx.ids) expect(cxLog).toContain(id.value);
    for (const amount of `${cx.what} ${cx.checks}`.match(/EUR \d+\.\d{2}/g) ?? []) expect(cxLog).toContain(amount);
    expect(cxLog).toMatch(/17 calls in all/);
    expect(cx.checks).toMatch(/simulat/);
    // The platform end-to-end row, held to its run log the same way.
    const pe = rows.find((r) => r.key === "platform-e2e-1")!;
    const peLog = readFileSync("docs/runs/2026-11-10-platform-e2e.md", "utf8");
    for (const id of pe.ids.flatMap((x) => x.value.split(", "))) expect(peLog).toContain(id);
    for (const amount of `${pe.what} ${pe.checks}`.match(/EUR \d+\.\d{2}/g) ?? []) expect(peLog).toContain(amount);
    expect(pe.what).toMatch(/test passkey \(not Face ID\)/);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1]!.iso >= rows[i]!.iso).toBe(true);
    expect(text(pages.runs!)).toContain(`Last live run: ${rows[0]!.date}`);
  });

  // The two-locks run has two dated logs: created and held on 10 Nov, approved at Airwallex and PAID on 12 Nov.
  const twoLocksFirst = () => readFileSync("docs/runs/2026-11-10-airwallex-two-locks.md", "utf8");
  const twoLocksPaid = () => readFileSync("docs/runs/2026-11-12-airwallex-two-locks-paid.md", "utf8");

  it("has a 12 Nov log of the two-locks run: the ids, IN_APPROVAL then PROCESSING then PAID, the signer and the approver", () => {
    const log = twoLocksPaid();
    for (const id of ["4074d684-4704-406c-a527-2832753baf4f", "c25bfc22-64fe-4ff3-aeb2-102a3684fc19", "SLL-2026-11B", "P-0001", "f9ba0fe8758eadbef3b48f23e571ea92e3208f4ebd802703b413a414d444ac28", "EUR 240.00", "Stockline Data GmbH"]) expect(log).toContain(id);
    // The steps of 12 Nov, each on its own line with its UTC time, in this order.
    const steps = [/09:35:59[^\n]*`IN_APPROVAL`/, /owner approved the transfer in the Airwallex sandbox web app[^\n]*Business Accounts, Transfers, Pending your approval/, /09:43:45[^\n]*`PROCESSING`/, /09:43:57[^\n]*`SENT`[^\n]*simulated settlement/, /09:43:58[^\n]*`PAID`[^\n]*simulated settlement/];
    const at = steps.map((re) => log.search(re));
    for (const i of at) expect(i).toBeGreaterThan(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // The signer is the labelled virtual test passkey the tool enrols, by its own label; the approver is the owner.
    expect(readFileSync("src/cli/twoLocks.ts", "utf8")).toContain('TWO_LOCKS_PASSKEY_LABEL = "two-locks virtual test passkey"');
    expect(log).toMatch(/"two-locks virtual test passkey", a labelled virtual test passkey, not a person's device/);
    expect(log).toMatch(/At Airwallex[^\n]*the owner/);
    // The calls: 14 in total, 7 on each day, within the budget the owner raised.
    expect(log).toMatch(/14 Airwallex calls in total/);
    expect(log).toMatch(/from 10 to 12 to 14/);
    const counts = [...log.matchAll(/^\| `(?:POST|GET) [^`]+` \| (\d+) \|$/gm)].map((m) => Number(m[1]));
    expect(counts).toEqual([5, 3, 1, 3, 2]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(14);
    expect(log).toMatch(/7 of them on 10 November[^\n]*7 on 12 November/);
    // What it does not show, said plainly.
    expect(log).toMatch(/not by a real Face ID/);
    expect(log).toMatch(/approved only at Airwallex/);
    expect(log).toMatch(/`SENT` and `PAID` came from the sandbox's simulation endpoints/);
    // The 10 Nov log keeps its sentences and gains one dated line under its title that links this one.
    const first = twoLocksFirst().split("\n");
    expect(first[0]).toBe("# Two locks on one payout: the CFO's passkey, then Airwallex's own approval workflow (10 November 2026)");
    expect(first[2]).toMatch(/^\*\*12 November 2026:\*\* .*PAID.*\(2026-11-12-airwallex-two-locks-paid\.md\)/);
    expect(first.join("\n")).toMatch(/\*\*Not completed\.\*\*/);
    expect(log).toContain("(2026-11-10-airwallex-two-locks.md)");
  });

  it("holds the two-locks row to its two logs: it ends PAID, settlement simulated, a test passkey, approved by the owner at Airwallex", () => {
    const tl = rows.find((r) => r.key === "two-locks-1")!;
    const logs = twoLocksFirst() + twoLocksPaid();
    // The card is dated at the moment the transfer ended PAID, which the 12 Nov log has to the second.
    expect(tl.iso).toBe("2026-11-12T09:43:58.000Z");
    expect(tl.date).toBe("12 Nov 2026");
    expect(twoLocksPaid()).toMatch(/\(12 November 2026\)[\s\S]*09:43:58[^\n]*`PAID`/);
    // Every id and amount on the row is in the two logs taken together.
    expect(tl.ids.map((i) => i.value)).toEqual(["4074d684-4704-406c-a527-2832753baf4f", "c25bfc22-64fe-4ff3-aeb2-102a3684fc19", "P261110-48HWOJN", "P-0001", "f9ba0fe8758eadbef3b48f23e571ea92e3208f4ebd802703b413a414d444ac28"]);
    for (const id of tl.ids) expect(logs).toContain(id.value);
    const said = `${tl.what} ${tl.checks}`;
    const amounts = said.match(/EUR \d+\.\d{2}/g) ?? [];
    expect(amounts).toEqual(["EUR 240.00"]);
    for (const amount of amounts) expect(logs).toContain(amount);
    // The finished story, with its limits.
    expect(tl.what).toMatch(/[Cc]reated on 10 Nov/);
    expect(tl.what).toMatch(/test passkey \(not a person's Face ID\)/);
    expect(tl.what).toMatch(/the owner approved it in Airwallex's sandbox web app/);
    expect(said).toMatch(/PAID/);
    expect(said).toMatch(/simulat/);
    expect(said).not.toMatch(/not completed|is not paid|SCHEDULED/);
    expect(tl.checks).toMatch(/PROCESSING/);
    expect(tl.checks).toMatch(/14 Airwallex calls \(7 on 10 Nov, 7 on 12 Nov\)/);
    expect(twoLocksPaid()).toMatch(/14 Airwallex calls in total/);
    expect(`${tl.title} ${tl.rails}`).not.toMatch(/CFO/);
    // The card's big numbers end in PAID, said to be simulated settlement.
    expect(tl.stats!.at(-1)).toEqual({ v: "PAID", l: "settlement simulated" });
    // Both logs are linked, the 12 Nov one first, and both exist.
    expect(tl.files.map((f) => f.href)).toEqual(["../../docs/runs/2026-11-12-airwallex-two-locks-paid.md", "../../docs/runs/2026-11-10-airwallex-two-locks.md"]);
    for (const f of tl.files) expect(existsSync(f.href.replace("../../", ""))).toBe(true);
    // The page shows it as the newest card.
    expect(text(pages.runs!)).toContain(`Last live run: 12 Nov 2026 (${tl.title})`);
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
