// Home, 21 Nov (Max: "We have enormously many headings on the homepage. Make it clean, tighter and prettier. Make real
// use of animations and visuals"; "Should we show all these pages at all? I want it simple and tight"): six parts, one
// heading each at most. The hero (Purser Cloud for companies, the heading, the idea, the judge tour and Try, the sandbox
// line, the product card from one /try run); the integrations band; four agents; one proof row; the judge tour's map;
// how to start in three steps. The honesty rules of the jury panel (A1 to A10) still hold: no recorded run called live,
// simulated and test money said where a reader meets them, one note line, every figure from a record, every amount with
// its currency, no fetch, no award wording; no customer, no competitor, no founder.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAVEAT_LINE, CHAIN_TEST, DESIGN_PARTNER_LABEL, DESIGN_PARTNER_URL, FILM_URL, HERO, SECOND_APPROVER } from "../src/config/brand.js";
import { BOOKED, FLOW, FLOW_NOTE, TRY_SAMPLE_RECORD } from "../src/redesign/heroFlow.js";
import { AP_ACCOUNTS, dutchVat } from "../src/ap/books.js";
import {
  AGENTS_HEAD, CLOUD_EYEBROW, HOME_SUB, PROOF_BUTTON, PROOF_HEAD, REASSURE, ROSTER_NOTE, ROSTER_RECORDS, START, START_HEAD, STOP_DRILL_DOC, STOP_DRILL_RECORD,
  AI_CONNECT_URL, AI_HEAD, AI_STEPS, AI_SUB, TOUR_BUTTON, TOUR_HEAD, VERIFY_BUTTON, WHATS_REAL, agentRoster, agentTiles, homePage, proofRows, proofTiles, stopDrillFacts,
} from "../src/redesign/home.js";
import { REPO_BLOB } from "../src/redesign/metalStory.js";
import { MONEY_FLOW_RECORDS, moneyFlowFacts } from "../src/redesign/moneyFlow.js";
import { TOUR_PAGES, TOUR_START_HREF, TOUR_STOPS } from "../src/redesign/tour.js";
import { TRY_URL } from "../src/redesign/ui.js";
import { buildPages } from "../src/relay/assets.js";
import { MORE_LINKS, NEGOTIATE_URL } from "../src/ui/more.js";
import { scriptBlocks, scriptBody, withoutBlocks } from "./support/scriptBlocks.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const ENTITIES: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&#39;": "'", "&lt;": "<", "&gt;": ">" };
const decode = (s: string) => s.replace(/&(?:amp|quot|#39|lt|gt);/g, (e) => ENTITIES[e]!);
const text = (html: string) => decode(html.replace(/<svg\b[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const mainOf = (html: string) => /<main[\s\S]*<\/main>/.exec(html)![0];
const section = (html: string, cls: string) => new RegExp(`<section class="${cls}"[\\s\\S]*?</section>`).exec(html)?.[0] ?? "";
/** The page without the "What's real?" fold, scripts and styles: what is in sight or said aloud. */
const outsideFold = (html: string) => withoutBlocks(html.replace(/<details class="real"[\s\S]*?<\/details>/, " "), ["script", "style"], " ");
function visibleWords(html: string): number {
  let main = mainOf(html);
  for (let prev = ""; prev !== main;) { prev = main; main = main.replace(/<svg\b[^>]*>(?:(?!<svg\b)[\s\S])*?<\/svg>/g, " "); }
  const t = withoutBlocks(main, ["script", "style"], " ")
    .replace(/<details\b[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>[\s\S]*?<\/details>/g, " $1 ").replace(/<[^>]+>/g, " ");
  return decode(t).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

const ON = homePage(undefined, { trySign: true }), OFF = homePage();
const AWX = JSON.parse(read("docs/demo/airwallex-run.json")) as {
  cards: { agent: string; read_back: { per_tx: string; monthly: string; currency: string; last4: string; status: string } }[];
  card_transactions: { id: string; agent: string; amount: string; currency: string; approved: boolean; decline_code: string | null }[];
  note: string;
};
const MAIN = JSON.parse(read("docs/demo/main-run.json")) as { snapshot: { agents: { id: string; name: string; mandate: { cap: string } }[] } };
const SAMPLE = JSON.parse(read(TRY_SAMPLE_RECORD)) as { mode: { reader: string; bank: string; money: string }; invoice: { supplier: string; number: string; currency: string; total: string; due: string; account_ending: string }; signed: { terms_hash_prefix: string }; booked: { account: string; debit: string | null; credit: string | null }[] };
const DRILL = JSON.parse(read(STOP_DRILL_RECORD)) as { test_money: boolean; cards: unknown[]; passes: { stopped: unknown; timings: { fully_blocked_ms: number } | null; steps: { id: string; pass: boolean; facts: { changed?: string[]; failure_reason?: string } | null }[] }[] };

describe("Home, 21 Nov: one short story", () => {
  it("is six parts in this order, each with one heading at most: the hero, the band, the agents, the proof, the judge tour, how to start", () => {
    for (const html of [ON, OFF]) {
      const main = mainOf(html);
      expect(main.match(/<section\b[^>]*>/g)).toEqual(['<section class="e-hero">', '<section class="e-band" aria-label="Integrations">', '<section class="e-ai" id="ai" aria-labelledby="h-ai">', '<section class="e-agents" aria-labelledby="h-agents">', '<section class="e-proof" aria-labelledby="h-proof">', '<section class="e-tour" id="tour" aria-labelledby="h-tour">', '<section class="e-start" id="start" aria-labelledby="h-start">']);
      expect(main.match(/<h[1-6]\b/g)).toEqual(["<h1", "<h2", "<h2", "<h2", "<h2", "<h2"]);
      expect([...main.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => text(m[1]!))).toEqual([AI_HEAD, AGENTS_HEAD, PROOF_HEAD, TOUR_HEAD, START_HEAD]);
      expect(text(/<h1[\s\S]*?<\/h1>/.exec(main)![0])).toBe(HERO);
      const at = ['<p class="eyebrow cloud">', '<h1 class="h-hero">', `<p class="what">${HOME_SUB}</p>`, '<div class="ctas">', '<p class="reassure">', '<figure class="hf"', '<p class="hf-note">', '<div class="lband"', '<ol class="aflow"', '<ul class="agents">', '<ul class="prow">', '<ol class="tmap">', '<ol class="steps3">', '<p class="ask">'].map((s) => ({ s, i: main.indexOf(s) }));
      expect(at.filter((x) => x.i < 0)).toEqual([]);
      expect(at.map((x) => x.i)).toEqual([...at.map((x) => x.i)].sort((a, b) => a - b));
      // Max, 21 Nov: "'Purser Cloud for finance teams': it's for companies in general."
      expect(text(/<p class="eyebrow cloud">[\s\S]*?<\/p>/.exec(main)![0])).toBe(CLOUD_EYEBROW);
      expect(CLOUD_EYEBROW).toBe("Purser Cloud, for companies");
      expect(main).not.toMatch(/finance teams/i);
    }
  });

  it("has two buttons in the hero, the judge tour (primary) and Try, then the proof's two at its row; nothing else is a button", () => {
    const buttons = (html: string) => [...mainOf(html).matchAll(/<a class="btn[^"]*" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => [decode(m[1]!), text(m[2]!)]);
    for (const html of [ON, OFF]) expect(buttons(html)).toEqual([[TOUR_START_HREF, TOUR_BUTTON], [TRY_URL, START], ["proof", PROOF_BUTTON], ["/verify", VERIFY_BUTTON]]);
    expect([TOUR_BUTTON, START]).toEqual(["Start the judge tour", "Try it"]);
    for (const html of [ON, OFF]) expect(mainOf(html).match(/class="btn primary/g)).toHaveLength(1);
    expect(homePage(undefined, { verifyUrl: "" })).not.toContain(VERIFY_BUTTON);
    expect(mainOf(buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv).home!)).toBe(mainOf(ON));
    expect(buildPages({} as NodeJS.ProcessEnv).home).toBe(OFF);
    for (const html of [ON, OFF]) expect(html).not.toMatch(/href="\/?(pricing|judge)"/);
  });

  it("A6: one sandbox line under the buttons", () => {
    expect(REASSURE).toEqual({ sign: "Sandbox demo: test money, no real settlement.", world: "Sandbox demo: test money, no real settlement." });
    for (const html of [ON, OFF]) expect(mainOf(html).match(/<p class="reassure">/g)).toHaveLength(1);
    expect(text(/<div class="ctas">[\s\S]*?<p class="reassure">[\s\S]*?<\/p>/.exec(ON)![0]).endsWith(REASSURE.sign)).toBe(true);
  });

  it("A1: no heading says live, and outside the fold nothing on Home is called live", () => {
    for (const html of [ON, OFF]) {
      for (const h of html.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/g)) expect(text(h[1]!)).not.toMatch(/live/i);
      // Two honest labels say the word: the band's line (each connection's label, "live" among them) and the AI block's
      // small print ("built, not yet run live").
      expect(text(outsideFold(mainOf(html))).replace("live, sandbox, testnet, export or built", " ").replace("not yet run live", " ")).not.toMatch(/\blive\b/i);
      expect(html).not.toMatch(/live run|Replay of/i);
    }
  });

  it("A3: test money said where a reader is sent on (the sandbox line, the cent's tile, the pilot), simulated where the card's payment ran, read only where an AI connects; the run caveat is in the fold", () => {
    for (const html of [ON, OFF]) {
      const t = outsideFold(mainOf(html));
      expect(text(t).match(/simulated/gi)).toHaveLength(1);
      expect(text(/<figure class="hf"[\s\S]*?<\/figure>/.exec(t)![0])).toMatch(/simulated bank/);
      expect(text(t).match(/test money/gi)).toHaveLength(3);
      for (const where of [/<p class="reassure">[\s\S]*?<\/p>/, /<li class="reveal p-cent"[\s\S]*?<\/li>/, /<li class="reveal pilot">[\s\S]*?<\/li>/]) expect(text(where.exec(t)![0])).toMatch(/test money/i);
      // Every proof tile says where it ran.
      expect([...t.matchAll(/<span class="tag">([^<]+)<\/span>/g)].map((m) => m[1])).toEqual(proofTiles().map((p) => p.tag));
      expect(text(/<details class="real"[\s\S]*?<\/details>/.exec(html)![0])).toContain(CAVEAT_LINE);
    }
  });

  it("A4: one note line with the What's real? link; the only date in sight is the sample invoice's own due date", () => {
    expect(FLOW_NOTE).toBe("One /try run, a test company's sample invoice.");
    const DATE = /\b\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*(?: \d{4})?|\b20\d\d-\d\d-\d\d/g;
    for (const html of [ON, OFF]) {
      const main = mainOf(html);
      expect(main.match(/<p class="hf-note">/g)).toHaveLength(1);
      expect(text(/<p class="hf-note">[\s\S]*?<\/p>/.exec(main)![0])).toBe(`${FLOW_NOTE} ${WHATS_REAL}`);
      expect(main).toContain(`<a href="#real" data-real>${WHATS_REAL}</a>`);
      expect(text(outsideFold(main)).match(DATE)).toEqual([SAMPLE.invoice.due]);
    }
    expect(ON).toContain('document.querySelectorAll("[data-real]")');
  });

  it("the product card books the VAT as the engine books that invoice now (judge scan, 15 Nov): 1515, not the record's 1510", () => {
    const [net, vat] = [SAMPLE.booked[0]!.debit!, SAMPLE.booked[1]!.debit!].map((a) => Math.round(Number(a) * 100));
    expect(dutchVat(net!, vat!)).toBeNull();
    expect(SAMPLE.booked.map((b) => b.account)).toEqual(["6200", AP_ACCOUNTS.inputVat, "2100"]);
    expect(BOOKED.map((b) => b.account)).toEqual(["6200", AP_ACCOUNTS.foreignVat, "2100"]);
    expect(BOOKED.map((b) => b.debit ?? b.credit)).toEqual(SAMPLE.booked.map((b) => b.debit ?? b.credit));
  });

  it("the product card, in the hero, shows one /try run as its record holds it, names it, and says Claude read that run's invoice", () => {
    expect([SAMPLE.mode.reader, SAMPLE.mode.bank, SAMPLE.mode.money]).toEqual(["claude", "simulated", "test"]);
    const money = (a: string) => `${SAMPLE.invoice.currency} ${Number(a).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
    expect(FLOW.supplier).toBe(SAMPLE.invoice.supplier);
    expect(FLOW.amount).toBe(money(SAMPLE.invoice.total));
    for (const html of [ON, OFF]) {
      expect(section(html, "e-hero")).toContain('<figure class="hf"');
      expect(mainOf(html).match(/<figure\b/g)).toHaveLength(1);
      const card = /<figure class="hf"[\s\S]*?<\/figure>/.exec(mainOf(html))![0];
      expect(card).toContain(`data-rec="${TRY_SAMPLE_RECORD}"`);
      const t = text(card);
      for (const v of [SAMPLE.invoice.supplier, `Invoice ${SAMPLE.invoice.number}`, money(SAMPLE.invoice.total), SAMPLE.invoice.due, `…${SAMPLE.invoice.account_ending}`, ...BOOKED.map((b) => `${b.account}`), ...SAMPLE.booked.map((b) => money((b.debit ?? b.credit)!))]) expect({ v, found: t.includes(v) }).toEqual({ v, found: true });
      expect(t).toContain("Signed with a passkey · fingerprint of the terms");
      expect(card).toContain(`title="SHA-256 of the signed terms: ${SAMPLE.signed.terms_hash_prefix}…"`);
      expect(t).toContain("Claude reader");
      expect(t).toContain("Purser's code holds the limits");
      expect(text(/<details class="real"[\s\S]*?<\/details>/.exec(html)![0])).toContain("Claude Haiku 5.5 read that invoice");
    }
  });

  it("A7: every animation sits under no-preference, and nothing on Home reaches the network", () => {
    for (const html of [ON, OFF]) {
      // Home's own style (the site's shared motion, before it, has its own reduced-motion rules: src/ui/motion.ts).
      const whole = /<style>([\s\S]*?)<\/style>/.exec(html)![1]!, style = whole.slice(whole.indexOf("/* Home, 21 Nov"));
      expect(style.length).toBeGreaterThan(1000);
      // Each `animation:` that runs (not "none") is inside a block for readers who did not ask for less motion.
      const outside = style.replace(/@media \(prefers-reduced-motion: no-preference\) \{(?:[^{}]|\{[^{}]*\})*\}/g, " ");
      expect(outside.match(/animation:\s*(?!none)[a-z-]+ [^;]*infinite/g) ?? []).toEqual([]);
      const script = scriptBlocks(html).map(scriptBody).join("\n");
      expect(script).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/);
      expect(html).not.toMatch(/ style="/);
    }
    for (const env of [{ TRY_SIGN_ENABLED: "on" }, {}]) expect(buildPages(env as NodeJS.ProcessEnv).csp.home).toContain("connect-src 'none'");
  });

  it("A10: the headline is two sentences on two lines, every amount has its currency, and no award wording", () => {
    for (const html of [ON, OFF]) {
      expect(html).toContain('<h1 class="h-hero"><span>AI agents spend.</span> <span>You sign off.</span></h1>');
      const t = text(outsideFold(mainOf(html)));
      const amounts = [...t.matchAll(/(\S+)\s+(\d[\d,]*\.\d{2})\b/g)];
      expect(amounts.length).toBeGreaterThanOrEqual(3);
      for (const m of amounts) expect({ amount: m[2], unit: m[1] }).toEqual({ amount: m[2], unit: m[1]!.replace(/^\+/, "") === "EUR" ? m[1] : "EUR" });
      expect(html).not.toMatch(/Kit 11|x402 Business Agents|Competing for|Metal Award|Visa Award/);
    }
  });

  it("names no TAP and no awards; the one Watch is the tour's first stop, the film on YouTube", () => {
    for (const html of [ON, OFF]) {
      const rest = html.replace(/<header class="top">[\s\S]*?<\/header>/, " ").replace(/<script>[\s\S]*?<\/script>/g, " ");
      expect(rest.match(/\bWatch\b/g)).toEqual(["Watch"]);
      expect(mainOf(html)).toContain(`<a href="${FILM_URL}" target="_blank" rel="noopener">`);
      expect(rest).not.toMatch(/href="watch"/);
      expect(rest).not.toMatch(/TAP\b|Visa TAP|single-use Visa/);
    }
  });

  it("keeps the full list in the What's real? fold: the card's run, the cent's files, the Airwallex run's note, the Alta test, the second approver, the band", () => {
    const fold = text(/<details class="real"[\s\S]*?<\/details>/.exec(ON)![0]);
    for (const line of [SECOND_APPROVER, CHAIN_TEST, AWX.note, "one /try run of its sample invoice on", ...MONEY_FLOW_RECORDS, "No customer uses it yet.", "The integrations band"]) expect({ line, found: fold.includes(line) }).toEqual({ line, found: true });
  });

  it("claims no customer, names no competitor and no person, and asks for a design partner only in its one link", () => {
    expect(DESIGN_PARTNER_URL).toBe("mailto:max.geurtsen@outlook.com");
    for (const html of [ON, OFF]) {
      // (Purser Cloud's own address, max-31b.workers.dev, is an address, not a person.)
      const t = text(mainOf(html)).replace(/[\w.-]+\.workers\.dev[\w/.-]*/g, " ");
      expect(t).not.toMatch(/\b(customers? (use|trust)|trusted by|used by \d|our customers|in production at)\b/i);
      expect(t).not.toMatch(/\b(Pleo|Ramp|Brex|Spendesk|Payhawk|Expensify|Mercury|Revolut|Stripe|Mastercard|Coinbase)\b/);
      expect(t).not.toMatch(/founder|Max Geurtsen|\bMax\b/i);
      expect(t).not.toMatch(/revolution|seamless|world-class|game.?chang|cutting.edge|best-in-class|effortless/i);
      expect(html.split(DESIGN_PARTNER_LABEL)).toHaveLength(2);
      expect(mainOf(html)).toContain(`<a href="${DESIGN_PARTNER_URL}">${DESIGN_PARTNER_LABEL} →</a>`);
    }
    expect(homePage(undefined, { partnerUrl: "" })).not.toContain(DESIGN_PARTNER_LABEL);
  });

  // 21 Nov (Max: "Make it clean, tighter"): 880 → 620. The parts as built: the hero with the product card (the card
  // alone is about 70 words of values from its record), the band's names, the AI flow (the owner, 21 Nov: "Works where
  // your AI already works"), four agents, four proof tiles, the tour's seven stops and the three steps (612 as built).
  it("A11: stays within 620 visible words", () => {
    expect(visibleWords(ON)).toBeLessThanOrEqual(620);
    expect(visibleWords(OFF)).toBeLessThanOrEqual(620);
  });
});

describe("The agents, on Home", () => {
  it("are four tiles, sourcing and negotiation, payables, treasury, support, each with one link that is served", () => {
    const tiles = agentTiles();
    expect(tiles.map((t) => t.id)).toEqual(["sourcing", "payables", "treasury", "support"]);
    expect(tiles.map((t) => t.href)).toEqual([NEGOTIATE_URL, TRY_URL, `${REPO_BLOB}${STOP_DRILL_DOC}`, "agents/support"]);
    expect(existsSync(new URL(`../${STOP_DRILL_DOC}`, import.meta.url))).toBe(true);
    expect(Object.keys((buildPages({} as NodeJS.ProcessEnv) as unknown as { agents: Record<string, unknown> }).agents)).toContain("support");
    // The negotiation is /try/negotiate's own page (cloud/src/try/negotiatePage.ts), linked at the end of /try too, and
    // out of the menu since 15 Nov (Max: it read as unprofessional there).
    expect(MORE_LINKS.map((l) => l.href)).not.toContain(NEGOTIATE_URL);
    expect(read("cloud/src/try/negotiatePage.ts")).toMatch(/negotiate/);
    expect(read("cloud/src/tryPage.ts")).toMatch(/negotiate/);
    for (const html of [ON, OFF]) {
      const s = section(html, "e-agents");
      expect(s.match(/<li class="reveal ag-/g)).toHaveLength(4);
      for (const t of tiles) expect(s).toContain(`<a class="go" href="${t.href.replace(/&/g, "&amp;")}"`);
    }
    // Each job as src/config/brand.ts says it (AGENT_DISPLAY): sourcing buys data per query, support refunds disputes,
    // treasury sweeps to Airwallex and pays the EUR licence fee.
    const brand = read("src/config/brand.ts");
    expect(brand).toContain("buys upstream data per query");
    expect(brand).toContain("refunds customers when a dispute holds");
    expect(brand).toContain("sweeps earnings to Airwallex");
  });

  it("show each agent's own card and limit as Airwallex read them back, the records named", () => {
    const roster = agentRoster();
    expect(roster).toEqual(AWX.cards.map((c) => ({
      id: c.agent, name: MAIN.snapshot.agents.find((a) => a.id === c.agent)!.name, last4: c.read_back.last4, currency: c.read_back.currency,
      perTx: c.read_back.per_tx, monthly: c.read_back.monthly, altaCap: MAIN.snapshot.agents.find((a) => a.id === c.agent)!.mandate.cap,
    })));
    for (const html of [ON, OFF]) {
      const s = section(html, "e-agents"), t = text(s);
      for (const a of roster) {
        expect(s).toMatch(new RegExp(`<li class="reveal ag-${a.id}" data-rec="[^"]+">`));
        expect(t).toContain(`••${a.last4} ${a.currency} ${a.perTx} a purchase`);
      }
      expect(s).toContain(`<p class="fine" data-rec="${ROSTER_RECORDS}">${ROSTER_NOTE}</p>`);
    }
    expect(agentRoster(null)).toEqual([]);
    expect(agentRoster({ ...AWX, cards: AWX.cards.map((c) => ({ ...c, read_back: { ...c.read_back, status: "INACTIVE" } })) } as never)).toEqual([]);
  });

  it("states the emergency stop as the drill's record holds it, or not at all", () => {
    const pass = [...DRILL.passes].reverse().find((p) => !p.stopped && p.steps.some((s) => s.id === "stop.pull" && s.pass))!;
    expect(DRILL.test_money).toBe(true);
    expect(pass.steps.filter((s) => s.id.startsWith("blocked.")).every((s) => s.pass)).toBe(true);
    const facts = stopDrillFacts();
    expect(facts).toEqual({ agents: DRILL.cards.length, seconds: (pass.timings!.fully_blocked_ms / 1000).toFixed(1) });
    expect(DRILL.cards).toHaveLength(3);
    for (const html of [ON, OFF]) expect(text(section(html, "e-agents"))).toContain(`One signed stop froze all three agents' cards in ${facts!.seconds} s. ••`);
    expect(stopDrillFacts({ ...DRILL, passes: DRILL.passes.map((p) => ({ ...p, stopped: "halted" })) } as never)).toBeNull();
    expect(stopDrillFacts({ ...DRILL, test_money: false } as never)).toBeNull();
    expect(agentTiles(null).find((t) => t.id === "treasury")!.text).not.toMatch(/stop/);
  });
});

describe("The proof row, on Home", () => {
  it("is the changed cent, Airwallex's decline, Alta's refusal and Visa's reused credential, each value from its record", () => {
    const rows = proofRows(), mf = moneyFlowFacts()!;
    expect(rows.map((r) => r.partner)).toEqual(["Airwallex", "Alta", "Visa"]);
    const decline = AWX.card_transactions.find((t) => t.id === rows[0]!.full)!;
    expect(decline.approved).toBe(false);
    const limit = AWX.cards.find((c) => c.agent === decline.agent)!.read_back.per_tx;
    const tiles = proofTiles();
    expect(tiles.map((t) => [t.key, t.value, t.tag])).toEqual([
      ["Passkey", `+${mf.cent!.currency} 0.01`, "test money"],
      ["Airwallex", `${decline.currency} ${decline.amount}`, "sandbox"],
      ["Alta", "Over cap", "testnet"],
      ["Visa", "Reused", "sandbox"],
    ]);
    expect(tiles[1]!.text).toContain(`over its ${decline.currency} ${limit} limit`);
    // Alta's refusal was a test with Purser's own check off (CHAIN_TEST): the tile says so.
    expect(tiles[2]!.text).toContain("with our own check off for a test");
    expect(tiles.map((t) => t.href)).toEqual(["/verify", rows[0]!.href, rows[1]!.href, rows[2]!.href]);
    for (const html of [ON, OFF]) for (const t of tiles) expect(section(html, "e-proof")).toContain(`href="${t.href.replace(/&/g, "&amp;")}"`);
    // A tile whose record is missing drops out.
    expect(proofTiles(proofRows(undefined, null, null), null).map((t) => t.key)).toEqual(["Alta"]);
    expect(proofTiles([], null)).toEqual([]);
  });
});

describe("The judge tour, on Home and its stops", () => {
  it("has seven stops: the film, Try, Purser Cloud as a guest, then Alta, Visa, T:0 and the proof on the site", () => {
    expect(TOUR_STOPS.map((s) => s.title)).toEqual(["Watch the demo", "Try it", "Purser Cloud", "Agents on Alta", "Cards via Visa", "Books on T:0", "Proof"]);
    expect(TOUR_STOPS.filter((s) => s.external).map((s) => s.href)).toEqual([FILM_URL, TRY_URL, "https://purser-try.max-31b.workers.dev/#/guest"]);
    expect(TOUR_STOPS.filter((s) => !s.external).map((s) => [s.href, s.key])).toEqual([["alta", "metal"], ["visa", "visa"], ["t0", "t0"], ["proof", "proof"]]);
    expect([...TOUR_PAGES]).toEqual(["home", "metal", "visa", "t0", "proof"]);
    for (const html of [ON, OFF]) {
      const map = /<ol class="tmap">[\s\S]*?<\/ol>/.exec(mainOf(html))![0];
      expect([...map.matchAll(/<li data-stop="(\d)"><a href="([^"]+)"/g)].map((m) => [Number(m[1]), decode(m[2]!)])).toEqual(TOUR_STOPS.map((s, i) => [i + 1, s.external ? s.href : `${s.href}?tour=${i + 1}`]));
    }
    expect(TOUR_START_HREF).toBe("home?tour=1#tour");
  });

  it("puts its bar's script on Home and on each stop on the site, inside the page's one hashed script, and on no other page", () => {
    const pages = buildPages({} as NodeJS.ProcessEnv) as unknown as Record<string, string> & { csp: Record<string, string> };
    const marker = 'K = "purser.tour"';
    for (const key of ["home", "metal", "visa", "t0", "proof"]) {
      expect({ key, bar: pages[key]!.includes(marker) }).toEqual({ key, bar: true });
      expect(pages[key]!.match(/<script>/g)).toHaveLength(1);
      expect(pages.csp[key]).toMatch(/script-src 'sha256-/);
      expect(pages[key]).toContain("aside.tbar {");
    }
    // (The replay at /replay sits under the Proof tab, so it carries the bar too: a judge who opens it from /proof keeps the tour.)
    for (const key of ["airwallex", "claude", "security", "privacy", "docs", "books", "status", "runs", "trace"]) expect({ key, bar: String(pages[key]).includes(marker) }).toEqual({ key, bar: false });
    // The bar is built with createElement and textContent; its words are the stops' own, never markup from the URL.
    const js = scriptBlocks(pages.home!).map(scriptBody).join("\n");
    expect(js).not.toMatch(/innerHTML\s*=(?!\s*markup\b)/);
    expect(js).toContain("sessionStorage");
  });
});

describe("Works where your AI already works, on Home", () => {
  it("is one flow of four steps in plain words, the jargon in its small print, and says Airwallex's news as Airwallex says it", () => {
    expect(AI_HEAD).toBe("Works where your AI already works.");
    expect(AI_STEPS.map((s) => s.title)).toEqual(["Your AI", "Purser", "The money", "The books"]);
    expect(AI_STEPS[1]!.tags).toEqual(["Limits in code", "Your passkey above"]);
    for (const html of [ON, OFF]) {
      const s = section(html, "e-ai");
      // No jargon in its heading or line: no MCP, x402, SHA-256 or hash.
      for (const h of [AI_HEAD, AI_SUB]) expect(h).not.toMatch(/MCP|x402|SHA|hash/i);
      expect(s).toContain('<ol class="aflow"');
      expect(s.match(/<li class="af-n /g)).toHaveLength(4);
      // The protocol and the address only in the small print, with each AI's set-up (Purser Cloud serves /connect-ai).
      expect(text(/<p class="af-fine">[\s\S]*?<\/p>/.exec(s)![0])).toContain("purser-try.max-31b.workers.dev/mcp (demo company, read only)");
      expect(s).toContain(`href="${AI_CONNECT_URL}"`);
      // The Airwallex reader is said as the hub says it: built, not yet run live.
      expect(text(s)).toContain("Airwallex sandbox reader: built, not yet run live.");
      // Each mark is a file the site serves.
      for (const m of s.matchAll(/<img src="assets\/([\w.-]+)"/g)) expect(Object.keys(buildPages({} as NodeJS.ProcessEnv).images)).toContain(m[1]);
    }
    expect(read("cloud/src/claude/routes.ts")).toContain('path: "/connect-ai"');
    const hub = read("cloud/src/connections.ts");
    expect(hub).toMatch(/Airwallex sandbox, read only \(Code Mode MCP\)", kind: "built, not tested live"/);
    // Airwallex's own words (its release notes, 12 Nov): AgentOS is available in ChatGPT. The fold says so, and says
    // Purser does not connect to Airwallex's app.
    const fold = text(/<details class="real"[\s\S]*?<\/details>/.exec(ON)![0]);
    expect(fold).toContain("its AgentOS is available in ChatGPT");
    expect(fold).toContain("Purser does not connect to Airwallex's app");
  });
});
