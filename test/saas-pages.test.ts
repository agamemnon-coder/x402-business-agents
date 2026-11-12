// The product pages under "More" (12 Nov): /pricing ("Pilot pricing") and /security ("Security and trust"). Nothing on
// them is typed in by hand: every price comes from src/config/pricing.ts, the platform fee's test amounts from its run
// record, the red team's counts from its reports, the audit log's rows from the published log, and the "Not yet" lines
// from the docs, word for word. Each page is served by the Worker and by `npm run judge` under a style-only policy
// (no script), linked from "More" and from the footer, and named in llms.txt.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHECK_PATHS } from "../src/cli/judge.js";
import { repoHref } from "../src/redesign/productPage.js";
import { hostileClaimText } from "../src/redesign/partners.js";
import { FEE_BPS_CAP } from "../src/airwallex/platform.js";
import { PRICING, euro, percentOfBps } from "../src/config/pricing.js";
import { FEE_FOLD, PRICING_LEAD, TEST_VALUES, e2eFeeRun, feeLine, feeRun, pricingPage } from "../src/redesign/pricing.js";
import { AUDIT_COMMAND, AUDIT_LOG, CHAIN_LINES, OVERVIEW_DOC, existingDoc, NOT_YET_LINE, NOT_YET_SOURCES, docLine, publishedAudit, redTeamRound, securityCards, securityPage, REDTEAM_NIGHT, REDTEAM_NIGHT_RECORD, REDTEAM_OCT31, REDTEAM_REPORT } from "../src/redesign/security.js";
import { buildPages, flowLinks } from "../src/relay/assets.js";
import { AIRWALLEX_PAGE, CLAUDE_PAGE, METAL_PAGE, PRICING_CSP, PRICING_PAGE, PROOF_PAGE, RUNS_PAGE, SECURITY_CSP, SECURITY_PAGE, VISA_PAGE } from "../src/servers/dashboard.js";
import { menuItemOf } from "../src/ui/more.js";
import { navHtml } from "../src/ui/nav.js";
import { pageResponse, type Pages } from "../worker/src/core.js";
import { HEADER_PATHS } from "./security-headers.rules.js";
import { scriptBlocks } from "./support/scriptBlocks.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const json = <T>(p: string) => JSON.parse(read(p)) as T;
// "&amp;" last, so an escaped entity ("&amp;lt;") is decoded once, never twice.
const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/** The page's <main> as a person reads it with every fold open: tags out, entities decoded, white space single. */
const mainText = (html: string) => decode((/<main[\s\S]*<\/main>/.exec(html)?.[0] ?? "").replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
/** A piece of a page as it is in sight: a fold counts as its summary only. */
const inSight = (el: string) => mainText(`<main>${el.replace(/<details\b[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>[\s\S]*?<\/details>/g, " $1 ")}</main>`);
/** One card of a page, by its id. */
const card = (html: string, id: string) => new RegExp(`<article class="pc card[^"]*" id="${id}">[\\s\\S]*?</article>`).exec(html)?.[0] ?? "";
const NUM = /\d+(?:[.,]\d+)*/g;
const numbers = (text: string) => [...new Set(text.match(NUM) ?? [])];
const REPO = "https://github.com/agamemnon-coder/x402-business-agents/blob/main/";
/** The repository files a page links to on GitHub (without any #anchor). */
const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const repoLinks = (html: string) => [...html.matchAll(new RegExp(`href="${reEscape(REPO)}([^"#]+)`, "g"))].map((m) => m[1]!);

describe("/pricing: pilot pricing", () => {
  const html = pricingPage(), text = mainText(html);
  const record = read(PRICING.platformFee.runRecord);

  it("keeps the prices in one module, as decided on 12 November: Starter 49 a month with 100 invoices and 0.25 per extra invoice, Business from 249 a month", () => {
    expect(PRICING.starter).toEqual({ name: "Starter", monthlyCents: 4900, invoicesIncluded: 100, extraInvoiceCents: 25 });
    expect(PRICING.business).toEqual({ name: "Business", fromMonthlyCents: 24900, includes: ["Several companies", "Four-eyes approval", "Bookkeeping connectors"] });
    // The fee per payout has no price here: the two run records, the code's own ceiling and the test policy's rate
    // (test/saas-additions.test.ts checks how they fit).
    expect(PRICING.platformFee).toEqual({ name: "Platform fee", runRecord: "docs/runs/2026-11-10-connected-accounts-sandbox.md", e2eRecord: "docs/runs/2026-11-10-platform-e2e.md", capBps: FEE_BPS_CAP, testPolicyBps: 50 });
    expect([euro(4900), euro(25), euro(24900), euro(120000), euro(5)]).toEqual(["€49", "€0.25", "€249", "€1,200", "€0.05"]);
    expect(() => euro(0.5)).toThrow();
  });

  it("says in one lead line that these are pilot prices and that nothing is on sale yet", () => {
    expect(PRICING_LEAD).toBe("Pilot prices. Nothing is on sale yet.");
    // The owner, 12 Nov 15:52: no "design partner" wording on the page.
    expect(pricingPage()).not.toMatch(/design partner/i);
    expect(html).toContain(`<p class="lead">${PRICING_LEAD}</p>`);
    expect((html.match(/<h1\b/g) ?? []).length).toBe(1);
    expect(html).toContain("<h1>Pilot pricing</h1>");
    expect(html).toContain("<title>Pilot pricing</title>");
  });

  it("shows three cards, each price formatted from the module", () => {
    expect([...html.matchAll(/<article class="pc card[^"]*" id="([a-z-]+)">/g)].map((m) => m[1])).toEqual(["starter", "business", "platform-fee"]);
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
    // In sight: the card as before, and one folded line, "How the fee is set" (12 Nov: counted as its summary only).
    const fees = inSight(card(html, "platform-fee"));
    expect(fees).toBe(`Platform fee A small fee per payout Collected through Airwallex connected accounts Already ran in the Airwallex sandbox (10 November) In that run: a ${fee} test fee on a ${payout} test payout. ${TEST_VALUES} The run record ↗ ${FEE_FOLD}`);
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

  it("folds one line into the fee's card: how the fee is set, and how the two runs' fixed test fees fit the percentage", () => {
    // One fold on the page, in the fee's card, closed; its words are feeLine's, and it links the second record.
    expect((html.match(/<details class="fold"/g) ?? []).length).toBe(1);
    expect(html).not.toMatch(/<details[^>]* open/);
    const fold = /<details class="fold"><summary>([^<]+)<\/summary><ul class="pl">([\s\S]*?)<\/ul><\/details>/.exec(card(html, "platform-fee"))!;
    expect(fold[1]).toBe(FEE_FOLD);
    expect(FEE_FOLD).toBe("How the fee is set");
    expect(mainText(`<main>${fold[2]}</main>`)).toBe(`${feeLine()} The end-to-end run record ↗`);
    expect(fold[2]).toContain(`<a class="pf" href="${REPO}${PRICING.platformFee.e2eRecord}" target="_blank" rel="noopener">The end-to-end run record ↗</a>`);
  });

  it("shows no Claude cost per invoice: no eval or run record in the repository holds a measured one (12 Nov)", () => {
    expect(html).not.toMatch(/costs us in Claude calls/i);
    expect(text).not.toMatch(/Claude|USD|\$/);
    // What the records do hold: the end-to-end run counted its Claude calls, not their cost.
    expect(read("docs/runs/2026-11-10-platform-e2e.md")).toMatch(/\| Claude \| \d+ \| \d+ \| [^|]*classify, read and review per invoice/);
  });

  it("shows no number that is not in the pricing module or the run record", () => {
    const run = feeRun(), second = e2eFeeRun();
    const allowed = new Set([euro(PRICING.starter.monthlyCents), euro(PRICING.starter.extraInvoiceCents), euro(PRICING.business.fromMonthlyCents)].map((e) => e.slice(1))
      .concat(String(PRICING.starter.invoicesIncluded), run.day.split(" ")[0]!, run.fee.replace("EUR ", ""), run.payout.replace("EUR ", ""))
      // In the fold: the second run's fee and payout, the code's ceiling and the test policy's rate, as percentages.
      .concat(second.fee.replace("EUR ", ""), second.payout.replace("EUR ", ""), percentOfBps(PRICING.platformFee.capBps).slice(0, -1), percentOfBps(PRICING.platformFee.testPolicyBps).slice(0, -1)));
    expect(numbers(text).filter((n) => !allowed.has(n))).toEqual([]);
    expect(numbers(text).sort()).toEqual([...allowed].sort());
    // And a typed-in price would be caught.
    expect(numbers(`${text} only €19 today`).filter((n) => !allowed.has(n))).toEqual(["19"]);
  });

  it("says what is real in its own words, not the main run's", () => {
    const real = decode((/<details class="real"[\s\S]*?<\/details>/.exec(html)?.[0] ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
    expect(real).toContain("Pilot prices. Nothing is on sale yet.");
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

  // The owner, 12 Nov 15:55: the strongest page of the site, enterprise grade and calm: one header line, a grid of
  // controls each with its proof, and a short honest "Not yet".
  it("has nine controls and a \"Not yet\" box in this order, each one short sentence, a link to its proof and a folded detail", () => {
    expect(cards.map((c) => [c.id, c.title])).toEqual([["s-sign", "Signed terms"], ["s-locks", "Two locks"], ["s-limits", "Limits outside the prompt"], ["s-code", "Agents propose, code enforces"], ["s-secrets", "Secrets"], ["s-tenants", "Each company apart"], ["s-audit", "Audit trail"], ["s-redteam", "Tested by attack"], ["s-data", "Money and data"], ["s-notyet", "Not yet"]]);
    // A grid of three at desktop width, the "Not yet" box across it.
    expect(html).toContain('<div class="cols c3">');
    expect(cards.filter((c) => c.wide).map((c) => c.id)).toEqual(["s-notyet"]);
    // One header line, then the full matrix behind it.
    expect(text).toContain("Each control below, with its proof. Every risk, its control and its test ↗");
    expect(html).toContain(`href="${repoHref("docs/controls-matrix.md")}"`);
    expect([...html.matchAll(/<article class="pc card[^"]*" id="(s-[a-z]+)">/g)].map((m) => m[1])).toEqual(cards.map((c) => c.id));
    for (const c of cards) {
      const el = card(html, c.id), line = mainText(`<main>${/<p>([\s\S]*?)<\/p>/.exec(el)![0]}</main>`);
      // One sentence: it ends with a full stop and has no other sentence end inside it.
      expect({ id: c.id, sentences: line.replace(/\bnpm run verify-log\b/, "the command").split(/[.!?](?:\s|$)/).filter(Boolean).length, ends: /\.$/.test(line) }).toEqual({ id: c.id, sentences: 1, ends: true });
      expect({ id: c.id, words: line.split(" ").length <= (c.id === "s-notyet" ? 30 : 17) }).toEqual({ id: c.id, words: true });
      expect({ id: c.id, links: (/<div class="links">([\s\S]*?)<\/div>/.exec(el)?.[1]?.match(/<a class="pf" href="[^"]+"/g) ?? []).length >= 1 }).toEqual({ id: c.id, links: true });
      expect({ id: c.id, folds: (el.match(/<details class="fold"><summary>[^<]+<\/summary><ul class="pl"><li>/g) ?? []).length, closed: (el.match(/<\/li><\/ul><\/details>/g) ?? []).length === (el.match(/<details\b/g) ?? []).length }).toEqual({ id: c.id, folds: 1, closed: true });
      // One card carries a second fold, with an anchor of its own: "If the approver is unavailable", under the
      // signature (the panel's review, 12 Nov; test/saas-additions.test.ts reads its lines). No other card has one.
      expect({ id: c.id, more: (el.match(/<details class="fold" id="[a-z]+">/g) ?? []) }).toEqual({ id: c.id, more: c.id === "s-sign" ? ['<details class="fold" id="unavailable">'] : [] });
      expect({ id: c.id, folds: (el.match(/<details\b/g) ?? []).length }).toEqual({ id: c.id, folds: c.id === "s-sign" ? 2 : 1 });
    }
    expect(cards.filter((c) => c.more).map((c) => [c.id, c.more!.id, c.more!.summary])).toEqual([["s-sign", "unavailable", "If the approver is unavailable"]]);
    // Nothing is open until the reader opens it.
    expect(html).not.toMatch(/<details[^>]* open/);
    expect((html.match(/<h1\b/g) ?? []).length).toBe(1);
    expect(html).toContain("<h1>Security and trust</h1>");
    expect(text.startsWith("Sandbox and testnet only Security and trust")).toBe(true);
  });

  it("signatures: the exact terms, signed with a passkey, one changed cent refused; the proof is the Try tab", () => {
    // 12 Nov (jury check): the Face ID on chain run linked beside it.
    expect(inSight("s-sign")).toBe("Signed terms The CFO signs the exact terms with a passkey (Face ID); one changed cent is refused. Try it yourself Face ID signs on chain How If the approver is unavailable");
    // Since 12 Nov (the owner) every Try call to action opens the hands-on demo (TRY_URL); /try/sign keeps its own page.
    expect(card(html, "s-sign")).toContain('<a class="pf" href="https://purser-try.max-31b.workers.dev/try" data-next="https://purser-try.max-31b.workers.dev/try">Try it yourself</a>');
    expect(flowLinks(html, true)).toContain('<a class="pf" href="https://purser-try.max-31b.workers.dev/try" data-next="https://purser-try.max-31b.workers.dev/try">Try it yourself</a>');
    expect(flowLinks(html, false)).toContain('<a class="pf" href="https://purser-try.max-31b.workers.dev/try" data-next="https://purser-try.max-31b.workers.dev/try">Try it yourself</a>');
    expect(folded("s-sign")).toContain("signs the hash of the exact terms");
  });

  // 12 Nov (review): "no customer money", not "no funds of its own": in the linked sandbox run Purser's own platform
  // account funded the test company and took the test fee (docs/airwallex-platform.md: "the only place a Purser fee can go").
  it("money and data: only wording the docs support (the company's own Airwallex account; no personal data on chain), test money only, with the claims register's note", () => {
    expect(inSight("s-data")).toBe("Money and data Test money only Each company's money stays in its own Airwallex account, and on chain there is no personal data. The sandbox run ↗ See it on Metal's testnet How");
    const flat = (p: string) => read(p).replace(/\*\*|`/g, "").replace(/\s+/g, " ");
    expect(flat("docs/compliance.md")).toContain("Purser is software the business runs. It holds no customer money");
    expect(flat("docs/airwallex-platform.md")).toContain("Purser's own platform account (awxPlatform.feeAccount), the only place a Purser fee can go");
    expect(text).not.toMatch(/no funds of its own|no funds held/i);
    expect(flat("docs/compliance.md")).toContain("The money sits in the business's own Airwallex account and Metal account. Purser asks those rails to move it");
    expect(flat("docs/airwallex-platform.md")).toContain("The money stays in the company's own Airwallex wallet");
    expect(flat("README.md")).toContain("the control layer between a company's AI agents and its money");
    // The softened wording of the claims register, and the note it asks for with it.
    expect(flat("docs/claims.md")).toContain("\"Purser holds no money\" → \"holds no funds of its own\", noting that the runner keeps the testnet owner key.");
    expect(text).not.toMatch(/holds no money/i);
    expect(folded("s-data")).toContain("“The money sits in the business's own Airwallex account and Metal account. Purser asks those rails to move it”");
    expect(folded("s-data")).toContain("In this build the runner keeps the testnet owner key.");
    expect(folded("s-data")).toContain("on behalf of a test company's own connected account, with test money");
  });

  it("two locks: the CFO's signature in Purser, then Airwallex's own approval; the run records say it ran once, with a test passkey", () => {
    expect(inSight("s-locks")).toBe("Two locks A payout needs the CFO's signature in Purser, then Airwallex's own approval. The sandbox run ↗ How");
    expect(card(html, "s-locks")).toContain(`href="${repoHref("docs/runs/2026-11-12-airwallex-two-locks-paid.md")}"`);
    for (const q of ["a labelled virtual test passkey signed the exact terms in Purser", "Airwallex's own approval workflow held it IN_APPROVAL", "On 12 November the owner approved it at Airwallex and it ended PAID, with simulated settlement."]) expect(folded("s-locks")).toContain(`“${q}”`);
  });

  it("agents propose, code enforces: the models hold no key or tool, code checks what they return; secrets stay with the runner and every push is scanned", () => {
    expect(inSight("s-code")).toBe("Agents propose, code enforces Agents hold no keys; code checks what they propose before anything moves. Least privilege ↗ Hostile-model eval ↗ How");
    // The hostile-model eval (12 Nov): the record's own line, as /claude says it.
    expect(folded("s-code")).toContain(hostileClaimText());
    expect(hostileClaimText()).toMatch(/^In CI, a script in place of the payables agents, on \d+ test invoices: \d+ hostile tool calls, \d+ refused by code, 0 unsafe by the ledger verdict\.$/);
    expect(folded("s-code")).toContain("“Models: no key, URL, credential or tool. They read text and return typed data that code checks");
    expect(inSight("s-secrets")).toBe("Secrets Only the runner holds keys, and every push is scanned for leaked secrets. Trust boundaries ↗ How");
    for (const q of ["Only the runner holds keys and writes the ledger.", "gitleaks on the pushed commits and the whole history of the branch under check", "cloud/src/log.ts cleans every field: anything named like a secret becomes [redacted]"]) expect(folded("s-secrets")).toContain(`“${q}”`);
  });

  // Not "a Durable Object per company": Purser Cloud keeps every company in one database, each row scoped (docs/cloud.md).
  it("each company apart: every row carries its company, and a test tries each route on another company's data", () => {
    expect(inSight("s-tenants")).toBe("Each company apart Every row carries its company, and a test tries each route on another company's data. Purser Cloud ↗ How");
    expect(folded("s-tenants")).toContain("“Every row carries the company (tenant_id); routes only reach data through a tenant-scoped layer (cloud/src/tenant.ts), and a test tries every route against another company's objects.”");
    expect(text).not.toMatch(/Durable Object per company/i);
  });

  it("limits: outside the prompt, per agent, at Airwallex (card controls) and on Metal (a mandate on chain)", () => {
    expect(inSight("s-limits")).toBe("Limits outside the prompt Card controls per agent at Airwallex, and a mandate per agent on Metal's chain. Card controls, read back A refusal on chain How");
    expect(card(html, "s-limits")).toContain('<a class="pf" href="airwallex#controls">Card controls, read back</a><a class="pf" href="metal">A refusal on chain</a>');
    // The anchor exists on /airwallex.
    expect(buildPages().airwallex).toMatch(/id="controls"/);
    expect(folded("s-limits")).toMatch(/Airwallex: The CFO policy's limits[^.]*are written to each agent's card as Airwallex's own controls and read back\./);
    expect(folded("s-limits")).toMatch(/Metal: A mandate per agent: a cap per payment, a total budget, one payee and an end date/);
  });

  it("audit trail: hash-chained, anyone can re-check it, and the command is named; the published log's rows are counted from the file", () => {
    expect(AUDIT_COMMAND).toBe("npm run verify-log");
    expect(inSight("s-audit")).toBe("Audit trail Every step goes into a hash-chained log that anyone can re-check: npm run verify-log . Check the published log ↗ How");
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
    expect(folded("s-data")).toContain("Every card is an Airwallex sandbox test card and every amount is test money.");
    expect(folded("s-data")).toContain("Metal's testnet is public: each agent's mandate and every payment can be seen on its explorer.");
    expect(folded("s-data")).toContain("“Mandate changes anchor the approval on chain (the new credential's hash is bound)”");
    expect(folded("s-data")).toContain("“the customer is simulated and Purser holds no personal data on chain”");
    expect(read(OVERVIEW_DOC).replace(/\s+/g, " ")).toContain("Mandate changes anchor the approval on chain (the new credential's hash is bound)");
    expect(CHAIN_LINES[0]!.doc).toBe(OVERVIEW_DOC);
  });

  // 12 Nov: another branch moves docs/overview.md to docs/archive/overview.md. The page reads whichever exists, links
  // there, and stops the build when neither does.
  it("finds the overview where it is, before or after its move to docs/archive", () => {
    const at = (present: string[]) => (p: string) => present.includes(p);
    expect(existingDoc(["docs/overview.md", "docs/archive/overview.md"], at(["docs/overview.md"]))).toBe("docs/overview.md");
    expect(existingDoc(["docs/overview.md", "docs/archive/overview.md"], at(["docs/archive/overview.md"]))).toBe("docs/archive/overview.md");
    expect(() => existingDoc(["docs/overview.md", "docs/archive/overview.md"], at([]))).toThrow(/none of/);
    expect(["docs/overview.md", "docs/archive/overview.md"]).toContain(OVERVIEW_DOC);
    expect(SECURITY_PAGE).toContain(`${OVERVIEW_DOC}#controls`);
    expect(read("docs/metal-award.md")).toContain("Purser holds no personal data on chain");
  });

  it("tested by attack: the red team's counts are the reports' own, counted again here", () => {
    interface R { attempts: number; blocked: number; inconclusive?: number; not_blocked?: number; caught_after?: number; results: { outcome?: string; caught?: string }[] }
    const sum = (files: string[], pick: (r: R) => number) => files.map((f) => json<R>(f)).reduce((n, r) => n + pick(r), 0);
    // The first report (30 October): every attempt has an outcome, and "caught" says before or after.
    const first = json<R>(REDTEAM_REPORT);
    const after = first.results.filter((r) => r.caught === "after").length, before = first.results.filter((r) => r.outcome === "blocked" && r.caught === "before").length;
    expect([first.attempts, before + after, after]).toEqual([first.results.length, first.blocked, first.caught_after]);
    // 12 Nov (jury check): "not prevented (detected after)", with how the two were detected linked.
    expect(inSight("s-redteam")).toBe(`Tested by attack Test world Red team: ${first.attempts} attacks, ${before} stopped before anything moved, ${after} not prevented (detected after). The report ↗ How the ${after} were detected ↗ Zero-trust report ↗ Later rounds`);
    expect(card(html, "s-redteam")).toContain(`href="${repoHref("docs/zero-trust/report.json")}"`);
    expect(redTeamRound([REDTEAM_REPORT])).toMatchObject({ day: "30 October", attempts: first.attempts, before, after, inconclusive: 0, notBlocked: 0 });
    // 31 October, three runs: counted from each run's results.
    const oct = { attempts: sum(REDTEAM_OCT31, (r) => r.results.length), after: sum(REDTEAM_OCT31, (r) => r.results.filter((x) => x.caught === "after").length), blocked: sum(REDTEAM_OCT31, (r) => r.results.filter((x) => x.outcome === "blocked").length), inconclusive: sum(REDTEAM_OCT31, (r) => r.results.filter((x) => x.outcome === "inconclusive").length) };
    expect(redTeamRound(REDTEAM_OCT31)).toMatchObject({ day: "31 October", attempts: oct.attempts, before: oct.blocked - oct.after, after: oct.after, inconclusive: oct.inconclusive, notBlocked: 0 });
    expect(folded("s-redteam")).toContain(`31 October, three runs in a row: ${oct.attempts} attacks, ${oct.blocked - oct.after} stopped before anything moved, ${oct.after} not prevented (detected after), ${oct.inconclusive} inconclusive.`);
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
    expect(NOT_YET_LINE).toBe("No SOC 2 report, no ISO 27001 audit and no third-party penetration test yet; sandbox and testnet only; the SME product's independent security review is pending.");
    expect(inSight("s-notyet")).toBe(`Not yet ${NOT_YET_LINE} What is not in place ↗ Sources`);
    expect(NOT_YET_SOURCES.map((s) => s.doc)).toEqual(["docs/security.md", "docs/controls.md", "docs/cloud.md"]);
    const flat = (p: string) => read(p).replace(/\*\*|`/g, "").replace(/\s+/g, " ");
    expect(flat("docs/security.md")).toContain("No third-party penetration test has been run");
    expect(flat("docs/controls.md")).toContain("This is not a SOC 2 report: no auditor has tested these controls, and the build runs on the Airwallex sandbox and Metal testnet only.");
    expect(flat("docs/cloud.md")).toContain("What the code does not do yet, and must be in place before a company's real data goes in: 1.");
    expect(flat("docs/cloud.md")).toContain("5. An independent security review of this code after these fixes, and a red-team run against a deployed staging copy.");
    for (const s of NOT_YET_SOURCES) {
      expect({ doc: s.doc, said: flat(s.doc).includes(s.quote) }).toEqual({ doc: s.doc, said: true });
      expect(folded("s-notyet")).toContain(`“${s.quote}” ${s.doc} ↗`);
    }
    // The quote from the SME product's doc says what it is about, in our words, before the doc's own.
    expect(folded("s-notyet")).toContain("The SME product, still to do before real customer data: “An independent security review of this code");
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
      .concat(first.day.split(" ")[0]!, oct.day.split(" ")[0]!, night.day.split(" ")[0]!, audit.day.split(" ")[0]!)
      // And the hostile-model eval's figures, from its own record.
      .concat(((r) => [r.cases.length, r.calls, r.refused, r.unsafe].map(String))(json<{ cases: unknown[]; calls: number; refused: number; unsafe: number }>("docs/evals/ap-hostile.json")))
      // And the day the two-locks run's record names, from its own heading.
      .concat(/^# [^\n]*\((\d{1,2}) [A-Z][a-z]+ \d{4}\)/.exec(read("docs/runs/2026-11-12-airwallex-two-locks-paid.md"))![1]!));
    // Names that carry a digit are not figures: "SOC 2", "SHA-256", and the files the folds name.
    const figures = (t: string) => numbers(t.replace(/SOC 2|SHA-256|ISO 27001/g, " ").replace(/(?:src|test|docs)\/[\w/.-]+/g, " "));
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
    expect((buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv) as Pages).security).toContain('href="https://purser-try.max-31b.workers.dev/try" data-next="https://purser-try.max-31b.workers.dev/try"');
    expect(CHECK_PATHS).toEqual(expect.arrayContaining(["/pricing", "/security"]));
    // 12 Nov (review): the README said "18 pages" while the list grew; it now names the list, which no count can outdate.
    const check = read("README.md").split("\n").find((l) => l.startsWith("- `npm run judge -- --check`")) ?? "";
    expect(check).toContain("builds every page in `CHECK_PATHS` (src/cli/judge.ts) from the main run's committed record");
    expect(check).not.toMatch(/\b\d+ pages\b/);
    expect(read("src/cli/judge.ts")).toContain("for (const path of CHECK_PATHS) {");
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

  // 12 Nov (orchestrator's preview): the marked item follows the page. A page listed under More marks More and its own
  // link there, never a tab; /runs marks Proof. One mapping in the nav code (src/ui/more.ts menuItemOf).
  it("mark the item the page sits under: partner pages mark More, /runs marks Proof", () => {
    const state = (html: string) => {
      const nav = /<nav class="tabs" aria-label="Main">([\s\S]*?)<\/nav>/.exec(html)![1]!;
      return { more: /<summary class="on">More<\/summary>/.test(nav), tabs: [...nav.matchAll(/<a href="(\w+)" class="on" aria-current="page">/g)].map((m) => m[1]) };
    };
    for (const [key, html] of [["airwallex", AIRWALLEX_PAGE], ["metal", METAL_PAGE], ["visa", VISA_PAGE], ["claude", CLAUDE_PAGE]] as const) {
      expect({ key, ...state(html), here: html.includes(`<a href="${key}" aria-current="page">`) }).toEqual({ key, more: true, tabs: [], here: true });
    }
    expect(state(RUNS_PAGE)).toEqual({ more: false, tabs: ["proof"] });
    expect(state(PROOF_PAGE)).toEqual({ more: false, tabs: ["proof"] });
    expect(state(pages.home!)).toEqual({ more: false, tabs: ["home"] });
    // The older navigation (src/ui/nav.ts) maps the same way.
    for (const key of ["airwallex", "metal", "visa", "claude"] as const) {
      const nav = navHtml(key);
      expect({ key, proof: /data-nav="proof" class="on"/.test(nav), more: /<summary class="on">More<\/summary>/.test(nav) }).toEqual({ key, proof: false, more: true });
    }
    expect(navHtml("month")).toMatch(/data-nav="proof" class="on"/);
    expect(menuItemOf("runs")).toBe("proof");
    expect(menuItemOf("pricing")).toBe("more");
    expect(menuItemOf("proof")).toBe("proof");
    expect(menuItemOf(null)).toBeNull();
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
    expect(lines.filter((l) => / https:\/\/kit11\.max-31b\.workers\.dev\/pricing( |$)/.test(l))).toEqual(["- Pricing: https://kit11.max-31b.workers.dev/pricing (pilot prices; nothing is on sale yet)"]);
    expect(lines.filter((l) => / https:\/\/kit11\.max-31b\.workers\.dev\/security( |$)/.test(l))).toEqual(["- Security and trust: https://kit11.max-31b.workers.dev/security (each control with its proof, and what is not in place yet; sandbox and testnet only)"]);
  });
});
