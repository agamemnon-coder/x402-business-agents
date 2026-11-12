// Home as one story (home-story, 12 Nov; the jury panel's A1 to A8, A10, A11): the headline, one sentence, one button
// with one reassurance line, the sentence every juror repeated, the hero (four steps, the fourth the visitor's own
// check), ONE provenance line, three proof rows each one tap from the partner's own record, and the second and last
// button. No Watch block, no awards strip, no run counts, no second caveat. Every id on the rows is read from the run
// records here, again. The browser side (the tap, the sizes, the screens) is test/browser/pages.check.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAVEAT_LINE, CHAIN_TEST, DESIGN_PARTNER_LABEL, DIFFERENTIATORS, HERO, JUDGE_LINE, SECOND_APPROVER, SMALL_COMPANY_DEMO_URL, WHAT_IT_IS } from "../src/config/brand.js";
import { DEMO_STEPS, heroDemoFacts, heroProvenance } from "../src/redesign/heroDemo.js";
import { heroReceipt, HERO_RECEIPT_FILE } from "../src/redesign/heroReceipt.js";
import { LOCKS_HEAD, NEXT_NEXT, PROOF_BUTTON, REASSURE, START, WHATS_REAL, homePage, proofRows } from "../src/redesign/home.js";
import { buildPages } from "../src/relay/assets.js";
import { scriptBlocks, scriptBody, withoutBlocks } from "./support/scriptBlocks.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
/** esc() undone in one pass, so "&amp;lt;" reads "&lt;" (a chain of replaces would decode it twice). */
const ENTITIES: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&#39;": "'", "&lt;": "<", "&gt;": ">" };
const decode = (s: string) => s.replace(/&(?:amp|quot|#39|lt|gt);/g, (e) => ENTITIES[e]!);
const text = (html: string) => decode(html.replace(/<svg\b[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const mainOf = (html: string) => /<main[\s\S]*<\/main>/.exec(html)![0];
/** The page without the "What's real?" fold (the footer's closed list), scripts and styles: what is in sight or said aloud. */
const outsideFold = (html: string) => withoutBlocks(html.replace(/<details class="real"[\s\S]*?<\/details>/, " "), ["script", "style"], " ");
/** As test/site-v4.test.ts counts them: <main>, no drawings, scripts, styles or folded details. */
function visibleWords(html: string): number {
  let main = mainOf(html);
  for (let prev = ""; prev !== main;) { prev = main; main = main.replace(/<svg\b[^>]*>(?:(?!<svg\b)[\s\S])*?<\/svg>/g, " "); }
  const t = withoutBlocks(main, ["script", "style"], " ")
    .replace(/<details\b[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>[\s\S]*?<\/details>/g, " $1 ").replace(/<[^>]+>/g, " ");
  return decode(t).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

const ON = homePage(undefined, { trySign: true }), OFF = homePage();
const AWX = JSON.parse(read("docs/demo/airwallex-run.json")) as {
  attempts: { at: string }[]; cards: { agent: string; read_back: { per_tx: string } }[];
  card_transactions: { id: string; agent: string; amount: string; currency: string; approved: boolean; decline_code: string | null }[];
  invoices: { invoice_no: string; transfer_id: string; approval_sha256: string }[]; verify: { level: string; what: string; detail: string }[];
};
const MAIN = JSON.parse(read("docs/demo/main-run.json")) as { ledger: { events: { event: string; payload: Record<string, unknown> }[] } };

describe("Home is one story, in this order", () => {
  it("headline, one sentence, one button, one reassurance line, the repeated sentence, the hero, one provenance line, three rows, the last button", () => {
    for (const html of [ON, OFF]) {
      const main = mainOf(html);
      const at = [
        '<h1 class="h-hero">', `<p class="what">${WHAT_IT_IS}</p>`, '<a class="btn primary big start"', '<p class="reassure">', `<p class="oneline">${DIFFERENTIATORS[0]}</p>`,
        '<figure class="hd" id="hero-demo"', '<p class="prov">', '<section class="locks"', '<ol class="rows">', `<a class="btn big more" href="proof">`,
      ].map((s) => ({ s, i: main.indexOf(s) }));
      expect(at.filter((x) => x.i < 0)).toEqual([]);
      expect(at.map((x) => x.i)).toEqual([...at.map((x) => x.i)].sort((a, b) => a - b));
      expect(text(/<h1[\s\S]*?<\/h1>/.exec(main)![0])).toBe(HERO);
      // No other section: the hero, the three locks and, last and closed, "About Purser" (the owner, 12 Nov; test/home-about.test.ts).
      expect(main.match(/<section\b[^>]*>/g)).toEqual(['<section class="hero">', '<section class="locks" aria-labelledby="h-locks">', '<section class="about" aria-labelledby="about">']);
    }
    expect(DIFFERENTIATORS[0]).toBe("An approval is usually a button. In Purser it's a signature over the exact terms: change one cent and it's worthless.");
    expect(text(mainOf(ON))).toContain(DIFFERENTIATORS[0]);
  });

  it("has exactly two buttons that lead somewhere: Try it yourself (to /try/sign, or /try without it) and See the proof", () => {
    const buttons = (html: string) => [...mainOf(html).matchAll(/<a class="btn[^"]*" href="([^"]+)">([\s\S]*?)<\/a>/g)].map((m) => [m[1], text(m[2]!)]);
    expect([START, PROOF_BUTTON]).toEqual(["Try it yourself", "See the proof"]);
    // Since 12 Nov (the owner) the first button opens the hands-on demo (TRY_URL) in both bundles.
    expect(buttons(ON)).toEqual([["https://purser-try.max-31b.workers.dev/try", START], ["proof", PROOF_BUTTON]]);
    expect(buttons(OFF)).toEqual([["https://purser-try.max-31b.workers.dev/try", START], ["proof", PROOF_BUTTON]]);
    expect(OFF).not.toContain('href="try/sign"');
    expect(ON.match(/class="btn\b/g)).toHaveLength(2);
    // The bundles agree (TRY_SIGN_ENABLED on and off).
    expect(mainOf(buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv).home!)).toBe(mainOf(ON));
    expect(buildPages({} as NodeJS.ProcessEnv).home).toBe(OFF);
    // The judge's tour: a footer link only, and only where /judge exists.
    expect(ON).toContain(`<a class="flink" href="judge">${JUDGE_LINE}</a>`);
    expect(mainOf(ON)).not.toContain('href="judge"');
    expect(OFF).not.toContain('href="judge"');
  });

  it("A6: one reassurance line under the button, saying only what the page behind it does", () => {
    // Since 12 Nov (the owner) every Try call to action opens the hands-on demo (TRY_URL); /try/sign keeps its own page.
    expect(REASSURE).toEqual({ sign: "Your own test company, deleted after 24 hours.", world: "Your own test company, deleted after 24 hours." });
    expect(ON).toMatch(new RegExp(`${START}</a>\\s*<p class="reassure">${REASSURE.sign}</p>`));
    expect(OFF).toMatch(new RegExp(`${START}</a>\\s*<p class="reassure">${REASSURE.world}</p>`));
    // /try/sign as it is on this branch: the passkey is a test passkey made on the page, with no name or e-mail, in a test world; about a minute.
    const sign = read("src/try/sign.ts");
    for (const said of ["it makes the visitor's test passkey first when there is none", "A random id, no name or e-mail", "nothing real moves", "about a minute"]) expect({ said, found: sign.includes(said) }).toEqual({ said, found: true });
  });

  it("A1: no heading says live, and nothing on Home calls a recorded run or a replay live", () => {
    for (const html of [ON, OFF]) {
      for (const h of html.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/g)) expect(text(h[1]!)).not.toMatch(/live/i);
      expect(text(outsideFold(html))).not.toMatch(/\blive\b/i);
      expect(html).not.toMatch(/live run|Replay of/i);
    }
  });

  it("A3: outside the What's real? fold, simulated and test money are each said once", () => {
    for (const html of [ON, OFF]) {
      const t = outsideFold(html);
      expect(t.match(/simulated/gi)).toHaveLength(1);
      expect(t.match(/test money/gi)).toHaveLength(1);
      expect(text(t)).toContain(CAVEAT_LINE);
    }
  });

  it("A4, A2: one provenance line with the What's real? link; one date and one transfer id on the page", () => {
    const f = heroDemoFacts()!;
    for (const html of [ON, OFF]) {
      const main = mainOf(html);
      expect(main.match(/<p class="prov">/g)).toHaveLength(1);
      const prov = /<p class="prov">[\s\S]*?<\/p>/.exec(main)![0];
      expect(text(prov)).toBe(`${heroProvenance(f, heroReceipt(f)!).join(" ")} ${WHATS_REAL}`);
      expect(prov).toContain(`<a href="#real" data-real>${WHATS_REAL}</a>`);
      expect(WHATS_REAL).toBe("What's real?");
      // One date in sight, the record's; no other day, month or run label anywhere outside the fold.
      const dates = text(outsideFold(html)).match(/\b\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*(?: \d{4})?|\b20\d\d-\d\d-\d\d/g);
      expect(dates).toEqual([f.date]);
      expect(text(outsideFold(html))).not.toMatch(/main run|Airwallex-only run|awx-1/i);
      // One transfer: the hero's. The main run's SWIFT transfer is not on Home.
      const transfers = AWX.invoices.map((i) => i.transfer_id).concat(MAIN.ledger.events.flatMap((e) => (typeof e.payload.transfer_id === "string" ? [e.payload.transfer_id] : [])));
      expect(transfers.length).toBeGreaterThan(2);
      expect([...new Set(transfers.filter((id) => outsideFold(html).includes(id.slice(0, 8))))]).toEqual([f.transfer]);
    }
    // The script opens the footer's fold for the link.
    expect(ON).toContain('document.querySelectorAll("[data-real]")');
  });

  it("A5: three proof rows replace the hedged card, each one tap from the partner's own record, every id from the run records", () => {
    const f = heroDemoFacts()!;
    const decline = AWX.card_transactions.find((t) => !t.approved && t.decline_code === "LIMIT_EXCEEDED")!;
    const limit = AWX.cards.find((c) => c.agent === decline.agent)!.read_back.per_tx;
    const refused = MAIN.ledger.events.find((e) => e.event === "upstream.refused_on_chain")!;
    const tx = String(refused.payload.tx);
    expect([decline.amount, decline.currency, limit]).toEqual(["45.00", "EUR", "30.00"]);
    const rows = proofRows();
    // Since the jury check of 12 Nov: four cards, no partner twice. The third is Visa Intelligent Commerce (vic-3,
    // purchase B: the signed hash read back equal at Airi and at Airwallex), the fourth the CFO's own signature.
    const vic3 = JSON.parse(read("docs/runs/2026-11-12-vic-3.json")) as { purchases: { step: string; payment_intent_id: string | null; read_back: { mandate: { equal: boolean } | null; payment_intent: { equal: boolean } | null } }[] };
    const b = vic3.purchases.find((p) => p.step === "B")!;
    expect([b.read_back.mandate?.equal, b.read_back.payment_intent?.equal]).toEqual([true, true]);
    expect(rows.map((r) => [r.partner, r.href, r.external])).toEqual([
      ["Airwallex", "airwallex#awx-1-steps", false],
      ["Metal", `https://testnet.metalntwx.com/tx/${tx}`, true],
      ["Visa", "visa#vic3-run", false],
      ["The CFO", "airwallex#awx-1-steps", false],
    ]);
    // Since the homepage polish (12 Nov): one card each, a short title and one short line (the owner: less text).
    expect(rows.map((r) => [r.title, r.text])).toEqual([
      ["Airwallex declined the card", "EUR 45.00 over a EUR 30.00 limit."],
      ["Metal refused it on chain", "Over the agent's cap."],
      ["Visa: hash read back", "Equal at Airi and Airwallex."],
      ["Your signature (Face ID)", "Hash in Airwallex's record."],
    ]);
    expect(rows.map((r) => [r.id, r.full])).toEqual([[`${decline.id.slice(0, 8)}…`, decline.id], [`tx ${tx.slice(0, 6)}…${tx.slice(-4)}`, tx], [`${b.payment_intent_id!.slice(0, 10)}…`, b.payment_intent_id], [`${f.hash.slice(0, 8)}…`, f.hash]]);
    // Row 3 is the hero's payment: the same invoice's hash, and the run's own check says it is in the transfer's metadata.
    expect(AWX.invoices.find((i) => i.approval_sha256 === f.hash)!.transfer_id).toBe(f.transfer);
    expect(AWX.verify.find((v) => v.what.includes(f.transfer))!.detail).toContain("approval hash in metadata");
    for (const html of [ON, OFF]) {
      const list = /<ol class="rows">[\s\S]*?<\/ol>/.exec(mainOf(html))![0];
      const as = [...list.matchAll(/<li><a class="row reveal" href="([^"]+)"( target="_blank" rel="noopener")?>([\s\S]*?)<\/a><\/li>/g)];
      expect(as.map((m) => [m[1], !!m[2]])).toEqual(rows.map((r) => [r.href, r.external]));
      as.forEach((m, i) => {
        expect(text(m[3]!)).toBe(`${rows[i]!.title} ${rows[i]!.text} ${rows[i]!.id}`);
        expect(m[3]).toContain(`<code title="${rows[i]!.full}">${rows[i]!.id}</code>`);
      });
      // No date, run label or caveat on the rows; the old card and its counts are gone.
      expect(text(list)).not.toMatch(/simulated|test money|Nov|run\b/i);
      expect(html).not.toMatch(/class="awxp|\d+ Claude decisions|payments on chain|\d+ Face ID signatures/);
      expect(text(/<h2[^>]*id="h-locks"[^>]*>[\s\S]*?<\/h2>/.exec(html)![0])).toBe(LOCKS_HEAD);
    }
    // A row whose record lacks a piece drops out.
    expect(proofRows(undefined, null, null).map((r) => r.partner)).toEqual(["Metal"]);
  });

  it("A7, A8: the hero is the one animation, its fourth tab reads +1 cent, and one tap needs no network", () => {
    for (const html of [ON, OFF]) {
      const main = mainOf(html);
      expect(main.match(/<figure\b/g)).toHaveLength(1);
      expect(DEMO_STEPS[3]).toBe("+1 cent");
      expect(main).toContain('<button type="button" class="hd-btn go" data-act="cent">+1 cent</button>');
      expect(html).not.toMatch(/data-stage|function Stage\(/);
      const script = scriptBlocks(html).map(scriptBody).join("\n");
      expect(script).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/);
    }
    // And the browser may not connect anywhere from Home: its CSP says so.
    for (const env of [{ TRY_SIGN_ENABLED: "on" }, {}]) expect(buildPages(env as NodeJS.ProcessEnv).csp.home).toContain("connect-src 'none'");
  });

  it("A10: the headline is two sentences on two lines, every amount has its currency, and there is no Kit 11 chip", () => {
    for (const html of [ON, OFF]) {
      expect(html).toContain('<h1 class="h-hero"><span>AI agents spend.</span> <span>You sign off.</span></h1>');
      const t = text(outsideFold(mainOf(html)));
      const amounts = [...t.matchAll(/(\S+)\s+(\d+\.\d{2})\b/g)];
      expect(amounts.length).toBeGreaterThanOrEqual(3);
      for (const m of amounts) expect({ amount: m[2], unit: m[1] }).toEqual({ amount: m[2], unit: "EUR" });
      // The amount field carries its currency too: a label that reads "EUR".
      expect(html).toMatch(/<label class="hd-amt"[^>]*><span>EUR<\/span>\s*<b class="hd-num">240\.00<\/b>\s*<input class="hd-in"/);
      expect(html).not.toMatch(/Kit 11|x402 Business Agents|Built on|Competing for|Metal Award|Visa Award/);
    }
  });

  it("drops the Watch block, the awards, the mixed Visa wording and what comes next", () => {
    for (const html of [ON, OFF]) {
      const rest = html.replace(/<header class="top">[\s\S]*?<\/header>/, " ");
      expect(rest).not.toMatch(/\bWatch\b|href="watch"/);
      // The partners' logo row (homepage polish, 12 Nov) names Visa in its image's alt text; no other Visa wording and
      // never TAP on Home.
      // Visa on Home: the Visa Intelligent Commerce card (vic-3) and the logos' alt text; never TAP.
      expect(rest).not.toMatch(/TAP\b|Visa TAP|single-use Visa/);
      expect(html).not.toMatch(/Extra, not an award entry/);
      expect(html).not.toMatch(/What comes next|class="(?:awards|agents|next|built|runlabel)"/);
    }
  });

  it("keeps the full list in the What's real? fold: the main run's lines, the run behind the hero, the receipt's own note, the Metal test", () => {
    const fold = text(/<details class="real"[\s\S]*?<\/details>/.exec(ON)![0]);
    const awx = JSON.parse(read("docs/demo/airwallex-run.json")) as { note: string };
    const receipt = JSON.parse(read(HERO_RECEIPT_FILE)) as { note: string };
    // Step 4 runs on the published receipt of the approval of 7 November: the fold says whose passkey, as its note does.
    expect(HERO_RECEIPT_FILE).toBe("docs/runs/2026-11-07-awx-1/receipt-P-0002.json");
    expect(fold).toContain(`The hero's step 4 checks the published receipt of this approval in your browser: ${receipt.note}`);
    for (const line of [SECOND_APPROVER, CHAIN_TEST, awx.note, receipt.note, "Simulated: the customer and its agent, the supplier, the merchants' charges, the settlement"]) expect({ line, found: fold.includes(line) }).toEqual({ line, found: true });
    expect(awx.note).toContain("Merchant charges and SENT/PAID are the sandbox's simulation endpoints");
  });

  it("shows the line for small companies only when its demo has an address, and the design-partner link only when set", () => {
    expect(SMALL_COMPANY_DEMO_URL).toBe("");
    expect(NEXT_NEXT).toMatch(/^Next, not live yet:/);
    for (const html of [ON, OFF]) { expect(html).not.toContain(NEXT_NEXT); expect(html).not.toContain('class="next"'); expect(html).not.toContain(DESIGN_PARTNER_LABEL); }
    const url = "https://small.example.test/demo";
    const shown = homePage(undefined, { trySign: true, smallCompanyUrl: url });
    expect(mainOf(shown)).toContain(`<p class="next">${NEXT_NEXT} <a href="${url}" target="_blank" rel="noopener">Open its demo\u00a0↗</a></p>`);
    expect(mainOf(shown).indexOf('class="next"')).toBeGreaterThan(mainOf(shown).indexOf('class="btn big more"'));
    expect(shown.match(/class="btn\b/g)).toHaveLength(2);
    for (const bad of ["javascript:alert(1)", "http://plain.example.test", 'https://x.test/"><script>']) expect(homePage(undefined, { smallCompanyUrl: bad })).not.toContain('class="next"');
    expect(visibleWords(shown)).toBeLessThanOrEqual(250 + NEXT_NEXT.split(" ").length + 3);
  });

  it("A11: stays within 250 visible words", () => {
    expect(visibleWords(ON)).toBeLessThanOrEqual(250);
    expect(visibleWords(OFF)).toBeLessThanOrEqual(250);
  });
});
