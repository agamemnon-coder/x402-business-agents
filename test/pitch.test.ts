// The pitch round (5 Nov): the pitch, the Q&A, the Demo Day runbook, the cheat sheet, the deck, the form and the README
// say the main run's figures as its record has them (docs/demo/main-run.json, counted by src/redesign/run.ts), say
// the core line word for word, keep each spoken sentence short, and say T:0 and Metal in the README's words. The QR
// code in docs/media/ opens /try/sign. Breaks when a figure, the line or the QR code drifts.
import { existsSync, readFileSync } from "node:fs";
import { PNG } from "pngjs";
import jsQRModule from "jsqr";
import { describe, expect, it } from "vitest";
import { faceIdDecisions, loadRecord, payments, split, stoppedAtLimit, stops, timings } from "../src/redesign/run.js";
import { CORE_LINE, METAL_ONCHAIN, NOT_ON_METAL, QR_URL, T0_STATUS, deckHtml, type DeckShots } from "../src/submission/deck.js";
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
  README: read("README.md"),
};
const TEXT = Object.fromEntries(Object.entries(SOURCES).map(([k, v]) => [k, words(v)]));

/** The pitch's spoken sentences: one per table row, the sentence in the cell before the source. */
function pitchRows(): { sentence: string; source: string }[] {
  return SOURCES.pitch!.split("\n").filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l)).map((l) => l.split("|").slice(1, -1).map((c) => c.trim()))
    .filter((c) => c.length >= 2 && !["Max says", "Source"].includes(c[c.length - 2]!))
    .map((c) => ({ sentence: words(c[c.length - 2]!).trim(), source: c[c.length - 1]! }));
}

const st = stops(record), t = timings(record), sp = split(record), pay = payments(record);

describe("the pitch's sentences", () => {
  const rows = pitchRows();

  it("are all there: the 30-second, the 3-minute and the 5-minute version", () => {
    for (const h of ["## 1. The elevator pitch (30 seconds)", "## 2. The demo pitch (3 minutes, with the live demo)", "## 3. The full pitch (5 minutes, when there is time)"]) expect(SOURCES.pitch).toContain(h);
    expect(rows.length).toBeGreaterThan(60);
  });

  it("are at most 14 words each, the core line the only exception, and each names its source", () => {
    const long = rows.filter((x) => x.sentence !== CORE_LINE && x.sentence.split(/\s+/).length > 14).map((x) => x.sentence);
    expect(long).toEqual([]);
    expect(rows.filter((x) => !x.source || /^[—-]$/.test(x.source)).map((x) => x.sentence)).toEqual([]);
  });

  it("use only numbers the record holds (or counts), the dates and the URL aside", () => {
    const allowed = new Set([...(RAW.match(/\d+(?:\.\d+)?/g) ?? []), ...Object.values({ a: sp.decisions, b: stoppedAtLimit(st), c: t.faceToPaid, d: t.toOptions, e: faceIdDecisions(record), f: pay.onChain, g: packFacts().main.claude_usd }).map(String),
      // 2025: the year of the agent-payment protocols (docs/claims.md); 6: also the mandate transactions (README, Metal).
      "2025"]);
    const unknown = rows.flatMap((x) => (x.sentence.replace(/\S*workers\.dev\S*/g, " ").replace(/\/try\/sign|\/watch|\/proof/g, " ").match(/\d+(?:\.\d+)?/g) ?? []).filter((n) => !allowed.has(n)));
    expect(unknown).toEqual([]);
  });

  it("end on the core line, word for word, in the 3- and 5-minute versions", () => {
    expect(rows.filter((x) => x.sentence === CORE_LINE)).toHaveLength(1);
    expect(CORE_LINE).toBe("Claude explains and proposes, the rules in code hold every limit, and a person signs before money moves beyond them.");
    expect(SOURCES.pitch!.indexOf(CORE_LINE)).toBeGreaterThan(SOURCES.pitch!.indexOf("**2:50 Close**"));
  });

  it("claim no status, no absolute safety, and never the old line", () => {
    const said = rows.map((x) => x.sentence).join(" ");
    expect(said).not.toMatch(/shortlist|finalist|\bsafe\b|guarantee|bank-grade|unhackable|code decides/i);
  });
});

describe("the core line", () => {
  it("is word for word in the pitch, the runbook, the cheat sheet, the deck, the form and the README's first lines", () => {
    for (const name of ["pitch", "demo-day", "spiekkaart", "deck", "form"]) expect({ name, has: TEXT[name]!.includes(CORE_LINE) }).toEqual({ name, has: true });
    expect(words(SOURCES.README!.split("\n").slice(0, 5).join("\n"))).toContain(CORE_LINE);
    expect(SOURCES.README!.split("\n").slice(0, 5).join("\n")).toContain("https://kit11.max-31b.workers.dev/try/sign");
  });
});

describe("one set of figures, the main run's record (3 November)", () => {
  const all = (re: RegExp, name: string) => [...TEXT[name]!.matchAll(re)];

  it("the record still holds what the pitch is built on: 2 stopped (Metal 1, CFO 1), 24/24 by Claude, 6 s, 5 Face ID, 40 s", () => {
    expect([stoppedAtLimit(st), st.metal, st.cfo, sp.byClaude, sp.decisions, t.faceToPaid, faceIdDecisions(record), t.toOptions]).toEqual([2, 1, 1, 24, 24, 6, 5, 40]);
  });

  it("says 'stopped at a limit' with the record's figure everywhere it is said, and in the pitch, the deck and the cheat sheet at least", () => {
    for (const name of Object.keys(TEXT)) {
      const got = all(/(\d+) stopped at a limit/gi, name).map((m) => Number(m[1]));
      expect({ name, wrong: got.filter((n) => n !== stoppedAtLimit(st)) }).toEqual({ name, wrong: [] });
      if (["pitch", "deck", "spiekkaart"].includes(name)) expect({ name, said: got.length > 0 }).toEqual({ name, said: true });
      for (const m of all(/(\d+) by Metal, (\d+) by the CFO|Metal (\d+) \([^)]*\), CFO (\d+)/g, name)) expect({ name, parts: (m[1] ? [m[1], m[2]] : [m[3], m[4]]).map(Number) }).toEqual({ name, parts: [st.metal, st.cfo] });
    }
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
    for (const name of ["deck", "spiekkaart"]) expect({ name, said: all(/(\d+) Face ID decisions/g, name).length > 0 }).toEqual({ name, said: true });
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

describe("T:0 and Metal, in the README's words (5 Nov)", () => {
  const readme = words(SOURCES.README!).replace(/, \[(?:tx|record)\]\([^)]*\)/g, "");

  it("the deck's lines are the README's", () => {
    expect(readme).toContain(METAL_ONCHAIN);
    expect(readme).toContain(`${METAL_ONCHAIN} ${NOT_ON_METAL}`);
    expect(readme).toContain(T0_STATUS.replace(/^Built, not yet live: /, "").replace(/\)\.$/, ""));
  });

  it("every marked block says T:0 is not live and nothing is posted; none says it is", () => {
    for (const name of ["pitch", "qa", "deck", "spiekkaart"]) {
      const blocks = [...SOURCES[name]!.matchAll(/<!-- T0-STATUS -->([\s\S]*?)<!-- \/T0-STATUS -->/g)].map((b) => words(b[1]!));
      expect({ name, blocks: blocks.length > 0 }).toEqual({ name, blocks: true });
      for (const b of blocks) {
        expect({ name, b, honest: /not yet live|refused|nothing posted/i.test(b) }).toEqual({ name, b, honest: true });
        expect({ name, b, claim: /T:0 is live|posted to T:0|live on T:0/i.test(b) }).toEqual({ name, b, claim: false });
      }
    }
  });

  it("every marked Metal block counts the run's own payments on chain: 86 (41 + 41 + 3 + 1), no clearing", () => {
    expect([pay.onChain, pay.sales, pay.purchases, pay.refunds, pay.sweeps]).toEqual([86, 41, 41, 3, 1]);
    expect((record.ledger?.events ?? []).filter((e) => e.event === "mandate.replaced")).toHaveLength(2);
    for (const name of ["pitch", "qa", "deck", "spiekkaart"]) {
      const blocks = [...SOURCES[name]!.matchAll(/<!-- METAL-ONCHAIN -->([\s\S]*?)<!-- \/METAL-ONCHAIN -->/g)].map((b) => words(b[1]!));
      expect({ name, blocks: blocks.length > 0 }).toEqual({ name, blocks: true });
      for (const b of blocks) {
        expect({ name, n: Number(/(\d+) (?:test-USD )?payments/.exec(b)?.[1]) }).toEqual({ name, n: pay.onChain });
        const parts = /\((\d+) sales, (\d+) supplier purchases, (\d+) refunds, (\d+) sweep\)/.exec(b);
        if (parts) expect(parts.slice(1).map(Number)).toEqual([pay.sales, pay.purchases, pay.refunds, pay.sweeps]);
        // The pitch's one spoken line has room only for the count; the rest says there was no clearing.
        if (name !== "pitch") expect({ name, clearing: /no clearing/i.test(b) }).toEqual({ name, clearing: true });
      }
    }
  });
});

describe("the deck", () => {
  it("has at most ten slides, dark, with the QR slide's short URL under the code, and no Visa logo", () => {
    const n = (DECK.match(/<section/g) ?? []).length;
    expect(n).toBeLessThanOrEqual(10);
    expect(DECK).toMatch(/html, body \{ background: #0b1020; \}/);
    expect(DECK).toMatch(/<div class="qr"><svg><\/svg><\/div><div><p class="url">kit11\.max-31b\.workers\.dev\/try\/sign<\/p>/);
    expect(DECK).not.toMatch(/<img[^>]*(visa|Visa)/);
    for (const title of ["Purser", "AI agents can now spend money. So who holds the pen?", "Each agent its own card and its own mandate", "One live run, three beats", "Sign one yourself", "Every id is published", "What is real, and what is not"]) expect(DECK).toContain(`<h1>${title}</h1>`);
  });

  it("names the second approver and the sandbox's SWIFT steps as they were", () => {
    expect(TEXT.deck).toContain("a labelled virtual test passkey, pressed by our build tool (Claude Code) on Max's go");
    expect(TEXT.deck).toContain("SWIFT SENT and PAID: moved by Purser through Airwallex's sandbox simulation API");
    expect(TEXT.deck).toContain("Built, not yet live: the Cardputer hub");
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

describe("the cheat sheet", () => {
  it("is one A4 page, printed from its HTML", () => {
    const pdf = new URL("../docs/internal/spiekkaart-demo.pdf", import.meta.url);
    expect(existsSync(pdf)).toBe(true);
    expect((readFileSync(pdf).toString("latin1").match(/\/Type\s*\/Page(?!s)/g) ?? []).length).toBe(1);
  });

  it("has the opening and the close word for word, the three figures and the URLs", () => {
    const s = TEXT.spiekkaart!;
    expect(s).toContain("AI agents can now spend money. So who holds the pen? I'm Max Geurtsen, and this is Purser.");
    expect(s).toContain(`${CORE_LINE} Purser.`);
    expect(s).toContain("2 stopped at a limit");
    expect(s).toContain("6 seconds from Face ID to PAID");
    expect(s).toContain("5 Face ID decisions");
    for (const u of ["kit11.max-31b.workers.dev/try/sign", "kit11.max-31b.workers.dev/watch", "kit11.max-31b.workers.dev/proof", "npm run judge"]) expect(s).toContain(u);
  });
});
