// The product pages under "More" (12 Nov): /pricing ("Pilot pricing") and /security ("Security and trust"). Nothing on
// them is typed in by hand: every price comes from src/config/pricing.ts, the platform fee's test amounts from its run
// record, the red team's counts from its reports, the audit log's rows from the published log, and the "Not yet" lines
// from the docs, word for word. Each page is served by the Worker and by `npm run judge` under a style-only policy
// (no script), linked from "More" and from the footer, and named in llms.txt.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHECK_PATHS } from "../src/cli/judge.js";
import { PRICING, euro } from "../src/config/pricing.js";
import { PRICING_LEAD, TEST_VALUES, feeRun, pricingPage } from "../src/redesign/pricing.js";
import { AUDIT_COMMAND, AUDIT_LOG, NOT_YET_LINE, NOT_YET_SOURCES, docLine, publishedAudit, redTeamRound, securityCards, securityPage, REDTEAM_NIGHT, REDTEAM_NIGHT_RECORD, REDTEAM_OCT31, REDTEAM_REPORT } from "../src/redesign/security.js";
import { buildPages, flowLinks } from "../src/relay/assets.js";
import { PRICING_CSP, PRICING_PAGE, SECURITY_CSP, SECURITY_PAGE } from "../src/servers/dashboard.js";
import { pageResponse, type Pages } from "../worker/src/core.js";
import { HEADER_PATHS } from "./security-headers.rules.js";
import { scriptBlocks } from "./support/scriptBlocks.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const json = <T>(p: string) => JSON.parse(read(p)) as T;
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
/** The page's <main> as a person reads it with every fold open: tags out, entities decoded, white space single. */
const mainText = (html: string) => decode((/<main[\s\S]*<\/main>/.exec(html)?.[0] ?? "").replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
/** One card of a page, by its id. */
const card = (html: string, id: string) => new RegExp(`<article class="pc card[^"]*" id="${id}">[\\s\\S]*?</article>`).exec(html)?.[0] ?? "";
const NUM = /\d+(?:[.,]\d+)*/g;
const numbers = (text: string) => [...new Set(text.match(NUM) ?? [])];
const REPO = "https://github.com/agamemnon-coder/x402-business-agents/blob/main/";
/** The repository files a page links to on GitHub (without any #anchor). */
const repoLinks = (html: string) => [...html.matchAll(new RegExp(`href="${REPO.replace(/[.]/g, "\\.")}([^"#]+)`, "g"))].map((m) => m[1]!);

describe("/pricing: pilot pricing", () => {
  const html = pricingPage(), text = mainText(html);
  const record = read(PRICING.platformFee.runRecord);

  it("keeps the prices in one module, as decided on 12 November: Starter 49 a month with 100 invoices and 0.25 per extra invoice, Business from 249 a month", () => {
    expect(PRICING.starter).toEqual({ name: "Starter", monthlyCents: 4900, invoicesIncluded: 100, extraInvoiceCents: 25 });
    expect(PRICING.business).toEqual({ name: "Business", fromMonthlyCents: 24900, includes: ["Several companies", "Four-eyes approval", "Bookkeeping connectors"] });
    expect(PRICING.platformFee).toEqual({ name: "Platform fee", runRecord: "docs/runs/2026-11-10-connected-accounts-sandbox.md" });
    expect([euro(4900), euro(25), euro(24900), euro(120000), euro(5)]).toEqual(["€49", "€0.25", "€249", "€1,200", "€0.05"]);
    expect(() => euro(0.5)).toThrow();
  });

  it("says in one lead line that these are pilot prices for design partners and that nothing is on sale yet", () => {
    expect(PRICING_LEAD).toBe("These are pilot prices for design partners. Nothing is on sale yet.");
    expect(html).toContain(`<p class="lead">${PRICING_LEAD}</p>`);
    expect((html.match(/<h1\b/g) ?? []).length).toBe(1);
    expect(html).toContain("<h1>Pilot pricing</h1>");
    expect(html).toContain("<title>Pilot pricing</title>");
  });

  it("shows three cards, each price formatted from the module", () => {
    expect([...html.matchAll(/<article class="pc card" id="([a-z-]+)">/g)].map((m) => m[1])).toEqual(["starter", "business", "platform-fee"]);
    const starter = mainText(`<main>${card(html, "starter")}</main>`), business = mainText(`<main>${card(html, "business")}</main>`);
    expect(starter).toBe(`Starter ${euro(PRICING.starter.monthlyCents)} a month ${PRICING.starter.invoicesIncluded} invoices included ${euro(PRICING.starter.extraInvoiceCents)} per extra invoice`);
    expect(business).toBe(`Business from ${euro(PRICING.business.fromMonthlyCents)} a month ${PRICING.business.includes.join(" ")}`);
    expect(starter).toBe("Starter €49 a month 100 invoices included €0.25 per extra invoice");
    expect(business).toBe("Business from €249 a month Several companies Four-eyes approval Bookkeeping connectors");
  });

  it("reads the platform fee's test amounts from the run record, says it ran in the sandbox, labels them test values and links the record", () => {
    // Counted again here from the record's own payout row, not through the page's reader.
    const row = record.split("\n").find((l) => /`POST \/transfers\/create` with `x-on-behalf-of`/.test(l) && /application_fee_options/.test(l))!;
    const payout = /with `x-on-behalf-of`: (EUR \d+\.\d{2}),/.exec(row)![1]!, fee = /`application_fees`: (EUR \d+\.\d{2}) \(TRANSFER\)/.exec(row)![1]!;
    expect(row).toContain(`amount: "${fee.replace("EUR ", "")}", currency: EUR`);
    expect(record).toMatch(/\*\*`PAID`\*\*/);
    expect(record).toMatch(/^# Connected accounts, sandbox runs \(10 November 2026\)/);
    expect(feeRun()).toEqual({ day: "10 November", payout, fee, record: PRICING.platformFee.runRecord });
    const fees = mainText(`<main>${card(html, "platform-fee")}</main>`);
    expect(fees).toBe(`Platform fee A small fee per payout Collected through Airwallex connected accounts Already ran in the Airwallex sandbox (10 November) In that run: a ${fee} test fee on a ${payout} test payout. ${TEST_VALUES} The run record ↗`);
    expect(TEST_VALUES).toBe("Test values, not prices");
    expect(card(html, "platform-fee")).toContain(`<a class="pf" href="${REPO}${PRICING.platformFee.runRecord}" target="_blank" rel="noopener">The run record ↗</a>`);
    // A record that no longer says the payout and its fee is an error, never a guess.
    expect(() => feeRun(record.replace(/`application_fees`: EUR/g, "`application_fees`: about EUR"))).toThrow(/not in the record/);
    expect(() => feeRun("# Another record (1 January 2027)\n")).toThrow();
  });

  it("says once, in one line, what is not there yet: no real-money go-live", () => {
    expect((html.match(/<p class="notyet">/g) ?? []).length).toBe(1);
    expect(text).toMatch(/Not yet: no real-money go-live\. Everything so far ran in the sandbox, with test money\.$/);
  });

  it("shows no Claude cost per invoice: no eval or run record in the repository holds a measured one (12 Nov)", () => {
    expect(html).not.toMatch(/costs us in Claude calls/i);
    expect(html).not.toMatch(/<details class="fold"/);
    expect(text).not.toMatch(/Claude|USD|\$/);
    // What the records do hold: the end-to-end run counted its Claude calls, not their cost.
    expect(read("docs/runs/2026-11-10-platform-e2e.md")).toMatch(/\| Claude \| \d+ \| \d+ \| [^|]*classify, read and review per invoice/);
  });

  it("shows no number that is not in the pricing module or the run record", () => {
    const run = feeRun();
    const allowed = new Set([euro(PRICING.starter.monthlyCents), euro(PRICING.starter.extraInvoiceCents), euro(PRICING.business.fromMonthlyCents)].map((e) => e.slice(1))
      .concat(String(PRICING.starter.invoicesIncluded), run.day.split(" ")[0]!, run.fee.replace("EUR ", ""), run.payout.replace("EUR ", "")));
    expect(numbers(text).filter((n) => !allowed.has(n))).toEqual([]);
    expect(numbers(text).sort()).toEqual([...allowed].sort());
    // And a typed-in price would be caught.
    expect(numbers(`${text} only €19 today`).filter((n) => !allowed.has(n))).toEqual(["19"]);
  });

  it("says what is real in its own words, not the main run's", () => {
    const real = decode((/<details class="real"[\s\S]*?<\/details>/.exec(html)?.[0] ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
    expect(real).toContain("Pilot prices for design partners. Nothing is on sale yet.");
    expect(real).toContain("are test values, not prices");
    expect(real).toContain("No real-money go-live yet: sandbox and test money only.");
    expect(real).toContain("Source: src/config/pricing.ts (the prices) and docs/runs/2026-11-10-connected-accounts-sandbox.md (the fee's sandbox run).");
    expect(real).not.toMatch(/Northwind|Real Claude decisions/);
    expect(html).toContain('<span class="pill note">');
    expect(text.startsWith("Sandbox and test money only Pilot pricing")).toBe(true);
  });
});

describe("/security: security and trust", () => {
  const html = securityPage(), text = mainText(html), cards = securityCards();
  /** A card's words in sight: its fold counts as its summary only. */
  const inSight = (id: string) => mainText(`<main>${card(html, id).replace(/<details\b[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>[\s\S]*?<\/details>/g, " $1 ")}</main>`);
  const folded = (id: string) => mainText(`<main>${/<details class="fold">[\s\S]*?<\/details>/.exec(card(html, id))?.[0] ?? ""}</main>`);

  it("has seven short cards in this order, each one sentence, a link to its proof and a folded detail", () => {
    expect(cards.map((c) => [c.id, c.title])).toEqual([["s-sign", "Signed terms"], ["s-funds", "No funds held"], ["s-limits", "Limits"], ["s-audit", "Audit trail"], ["s-chain", "On chain"], ["s-redteam", "Tested by attack"], ["s-notyet", "Not yet"]]);
    expect([...html.matchAll(/<article class="pc card[^"]*" id="(s-[a-z]+)">/g)].map((m) => m[1])).toEqual(cards.map((c) => c.id));
    for (const c of cards) {
      const el = card(html, c.id), line = mainText(`<main>${/<p>([\s\S]*?)<\/p>/.exec(el)![0]}</main>`);
      // One sentence: it ends with a full stop and has no other sentence end inside it.
      expect({ id: c.id, sentences: line.replace(/\bnpm run verify-log\b/, "the command").split(/[.!?](?:\s|$)/).filter(Boolean).length, ends: /\.$/.test(line) }).toEqual({ id: c.id, sentences: 1, ends: true });
      expect({ id: c.id, words: line.split(" ").length <= 26 }).toEqual({ id: c.id, words: true });
      expect({ id: c.id, links: (/<div class="links">([\s\S]*?)<\/div>/.exec(el)?.[1]?.match(/<a class="pf" href="[^"]+"/g) ?? []).length >= 1 }).toEqual({ id: c.id, links: true });
      expect({ id: c.id, folds: (el.match(/<details class="fold"><summary>[^<]+<\/summary><ul class="pl">(?:<li>[\s\S]*?<\/li>)+<\/ul><\/details>/g) ?? []).length }).toEqual({ id: c.id, folds: 1 });
    }
    expect((html.match(/<h1\b/g) ?? []).length).toBe(1);
    expect(html).toContain("<h1>Security and trust</h1>");
    expect(text.startsWith("Sandbox and testnet only Security and trust")).toBe(true);
  });

  it("signatures: the exact terms, signed with a passkey, one changed cent refused; the proof is the Try tab", () => {
    expect(inSight("s-sign")).toBe("Signed terms The CFO signs the exact terms with a passkey: change one cent and the signature is refused. Try it yourself How");
    expect(card(html, "s-sign")).toContain('<a class="pf" href="try" data-next="try">Try it yourself</a>');
    // In a bundle that carries /try/sign the link leads there, as the Try tab does; in one without it, to /try.
    expect(flowLinks(html, true)).toContain('<a class="pf" href="try/sign" data-next="try">Try it yourself</a>');
    expect(flowLinks(html, false)).toContain('<a class="pf" href="try" data-next="try">Try it yourself</a>');
    expect(folded("s-sign")).toContain("signs the hash of the exact terms");
  });

  it("funds: only wording the docs support (no funds of its own; the company's own Airwallex account; the control layer), sandbox only, with the claims register's note", () => {
    expect(inSight("s-funds")).toBe("No funds held Sandbox only Purser holds no funds of its own: the money stays in the company's own Airwallex account, and Purser is the control layer. The sandbox run ↗ How");
    const flat = (p: string) => read(p).replace(/\*\*|`/g, "").replace(/\s+/g, " ");
    expect(flat("docs/business/model.md")).toContain("Purser holds no funds of its own");
    expect(flat("docs/compliance.md")).toContain("The money sits in the business's own Airwallex account and Metal account. Purser asks those rails to move it");
    expect(flat("docs/airwallex-platform.md")).toContain("The money stays in the company's own Airwallex wallet");
    expect(flat("README.md")).toContain("Purser is a control layer for AI agents that spend company money");
    // The softened wording of the claims register, and the note it asks for with it.
    expect(flat("docs/claims.md")).toContain("\"Purser holds no money\" → \"holds no funds of its own\", noting that the runner keeps the testnet owner key.");
    expect(text).not.toMatch(/holds no money/i);
    expect(folded("s-funds")).toContain("“The money sits in the business's own Airwallex account and Metal account. Purser asks those rails to move it”");
    expect(folded("s-funds")).toContain("In this build the runner keeps the testnet owner key.");
    expect(folded("s-funds")).toContain("on behalf of a test company's own connected account, with test money");
  });

  it("limits: outside the prompt, per agent, at Airwallex (card controls) and on Metal (a mandate on chain)", () => {
    expect(inSight("s-limits")).toBe("Limits Limits live outside the prompt: card controls per agent at Airwallex, and a mandate per agent on chain at Metal. Card controls, read back A refusal on chain How");
    expect(card(html, "s-limits")).toContain('<a class="pf" href="airwallex#controls">Card controls, read back</a><a class="pf" href="metal">A refusal on chain</a>');
    // The anchor exists on /airwallex.
    expect(buildPages().airwallex).toMatch(/id="controls"/);
    expect(folded("s-limits")).toMatch(/Airwallex: The CFO policy's limits[^.]*are written to each agent's card as Airwallex's own controls and read back\./);
    expect(folded("s-limits")).toMatch(/Metal: A mandate per agent: a cap per payment, a total budget, one payee and an end date/);
  });

  it("audit trail: hash-chained, anyone can re-check it, and the command is named; the published log's rows are counted from the file", () => {
    expect(AUDIT_COMMAND).toBe("npm run verify-log");
    expect(inSight("s-audit")).toBe("Audit trail Every step goes into a hash-chained audit log that anyone can re-check: npm run verify-log . Check the published log ↗ How");
    expect(card(html, "s-audit")).toContain("<code>npm run verify-log</code>");
    expect(json<{ scripts: Record<string, string> }>("package.json").scripts["verify-log"]).toBe("tsx src/cli/verifyLog.ts");
    const rows = read(AUDIT_LOG).split("\n").filter((l) => l.trim()).length;
    const recorded = json<{ recorded_at: string; snapshot: { audit: { rows: number } } }>("docs/demo/snapshot.json");
    expect(rows).toBe(recorded.snapshot.audit.rows);
    expect(publishedAudit()).toEqual({ rows, day: "30 October", command: `npm run verify-log -- --jsonl ${AUDIT_LOG}` });
    expect(recorded.recorded_at.slice(0, 10)).toBe("2026-10-30");
    expect(folded("s-audit")).toContain(`The 30 October run's log is in the repository, ${rows} rows. Check it offline, with no keys: npm run verify-log -- --jsonl docs/audit/friday-1-audit.jsonl`);
    // The docs name the same command for the same file, and say how the chain holds, in the words the fold quotes.
    expect(read("docs/audit/README.md")).toContain("npm run verify-log -- --jsonl docs/audit/friday-1-audit.jsonl");
    expect(read("docs/audit/README.md").replace(/`/g, "").replace(/\s+/g, " ")).toContain("Each row's hash is SHA-256 over the previous row's hash and the row itself (src/audit/log.ts), so changing, removing or reordering any row breaks every hash after it.");
    expect(folded("s-audit")).toContain("“Each row's hash is SHA-256 over the previous row's hash and the row itself (src/audit/log.ts), so changing, removing or reordering any row breaks every hash after it.” docs/audit/README.md ↗");
  });

  it("on chain: each agent's mandate and its payments, of an approval only a hash, no personal data, as the docs say", () => {
    expect(inSight("s-chain")).toBe("On chain On Metal's chain are each agent's mandate and its payments, and of an approval only a hash: no personal data. See it on Metal's testnet How");
    expect(folded("s-chain")).toContain("“Mandate changes anchor the approval on chain (the new credential's hash is bound)”");
    expect(folded("s-chain")).toContain("“the customer is simulated and Purser holds no personal data on chain”");
    expect(read("docs/overview.md").replace(/\s+/g, " ")).toContain("Mandate changes anchor the approval on chain (the new credential's hash is bound)");
    expect(read("docs/metal-award.md")).toContain("Purser holds no personal data on chain");
  });

  it("tested by attack: the red team's counts are the reports' own, counted again here", () => {
    interface R { attempts: number; blocked: number; inconclusive?: number; not_blocked?: number; caught_after?: number; results: { outcome?: string; caught?: string }[] }
    const sum = (files: string[], pick: (r: R) => number) => files.map((f) => json<R>(f)).reduce((n, r) => n + pick(r), 0);
    // The first report (30 October): every attempt has an outcome, and "caught" says before or after.
    const first = json<R>(REDTEAM_REPORT);
    const after = first.results.filter((r) => r.caught === "after").length, before = first.results.filter((r) => r.outcome === "blocked" && r.caught === "before").length;
    expect([first.attempts, before + after, after]).toEqual([first.results.length, first.blocked, first.caught_after]);
    expect(inSight("s-redteam")).toBe(`Tested by attack Our red team ran ${first.attempts} attacks in a test world: ${before} were stopped before anything moved and ${after} were found afterwards, not prevented. The report ↗ Later rounds`);
    expect(redTeamRound([REDTEAM_REPORT])).toMatchObject({ day: "30 October", attempts: first.attempts, before, after, inconclusive: 0, notBlocked: 0 });
    // 31 October, three runs: counted from each run's results.
    const oct = { attempts: sum(REDTEAM_OCT31, (r) => r.results.length), after: sum(REDTEAM_OCT31, (r) => r.results.filter((x) => x.caught === "after").length), blocked: sum(REDTEAM_OCT31, (r) => r.results.filter((x) => x.outcome === "blocked").length), inconclusive: sum(REDTEAM_OCT31, (r) => r.results.filter((x) => x.outcome === "inconclusive").length) };
    expect(redTeamRound(REDTEAM_OCT31)).toMatchObject({ day: "31 October", attempts: oct.attempts, before: oct.blocked - oct.after, after: oct.after, inconclusive: oct.inconclusive, notBlocked: 0 });
    expect(folded("s-redteam")).toContain(`31 October, three runs in a row: ${oct.attempts} attacks, ${oct.blocked - oct.after} stopped before anything moved, ${oct.after} found afterwards, ${oct.inconclusive} inconclusive.`);
    // 2 November, the night batch: its three files' own totals, and the record's own words on the re-check by hand.
    const night = { attempts: sum(REDTEAM_NIGHT, (r) => r.results.length), blocked: sum(REDTEAM_NIGHT, (r) => r.blocked), notBlocked: sum(REDTEAM_NIGHT, (r) => r.not_blocked ?? 0), inconclusive: sum(REDTEAM_NIGHT, (r) => r.inconclusive ?? 0) };
    expect(night.blocked + night.notBlocked + night.inconclusive).toBe(night.attempts);
    expect(redTeamRound(REDTEAM_NIGHT)).toMatchObject({ day: "2 November", attempts: night.attempts, before: null, after: null, blocked: night.blocked, notBlocked: night.notBlocked, inconclusive: night.inconclusive });
    expect(read(REDTEAM_NIGHT_RECORD)).toContain(`checked by hand (${night.notBlocked}; none is a breach)`);
    expect(folded("s-redteam")).toContain(`2 November, tests written by Claude Opus as the attacker: ${night.attempts} run, ${night.blocked} blocked, ${night.notBlocked} not blocked by code's verdict (checked by hand: none is a breach), ${night.inconclusive} inconclusive.`);
    // Honest about where it ran, in the site's words (never "stand-in" on a public page).
    expect(folded("s-redteam")).toContain("Every round ran in a throwaway test world on simulated rails, with test data: not live.");
    expect(read("docs/claims.md")).toContain("Tested on stand-ins (not live)");
  });

  it("not yet: one honest sentence, each part of it a sentence the docs say, word for word", () => {
    expect(NOT_YET_LINE).toBe("No third-party penetration test and no SOC 2 report yet; sandbox and testnet only; the SME product's independent security review is pending.");
    expect(inSight("s-notyet")).toBe(`Not yet ${NOT_YET_LINE} What is not in place ↗ Sources`);
    expect(NOT_YET_SOURCES.map((s) => s.doc)).toEqual(["docs/security.md", "docs/controls.md", "docs/cloud.md"]);
    const flat = (p: string) => read(p).replace(/\*\*|`/g, "").replace(/\s+/g, " ");
    expect(flat("docs/security.md")).toContain("No third-party penetration test has been run");
    expect(flat("docs/controls.md")).toContain("This is not a SOC 2 report: no auditor has tested these controls, and the build runs on the Airwallex sandbox and Metal testnet only.");
    expect(flat("docs/cloud.md")).toContain("What the code does not do yet, and must be in place before a company's real data goes in: 1.");
    expect(flat("docs/cloud.md")).toContain("5. An independent security review of this branch after these fixes, and a red-team run against a deployed staging copy.");
    for (const s of NOT_YET_SOURCES) {
      expect({ doc: s.doc, said: flat(s.doc).includes(s.quote) }).toEqual({ doc: s.doc, said: true });
      expect(folded("s-notyet")).toContain(`“${s.quote}” ${s.doc} ↗`);
    }
    // The quote from the SME product's doc says what it is about, in our words, before the doc's own.
    expect(folded("s-notyet")).toContain("The SME product, still to do before real customer data: “An independent security review of this branch");
    expect(flat("docs/cloud.md")).toMatch(/^# Purser Cloud/);
    // The anchors the links use are headings of those docs.
    expect(read("docs/security.md")).toMatch(/^## Checks$/m);
    expect(read("docs/cloud.md")).toMatch(/^## Before real customer data$/m);
    expect(read("docs/controls.md")).toMatch(/^## Not in place \(summary\)$/m);
    // A doc that stops saying a sentence stops the build: the page never keeps a line the docs dropped.
    expect(() => docLine({ doc: "docs/security.md", anchor: "", quote: "A third party has tested everything" })).toThrow(/no longer says/);
    // Never a certificate, an endorsement or an approval claimed.
    expect(text).not.toMatch(/\b(certified|certification|endorsed|approved by|compliant|audited by)\b/i);
  });

  it("shows no number that is not read from a report, a record or the published log", () => {
    const first = redTeamRound([REDTEAM_REPORT]), oct = redTeamRound(REDTEAM_OCT31), night = redTeamRound(REDTEAM_NIGHT), audit = publishedAudit();
    const allowed = new Set([first.attempts, first.before, first.after, oct.attempts, oct.before, oct.after, oct.inconclusive, night.attempts, night.blocked, night.notBlocked, night.inconclusive, audit.rows].map(String)
      // And the days of the dated rounds and of the published log's run.
      .concat(first.day.split(" ")[0]!, oct.day.split(" ")[0]!, night.day.split(" ")[0]!, audit.day.split(" ")[0]!));
    // Names that carry a digit are not figures: "SOC 2", "SHA-256", and the files the folds name.
    const figures = (t: string) => numbers(t.replace(/SOC 2|SHA-256/g, " ").replace(/(?:src|test|docs)\/[\w/.-]+/g, " "));
    expect(figures(text).filter((n) => !allowed.has(n))).toEqual([]);
    expect(figures(`${text} 100% safe`).filter((n) => !allowed.has(n))).toEqual(["100"]);
  });

  it("says what is real in its own words: sandbox and testnet only", () => {
    const real = decode((/<details class="real"[\s\S]*?<\/details>/.exec(html)?.[0] ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
    expect(real).toContain("Sandbox and testnet only: Airwallex's sandbox, Metal's testnet, test money.");
    expect(real).toContain("The red team ran in a throwaway test world on simulated rails, not live.");
    expect(real).toContain(NOT_YET_LINE);
    expect(real).not.toMatch(/Northwind|Real Claude decisions/);
  });
});

describe("the two pages on the site", () => {
  const pages = buildPages() as Pages;

  it("are built once and served as they are: the same page from the Worker's bundle and the judge server", () => {
    expect(PRICING_PAGE).toBe(pricingPage());
    expect(SECURITY_PAGE).toBe(securityPage());
    // Without /try/sign in the bundle the pages are served unchanged; with it, /security's link to Try leads there.
    expect(pages.pricing).toBe(PRICING_PAGE);
    expect(pages.security).toBe(SECURITY_PAGE);
    expect((buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv) as Pages).security).toContain('href="try/sign" data-next="try"');
    expect(CHECK_PATHS).toEqual(expect.arrayContaining(["/pricing", "/security"]));
    expect(HEADER_PATHS.filter((h) => ["/pricing", "/security"].includes(h.path))).toEqual([{ path: "/pricing", kind: "page", status: 200 }, { path: "/security", kind: "page", status: 200 }]);
  });

  it("carry no script, so each is served under a style-only policy of its own", () => {
    for (const [name, html, csp] of [["pricing", PRICING_PAGE, PRICING_CSP], ["security", SECURITY_PAGE, SECURITY_CSP]] as const) {
      expect({ name, scripts: scriptBlocks(html) }).toEqual({ name, scripts: [] });
      expect({ name, styles: (html.match(/<style>/g) ?? []).length }).toEqual({ name, styles: 1 });
      expect({ name, csp }).toEqual({ name, csp: expect.stringMatching(/^default-src 'none'; style-src 'sha256-[A-Za-z0-9+/=]+'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'$/) });
      expect(pages.csp[name]).toBe(csp);
      const res = pageResponse(new Request(`https://x.test/${name}`), pages)!;
      expect({ name, status: res.status, type: res.headers.get("content-type"), csp: res.headers.get("content-security-policy") }).toEqual({ name, status: 200, type: "text/html; charset=utf-8", csp });
      // No image, font or script from anywhere but the site itself.
      expect({ name, outside: html.match(/<(?:img|script|link)[^>]*(?:src|href)="https?:[^"]*"/g) ?? [] }).toEqual({ name, outside: [] });
    }
    // An older bundle without the pages answers nothing for them (the Worker then serves the clean 404).
    const { pricing: _p, security: _s, ...older } = pages;
    expect(pageResponse(new Request("https://x.test/pricing"), older as Pages)).toBeNull();
    expect(pageResponse(new Request("https://x.test/security"), older as Pages)).toBeNull();
  });

  it("are marked in the menu as the page the reader is on, under More", () => {
    for (const [key, html] of [["pricing", PRICING_PAGE], ["security", SECURITY_PAGE]] as const) {
      const nav = /<nav class="tabs" aria-label="Main">([\s\S]*?)<\/nav>/.exec(html)![1]!;
      expect({ key, more: /<details class="pmore"><summary class="on">More<\/summary>/.test(nav), here: nav.includes(`<a href="${key}" aria-current="page">`), tabs: (nav.match(/class="on" aria-current="page"/g) ?? []).length }).toEqual({ key, more: true, here: true, tabs: 0 });
    }
    // Elsewhere "More" is not marked, and the dropdown is closed until the reader opens it.
    const home = /<nav class="tabs" aria-label="Main">([\s\S]*?)<\/nav>/.exec(pages.home!)![1]!;
    expect(home).toContain('<details class="pmore"><summary>More</summary>');
    expect(home).not.toMatch(/<details class="pmore" open/);
  });

  it("link only to repository files that exist", () => {
    for (const [name, html] of [["pricing", PRICING_PAGE], ["security", SECURITY_PAGE]] as const) {
      const files = repoLinks(html);
      expect({ name, some: files.length > 0 }).toEqual({ name, some: true });
      for (const f of files) expect({ name, file: f, exists: existsSync(new URL(`../${f}`, import.meta.url)) }).toEqual({ name, file: f, exists: true });
    }
  });

  it("are named in llms.txt, one line each, with what they are", () => {
    const lines = read("llms.txt").split("\n");
    expect(lines.filter((l) => l.includes("https://kit11.max-31b.workers.dev/pricing"))).toEqual(["- Pricing: https://kit11.max-31b.workers.dev/pricing (pilot prices for design partners; nothing is on sale yet)"]);
    expect(lines.filter((l) => l.includes("https://kit11.max-31b.workers.dev/security"))).toEqual(["- Security and trust: https://kit11.max-31b.workers.dev/security (each control with its proof, and what is not in place yet; sandbox and testnet only)"]);
  });
});
