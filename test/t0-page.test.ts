// T:0 on /books (merged 21 Nov; /t0 until then, owner 12 Nov): Purser's books in T:0's general ledger, every figure and id read from the T:0 run records (the
// posting of 10 November with its read-back and T:0's statements, the platform run's entries, the refused attempts of 3
// and 5 November), within 150 words, labelled as the T:0 sandbox with test data, served everywhere a page is. And the
// "Built on" strip in the footer of the partner pages (not Home, not /visa): one proof number per partner, each from its
// record, text only, ICC only as access requested.
import { vic3Run } from "../src/redesign/vic3Run.js";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHECK_PATHS } from "../src/cli/judge.js";
import { PLATFORM_FACTS_FILE, PLATFORM_RUN_FILE, productTiles, tilesCountWords } from "../src/redesign/airwallexProducts.js";
import { airiRun } from "../src/redesign/airiRun.js";
import { REPO_BLOB, metalStory } from "../src/redesign/metalStory.js";
import { ICC_LINE, builtOnHtml, builtOnItems } from "../src/redesign/partners.js";
import { agentRun } from "../src/redesign/run.js";
import { T0_CSS, T0_FIRST_RECORD, T0_JOURNAL_RECORD, T0_LABEL, T0_READBACK_RECORD, T0_SECOND_RECORD, T0_USE, balances, ownerFunding, t0Data, t0Journal, t0Platform, t0Refusals, t0Rows } from "../src/redesign/t0Page.js";
import { t0CloseFacts } from "../src/redesign/t0CloseTile.js";
import { esc } from "../src/redesign/ui.js";
import { buildPages } from "../src/relay/assets.js";
import { AIRWALLEX_PAGE, BOOKS_CSP, BOOKS_PAGE, CLAUDE_PAGE, HOME_PAGE, METAL_PAGE, PROOF_PAGE, VISA_PAGE, WATCH_PAGE } from "../src/servers/dashboard.js";
import { pageResponse, type Pages } from "../worker/src/core.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const decode = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const text = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
const main = /<main[\s\S]*<\/main>/.exec(BOOKS_PAGE)![0];
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
    expect(j.accounts[0]).toMatchObject({ account: "11120 (1200)", code: "11120", name: "Operating Checking Account #2", ours: "11,144,700.05", t0: "11,144,700.05" });
    expect(j.samples).toHaveLength(4);
    expect(j.samples[0]).toEqual({ ours: "PUR-8264fd976b2da0702aaf01ae", what: "owner funding on Metal, test USD", t0: "je_prod_z7kTCuZ1iiwad01q" });
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

// 21 Nov (the owner: "merge them: the books page, with T:0 in it"): T:0 is a section of /books, and /t0 answers 301 there.
describe("T:0 on /books", () => {
  const section = /<section class="card t0s" id="t0"[\s\S]*?<\/section>\n<\/section>|<section class="card t0s" id="t0"[\s\S]*?<div class="folds">[\s\S]*?<\/div>\n<\/section>/.exec(main)![0];

  it("says what Purser uses T:0 for, with its two figures from the records, each with its record link, labelled as the T:0 sandbox", () => {
    expect(section).toContain(`<span class="pill run">${T0_LABEL}</span>`);
    expect(section).toContain('<span class="t0mark" role="img" aria-label="T:0">T:0</span>');
    expect(text(section)).toContain(T0_USE);
    const j = t0Data().journal!, close = t0CloseFacts()!;
    const stats = /<ul class="t0n">([\s\S]*?)<\/ul>/.exec(section)![1]!;
    expect(text(stats)).toContain(`${j.posted} journal entries posted to T:0, ${j.day}`);
    expect(text(stats)).toContain(`${close.check.problems.length} differences when read back`);
    expect(stats).toContain(`${REPO_BLOB}${T0_JOURNAL_RECORD}`);
    expect(stats).toContain(`${REPO_BLOB}${T0_READBACK_RECORD}`);
  });

  it("folds the accounts ours against T:0's, a check only where they match, and says the amounts are the sandbox's", () => {
    const j = t0Data().journal!;
    const all = /<details class="fold"><summary>The accounts, ours beside T:0's \(USD\)<\/summary>([\s\S]*?)<\/details>/.exec(section)![1]!;
    // The rows as t0Rows draws them; the page names Alta "(formerly Metal)" at its first mention, so compare without it.
    expect(all.replace("Alta (formerly Metal)", "Alta")).toContain(t0Rows(j.accounts, true));
    for (const a of j.accounts) expect(all).toContain(esc(a.ours));
    const funding = j.accounts.find((a) => a.code === "32000")!.ours.replace(/^-/, "");
    expect(text(all)).toContain(`Sandbox amounts: the books open with the Airwallex sandbox's test balances, ${funding} USD of owner funding. No real money.`);
    expect(inSight(section).join(" ")).not.toContain(funding);
  });

  it("checks T:0's balance sheet in code and keeps the shared entity's totals off the page", () => {
    const j = t0Data().journal!;
    expect(balances(j.statements!)).toBe(true);
    expect(ownerFunding(j)).toBe(true);
    expect(text(section)).not.toMatch(/26,447,805\.98|Shared entity/);
  });

  it("keeps the history, what Purser sends, the next steps and the ids folded, every repository link a file that exists", () => {
    for (const s of ["What Purser sends", "How it got there", "Next steps", "The ids in T:0"]) expect(section).toContain(`<summary>${s}</summary>`);
    expect(text(section)).toContain("Accounts are made in T:0's app; its API cannot create them.");
    for (const href of [...section.matchAll(/href="([^"]+)"/g)].map((m) => decode(m[1]!)).filter((h) => h.startsWith(REPO_BLOB))) {
      expect({ href, exists: existsSync(new URL(`../${href.slice(REPO_BLOB.length).split("#")[0]}`, import.meta.url)) }).toEqual({ href, exists: true });
    }
  });

  it("shows no figure its records do not hold", () => {
    const shown = text(section).replace(/\b\d{1,2} Nov( 2026)?\b/g, " ").replace(/je_prod_\w+/g, " ").replace(/T:0/g, " ").replace(/PUR-\w+/g, " ").replace(/\b\d{5}\b/g, " ").match(/-?\d[\d,]*(\.\d+)?/g) ?? [];
    expect(shown.length).toBeGreaterThan(3);
    const close = read(T0_READBACK_RECORD);
    for (const n of shown) expect({ n, inRecords: (records + close).includes(n.replace(/^-/, "")) || /^(0|1|6\.1|2026|401|403)$/.test(n) }).toEqual({ n, inRecords: true });
  });

  it("is served at /books with its scripts' hashes and connect-src 'self'; /t0 answers 301 to /books", () => {
    expect(BOOKS_CSP).toMatch(/^default-src 'none'; script-src 'sha256-[A-Za-z0-9+/=]+'; style-src 'sha256-[A-Za-z0-9+/=]+'; connect-src 'self'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'$/);
    const pages = buildPages() as unknown as Pages;
    expect(pages.books).toBe(BOOKS_PAGE);
    expect((pages as { t0?: string }).t0).toBeUndefined();
    const res = pageResponse(new Request("https://x.test/t0?from=old"), pages)!;
    expect([res.status, res.headers.get("location")]).toEqual([301, "/books?from=old"]);
    expect(CHECK_PATHS).toContain("/books");
    expect(CHECK_PATHS).not.toContain("/t0");
    expect(T0_CSS).toContain(".t0mark");
  });
});

describe("the Built on strip", () => {
  const run = agentRun();
  const items = builtOnItems(run);
  it("names each partner once, with one proof number from its record", () => {
    // Jury panel, 15 Nov: "Alta"; "(formerly Metal)" once per page, at the first mention in <main>.
    expect(items.map((i) => i.name)).toEqual(["Airwallex", "Alta", "Visa (VIC through Airwallex's Airi)", "Claude", "T:0", "x402"]);
    const st = metalStory(run.record);
    // Paid across both live Airi runs, as /visa counts them (the jury check, 12 Nov): 7 Nov SETTLED plus vic-3's paid.
    // 13 Nov: and vic-4's paid, three live runs in all. 14 Nov: and vic-5's (the latest), four in all.
    const later = [vic3Run("docs/runs/2026-11-12-vic-3.json")!, vic3Run("docs/runs/2026-11-13-vic-4.json")!, vic3Run()!];
    const settled = airiRun()!.purchases.filter((p) => (p as { status?: string }).status === "SETTLED").length + later.reduce((n, v) => n + v.purchases.filter((p) => !/^F/.test(p.step) && p.outcome?.status === "succeeded").length, 0);
    // Jury, 13 Nov: each figure names its run (the main run's four, the latest Visa run's own count first).
    const latest = later[2]!, latestPaid = latest.purchases.filter((p) => !/^F/.test(p.step) && p.outcome?.status === "succeeded").length;
    const latestDay = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(latest.started_at));
    expect(items.map((i) => i.proof)).toEqual([
      `${tilesCountWords(productTiles(run), true)}, each run dated`, `${st.payments.total} payments on testnet (main run)`, `${latestPaid} paid in the ${latestDay} run (${settled} paid across 4 Visa runs)`,
      `${run.record.snapshot.agent_stats.reduce((n, a) => n + a.decisions, 0)} decisions (main run)`, `${t0Data().journal!.posted} journal entries (main run)`, `${st.payments.sales} requests sold, ${st.payments.purchases} bought (main run)`,
    ]);
    expect(items.map((i) => i.proof)).toEqual(["9 Airwallex features plus Airi (beta), each run dated", "86 payments on testnet (main run)", "1 paid in the 14 Nov run (6 paid across 4 Visa runs)", "24 decisions (main run)", "95 journal entries (main run)", "41 requests sold, 41 bought (main run)"]);
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
    for (const [name, html] of Object.entries({ metal: METAL_PAGE, airwallex: AIRWALLEX_PAGE, claude: CLAUDE_PAGE, books: BOOKS_PAGE })) {
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
