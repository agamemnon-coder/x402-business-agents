// The final review before submission (4 Nov), site side: every page says what the main run's record says
// (docs/demo/main-run.json, read through src/redesign/run.ts), in one way, and labels each other record by its own run.
// One describe per finding of the review.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { publish } from "../src/autonomy/bus.js";
import { CHECK_PATHS, judgeMenu, startJudge } from "../src/cli/judge.js";
import { CHAIN_TEST, SANDBOX_SETTLED, SECOND_APPROVER, VISA_EXTRA_LINK, VISA_TAP_STATUS, WORLD_SETUP } from "../src/config/brand.js";
import { agentChat } from "../src/dashboard/agentStats.js";
import { railsView } from "../src/dashboard/rails.js";
import { describe as feedLine } from "../src/dashboard/snapshot.js";
import { openDb } from "../src/db/open.js";
import { homePage } from "../src/redesign/home.js";
import { proofPage } from "../src/redesign/proof.js";
import { agentRun, cardRaiseOf, decisionsOf, letThroughOf, loadRecord, payments, stopStory, stops, stopsLine, timings } from "../src/redesign/run.js";
import { buildPages } from "../src/relay/assets.js";
import { PAGE, TRY_PAGE, TRY_PAGE_OFFLINE, recordedLabel } from "../src/servers/dashboard.js";
import { deckHtml, type DeckShots } from "../src/submission/deck.js";
import { packFacts } from "../src/submission/facts.js";
import { trySignPage } from "../src/try/sign.js";

const { record } = loadRecord();
/** The words as a person reads them: tags gone, entities decoded, white space single. */
const words = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ");
/** A page's data block, as its script reads it. */
const block = <T>(html: string, id: string): T => JSON.parse(new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`).exec(html)![1]!) as T;
/** The page's own script (not a data block). */
const script = (html: string) => /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
const shots = new Proxy({}, { get: () => "" }) as DeckShots;

interface Enforcer { who: string; count: number; last: { reason: string; words: string; at: string; proof: { kind: string; ref: string } | null } | null }
interface Replay {
  label: string;
  figures: { stopped: number; keptOut: string; refusedPill: string; refusedNote: string; enforcedNote: string; claude: string };
  snapshot: { tower: { enforced: Enforcer[] }; agent_chat: { kind: string; text: string }[]; rails: { airwallex: { what: string; detail: string }[] }; feed: { event: string; text: string }[] };
}
const replay = block<Replay>(PAGE, "autonomy-data");

describe("1. the main run's CFO dashboard (/?autonomy) counts as Home, Watch and Proof do", () => {
  const st = stops(record);

  it("takes its stop figures from run.ts (Max, 5 Nov): the 16 stops in one sentence; #24 counted once, #37 counted as Metal's", () => {
    const story = stopStory(record), line = stopsLine(story);
    expect(story.total).toBe(16);
    const f = replay.figures;
    expect(f.stopped).toBe(story.total);
    // "Enforced by": Metal's refusals as the sentence counts them (#24 once, though it has two rows; and #37), the last
    // shown the one at the cap, with the refusal's tx; not 3.
    const metal = replay.snapshot.tower.enforced.find((e) => e.who === "metal")!;
    expect(metal.count).toBe(story.metal);
    expect(metal.count).toBe(st.metal + st.revoked);
    expect(metal.count).toBe(2);
    expect(metal.last).toMatchObject({ reason: "mandate_cap_exceeded", proof: { kind: "tx", ref: letThroughOf(record)!.tx } });
    expect(metal.last!.words).toMatch(/let through on purpose/);
    expect(replay.snapshot.tower.enforced.find((e) => e.who === "airwallex")!.count).toBe(st.airwallex);
    const detail = " Metal's 2: 1 over the mandate's cap, 1 on a mandate that had just been replaced.";
    expect(line).toBe("16 stops, nothing paid over a limit: one buy rule Claude set stopped 12 overpriced checks, Metal refused 2 purchases, the CFO rejected 1 proposal, and 1 planted instruction changed nothing.");
    expect(f.keptOut).toBe(`${line}${detail} The amount is what stayed out for good.`);
    expect(f.refusedPill).toBe("16 stops");
    expect(f.refusedNote).toBe(`As on Home and Proof: ${line}${detail}`);
    expect(f.enforcedNote).toBe(`In this run: ${line}${detail}`);
    expect(JSON.stringify(f)).not.toMatch(/all counted|stopped at a limit|over its cap; the CFO|1 \+ 1/i);
  });

  it("shows those figures: the page's script reads them for the KPI, the refusals, Enforced by and Claude", () => {
    const js = script(PAGE);
    for (const k of ["figures.keptOut", "figures.refusedPill", "figures.refusedNote", "figures.enforcedNote", "figures.claude"]) expect({ k, used: js.includes(k) }).toEqual({ k, used: true });
    expect(js).toContain("AUTONOMY.figures");
  });

  it("labels the Claude total for what it is: 58 calls in all, the agents' own 50 (USD 0.3170, as on Proof) and 8 that read documents", () => {
    const c = (record.snapshot as unknown as { claude: { calls: number; cost_usd_micros: number } }).claude;
    const s = record.snapshot.agent_stats;
    const agentCalls = s.reduce((n, a) => n + a.claude_calls, 0), agentUsd = (s.reduce((n, a) => n + a.cost_usd_micros, 0) / 1e6).toFixed(4);
    expect([c.calls, agentCalls, agentUsd]).toEqual([58, 50, "0.3170"]);
    // All of them, said as all of them, and adding up to Proof's: the agents' 50 and the reader's 8 (documents, reviews).
    expect(replay.figures.claude).toBe("58 Claude calls in all, $0.38: the agents' own 50 (USD 0.3170, as on Proof) and 8 more that read documents or review proposals.");
    expect(words(proofPage())).toContain(`${agentCalls} calls to Claude, each logged`);
  });

  it("words a refused purchase by who refused it (refused_by), never 'refused before signing' for Metal's refusal", () => {
    const db = openDb(":memory:");
    const at = (s: number) => new Date(Date.UTC(2026, 10, 3, 11, 23, s));
    publish(db, "upstream.refused", { seq: 24, supplier: "stockline", reason: "mandate_cap_exceeded", refused_by: "metal" }, "sourcing", "system", at(1));
    publish(db, "upstream.refused", { seq: 25, supplier: "none", reason: "buy_policy: the Sourcing agent chose not to buy", refused_by: "buy_policy" }, "sourcing", "system", at(2));
    publish(db, "upstream.refused", { seq: 41, supplier: "stockline", reason: "mandate_cap_exceeded: 0.04 is over the sourcing mandate's 0.03 a payment", refused_by: "purser" }, "sourcing", "system", at(3));
    publish(db, "upstream.refused", { seq: 42, supplier: "ridgeline", reason: "supplier_unavailable: 503", refused_by: "supplier" }, "sourcing", "system", at(4));
    expect(agentChat(db).map((c) => c.text)).toEqual([
      "A purchase from stockline was refused by Metal: mandate_cap_exceeded",
      "The Sourcing agent's own buy policy refused a purchase before signing: buy_policy: the Sourcing agent chose not to buy",
      "A purchase from stockline was refused by Purser before signing: mandate_cap_exceeded: 0.04 is over the sourcing mandate's 0.03 a payment",
      "ridgeline made no offer, so nothing was signed: supplier_unavailable: 503",
    ]);
  });

  it("in the replay, words the record's refusal lines from its ledger: #24 let through on purpose and refused by Metal", () => {
    const lines = replay.snapshot.agent_chat.filter((c) => c.kind === "world").map((c) => c.text);
    expect(lines.filter((x) => /refused before signing: mandate_cap_exceeded/.test(x))).toEqual([]);
    expect(lines).toContain("A purchase from stockline, let through on purpose, was refused by Metal: mandate_cap_exceeded");
    expect(lines.filter((x) => /^A purchase from none\b/.test(x))).toEqual([]);
    expect(lines.filter((x) => x.startsWith("The Sourcing agent's own buy policy refused a purchase before signing: buy_policy:"))).toHaveLength(3);
    // Watch tells these by their own rows (a money movement, a refusal), as before.
    expect(agentRun().events.filter((e) => e.k === "world" && /refused/.test(e.text))).toEqual([]);
  });
});

describe("2. What's real?, on each page its own", () => {
  const real = (html: string) => words(/<details class="real"[^>]*>[\s\S]*?<\/details>/.exec(html)?.[0] ?? "");
  const MAIN = "Real Claude decisions, real Metal testnet and Airwallex sandbox calls";

  it("/try/sign says what it is: a test world, no Airwallex payment or Metal call, no money, the live agents (Sonnet reads, Opus advises) labelled; none of the main run's lines", () => {
    // Its one "What's real?" is the expander under the disclaimer (6 Nov: the footer's copy is gone), found by position.
    const html = trySignPage(), a = html.indexOf('<details class="wr">');
    const r = words(html.slice(a, html.indexOf("</details>", a)));
    expect(a).toBeGreaterThan(0);
    expect(html).not.toContain('<details class="real"');
    expect(r).toContain("No payment or conversion at Airwallex, no Metal call, and no money moves");
    expect(r).toContain("read-only, nothing is converted, no money moves");
    expect(r).toContain("Only the invoice and the test world's facts go in, never anything you type");
    expect(r).toContain("No model sets an amount, a payee, the conversion or the plan");
    expect(r).toContain("labelled “recorded: the live agent was unavailable” with the reason");
    expect(r).toContain("no money moves");
    for (const x of [MAIN, WORLD_SETUP, SECOND_APPROVER, "Ridgeline"]) expect({ x, has: r.includes(x) }).toEqual({ x, has: false });
  });

  it("the main run's pages keep the main run's lines", () => {
    const pages = buildPages();
    for (const [name, html] of Object.entries({ home: pages.home!, watch: pages.watch!, proof: pages.proof!, metal: pages.metal, airwallex: pages.airwallex!, visa: pages.visa, claude: pages.claude! })) {
      expect({ name, main: real(html).includes(MAIN), setup: real(html).includes(WORLD_SETUP) }).toEqual({ name, main: true, setup: true });
    }
  });

  it("/try says what is real in either mode: the hosted page never says 'offline copy'; the offline copy never says Claude reads it", () => {
    const realbox = (h: string) => words(/<div class="realbox"[\s\S]*?<\/div>/.exec(h)![0]);
    const main = (h: string) => words(/<main>[\s\S]*<\/main>/.exec(h)![0]);
    expect(TRY_PAGE).not.toMatch(/offline copy/i);
    expect(realbox(TRY_PAGE)).toContain("Claude Haiku sorts your request and Claude Sonnet reads it");
    expect(realbox(TRY_PAGE_OFFLINE)).toContain("In this offline copy no model is asked");
    expect(main(TRY_PAGE_OFFLINE)).not.toMatch(/Claude reads your task|Claude Haiku sorts it and Claude Sonnet reads it|decides with Claude Haiku/);
    for (const h of [TRY_PAGE, TRY_PAGE_OFFLINE]) {
      expect(realbox(h)).toContain("nothing on this page calls Airwallex or Metal");
      expect(realbox(h)).toContain("the run recorded on 30 October");
      for (const x of [MAIN, WORLD_SETUP, SECOND_APPROVER]) expect({ x, has: realbox(h).includes(x) }).toEqual({ x, has: false });
    }
    // One script and one style for both, so both answer under the one CSP.
    const code = (h: string) => [script(h), /<style>([\s\S]*?)<\/style>/.exec(h)![1]];
    expect(code(TRY_PAGE_OFFLINE)).toEqual(code(TRY_PAGE));
    // The offline copy's script words come in its own data block; the hosted page has none.
    expect(block<{ offline: unknown }>(TRY_PAGE, "try-data").offline).toBe(false);
    expect(block<{ offline: { example: string } }>(TRY_PAGE_OFFLINE, "try-data").offline.example).toContain("in this offline copy code alone reads it");
  });

  it("npm run judge serves the offline copy at /try; the relay bundle carries the hosted page", async () => {
    const { server, url } = await startJudge(0);
    try {
      expect(await (await fetch(`${url}/try`)).text()).toBe(TRY_PAGE_OFFLINE);
    } finally {
      server.close();
    }
    expect(buildPages().try).toBe(TRY_PAGE);
  });
});

describe("3. /claude lists every decision the headline counts", () => {
  it("24 decisions (Sourcing 11, Support 4, Treasury 9), one per trace in the record, each with its Claude call", () => {
    const s = record.snapshot.agent_stats;
    const fold = /<summary>Every decision, with its Claude call<\/summary><ul class="pl">([\s\S]*?)<\/ul>/.exec(buildPages().claude!)![1]!;
    const items = [...fold.matchAll(/<li class="ok">([\s\S]*?)<\/li>/g)].map((m) => words(m[1]!).trim());
    expect(items).toHaveLength(s.reduce((n, a) => n + a.decisions, 0));
    expect(items).toHaveLength(24);
    for (const a of s) expect({ agent: a.agent, n: items.filter((t) => t.startsWith(`${a.agent[0]!.toUpperCase()}${a.agent.slice(1)},`)).length }).toEqual({ agent: a.agent, n: a.decisions });
    for (const t of record.snapshot.traces) for (const id of t.request_ids ?? []) expect(fold).toContain(id);
    // The three the agents' chat does not hold: Support's settlement (the refunds and P-0004), Treasury's plan, its timing advice.
    expect(decisionsOf(record).map((d) => d.seq)).toEqual(expect.arrayContaining([303, 145, 348]));
    expect(items.some((t) => /^Support, 11:28 UTC: Refunded #7, #10, #13 itself and sent 9 to the CFO \(P-0004\)/.test(t))).toBe(true);
    expect(items.some((t) => /^Treasury, 11:24 UTC: Planned sourcing 14\.00/.test(t))).toBe(true);
    expect(items.some((t) => /^Treasury, 11:30 UTC: Advised paying SLL-2026-11 \(P-0005\)/.test(t))).toBe(true);
  });
});

describe("4. the red team, said as its records say it", () => {
  const rt = JSON.parse(readFileSync(new URL("../docs/redteam/report.json", import.meta.url), "utf8")) as { attempts: number; caught_after: number; results: { caught: string }[] };
  const before = rt.results.filter((r) => r.caught === "before").length, after = rt.results.filter((r) => r.caught === "after").length;

  it("is 37 of 39 stopped and 2 detected afterwards (30 October), never '39/39 attacks failed'", () => {
    expect([before, after, rt.attempts, rt.caught_after]).toEqual([37, 2, 39, 2]);
    const t = words(proofPage());
    expect(t).toContain(`${before}/${rt.attempts} attacks stopped`);
    expect(t).toContain(`${after} more detected afterwards, not prevented`);
    expect(t).not.toMatch(/39\/39|39 of 39|attacks failed/);
  });

  it("gives the later run it summarises with its scope, and links the latest runs' report", () => {
    const loop = JSON.parse(readFileSync(new URL("../docs/evals/autonomy-redteam.json", import.meta.url), "utf8")) as { summary: { runs: number; held: number } };
    const html = proofPage(), t = words(html);
    expect(t).toContain(`${loop.summary.held} of ${loop.summary.runs} runs held`);
    expect(t).toContain("the Sourcing agent on Haiku, simulated rails");
    expect(html).toContain('href="https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-02-night-batch.md#5-red-team-opus-as-the-attacker"');
  });

  it("is said the same way in the dashboard's script and the deck", () => {
    expect(PAGE).not.toMatch(/attacks failed/);
    const deck = words(deckHtml(packFacts(), shots, ""));
    expect(deck).toContain(`${before} of ${rt.attempts} attacks stopped, ${after} more detected afterwards, not prevented`);
    expect(deck).not.toMatch(/attacks failed/);
  });
});

describe("5. PAID in the sandbox, where the settlement is simulated", () => {
  it("keeps 6 s as the measured time, and says the settlement is simulated wherever a page states it", () => {
    expect(SANDBOX_SETTLED).toBe("in the sandbox, where the settlement is simulated");
    expect(timings(record).faceToPaid).toBe(6);
    const pages = buildPages();
    // The moment's own step (src/redesign/run.ts) keeps the qualifier; Home shows no scene text since 7 Nov (Max).
    // Review 9 Nov: the headline is that Airwallex accepted the signed payment, not "PAID" (the settlement is simulated).
    expect(agentRun().scenes[2]!.steps.map((s) => s.text)).toContain(`€240 licence by SWIFT, accepted by Airwallex with the signed hash · ${SANDBOX_SETTLED}`);
    expect(words(pages.airwallex!)).toContain(`Airwallex accepted it with the signed hash; ${SANDBOX_SETTLED}`);
    expect(words(pages.airwallex!)).not.toMatch(/PAID by SWIFT/);
    for (const [name, html] of Object.entries({ home: homePage(), proof: proofPage(), watch: pages.watch!, airwallex: pages.airwallex!, dashboard: PAGE })) {
      const t = words(html);
      for (const m of t.matchAll(/\d+ s after Face ID/g)) expect({ name, said: t.slice(m.index, m.index + 90).includes(SANDBOX_SETTLED) }).toEqual({ name, said: true });
    }
  });

  it("qualifies the SWIFT payout's PAID on Proof, /airwallex and the dashboard's replay (its rails and its feed)", () => {
    const pages = buildPages();
    for (const [name, html] of Object.entries({ proof: proofPage(), airwallex: pages.airwallex! })) expect({ name, has: words(html).includes(`EUR 240.00 to the allowlisted supplier, PAID ${SANDBOX_SETTLED}, fee EUR 13.42`) }).toEqual({ name, has: true });
    expect(replay.snapshot.rails.airwallex.find((x) => x.what === "SWIFT payout of an invoice")!.detail).toContain(`PAID ${SANDBOX_SETTLED}`);
    const paid = replay.snapshot.feed.filter((f) => f.event === "transfer.status" && /PAID/.test(f.text));
    expect(paid.length).toBeGreaterThan(0);
    for (const f of paid) expect(f.text).toBe(`Transfer PAID ${SANDBOX_SETTLED}`);
    expect(words(pages.airwallex!)).toContain("Purser moves the sandbox transfer to SENT, then PAID, through Airwallex's simulation API");
  });

  it("says so where the words are made, for the live dashboard and later recordings", () => {
    const row = { seq: 1, ts: "2026-11-03T11:31:24.283Z", actor: "awx-executor", event: "transfer.status", subject: "tr1", payload_json: JSON.stringify({ status: "PAID" }), row_hash: "h" };
    expect(feedLine(row, () => undefined).text).toBe(`Transfer PAID ${SANDBOX_SETTLED}`);
    const db = openDb(":memory:");
    db.prepare("INSERT INTO invoices (invoice_no, vendor, amount, currency, due_date, iban_sha256, bic, doc_sha256, status) VALUES ('SLL-1', 'Stockline Data GmbH', '240.00', 'EUR', '2026-11-15', 'x', 'x', 'x', 'RECEIVED')").run();
    db.prepare("INSERT INTO transfers (transfer_id, request_id, invoice_no, amount, currency, method, fee_estimate, fee_actual, status, approval_sha256, updated_at) VALUES ('tr1', 'req1', 'SLL-1', '240.00', 'EUR', 'SWIFT', '20.00', 'EUR 13.42', 'PAID', 'h', '2026-11-03T11:31:24.283Z')").run();
    expect(railsView(db).airwallex.find((x) => x.what === "SWIFT payout of an invoice")!.detail).toBe(`EUR 240.00 to the allowlisted supplier, PAID ${SANDBOX_SETTLED}, fee EUR 13.42; the approval hash is in the transfer's metadata`);
  });
});

describe("6. TAP's status (Visa, 5 Nov: not eligible Visa tooling), said once, on /visa", () => {
  it("is on /visa only; Home and Proof link to /visa as an extra, not an award entry; the Visa Award only in the Kit line (since 7 Nov, on the VIC run), never on TAP", () => {
    const pages = buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv) as unknown as Record<string, unknown>;
    expect(String(pages.visa)).toContain(VISA_TAP_STATUS);
    for (const [name, body] of Object.entries(pages)) if (typeof body === "string" && name !== "visa") expect({ name, has: body.includes(VISA_TAP_STATUS) }).toEqual({ name, has: false });
    // Home links it; Proof no longer does (12 Nov, jury: Proof starts with the guarantees, the footer link left it).
    for (const [name, html, link] of [["home", homePage(), true], ["proof", proofPage(), false]] as const) expect({ name, link: /<a [^>]*href="visa"[^>]*>Extra, not an award entry: Visa TAP[^<]*<\/a>/.test(html) && html.includes(VISA_EXTRA_LINK) }).toEqual({ name, link });
    expect(proofPage()).not.toContain(VISA_EXTRA_LINK);
    for (const [name, body] of Object.entries(pages)) if (typeof body === "string") expect({ name, entered: /\+ Visa Award|TAP counts as Visa tooling/i.test(body) || /Visa Award/i.test(body.split("entered for the Metal Award and the Visa Award").join(" ")) }).toEqual({ name, entered: false });
  });
});

describe("7. copy slips", () => {
  it("Home's first scene says the purchase Metal refused was a test of the chain: our own check switched off once (jury review, 6 Nov, #8)", () => {
    expect(agentRun().scenes[0]!.sentence).toBe("Stockline raises its price to 0.04 → we switched off our own check once to prove the chain holds the line: Metal refused the purchase on chain → Treasury replans → two signatures → the mandate is replaced.");
    // Home shows no scene cards since Max's round of 7 Nov; where the refusal is replayed (/watch), its step says why,
    // as the chain test (jury review, 7 Nov, #13: not the Defense-in-depth label beside it).
    expect(homePage()).not.toContain('class="scene card"');
    expect(buildPages().watch!).toContain(CHAIN_TEST);
    expect(buildPages().watch!).not.toContain("To prove the rail itself enforces the limit");
    // Both layers where the refusal is told in full: Purser refuses first; with that check off once, Metal refused anyway.
    for (const html of [proofPage(), buildPages().metal]) expect(words(html)).toContain(CHAIN_TEST);
  });

  it("/visa's 'no approval' line is true: none in the TAP run; in the main run the card buy came after the CFO's Face ID on P-0006", () => {
    const raise = cardRaiseOf(record)!;
    expect(raise).toMatchObject({ proposal: "P-0006", from: "30.00", to: "46.00" });
    const t = words(buildPages().visa);
    expect(t).not.toContain("No approval was asked for or given in this run.");
    expect(t).toContain("In the separate TAP run (2 November) no approval was asked for or given. In the main run the card buy came after the CFO approved P-0006 with Face ID, which raised the card's limit per purchase from EUR 30.00 to EUR 46.00.");
  });

  it("Proof's note under the payments reads as a sentence", () => {
    const pay = payments(record);
    const t = words(proofPage());
    expect(t).not.toMatch(/purchases of:/);
    expect(t).toContain(`${pay.metalParts} on Metal, all inside the limits.`);
  });

  it("leaves the separate TAP run of 2 November out of Home, Proof and the deck: it is on /visa (Max, 5 Nov; Proof since his last round, item 2; Home since 7 Nov)", () => {
    expect(deckHtml(packFacts(), shots, "")).not.toMatch(/TAP run|2 November|LIMIT_EXCEEDED/);
    expect(proofPage()).not.toMatch(/class="(?:septest|sep)"|TAP run|LIMIT_EXCEEDED/);
    expect(homePage()).not.toMatch(/class="(?:septest|sep)"|TAP run|LIMIT_EXCEEDED/);
    for (const [name, html] of Object.entries({} as Record<string, string>)) {
      expect({ name, label: /Separate test, 2 November/.test(html) }).toEqual({ name, label: false });
      const rows = html.match(/<p class="(?:septest|sep)">[\s\S]*?<\/p>/g) ?? [];
      expect({ name, rows: rows.length > 0 }).toEqual({ name, rows: true });
      for (const row of rows) expect({ name, times: (row.match(/2 November/g) ?? []).length }).toEqual({ name, times: 1 });
    }
  });
});

describe("8. npm run judge names each CFO dashboard by its run", () => {
  it("offers the main run's dashboard (/?autonomy) first, and /?recorded as the 30 October run", () => {
    const menu = judgeMenu("http://localhost:4311");
    const a = menu.findIndex((l) => /\/\?autonomy\s/.test(l)), r = menu.findIndex((l) => /\/\?recorded\s/.test(l));
    expect(a).toBe(1);
    expect(r).toBeGreaterThan(a);
    expect(menu[a]).toContain("the main run's CFO dashboard (3 November)");
    expect(menu[r]).toContain("the 30 October run (an earlier recording)");
    expect(menu.join("\n")).not.toMatch(/end of the recorded run/);
    expect(CHECK_PATHS).toEqual(expect.arrayContaining(["/?autonomy", "/?recorded"]));
  });

  it("says in /?recorded's label line that it is the 30 October run", () => {
    const rec = block<{ recorded_at: string; label: string }>(PAGE, "recorded-data");
    expect(rec.recorded_at.slice(0, 10)).toBe("2026-10-30");
    expect(rec.label).toBe("Recorded run · the 30 October run, an earlier recording · test money · nothing here is live");
    expect(recordedLabel(rec as never)).toBe(rec.label);
    expect(script(PAGE)).toContain("RECORDED.label");
  });
});
