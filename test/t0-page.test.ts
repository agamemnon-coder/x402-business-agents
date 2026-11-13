// /t0 (owner, 12 Nov): Purser's books in T:0's general ledger, every figure and id read from the T:0 run records (the
// posting of 10 November with its read-back and T:0's statements, the platform run's entries, the refused attempts of 3
// and 5 November), within 150 words, labelled as the T:0 sandbox with test data, served everywhere a page is. And the
// "Built on" strip in the footer of the partner pages (not Home, not /visa): one proof number per partner, each from its
// record, text only, ICC only as access requested.
import { vic3Run } from "../src/redesign/vic3Run.js";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHECK_PATHS } from "../src/cli/judge.js";
import { PLATFORM_FACTS_FILE, PLATFORM_RUN_FILE, productTiles } from "../src/redesign/airwallexProducts.js";
import { airiRun } from "../src/redesign/airiRun.js";
import { REPO_BLOB, metalStory } from "../src/redesign/metalStory.js";
import { ICC_LINE, builtOnHtml, builtOnItems } from "../src/redesign/partners.js";
import { agentRun } from "../src/redesign/run.js";
import { T0_FIRST_RECORD, T0_JOURNAL_RECORD, T0_LABEL, T0_SECOND_RECORD, t0Data, t0Journal, t0Platform, t0Refusals } from "../src/redesign/t0Page.js";
import { buildPages } from "../src/relay/assets.js";
import { AIRWALLEX_PAGE, CLAUDE_PAGE, HOME_PAGE, METAL_PAGE, PROOF_PAGE, T0_CSP, T0_PAGE, VISA_PAGE, WATCH_PAGE } from "../src/servers/dashboard.js";
import { pageResponse, type Pages } from "../worker/src/core.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const decode = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const text = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
const main = /<main[\s\S]*<\/main>/.exec(T0_PAGE)![0];
/** The words in sight before anything is opened (as test/site-v4.test.ts counts them). */
const inSight = (html: string) => decode(html.replace(/<details\b[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>[\s\S]*?<\/details>/g, " $1 ").replace(/<[^>]+>/g, " ")).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
const journalMd = read(T0_JOURNAL_RECORD), platformMd = read(PLATFORM_RUN_FILE), facts = read(PLATFORM_FACTS_FILE);
const records = journalMd + platformMd + facts + read(T0_FIRST_RECORD) + read(T0_SECOND_RECORD);

describe("/t0 reads every figure from the T:0 run records", () => {
  it("the posting of 10 November: 95 entries, read back with 0 differences, per account as recorded, and T:0's statements", () => {
    const j = t0Journal(journalMd)!;
    expect(j).toMatchObject({ posted: 95, day: "10 Nov", firstId: "je_prod_z7kTCuZ1iiwad01q", differences: 0, built: 95, debits: "21,141,221.86", secondPush: { posted: 0, skipped: 95 } });
    expect(j.accounts).toHaveLength(9);
    for (const a of j.accounts) expect(a.ours).toBe(a.t0);
    expect(j.statements).toEqual({ assets: "26,447,805.98", liabilities: "3,807,739.87", equity: "22,640,066.11", difference: "0.00", financing: "21,140,636.23" });
    expect(t0Journal(null)).toBeNull();
    expect(t0Journal("# nothing posted")).toBeNull();
  });

  it("the platform run's entries (its facts), the post T:0 refused first, and the refused attempts of 3 and 5 November", () => {
    const ids = (JSON.parse(facts) as { t0_entries?: string[] }[]).flatMap((f) => f.t0_entries ?? []);
    expect(t0Platform(facts, platformMd)).toEqual({ entries: ids, refusedCode: "400 CAPI33" });
    expect(ids).toHaveLength(2);
    expect(t0Platform(null, platformMd)).toBeNull();
    expect(t0Refusals(read(T0_FIRST_RECORD), read(T0_SECOND_RECORD))).toEqual([
      { day: "3 Nov", code: "403", why: "the shared key could read, not post", record: T0_FIRST_RECORD },
      { day: "5 Nov", code: "401", why: "the new key was not accepted", record: T0_SECOND_RECORD },
    ]);
  });
});

describe("/t0", () => {
  it("says what ran live and what is not done, labelled as the T:0 sandbox with test data, within 150 words", () => {
    expect(T0_PAGE).toContain(`<span class="pill run">${T0_LABEL}</span>`);
    expect(T0_LABEL).toBe("T:0 sandbox, test data");
    expect(inSight(main).length).toBeLessThanOrEqual(150);
    const t = text(main);
    for (const line of ["10 Nov: 95 journal entries posted", "the main run's books, read back with 0 differences.", "10 Nov: T:0's balance sheet balances to the cent; its financing line is our owner funding.",
      "10 Nov: the platform run booked 2 entries.", "3 Nov: refused, 403: the shared key could read, not post.", "5 Nov: refused, 401: the new key was not accepted.",
      "Accounts are made in T:0's app; its API cannot create them.", "One rate per currency, given by us; no daily rate source yet.", "A supplier bill on T:0's payables account needs a T:0 vendor (refused, 400)."]) expect(t).toContain(line);
    // Every record it links is in the repository.
    for (const href of [...main.matchAll(/href="([^"]+)"/g)].map((m) => decode(m[1]!)).filter((h) => h.startsWith(REPO_BLOB))) {
      expect(existsSync(new URL(`../${href.slice(REPO_BLOB.length).replace(/#.*$/, "")}`, import.meta.url)), href).toBe(true);
    }
  });

  it("shows no figure its records do not hold", () => {
    const shown = text(main).replace(/\b\d{1,2} Nov\b/g, " ").replace(/je_prod_\w+/g, " ").replace(/T:0/g, " ").replace(/PUR-/g, " ").match(/-?\d[\d,]*(\.\d+)?/g) ?? [];
    expect(shown.length).toBeGreaterThan(20);
    for (const n of shown) expect(records, `${n} is in no T:0 record`).toContain(n);
  });

  it("has no script, a style-only policy, and is served by the bundle, the Worker and the judge", () => {
    expect(T0_PAGE).not.toMatch(/<script/);
    expect(T0_CSP).toMatch(/^default-src 'none'; style-src 'sha256-[A-Za-z0-9+/=]+'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'$/);
    const pages = buildPages() as unknown as Pages;
    expect(pages.t0).toBe(T0_PAGE);
    expect(pages.csp.t0).toBe(T0_CSP);
    const res = pageResponse(new Request("https://x.test/t0"), pages)!;
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(T0_CSP);
    expect(CHECK_PATHS).toContain("/t0");
  });
});

describe("the Built on strip", () => {
  const run = agentRun();
  const items = builtOnItems(run);
  it("names each partner once, with one proof number from its record", () => {
    expect(items.map((i) => i.name)).toEqual(["Airwallex", "Metal", "Visa (VIC through Airwallex's Airi)", "Claude", "T:0", "x402"]);
    const st = metalStory(run.record);
    // Paid across both live Airi runs, as /visa counts them (the jury check, 12 Nov): 7 Nov SETTLED plus vic-3's paid.
    // 13 Nov: and vic-4's paid, three live runs in all.
    const later = [vic3Run("docs/runs/2026-11-12-vic-3.json")!, vic3Run()!];
    const settled = airiRun()!.purchases.filter((p) => (p as { status?: string }).status === "SETTLED").length + later.reduce((n, v) => n + v.purchases.filter((p) => !/^F/.test(p.step) && p.outcome?.status === "succeeded").length, 0);
    // Jury, 13 Nov: each figure names its run (the main run's four, the latest Visa run's own count first).
    const latest = later[1]!, latestPaid = latest.purchases.filter((p) => !/^F/.test(p.step) && p.outcome?.status === "succeeded").length;
    const latestDay = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(latest.started_at));
    expect(items.map((i) => i.proof)).toEqual([
      `${productTiles(run).length} products, each run dated`, `${st.payments.total} payments on testnet (main run)`, `${latestPaid} paid in the ${latestDay} run (${settled} paid across 3 live Visa runs)`,
      `${run.record.snapshot.agent_stats.reduce((n, a) => n + a.decisions, 0)} decisions (main run)`, `${t0Data().journal!.posted} journal entries (main run)`, `${st.payments.sales} paid requests (main run)`,
    ]);
    expect(items.map((i) => i.proof)).toEqual(["10 products, each run dated", "86 payments on testnet (main run)", "2 paid in the 13 Nov run (5 paid across 3 live Visa runs)", "24 decisions (main run)", "95 journal entries (main run)", "41 paid requests (main run)"]);
    // #216 (12 Nov): ICC spelled out in the footer.
    expect(ICC_LINE).toBe("Visa Intelligent Commerce Connect (access requested)");
  });

  // #216 (12 Nov): one footer everywhere. The Built on list is in every page's footer (registered with ui.ts), never in
  // <main>; /visa, which says ICC in its body, leaves that item out.
  it("is in the footer of every page, a list, text only; never in <main>; /visa without the ICC item", () => {
    const strip = builtOnHtml(run);
    expect(strip).not.toMatch(/<img|<svg/);
    const lis = (h: string) => [...h.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => text(m[1]!).trim());
    // Jury pass, 13 Nov: Intelligent Commerce Connect is not used, so no footer lists it under Built on.
    expect(lis(strip)).toEqual(["Built on", ...items.map((i) => `${i.name}: ${i.proof}`)]);
    expect(strip).not.toContain(ICC_LINE);
    expect(lis(builtOnHtml(run, false))).toEqual(["Built on", ...items.map((i) => `${i.name}: ${i.proof}`)]);
    for (const [name, html] of Object.entries({ metal: METAL_PAGE, airwallex: AIRWALLEX_PAGE, claude: CLAUDE_PAGE, t0: T0_PAGE })) {
      const foot = /<footer[\s\S]*<\/footer>/.exec(html)![0];
      expect({ name, strip: foot.includes(strip) }).toEqual({ name, strip: true });
      expect({ name, inMain: /<main[\s\S]*<\/main>/.exec(html)![0].includes('class="builton"') }).toEqual({ name, inMain: false });
    }
    for (const [name, html] of Object.entries({ home: HOME_PAGE, visa: VISA_PAGE, watch: WATCH_PAGE, proof: PROOF_PAGE })) {
      expect({ name, inFooter: /<footer[\s\S]*<\/footer>/.exec(html)![0].includes('class="builton"'), inMain: /<main[\s\S]*<\/main>/.exec(html)![0].includes('class="builton"') }).toEqual({ name, inFooter: true, inMain: false });
    }
    expect(VISA_PAGE).toContain(builtOnHtml(run, false));
  });
});
