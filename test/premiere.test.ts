// The premiere (src/film/premiere.ts, premiereScript.ts, premiere.html): every figure on screen and in the voice-over
// is the main run's record's (docs/demo/main-run.json), counted here again from the raw record; the build stops when a
// figure is missing; the page types in no figure of its own; the /try/sign mock says what the live page says; and the
// script, subtitles and read-aloud script in docs/video/ are the ones the code writes.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLOSING, MAIN_RUN_FILE, TRY_SIGN_URL, TRY_SIGN_WORDS, buildPremiere, premiereFacts, premierePage, spoken, testLine, trySignExample, type MainRun, type PremiereData } from "../src/film/premiere.js";
import { MASTER_CLIPS, OVERLAYS, PREMIERE_SCENES, clock, factsUsed, lineSeconds, premiereBeats, premiereReadAloud, premiereSeconds, premiereSrt, premiereTable, premiereTimeline, voiceTimeline } from "../src/film/premiereScript.js";
import { agentRun } from "../src/redesign/run.js";
import { TRY_URL } from "../src/submission/deck.js";
import { TRY_SIGN_LABEL, trySignPage } from "../src/try/sign.js";
import { DEFENSE_IN_DEPTH } from "../src/config/brand.js";
import { FIXED_PROPOSALS, TEST_WORLD, canonical, checkPayment } from "../worker/src/trySign.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const README = read("README.md");
const raw = () => JSON.parse(read(MAIN_RUN_FILE)) as MainRun & { ledger: NonNullable<MainRun["ledger"]> };
const data = buildPremiere(raw(), README);
const fact = (k: string) => data.facts[k]!.value;
const screen = (id: string) => data.screen[id] as Record<string, unknown>;
const toSeconds = (t: string) => { const [h, m, s] = t.split(":"); return Number(h) * 3600 + Number(m) * 60 + Number(s!.replace(",", ".")); };
const timeline = premiereTimeline();
const scenesForPage = timeline.map((s) => ({ id: s.id, start: s.start, seconds: s.seconds, kind: s.kind }));

describe("the premiere's figures are the main run's record's", () => {
  // Counted again here from the raw record, by other code than the film's.
  const r = raw();
  const ev = r.ledger.events;
  const byEvent = (name: string) => ev.filter((e) => e.event === name);

  it("the price rise: 0.02 → 0.04 over the 0.03 cap, let through once, refused by Metal, its tx on chain", () => {
    const lt = byEvent("upstream.let_through")[0]!;
    const chain = byEvent("upstream.refused_on_chain")[0]!;
    const first = r.snapshot.flows.find((f) => f.kind === "upstream" && !f.refused)!;
    expect({ old: fact("price.old"), new: fact("price.new"), cap: fact("price.cap"), tx: fact("price.tx"), at: fact("price.txAt") })
      .toEqual({ old: (Number(first.amount) / first.count!).toFixed(2), new: lt.payload.amount, cap: lt.payload.bound_cap, tx: chain.payload.tx, at: chain.ts.slice(11, 19) });
    expect(fact("price.tx")).toBe("0x2e92f9cb4549246f58b9b888881c258bf117c6233c1d8f126f4833ae6ae41871");
    expect([fact("price.old"), fact("price.new"), fact("price.cap")]).toEqual(["0.02", "0.04", "0.03"]);
    expect(screen("05-price-rise")).toMatchObject({ from: "0.02", to: "0.04", capValue: "0.03", tx: "0x2e92f9cb…1871", txWhere: "testnet.metalntwx.com · 11:23:33 UTC" });
    // The run's own label, word for word, and the short honest line Max asked for.
    expect(screen("05-price-rise").label).toBe(DEFENSE_IN_DEPTH);
    expect(screen("05-price-rise").letThrough).toBe("Let through on purpose. Purser normally refuses first.");
  });

  it("the dispute: 12 orders, all signed; #7, #10, #13 refunded by Support (0.15); the other 9 rejected with Face ID", () => {
    const d = r.ledger.disputes[0]!;
    const refunds = byEvent("refund.paid").filter((e) => e.actor === "support");
    const batch = r.ledger.proposals.find((p) => p.kind === "refund_batch")!;
    expect(screen("06-dispute").orders).toEqual(d.claims.sale_refs.map((n) => `#${n}`));
    expect(screen("06-dispute").refunded).toEqual(refunds.map((e) => `#${e.subject}`));
    expect({ count: fact("dispute.count"), signed: fact("dispute.signed"), refunded: fact("dispute.refunded"), total: fact("dispute.refundTotal"), rest: fact("dispute.rest"), proposal: fact("dispute.proposal") })
      .toEqual({ count: "12", signed: String(d.evidence.filter((e) => e.signed_order).length), refunded: "#7 #10 #13", total: (refunds.reduce((n, e) => n + Number(e.payload.amount), 0)).toFixed(2), rest: String((batch.terms.refunds as unknown[]).length), proposal: batch.proposal_id });
    expect([fact("dispute.signed"), fact("dispute.refundTotal"), fact("dispute.rest")]).toEqual(["12", "0.15", "9"]);
    expect(batch.status).toBe("REJECTED");
    expect(fact("dispute.rejectedAt")).toBe(byEvent("proposal.rejected")[0]!.ts.slice(11, 19));
    expect(screen("06-dispute").claim).toBe("“Our agent never placed orders #5 to #16.”");
  });

  it("6 seconds from Face ID to PAID, as the run log says; transfer 03360bfa…3985 and its FX first", () => {
    const approved = byEvent("proposal.approved").find((e) => e.subject === "P-0005")!;
    const paid = byEvent("transfer.status").find((e) => e.payload.status === "PAID")!;
    const ms = Date.parse(paid.ts) - Date.parse(approved.ts);
    expect(ms).toBeGreaterThan(5500);
    expect(ms).toBeLessThan(6500);
    expect(fact("paid.seconds")).toBe("6");
    expect(read("docs/runs/2026-11-03-main-run.md")).toContain("6 s from Face ID to PAID");
    expect(fact("paid.transfer")).toBe("03360bfa-afce-457b-89d1-e1097fbe3985");
    expect(screen("09-six-seconds")).toMatchObject({ big: "6", unit: "seconds", transfer: "03360bfa-afce-457b-89d1-e1097fbe3985" });
    expect(screen("09-six-seconds").steps).toEqual([["11:31:18", "Face ID"], ["11:31:19", "FX · EUR 110.00 for USD 124.29"], ["11:31:21", "SWIFT · EUR 240.00"], ["11:31:24", "PAID"]]);
    expect(String(screen("09-six-seconds").foot)).toMatch(/sandbox simulates .*PAID/);
  });

  it("the approval card is P-0005's exact terms: the Treasury agent's plan, its hash the one Max signed", () => {
    const p = r.ledger.proposals.find((x) => x.proposal_id === "P-0005")!;
    const approved = byEvent("proposal.approved").find((e) => e.subject === "P-0005")!;
    expect(screen("07-approval").what).toBe(`Pay ${p.terms.vendor} EUR ${p.terms.amount} by ${p.terms.method}`);
    expect(screen("07-approval").rows).toEqual([["Invoice", p.terms.invoice_no], ["Buy first", "EUR 110.00 for USD 124.29"], ["Fee at most", `EUR ${p.terms.fee_max}`], ["Planned by", "Treasury agent · Claude Opus"], ["Expires", "11:45:01 UTC"]]);
    expect(fact("licence.hash")).toBe(approved.payload.terms_sha256);
    expect(String(screen("07-approval").hash)).toBe(`${fact("licence.hash").slice(0, 16)}…${fact("licence.hash").slice(-8)}`);
  });

  it("the spec cards: the README's test line, 412 audit rows (chain intact), 2 stopped at a limit, 24/24 by Claude", () => {
    const t = /\*\*(\d+) tests in (\d+) files, all passing\*\*/.exec(README)!;
    const cards = screen("13-specs").cards as { big: string; label: string; small: string }[];
    const st = r.snapshot.agent_stats;
    expect(cards.map((c) => c.big)).toEqual([t[1], String(r.snapshot.audit.rows), "2", `${st.reduce((n, a) => n + a.by_claude, 0)}/${st.reduce((n, a) => n + a.decisions, 0)}`]);
    expect(cards.map((c) => c.big).slice(1)).toEqual(["412", "2", "24/24"]);
    expect(r.snapshot.audit.intact).toBe(true);
    expect(cards[2]!.small).toBe("Metal 1 · the CFO 1 · in the main run");
    expect(cards[3]!.small).toBe("Sourcing 11 · Support 4 · Treasury 9 · 0 fallbacks");
  });

  it("agrees with the site's own counts (src/redesign/run.ts): stopped at a limit, Face ID to PAID, decisions", () => {
    const d = agentRun().derived;
    expect({ stopped: fact("specs.stopped"), faceToPaid: fact("paid.seconds"), byClaude: fact("specs.byClaude"), decisions: fact("specs.decisions"), faceIds: fact("run.faceIds") })
      .toEqual({ stopped: d.stopped, faceToPaid: d.faceToPaid, byClaude: d.byClaude, decisions: d.decisions, faceIds: d.faceId });
  });

  it("says the figures the same way in the voice-over", () => {
    const said = Object.values(data.voice).flat().map((l) => l.text).join(" ");
    for (const w of ["twelve orders", "All twelve were signed", "the three with wrong data", "Refund the other nine", "Six seconds from Face ID to paid", "Two stopped at a limit", "Twenty-four of twenty-four decisions by Claude", "three Claude agents", "doubled its price"]) expect(said).toContain(w);
    expect(spoken(24)).toBe("twenty-four");
    expect(() => spoken(120)).toThrow();
  });

  it("lists a source for every figure a scene uses", () => {
    for (const s of PREMIERE_SCENES) for (const k of factsUsed(s.id)) expect({ scene: s.id, k, source: !!data.facts[k]?.source }).toEqual({ scene: s.id, k, source: true });
  });
});

describe("the premiere refuses to render when a figure is missing", () => {
  const broken: [string, (r: ReturnType<typeof raw>) => void, RegExp][] = [
    ["the purchase let through", (r) => { r.ledger.events = r.ledger.events.filter((e) => e.event !== "upstream.let_through"); }, /upstream\.let_through/],
    ["the refusal on chain", (r) => { r.ledger.events = r.ledger.events.filter((e) => e.event !== "upstream.refused_on_chain"); }, /refused_on_chain/],
    ["the transfer's PAID", (r) => { r.ledger.events = r.ledger.events.filter((e) => !(e.event === "transfer.status" && e.payload.status === "PAID")); }, /transfer\.status/],
    ["the Face ID on the licence", (r) => { r.ledger.events = r.ledger.events.filter((e) => !(e.event === "proposal.approved" && e.subject === "P-0005")); }, /proposal\.approved/],
    ["the FX", (r) => { r.ledger.events = r.ledger.events.filter((e) => e.event !== "fx.converted"); }, /fx\.converted/],
    ["the dispute", (r) => { r.ledger.disputes = []; }, /dispute case/],
    ["the Support agent's refunds", (r) => { r.ledger.events = r.ledger.events.filter((e) => e.event !== "refund.paid"); }, /refund by the Support agent/],
    ["the CFO's rejection", (r) => { r.ledger.events = r.ledger.events.filter((e) => e.event !== "proposal.rejected"); }, /proposal\.rejected/],
    ["the agents' statistics", (r) => { r.snapshot.agent_stats = []; }, /agent statistics/],
    ["an intact audit chain", (r) => { r.snapshot.audit.intact = false; }, /intact audit chain/],
    ["the ledger", (r) => { delete (r as Partial<MainRun>).ledger; }, /ledger/],
    ["a refund the totals do not add up to", (r) => { r.ledger.disputes[0]!.claims.sale_refs.push(99); }, /do not add up/],
  ];
  for (const [what, breakIt, why] of broken) {
    it(`without ${what}`, () => {
      const r = raw();
      breakIt(r);
      expect(() => buildPremiere(r, README)).toThrow(why);
      expect(() => buildPremiere(r, README)).toThrow(/^premiere: /);
    });
  }

  it("without the README's test line", () => {
    expect(() => buildPremiere(raw(), README.replace(/\*\*\d+ tests in \d+ files, all passing\*\*/, "the tests"))).toThrow(/README has no test line/);
    expect(testLine("**2,181 tests in 241 files, all passing**")).toEqual({ tests: "2181", files: "241" });
  });

  it("builds nothing it cannot fill: the page is made from the data alone", () => {
    const html = premierePage(data, scenesForPage);
    expect(html).not.toContain("__PREMIERE_JSON__");
    const block = /<script type="application\/json" id="premiere-data">([\s\S]*?)<\/script>/.exec(html)![1]!;
    expect(JSON.parse(block)).toEqual({ screen: data.screen, scenes: scenesForPage });
  });
});

describe("the premiere's page", () => {
  const template = read("src/film/premiere.html");
  const script = /<script>([\s\S]*?)<\/script>/.exec(template)![1]!;

  it("types in no figure: no string in its script holds a digit (every figure is in the data)", () => {
    const literals = [...script.replace(/\/\/[^\n]*/g, "").matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1]!);
    expect(literals.length).toBeGreaterThan(100);
    // Scene ids ("05-price-rise") are names, not figures.
    expect(literals.filter((s) => /\d/.test(s) && !PREMIERE_SCENES.some((x) => x.id === s))).toEqual([]);
  });

  it("draws every scene of the script, and nothing else", () => {
    const built = [...script.matchAll(/^ {4}"(\d\d-[a-z0-9-]+)": function/gm)].map((m) => m[1]);
    expect(built).toEqual(PREMIERE_SCENES.map((s) => s.id));
    for (const s of PREMIERE_SCENES) expect({ s: s.id, screen: !!data.screen[s.id] }).toEqual({ s: s.id, screen: true });
  });

  it("shows no logo of others and letterboxes to 2.39:1 inside 1920x1080", () => {
    expect(template).not.toMatch(/<img|logo-|\.png|\.svg"/);
    expect(template).toMatch(/#pic \{[^}]*top: 138px; width: 1920px; height: 804px;/);
    expect(1920 / 804).toBeCloseTo(2.39, 2);
    expect(template).toMatch(/\.bar\.top \{ top: 0; \} \.bar\.bot \{ top: 942px; \}/);
  });
});

describe("the /try/sign mock says what the live page says", () => {
  const page = trySignPage();
  it("word for word, from the page's own code", () => {
    for (const [k, w] of Object.entries(TRY_SIGN_WORDS)) {
      // The hash note is two strings on the page ("… which your passkey signs" + " (checked on this device):").
      for (const part of k === "hashNote" ? w.split(/(?= \()/) : [w]) expect({ k, on: page.includes(part) }).toEqual({ k, on: true });
    }
    expect(screen("10-try-sign").label).toBe(TRY_SIGN_LABEL);
  });

  it("with the page's own proposal and its tamper step: EUR 1,850.00, then EUR 1,850.01", () => {
    const p = FIXED_PROPOSALS.find((x) => x.id === fact("try.proposal"))!;
    const c = checkPayment(p.amount, TEST_WORLD.balance);
    expect(c.check).toBe("pass");
    expect(screen("10-try-sign")).toMatchObject({ says: p.says, waits: c.check === "pass" ? c.waits : "" });
    expect(screen("10-try-sign").facts).toEqual([["Pay", p.payee], ["Amount", "EUR 1,850.00"], ["Reference", p.reference], ["Proposal", p.id]]);
    expect(screen("11-one-cent")).toMatchObject({ from: "EUR 1,850.00", plus: "+0.01", to: "EUR 1,850.01", last: "One cent. Worthless." });
    expect(fact("try.hash")).toMatch(/^[0-9a-f]{64}$/);
    expect(fact("try.tamperedHash")).not.toBe(fact("try.hash"));
  });

  it("points at the live page, the same address as the deck's", () => {
    expect(TRY_SIGN_URL).toBe(`${TRY_URL}/sign`);
    expect(screen("16-end").url).toBe("https://kit11.max-31b.workers.dev/try/sign");
  });
});

describe("the premiere's script", () => {
  it("fits in three minutes: 2:49, the line on black and then the pen, no hook (cut, Max, 4 Nov)", () => {
    expect(premiereSeconds()).toBeLessThanOrEqual(180);
    expect(premiereSeconds()).toBe(169);
    expect(timeline.at(-1)!.start + timeline.at(-1)!.seconds).toBe(premiereSeconds());
    expect(timeline.slice(0, 2).map((s) => [s.id, s.start])).toEqual([["01-line", 0], ["03-pen", 3]]);
    expect(PREMIERE_SCENES.map((s) => s.id).filter((id) => id.startsWith("02"))).toEqual([]);
    expect(Object.keys(data.screen).filter((id) => id.startsWith("02"))).toEqual([]);
    expect(PREMIERE_SCENES.filter((s) => s.kind === "slot").map((s) => s.id)).toEqual(["08-faceid", "15-close"]);
    expect(OVERLAYS).toEqual(["08-faceid", "10-try-sign", "15-close"]);
    expect(JSON.stringify(data.screen).replace(String((screen("16-end").credits as { ai: string }).ai), "")).not.toMatch(/AI-generated|AI hook/);
  });

  it("records one clip per scene from the page, and the AI-voice end card as a spare outside the master", () => {
    const beats = premiereBeats(data);
    expect(beats.map((b) => b.id)).toEqual([...PREMIERE_SCENES.map((s) => s.id), "16-end-ai-voice"]);
    expect(beats.slice(0, -1).map((b) => b.shots[0]!.path)).toEqual(timeline.map((s) => `/premiere?manual&from=${s.start}`));
    expect(beats.at(-1)!.shots[0]!.path).toMatch(/credits=ai$/);
    expect(MASTER_CLIPS).not.toContain("16-end-ai-voice");
  });

  it("gives each voice-over line time to be said before the next one and inside its scene", () => {
    for (const s of timeline) {
      const lines = data.voice[s.id] ?? [];
      lines.forEach((l, i) => {
        const end = l.at + lineSeconds(l.text);
        const next = i + 1 < lines.length ? lines[i + 1]!.at : s.seconds;
        expect({ scene: s.id, line: l.text.slice(0, 30), fits: end <= next }).toEqual({ scene: s.id, line: l.text.slice(0, 30), fits: true });
      });
    }
  });

  it("lets only Max say his own lines (an AI voice, if any, never speaks as Max)", () => {
    for (const [id, lines] of Object.entries(data.voice)) for (const l of lines) {
      if (/\bI'm\b|\bI signed\b|\bmy\b/i.test(l.text)) expect({ id, who: l.who }).toEqual({ id, who: "Max" });
    }
    expect(Object.entries(data.voice).filter(([, ls]) => ls.some((l) => l.who === "Max")).map(([id]) => id)).toEqual(["03-pen", "15-close"]);
    expect(data.voice["15-close"]!.map((l) => l.text).join(" ")).toBe(CLOSING.join(" "));
  });

  it("times the subtitles in order, inside the film, carrying every word of the voice-over", () => {
    const cues = premiereSrt(data).trim().split(/\n\n/).map((c) => { const [, time, ...text] = c.split("\n"); const [a, b] = time!.split(" --> "); return { a: toSeconds(a!), b: toSeconds(b!), text: text.join(" ") }; });
    for (let i = 0; i < cues.length; i++) {
      expect(cues[i]!.b).toBeGreaterThan(cues[i]!.a);
      if (i) expect(cues[i]!.a).toBeGreaterThanOrEqual(cues[i - 1]!.b);
      expect(cues[i]!.text.split(/\s+/).length).toBeGreaterThanOrEqual(3);
    }
    expect(cues.at(-1)!.b).toBeLessThanOrEqual(premiereSeconds());
    expect(cues.map((c) => c.text).join(" ").split(/\s+/)).toEqual(voiceTimeline(data).map((l) => l.text).join(" ").split(/\s+/));
    // Nothing is said in the silence of "One cent. Worthless."
    const cent = timeline.find((s) => s.id === "11-one-cent")!;
    expect(cues.filter((c) => c.b > cent.start && c.a < cent.start + cent.seconds)).toEqual([]);
  });

  it("claims nothing the run does not support", () => {
    const words = JSON.stringify(data.screen) + JSON.stringify(data.voice) + premiereTable(data);
    expect(words).not.toMatch(/code decides|certif|0 unsafe|never fails|cannot be broken|guarantee/i);
    // T:0: built, not live; the film never shows a T:0 booking as done.
    const t0 = [...(JSON.stringify(data.screen) + JSON.stringify(data.voice)).matchAll(/T:0[^"]*/g)].map((m) => m[0]);
    expect(t0).toEqual(["T:0: built, not yet live"]);
    // The server checks the signature; it does not prove Face ID (no attestation on /try/sign).
    expect(JSON.stringify(data.voice["10-try-sign"])).not.toMatch(/proves?|verif(y|ies) (your )?Face ID/i);
    // Who is real and who is ours, as the README says it.
    expect(screen("14-real")).toMatchObject({ real: ["the Airwallex sandbox", "Metal testnet", "Claude", "Face ID"], ours: ["the suppliers", "the customer", "the merchant", "the second approver: a labelled test passkey"] });
    expect(String(screen("06-dispute").kicker)).toContain("a simulated customer");
    expect(String(screen("08-faceid").label)).toMatch(/after the run, on a test proposal \(test money\)/);
  });
});

describe("docs/video/ holds what the code writes", () => {
  // The script table records the README's test line as it was when it was written; rebuild it with that line, so a
  // later README test count does not make it stale (the film itself reads the README's line when it is rendered).
  const table = read("docs/video/premiere-script.md");
  const tests = /tests = `(\d+)`/.exec(table)?.[1], files = /files = `(\d+)`/.exec(table)?.[1];
  const asWritten: PremiereData = buildPremiere(raw(), `**${tests} tests in ${files} files, all passing**`);

  it("premiere-script.md, subtitles.srt and script.md: npm run video -- --docs writes them again", () => {
    expect(tests && files).toBeTruthy();
    expect(table).toBe(premiereTable(asWritten));
    expect(read("docs/video/subtitles.srt")).toBe(premiereSrt(asWritten));
    expect(read("docs/video/script.md")).toBe(premiereReadAloud(asWritten));
  });

  it("the film itself reads the README's test line as it is now", () => {
    expect(premiereFacts(raw(), README)["specs.tests"]!.value).toBe(testLine(README).tests);
    expect(premiereFacts(raw(), README)["specs.files"]!.value).toBe(testLine(README).files);
  });

  it("names every clip, every slot and the music in the edit guide", () => {
    const guide = read("docs/video/README.md");
    for (const s of PREMIERE_SCENES) expect({ clip: s.id, named: guide.includes(`${s.id}.mp4`) }).toEqual({ clip: s.id, named: true });
    for (const o of OVERLAYS) expect({ overlay: o, named: guide.includes(`overlays/${o}.png`) }).toEqual({ overlay: o, named: true });
    // The guide's times are typed by hand: each row's time is its clip's start in the timeline, and the lengths
    // without the hook and with a 10-second one are the script's.
    const rows = [...guide.matchAll(/^\| (\d:\d\d) \| `(\d\d-[a-z-]+)\.mp4` \|/gm)].map((m) => [m[2], m[1]]);
    expect(rows).toEqual(timeline.map((s) => [s.id, clock(s.start)]));
    expect(guide).toContain(`**Purser in ${clock(premiereSeconds())}**`);
    expect(guide).not.toMatch(/AI hook|02-hook|without the hook|10-second hook/i);
    expect(guide).toMatch(/YouTube Audio Library/);
    expect(guide).toMatch(/unlisted/i);
    expect(guide).toMatch(/`clips\/16-end-ai-voice\.mp4` \| A spare/);
  });

  it("shows the hashes of the mock's example terms, as the page hashes them: one cent changes all of it", () => {
    const x = trySignExample();
    const h = (t: unknown) => createHash("sha256").update(canonical(t as Parameters<typeof canonical>[0])).digest("hex");
    expect([fact("try.hash"), fact("try.tamperedHash")]).toEqual([h(x.terms), h(x.tampered)]);
    expect({ ...x.tampered, amount: x.terms.amount }).toEqual(x.terms);
    expect([x.terms.amount, x.tampered.amount]).toEqual(["1850.00", "1850.01"]);
  });
});
