// The pitch round (5 Nov) and Max's review round (5 Nov): the pitch, the Q&A, the Demo Day runbook, the cheat sheet,
// the deck, the form and the README say the main run's figures as its record has them (docs/demo/main-run.json,
// counted by src/redesign/run.ts), say the core line and Max's lines word for word (the rule, the stops, the refusal,
// the T:0 sentence, the passkey), keep each spoken sentence short and the 3-minute pitch near 280 words. The QR code in
// docs/media/ opens /try/sign. Breaks when a figure, a line or the QR code drifts.
import { existsSync, readFileSync } from "node:fs";
import { PNG } from "pngjs";
import jsQRModule from "jsqr";
import { describe, expect, it } from "vitest";
import { DIFFERENTIATORS } from "../src/config/brand.js";
import { faceIdDecisions, loadRecord, payments, split, stopStory, stopsLine, timings } from "../src/redesign/run.js";
import { CORE_LINE, METAL_LINE, QR_URL, REFUSAL_LINE, RULE_LINE, T0_SHORT, T0_STATUS, deckHtml, type DeckShots } from "../src/submission/deck.js";
import { packFacts } from "../src/submission/facts.js";
import { QR_PNG, qrPng } from "../src/submission/qr.js";
import { TRY_SIGN_URL } from "../src/film/premiere.js";

// jsqr ships CommonJS with an ES default export in its types: take the function either way.
const jsQR = ((jsQRModule as unknown as { default?: typeof jsQRModule }).default ?? jsQRModule) as unknown as typeof import("jsqr").default;
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const { record } = loadRecord();
const RAW = read("docs/demo/main-run.json");
/** Words as read: comments, tags, Markdown emphasis and code marks gone, entities decoded, white space single. */
const words = (s: string) => s.replace(/<!--[\s\S]*?-->/g, "").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/[*`\\_]/g, "").replace(/\s+/g, " ");
const shots = new Proxy({}, { get: () => "" }) as DeckShots;
const DECK = deckHtml(packFacts(), shots, "<svg></svg>");

const SOURCES: Record<string, string> = {
  pitch: read("docs/submission/pitch.md"),
  qa: read("docs/submission/qa.md"),
  "demo-day": read("docs/submission/demo-day.md"),
  spiekkaart: read("docs/internal/spiekkaart-demo.html"),
  deck: DECK,
  form: read("docs/submission/README.md"),
  // The long form text the short Description replaced (5 Nov), linked from it: its figures are checked as before.
  "form (long)": read("docs/submission/long-description.md"),
  README: read("README.md"),
};
const TEXT = Object.fromEntries(Object.entries(SOURCES).map(([k, v]) => [k, words(v)]));

/** The pitch's spoken sentences: one per table row, the sentence in the cell before the source. */
function pitchRows(): { sentence: string; source: string }[] {
  return SOURCES.pitch!.split("\n").filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l)).map((l) => l.split("|").slice(1, -1).map((c) => c.trim()))
    .filter((c) => c.length >= 2 && !["Max says", "Source"].includes(c[c.length - 2]!))
    .map((c) => ({ sentence: words(c[c.length - 2]!).trim(), source: c[c.length - 1]! }));
}

const st = stopStory(record), t = timings(record), sp = split(record), pay = payments(record);
/** The spoken rows of one version: 1 (30 s), 2 (3 min), 3 (5 min). */
function section(n: 1 | 2 | 3): { sentence: string; source: string }[] {
  const all = SOURCES.pitch!, heads = ["## 1. ", "## 2. ", "## 3. ", "## Lines Max never says"];
  const body = all.slice(all.indexOf(heads[n - 1]!), all.indexOf(heads[n]!));
  return body.split("\n").filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l)).map((l) => l.split("|").slice(1, -1).map((c) => c.trim()))
    .filter((c) => c.length >= 2 && !["Max says", "Source"].includes(c[c.length - 2]!)).map((c) => ({ sentence: words(c[c.length - 2]!).trim(), source: c[c.length - 1]! }));
}

describe("the pitch's sentences", () => {
  const rows = pitchRows();

  it("are all there: the 30-second, the 3-minute and the 5-minute version", () => {
    for (const h of ["## 1. The elevator pitch (30 seconds)", "## 2. The demo pitch (3 minutes, with the live demo)", "## 3. The full pitch (5 minutes, when there is time)"]) expect(SOURCES.pitch).toContain(h);
    expect(rows.length).toBeGreaterThan(60);
  });

  it("are at most 14 words each, the core line and the stops' one sentence the only exceptions, and each names its source", () => {
    const long = rows.filter((x) => x.sentence !== CORE_LINE && x.sentence !== stopsLine(st) && x.sentence.split(/\s+/).length > 14).map((x) => x.sentence);
    expect(long).toEqual([]);
    expect(rows.filter((x) => !x.source || /^[—-]$/.test(x.source)).map((x) => x.sentence)).toEqual([]);
  });

  it("use only numbers the record holds (or counts), the dates and the URL aside", () => {
    const allowed = new Set([...(RAW.match(/\d+(?:\.\d+)?/g) ?? []), ...Object.values({ a: sp.decisions, b: st.total, b1: st.claude, b2: st.metal, b3: st.cfo, b4: st.planted, c: t.faceToPaid, d: t.toOptions, e: faceIdDecisions(record), f: pay.onChain, g: packFacts().main.claude_usd }).map(String),
      // 2025: the year of the agent-payment protocols (docs/claims.md); 6: also the mandate transactions (README, Metal).
      "2025"]);
    const unknown = rows.flatMap((x) => (x.sentence.replace(/\S*workers\.dev\S*/g, " ").replace(/\/try\/sign|\/watch|\/proof/g, " ").match(/\d+(?:\.\d+)?/g) ?? []).filter((n) => !allowed.has(n)));
    expect(unknown).toEqual([]);
  });

  it("say the core line word for word once, just before the tamper, and end the 3 minutes on \"One cent. Worthless.\"", () => {
    expect(rows.filter((x) => x.sentence === CORE_LINE)).toHaveLength(1);
    expect(CORE_LINE).toBe("Claude explains and proposes, the rules in code hold every limit, and a person signs before money moves beyond them.");
    const three = section(2);
    expect(three.at(-1)!.sentence).toBe("One cent. Worthless.");
    expect(three.findIndex((x) => x.sentence === CORE_LINE)).toBeGreaterThan(three.findIndex((x) => /scan this/.test(x.sentence)));
    expect(three.findIndex((x) => x.sentence === CORE_LINE)).toBeLessThan(three.findIndex((x) => /one cent\.$/.test(x.sentence)));
  });

  it("keep the 3 minutes near 280 words, say what Purser does by 0:40, and keep the disclaimers out of the beats (Max, 5 Nov)", () => {
    const three = section(2), said = three.map((x) => x.sentence);
    expect(said.join(" ").split(/\s+/).length).toBeLessThanOrEqual(290);
    const run = said.findIndex((x) => /replay of our main run/.test(x)), plainly = said.findIndex((x) => /^Said plainly/.test(x));
    expect(said.indexOf(RULE_LINE)).toBeGreaterThan(-1);
    expect(said.indexOf(RULE_LINE)).toBeLessThan(run);
    expect(said).toContain("Picture a small company that sells live stock data, per query.");
    expect(said).toContain("In this demo, I play the CFO.");
    expect(said.join(" ")).not.toMatch(/20 test dollars|Refund the other 9\?/);
    // The beats name no test passkey and no simulation; "Said plainly" names both, once, after them.
    expect(said.slice(run, plainly).join(" ")).not.toMatch(/test passkey|simulat/i);
    expect(said[plainly]).toMatch(/test passkey.*simulates settlement/);
    expect(said).toContain(REFUSAL_LINE);
  });

  it("say Treasury's two options, one line each, as the proposals' own terms have them (criterion 3)", () => {
    const terms = (o: string) => record.ledger!.proposals.find((p) => p.kind === "mandate_replace" && p.terms?.option === o)!.terms as { query_price: string; total_budget: string; steps: { agent: string; cap: string }[] };
    const [a, b] = [terms("A"), terms("B")];
    const cap = (x: typeof a) => x.steps.find((y) => y.agent === "sourcing")!.cap;
    expect([cap(a), a.query_price, cap(b), b.query_price, a.total_budget, b.total_budget]).toEqual(["0.04", "0.05", "0.04", "0.07", "20.00", "20.00"]);
    const said = section(2).map((x) => x.sentence);
    expect(said).toContain(`Option A: cap ${cap(a)}, and our price stays ${a.query_price}.`);
    expect(said).toContain(`Option B: the same cap, our price up to ${b.query_price}.`);
    expect(said).toContain(`Treasury proposes two options within the same ${a.total_budget}.`);
    expect(TEXT.deck).toContain(`A: Sourcing's cap ${cap(a)}, our price stays ${a.query_price} · B: the same cap, our price ${b.query_price}.`);
  });

  it("claim no status, no absolute safety, and never the old line", () => {
    const said = rows.map((x) => x.sentence).join(" ");
    expect(said).not.toMatch(/shortlist|finalist|\bsafe\b|guarantee|bank-grade|unhackable|code decides/i);
  });
});

describe("the core line", () => {
  it("is word for word in the pitch, the runbook, the cheat sheet and the deck; the README and the form open with the three sentences instead (jury review, 6 Nov)", () => {
    for (const name of ["pitch", "demo-day", "spiekkaart", "deck"]) expect({ name, has: TEXT[name]!.includes(CORE_LINE) }).toEqual({ name, has: true });
    const top = words(SOURCES.README!.split("\n").slice(0, 5).join("\n").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"));
    for (const d of DIFFERENTIATORS) expect(top).toContain(d);
    expect(SOURCES.README!.split("\n").slice(0, 5).join("\n")).toContain("https://kit11.max-31b.workers.dev/try/sign");
  });
});

describe("one set of figures, the main run's record (3 November)", () => {
  const all = (re: RegExp, name: string) => [...TEXT[name]!.matchAll(re)];

  it("the record still holds what the pitch is built on: 16 stops (Claude 12, Metal 2, CFO 1, 1 planted), 24/24 by Claude, 6 s, 5 Face ID, 40 s", () => {
    expect([st.total, st.claude, st.metal, st.cfo, st.planted, st.overLimitEur, sp.byClaude, sp.decisions, t.faceToPaid, faceIdDecisions(record), t.toOptions]).toEqual([16, 12, 2, 1, 1, "0.00", 24, 24, 6, 5, 40]);
  });

  it("says the stops in one sentence, with the record's counts, and never the old \"1 + 1\" (Max, 5 Nov)", () => {
    const line = stopsLine(st);
    expect(line).toBe("16 stops, nothing paid over a limit: a buy rule Claude set stopped 12 overpriced checks, Metal refused 2 purchases, the CFO rejected 1 proposal, and 1 planted instruction changed nothing.");
    for (const name of Object.keys(TEXT)) {
      expect({ name, figure: /\d+ stopped at a limit|over its cap; the CFO rejected|\b1 \+ 1\b/i.test(TEXT[name]!) }).toEqual({ name, figure: false });
      for (const m of all(/(\d+) stops, nothing paid over a limit: a buy rule Claude set stopped (\d+) overpriced checks?, Metal refused (\d+) purchases? on chain, the CFO rejected (\d+) proposals?, and (\d+) planted/g, name)) expect({ name, parts: m.slice(1).map(Number) }).toEqual({ name, parts: [st.total, st.claude, st.metal, st.cfo, st.planted] });
      if (["pitch", "deck", "spiekkaart", "form", "form (long)", "README"].includes(name)) expect({ name, said: TEXT[name]!.includes(line.slice(0, -1)) }).toEqual({ name, said: true });
    }
  });

  it("says Metal's refusal one way, and the passkey as Max's (Max, 5 Nov)", () => {
    for (const name of ["pitch", "qa", "deck", "spiekkaart"]) expect({ name, has: TEXT[name]!.includes(REFUSAL_LINE) }).toEqual({ name, has: true });
    for (const name of ["form", "form (long)", "README"]) expect({ name, has: /the refusal is recorded on chain/i.test(TEXT[name]!) }).toEqual({ name, has: true });
    for (const name of ["deck", "spiekkaart", "form", "form (long)", "README"]) expect({ name, has: TEXT[name]!.includes("Max's passkey (Face ID on his phone)") }).toEqual({ name, has: true });
    // The form's short Description (Max, 5 Nov): Metal's tx "on chain, checkable", Airwallex's ids "published".
    expect(TEXT.form).toContain("Metal tx: on chain, checkable. Airwallex ids: published on /proof.");
    for (const name of ["pitch", "deck", "spiekkaart", "form", "form (long)", "README", "qa"]) expect({ name, plays: /(Max|I)(, the builder,)? plays? the CFO/.test(TEXT[name]!) }).toEqual({ name, plays: true });
    // "published" for the ids (Airwallex's cannot be looked up by a juror); Metal's are on chain, checkable.
    for (const name of ["pitch", "qa", "deck", "spiekkaart"]) expect({ name, public: /\bids? (?:is|are) public\b/i.test(TEXT[name]!) }).toEqual({ name, public: false });
    expect(TEXT.deck).toContain("Every id is published");
    expect(TEXT.deck).toContain("On chain, checkable:");
  });

  it("says the decisions by Claude as the record counts them", () => {
    for (const name of Object.keys(TEXT)) for (const m of all(/(\d+)(?: of |\/)(\d+) decisions/g, name)) expect({ name, said: [Number(m[1]), Number(m[2])] }).toEqual({ name, said: [sp.byClaude, sp.decisions] });
    for (const name of ["pitch", "deck", "spiekkaart"]) expect({ name, said: all(/(\d+)(?: of |\/)(\d+) decisions/g, name).length > 0 }).toEqual({ name, said: true });
  });

  it("says the seconds from Face ID to PAID as measured, and says the settlement is simulated wherever it says them", () => {
    for (const name of Object.keys(TEXT)) {
      const got = all(/(\d+) (?:s|seconds) (?:from Face ID to PAID|after (?:my |the CFO's )?Face ID)/g, name).map((m) => Number(m[1]));
      expect({ name, wrong: got.filter((n) => n !== t.faceToPaid) }).toEqual({ name, wrong: [] });
      if (got.length) expect({ name, simulated: /simulat/i.test(TEXT[name]!) }).toEqual({ name, simulated: true });
    }
    for (const name of ["pitch", "deck", "spiekkaart", "demo-day"]) expect({ name, said: all(/(\d+) (?:s|seconds) (?:from Face ID to PAID|after (?:my |the CFO's )?Face ID)/g, name).length > 0 }).toEqual({ name, said: true });
  });

  it("says the Face ID decisions as the record counts them", () => {
    for (const name of Object.keys(TEXT)) for (const m of all(/(\d+) Face ID decisions|signed (\d+) times with Face ID|(\d+) decisions signed with Face ID/g, name)) expect({ name, n: Number(m[1] ?? m[2] ?? m[3]) }).toEqual({ name, n: faceIdDecisions(record) });
    for (const name of ["deck", "spiekkaart"]) expect({ name, said: all(/(\d+) Face ID decisions|(\d+) decisions signed with Face ID/g, name).length > 0 }).toEqual({ name, said: true });
  });

  it("says the options' 40 s, the dispute's 12 and 9, and the euros as the record has them", () => {
    for (const name of ["pitch", "deck"]) for (const m of all(/(\d+) (?:s|seconds) later/g, name)) expect({ name, n: Number(m[1]) }).toEqual({ name, n: t.toOptions });
    const m = packFacts().main;
    for (const name of Object.keys(TEXT)) {
      for (const d of all(/disputes (\d+) orders/g, name)) expect({ name, n: Number(d[1]) }).toEqual({ name, n: m.disputed });
      for (const d of all(/[Rr]efund the other (\d+)/g, name)) expect({ name, n: Number(d[1]) }).toEqual({ name, n: m.disputed - m.refunded.length });
    }
    expect(TEXT.pitch).toContain("110 euros");
    expect(m.fx_buy).toBe("EUR 110.00");
    expect(TEXT.pitch).toContain("240 euro licence");
    expect(TEXT.pitch).toContain(`USD ${m.claude_usd}`);
  });
});

describe("T:0 in one sentence, Metal counted (Max, 5 Nov)", () => {
  const flat = (p: string) => words(read(p)).replace(/, \[record\]\([^)]*\)/g, "");

  it("says the T:0 sentence word for word in the README, the form, the claims, docs/t0.md, the run logs and the Q&A", () => {
    expect(T0_STATUS).toBe("T:0 bookkeeping is built; posting failed (shared key 403 CAPI71 on 3 Nov, new key 401 CAPI11 on 5 Nov), so nothing is posted.");
    // Not in the form's short Description since 6 Nov (jury review, #7: no error codes there); the long text keeps it.
    expect(words(read("docs/submission/README.md").split("<!-- description -->")[1]!.split("<!-- /description -->")[0]!)).not.toContain("CAPI");
    for (const p of ["README.md", "docs/submission/long-description.md", "docs/claims.md", "docs/t0.md", "docs/runs/2026-11-05-t0-live.md", "docs/runs/2026-11-03-t0-sandbox.md", "docs/submission/qa.md", "docs/internal/spiekkaart-demo.html"]) expect({ p, has: flat(p).includes(T0_STATUS) }).toEqual({ p, has: true });
    // The codes as the run logs have them.
    expect(read("docs/runs/2026-11-03-t0-sandbox.md")).toMatch(/refused the first POST with `403 CAPI71`/);
    expect(read("docs/runs/2026-11-05-t0-live.md")).toMatch(/on 5 November[\s\S]*?`401 CAPI11`/i);
    for (const name of Object.keys(TEXT)) expect({ name, old: /95 entries are ready/.test(TEXT[name]!) }).toEqual({ name, old: false });
  });

  it("every marked T:0 block says nothing is posted; none says it is live", () => {
    for (const name of ["pitch", "qa", "deck", "spiekkaart"]) {
      const blocks = [...SOURCES[name]!.matchAll(/<!-- T0-STATUS -->([\s\S]*?)<!-- \/T0-STATUS -->/g)].map((b) => words(b[1]!));
      expect({ name, blocks: blocks.length > 0 }).toEqual({ name, blocks: true });
      for (const b of blocks) {
        expect({ name, b, honest: /nothing (?:is )?posted/i.test(b) }).toEqual({ name, b, honest: true });
        expect({ name, b, claim: /T:0 is live|posted to T:0|live on T:0/i.test(b) }).toEqual({ name, b, claim: false });
      }
    }
    expect(TEXT.deck).toContain(T0_SHORT);
  });

  it("every marked Metal block counts the run's own payments on chain: 86 (41 + 41 + 3 + 1), no clearing", () => {
    expect([pay.onChain, pay.sales, pay.purchases, pay.refunds, pay.sweeps]).toEqual([86, 41, 41, 3, 1]);
    expect((record.ledger?.events ?? []).filter((e) => e.event === "mandate.replaced")).toHaveLength(2);
    // The README's line, checked against the chain on 5 November, says the same.
    expect(words(read("README.md"))).toContain("86 test-USD payments, each its own transaction (41 sales, 41 supplier purchases, 3 refunds, 1 sweep)");
    expect(METAL_LINE).toBe(`Metal testnet: ${pay.onChain} payments and 6 mandate transactions, on chain, checkable; no clearing in this run.`);
    for (const name of ["pitch", "qa", "deck", "spiekkaart"]) {
      const blocks = [...SOURCES[name]!.matchAll(/<!-- METAL-ONCHAIN -->([\s\S]*?)<!-- \/METAL-ONCHAIN -->/g)].map((b) => words(b[1]!));
      expect({ name, blocks: blocks.length > 0 }).toEqual({ name, blocks: true });
      for (const b of blocks) {
        expect({ name, n: Number(/(\d+) (?:test-USD )?payments/.exec(b)?.[1]) }).toEqual({ name, n: pay.onChain });
        expect({ name, checkable: /on chain,? (?:and )?checkable/.test(b) }).toEqual({ name, checkable: true });
        const parts = /\((\d+) sales, (\d+) supplier purchases, (\d+) refunds, (\d+) sweep\)/.exec(b);
        if (parts) expect(parts.slice(1).map(Number)).toEqual([pay.sales, pay.purchases, pay.refunds, pay.sweeps]);
        if (name !== "pitch") expect({ name, clearing: /no clearing/i.test(b) }).toEqual({ name, clearing: true });
      }
    }
  });
});

describe("the Q&A, in Max's words (5 Nov)", () => {
  it("answers the lying agent and the compromised server with Max's sentences, and adds his three questions", () => {
    const q = TEXT.qa!;
    expect(q).toContain("Inside its limits a lying agent can spend at most its cap and budget; beyond them, nothing moves without a signature.");
    expect(q).toContain("The rails refuse anything over their current limits; changing a limit needs a signed proposal.");
    expect(q).not.toMatch(/adds rows, not risk|whatever our server asks/);
    for (const h of ["Isn't letting one purchase through staged?", "Worst-case loss per day inside the limits, and how fast does the CFO know?", "Why not Airwallex's own spend controls and approvals?"]) expect(q).toContain(h);
  });

  it("gives the worst case inside the limits from the code's own budgets and card limits", async () => {
    const { TOTAL_BUDGET_CENTS, INITIAL_MANDATES, CARDS, VELOCITY } = await import("../src/config/policy.js");
    const usd = (c: number) => (c / 100).toFixed(2);
    const budgets = Object.values(INITIAL_MANDATES).map((m) => m.budgetCents), monthly = Object.values(CARDS).map((c) => c.monthlyCents);
    expect(budgets.reduce((a, b) => a + b, 0)).toBe(TOTAL_BUDGET_CENTS);
    expect(TEXT.qa).toContain(`At most ${usd(TOTAL_BUDGET_CENTS)} test USD on Metal (the three mandates' budgets, ${budgets.map(usd).join(" + ")}`);
    expect(TEXT.qa).toContain(`EUR ${usd(monthly.reduce((a, b) => a + b, 0))} on the cards (monthly limits ${monthly.map(usd).join(" + ")})`);
    expect(TEXT.qa).toContain(`Sourcing: ${VELOCITY.sourcing.perMinute} payments a minute, ${usd(VELOCITY.sourcing.usdzPerHourCents)} test USD or EUR ${usd(VELOCITY.sourcing.eurPerHourCents)} an hour`);
    expect(TEXT.qa).toContain("there is no daily ceiling");
  });
});

describe("the deck", () => {
  it("has at most ten slides, dark, with the QR slide's short URL under the code, and no Visa logo", () => {
    const n = (DECK.match(/<section/g) ?? []).length;
    expect(n).toBeLessThanOrEqual(10);
    expect(DECK).toMatch(/html, body \{ background: #0b1020; \}/);
    expect(DECK).toMatch(/<div class="qr"><svg><\/svg><\/div><div><p class="url">kit11\.max-31b\.workers\.dev\/try\/sign<\/p>/);
    expect(DECK).not.toMatch(/<img[^>]*(visa|Visa)/);
    for (const title of ["Purser", "AI agents can now spend money. So who signs off?", "Each agent its own card and its own mandate", "One live run, three beats", "Sign one yourself", "Every id is published", "What is real, and what is not", "From test rails to production"]) expect(DECK).toContain(`<h1>${title}</h1>`);
  });

  it("follows Max's review (5 Nov): no logos, not opening with the awards, the rule on slide 2, the QR again on slide 10, no TAP run", () => {
    const slides = DECK.split("<section").slice(1);
    expect(DECK).not.toMatch(/<img[^>]*logos|data:image\/svg\+xml/);
    expect(TEXT.deck).toContain("Built on Airwallex and Metal, with Claude.");
    expect(slides[0]).not.toMatch(/Metal Award|Visa Award/);
    expect(words(slides[1]!)).toContain(RULE_LINE);
    expect(slides[3]).toContain("Only the 3 bad ones refunded");
    expect(slides[9]).toMatch(/<div class="qr small-qr"><svg><\/svg><\/div>/);
    expect(slides[9]).toMatch(/<p class="oneline">Visa TAP: built and verified against Visa's public reference verifier; not eligible Visa tooling for this hackathon \(Visa, 5 Nov\), so Purser is entered for the Metal Award only\.<\/p>/);
    expect(DECK).not.toMatch(/entered for[^.<]{0,40}Visa Award|\+ Visa Award|still being confirmed with Visa/i);
    expect(DECK).not.toMatch(/TAP run|LIMIT_EXCEEDED/);
    expect(slides[7]).toMatch(/86 Metal payments \+ 1 card charge; \$0\.0132 = Claude's cost per decision/);
  });

  it("names the second approver and the sandbox's SWIFT steps as they were", () => {
    expect(TEXT.deck).toContain("The second approver was a labelled test passkey, pressed by Claude Code on Max's go.");
    expect(TEXT.deck).toContain("SWIFT SENT and PAID are moved by Purser through the sandbox's simulation API.");
    expect(TEXT.deck).toContain("Built, not yet live: the Cardputer hub.");
  });
});

describe("the QR code to /try/sign", () => {
  it("is the film's address", () => {
    expect(QR_URL).toBe("https://kit11.max-31b.workers.dev/try/sign");
    expect(QR_URL).toBe(TRY_SIGN_URL);
  });

  it("decodes from docs/media/try-sign-qr.png to that address, and is the PNG the code makes", async () => {
    const buf = readFileSync(new URL(`../${QR_PNG}`, import.meta.url));
    const png = PNG.sync.read(buf);
    const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    expect(code?.data).toBe(QR_URL);
    expect(Buffer.compare(buf, await qrPng())).toBe(0);
  });
});

describe("the hook (Max, 5 November): \"So who signs off?\"", () => {
  it("says the same hook everywhere, and nowhere the old pen", () => {
    const film = ["src/film/premiere.ts", "src/film/premiere.html", "src/film/premiereScript.ts", "src/film/film.html", "src/film/script.ts", "docs/video/narrator-script.md", "docs/video/script.md", "docs/video/subtitles-v5.srt"].map(read).join("\n");
    for (const [name, text] of [...Object.entries(SOURCES), ["film", film], ["live", read("src/live/timeline.ts")]] as const) {
      expect({ name, pen: /holds? the pen|keeps the pen/i.test(text) }).toEqual({ name, pen: false });
    }
    expect(TEXT.deck).toContain("AI agents can now spend money. So who signs off?");
    expect(TEXT.pitch).toContain("So who signs off?");
    expect(read("docs/video/narrator-script.md")).toContain("AI agents can now spend money. … So who signs off?");
  });
});

describe("the cheat sheet", () => {
  it("is one A4 page, printed from its HTML", () => {
    const pdf = new URL("../docs/internal/spiekkaart-demo.pdf", import.meta.url);
    expect(existsSync(pdf)).toBe(true);
    expect((readFileSync(pdf).toString("latin1").match(/\/Type\s*\/Page(?!s)/g) ?? []).length).toBe(1);
  });

  it("has the opening and the close word for word, the three figures and the URLs", () => {
    const s = TEXT.spiekkaart!;
    expect(s).toContain("AI agents can now spend money. So who signs off? I'm Max Geurtsen, and this is Purser.");
    expect(s).toContain(`${CORE_LINE} On mine, signed before, I change the amount by one cent. The same signature is refused. One cent. Worthless.`);
    expect(s).toContain(`${RULE_LINE} In this demo, I play the CFO.`);
    expect(s).toContain(stopsLine(st));
    expect(s).toContain("6 seconds from Face ID to PAID");
    expect(s).toContain("5 Face ID decisions");
    for (const u of ["kit11.max-31b.workers.dev/try/sign", "kit11.max-31b.workers.dev/watch", "kit11.max-31b.workers.dev/proof", "npm run judge"]) expect(s).toContain(u);
  });
});
