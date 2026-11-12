// /airwallex, one story about Airwallex's own products (jury panel, 12 Nov): one tile per product Purser uses, each
// with one number, one id and its run's own date, all read from that run's record at build time. These tests hold every
// tile to its record file, the two-locks tile to whatever the record and the runs list say today (and to a finished
// record, should another team publish one), every link into the page to an id that exists on it, and the page's first
// screen to Airwallex's products with every fold closed.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPages } from "../src/relay/assets.js";
import { liveRuns, type RunRow } from "../src/redesign/runs.js";
import { agentRun } from "../src/redesign/run.js";
import {
  ACCEPTANCE_RUN_FILE, KIT_FILE, PLATFORM_FACTS_FILE, PLATFORM_RUN_FILE, PRODUCT_ORDER, TWO_LOCKS_FILE, TWO_LOCKS_KEY,
  acceptanceRun, kitSwift, platformRun, productDocs, productTiles, shortId, tileWords, twoLocksState, approvalsTile, tilesHtml, type PlatformFact,
} from "../src/redesign/airwallexProducts.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const pages = buildPages() as unknown as Record<string, string>;
const awx = pages.airwallex!;
const text = (html: string) => html.replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
/** The page with every fold taken out, nested ones included (innermost first). */
function withoutFolds(html: string): string {
  let out = html;
  for (let prev = ""; prev !== out;) { prev = out; out = out.replace(/<details\b[^>]*>(?:(?!<details\b)[\s\S])*?<\/details>/g, " "); }
  return out;
}
const main = (html: string) => /<main[\s\S]*<\/main>/.exec(html)![0];
const tiles = productTiles(agentRun());
const tileHtml = (key: string) => new RegExp(`<article class="awt card[^"]*" id="p-${key}"[\\s\\S]*?</article>`).exec(awx)?.[0] ?? "";
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
/** Every number in a text, as a value ("€45" and "45.00" are the same figure; "07" and "7" the same day). */
const numbers = (t: string) => (t.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => Number(n.replace(/,(?=\d{3}\b)/g, "")));
const idsOut = (t: string) => t.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, " ").replace(/\b[0-9a-f]{8}…/g, " ").replace(/\b(int|mdt|acct|tr)_[A-Za-z0-9_-]+/g, " ").replace(/\bP-\d{4}\b/g, " ").replace(/docs\/[\w./-]+/g, " ");

describe("/airwallex: one tile per Airwallex product, each from its run's record", () => {
  it("shows the seven products in order, each with one number, an id and a date, with every fold removed", () => {
    expect(tiles.map((t) => t.key)).toEqual([...PRODUCT_ORDER]);
    expect(tiles.map((t) => t.name)).toEqual(["Issuing", "Payouts", "FX", "Transfer approvals", "Connected accounts", "Payment acceptance", "Airi"]);
    const open = text(withoutFolds(main(awx)));
    let at = -1;
    for (const t of tiles) {
      const html = tileHtml(t.key);
      expect({ key: t.key, shown: html.length > 0 }).toEqual({ key: t.key, shown: true });
      expect(withoutFolds(main(awx))).toContain(html);
      const tt = text(html);
      // In order on the page, the product named, its number large, its id in monospace and its own date.
      expect(awx.indexOf(html)).toBeGreaterThan(at);
      at = awx.indexOf(html);
      expect(html).toMatch(new RegExp(`<h2[^>]*>${t.name}</h2>`));
      expect((html.match(/<span class="v">/g) ?? []).length).toBe(1);
      expect(html).toContain(`<span class="v">${t.value}</span>`);
      expect(html).toMatch(/<code[^>]*>[^<]+<\/code>/);
      expect(t.id.startsWith(shortId(t.id).replace(/…$/, ""))).toBe(true);
      expect(tt).toContain(shortId(t.id));
      expect(html).toContain(`<time datetime="${t.iso}">${day(t.iso)}</time>`);
      expect(open).toContain(t.name);
    }
    // The heading counts the tiles; the page is no longer the replay of one run.
    expect(awx).toContain("<h1>Purser uses seven Airwallex products</h1>");
    expect(text(main(awx))).not.toMatch(/Replay of the main run/);
    expect(awx).toMatch(/<span class="pill run">[\s\S]*?Airwallex sandbox · test money · each run dated<\/span>/);
  });

  it("finds each tile's number, id and date in its own record file", () => {
    for (const t of tiles) {
      const rec = t.files.map(read).join("\n");
      expect({ key: t.key, id: rec.includes(t.id) }).toEqual({ key: t.key, id: true });
      expect({ key: t.key, date: rec.includes(t.iso.slice(0, 10)) || rec.includes(new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(t.iso))) }).toEqual({ key: t.key, date: true });
      const inRecord = new Set(numbers(rec));
      const value = numbers(t.value);
      expect(value).toHaveLength(1);
      expect({ key: t.key, value: inRecord.has(value[0]!) }).toEqual({ key: t.key, value: true });
      // Every other figure on the tile too: nothing is typed in.
      const shown = numbers(idsOut(text(tileHtml(t.key)))).filter((n) => !inRecord.has(n) && n !== Number(day(t.iso).split(" ")[0]));
      expect({ key: t.key, unknown: shown }).toEqual({ key: t.key, unknown: [] });
    }
  });

  it("keeps each tile short: at most 22 words, the three-state tile 24", () => {
    for (const t of tiles) expect({ key: t.key, over: tileWords(tileHtml(t.key)) > (t.states ? 24 : 22) ? tileWords(tileHtml(t.key)) : 0 }).toEqual({ key: t.key, over: 0 });
  });

  it("holds every block that names its own record (data-rec) to that record's figures", () => {
    const blocks = [...main(awx).matchAll(/<(article|details|p|li)\b[^>]*\sdata-rec="([^"]+)"[\s\S]*?<\/\1>/g)];
    expect(blocks.length).toBeGreaterThanOrEqual(tiles.length + 2);
    for (const [html, , files] of blocks) {
      const rec = files!.split(" ").map(read).join("\n");
      const inRecord = new Set(numbers(rec));
      const dates = [...html.matchAll(/<time datetime="([^"]+)"/g)].map((m) => Number(day(m[1]!).split(" ")[0]));
      expect({ files, unknown: numbers(idsOut(text(html))).filter((n) => !inRecord.has(n) && !dates.includes(n)) }).toEqual({ files, unknown: [] });
      for (const id of text(html).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\b(?:int|acct)_[A-Za-z0-9_-]+/g) ?? []) expect({ files, id, known: rec.includes(id) }).toEqual({ files, id, known: true });
    }
  });

  it("tells the Issuing tile from the Airwallex-only run: Airwallex's own decline, the raise asked of the CFO, the same charge approved", () => {
    const t = tiles.find((x) => x.key === "issuing")!;
    const rec = JSON.parse(read("docs/demo/airwallex-run.json")) as { card_transactions: { id: string; amount: string; approved: boolean; decline_code: string | null; step: string }[]; declines_met: { transaction_id: string; proposal_id: string | null }[] };
    const no = rec.card_transactions.find((x) => !x.approved && x.decline_code === "LIMIT_EXCEEDED")!;
    const yes = rec.card_transactions.find((x) => x.approved && x.step === no.step && x.amount === no.amount)!;
    expect(yes).toBeTruthy();
    expect(rec.declines_met.find((m) => m.transaction_id === no.id)!.proposal_id).toMatch(/^P-\d+$/);
    expect(t.id).toBe(no.id);
    expect(t.value).toBe("€45");
    expect(no.amount).toBe("45.00");
    // Three states in a row, each as the record has it: the decline code is Airwallex's own.
    expect(t.states!.map((x) => x.text)).toEqual([`Declined: ${no.decline_code}`, "The agent asked the CFO", "Approved after Face ID"]);
    expect(t.states!.map((x) => x.tone)).toEqual(["bad", "hold", "ok"]);
    for (const x of t.states!) expect(text(tileHtml("issuing"))).toContain(x.text);
    expect(t.href).toBe("#awx-1-steps");
  });

  it("says the quote's id and expiry are inside the signed terms only for the run whose record holds those terms", () => {
    const t = tiles.find((x) => x.key === "fx")!;
    const r = JSON.parse(read("docs/demo/main-run.json")) as { ledger: { events: { event: string; subject: string; payload: Record<string, unknown> }[]; proposals: { proposal_id: string; terms: { conversion?: { quote_id: string; valid_to: string } } }[] } };
    const fx = r.ledger.events.find((e) => e.event === "fx.converted")!;
    const proposal = (fx.payload.origin as { proposal_id: string }).proposal_id;
    const terms = r.ledger.proposals.find((p) => p.proposal_id === proposal)!.terms;
    const approved = r.ledger.events.find((e) => e.event === "proposal.approved" && e.subject === proposal)!;
    // The quote Airwallex converted on is the one in the proposal's terms, and the conversion carries the hash the CFO approved.
    expect(terms.conversion!.quote_id).toBe(fx.payload.quote_id);
    expect(terms.conversion!.valid_to).toMatch(/^2026-11-03T/);
    expect(fx.payload.approval_sha256).toBe(approved.payload.terms_sha256);
    expect(approved.payload.method).toBe("passkey");
    expect(t.id).toBe(terms.conversion!.quote_id);
    expect(t.files).toEqual(["docs/demo/main-run.json"]);
    expect(t.what).toMatch(/Only the shortfall/);
    expect(t.what).toMatch(/id and expiry are in the signed terms/);
    // The fold names the quote in full with its expiry, from the same terms.
    expect(text(awx)).toContain(`quote ${terms.conversion!.quote_id}, valid to ${terms.conversion!.valid_to.slice(11, 16)} UTC`);
  });
});

const ROW = (o: { status?: string; id?: string } = {}): RunRow => ({
  key: TWO_LOCKS_KEY, iso: "2026-11-10T09:02:16.000Z", date: "10 Nov 2026", title: "Two locks", rails: "", what: "Only then did Purser create the EUR 240.00 transfer.", checks: "", money: "",
  ids: o.id === "" ? [] : [{ label: "Transfer", value: o.id ?? "4074d684-4704-406c-a527-2832753baf4f" }], files: [],
  stats: [{ v: "2", l: "locks on one payout" }, ...(o.status === "" ? [] : [{ v: o.status ?? "IN_APPROVAL", l: "held by Airwallex" }])],
});
/** A finished record as another team may publish it: approved in the web app, then scheduled, sent and paid. */
const FINISHED = `# Two locks on one payout (10 November 2026)

## What happened

| | |
|---|---|
| **Lock 1: the CFO's passkey over the exact terms** | Proposal \`P-0001\` signed by a **labelled virtual test passkey**. Only then did Purser call Airwallex. |
| **The API call** | \`POST /transfers/create\`, one time. Transfer \`4074d684-4704-406c-a527-2832753baf4f\`, EUR 240.00 SWIFT, created 2026-11-10T09:02:16Z. |
| **Lock 2: Airwallex's approval workflow** | Airwallex answered **\`IN_APPROVAL\`** on create. |
| **The web-app approval** | **Completed** on 12 November: approved in the Airwallex web app, then \`SCHEDULED\`; the sandbox simulation moved it to \`SENT\`, then **\`PAID\`**. |

## Checked first, offline

IN_APPROVAL → SCHEDULED → FAILED never happened here.
`;

describe("/airwallex: transfer approvals, three states read from the record and the runs list", () => {
  const md = read(TWO_LOCKS_FILE);
  const row = liveRuns().find((r) => r.key === TWO_LOCKS_KEY);

  it("today: what the record says, which is what the runs list says", () => {
    const s = twoLocksState(md, row)!;
    const recordNow = /\| \*\*The web-app approval\*\* \|[^\n]*`([A-Z_]+)`/.exec(md)?.[1] ?? /\*\*`([A-Z_]+)`\*\*/.exec(md)![1]!;
    expect(row).toBeTruthy();
    expect(s.source).toBe("record");
    expect(s.disagree).toBe(false);
    expect(md).toContain(s.transferId);
    expect(md).toContain(`EUR ${s.amount}`);
    expect(md).toContain(`created ${s.iso.replace(".000Z", "Z")}`);
    expect(row!.ids.find((i) => i.label === "Transfer")!.value).toBe(s.transferId);
    expect(row!.stats!.map((x) => x.v)).toContain(s.now);
    expect(md).toContain(`\`${s.now}\``);
    expect(s.held).toBe(/Airwallex answered \*\*`([A-Z_]+)`\*\*/.exec(md)![1]);
    expect(s.finished).toBe(s.now === "PAID");
    // The page shows the three states as the record has them, whatever they are today.
    const t = tiles.find((x) => x.key === "approvals")!;
    expect(t.states!.map((x) => x.text)).toEqual(approvalsTile(s)!.states!.map((x) => x.text));
    expect(t.states).toHaveLength(3);
    expect(t.states![0]!.text).toBe("Signed in Purser");
    expect(t.states![1]!.text).toBe(`${s.held} at Airwallex`);
    expect(t.states![2]!.text).toContain(s.now);
    expect(t.states![2]!.text).toContain(recordNow);
    for (const x of t.states!) expect(text(tileHtml("approvals"))).toContain(x.text);
    expect(t.id).toBe(s.transferId);
    expect(t.href).toBe(`runs#${TWO_LOCKS_KEY}`);
    expect(pages.runs).toContain(`id="${TWO_LOCKS_KEY}"`);
    // A passkey signed it, a labelled test passkey: the tile says "signed", never Face ID.
    expect(md).toMatch(/labelled virtual test passkey/);
    expect(s.testPasskey).toBe(true);
    expect(text(tileHtml("approvals"))).not.toMatch(/Face ID/);
    expect(text(awx)).toMatch(/two-locks run[^.]*labelled test passkey/);
  });

  it("a finished record and row: the tile shows PAID and no longer says it is not paid", () => {
    const s = twoLocksState(FINISHED, ROW({ status: "PAID" }))!;
    expect(s).toMatchObject({ held: "IN_APPROVAL", now: "PAID", finished: true, disagree: false, source: "record", transferId: "4074d684-4704-406c-a527-2832753baf4f", amount: "240.00" });
    const t = approvalsTile(s)!;
    expect(t.states!.map((x) => x.text)).toEqual(["Signed in Purser", "IN_APPROVAL at Airwallex", "Now: PAID"]);
    const html = text(tilesHtml([t]));
    expect(html).toContain("Now: PAID");
    expect(html).not.toMatch(/not paid|not completed|waiting/i);
    // A state between the two reads as itself.
    const scheduled = FINISHED.replace(/; the sandbox simulation moved it to `SENT`, then \*\*`PAID`\*\*/, "");
    expect(approvalsTile(twoLocksState(scheduled, ROW({ status: "SCHEDULED" }))!)!.states![2]!.text).toBe("Now: SCHEDULED, not paid");
  });

  it("when the record and the runs list disagree, the record's state is shown", () => {
    const ahead = twoLocksState(FINISHED, ROW({ status: "IN_APPROVAL" }))!;
    expect(ahead).toMatchObject({ now: "PAID", disagree: true, source: "record" });
    const behind = twoLocksState(md, ROW({ status: "PAID" }))!;
    expect(behind).toMatchObject({ now: twoLocksState(md, row)!.now, disagree: true, source: "record" });
    expect(approvalsTile(behind)!.states![2]!.text).not.toBe("Now: PAID");
    // Another transfer id in the list: the record's id stays.
    expect(twoLocksState(md, ROW({ id: "00000000-0000-4000-8000-000000000000" }))!).toMatchObject({ transferId: twoLocksState(md, row)!.transferId, disagree: true });
  });

  it("without a readable record the runs list's state is shown; with neither, no tile", () => {
    const s = twoLocksState("# nothing here", ROW({ status: "PAID" }))!;
    expect(s).toMatchObject({ now: "PAID", held: null, source: "runs", finished: true, transferId: "4074d684-4704-406c-a527-2832753baf4f" });
    expect(approvalsTile(s)!.states!.map((x) => x.text)).toEqual(["Signed in Purser", "Held by Airwallex's approval workflow", "Now: PAID"]);
    expect(twoLocksState(null, undefined)).toBeNull();
    expect(twoLocksState("# nothing", ROW({ status: "" }))).toBeNull();
    expect(approvalsTile(null)).toBeNull();
    // Statuses outside the "What happened" section (the offline rehearsal's) are not the run's.
    expect(twoLocksState(FINISHED, ROW({ status: "PAID" }))!.now).not.toBe("FAILED");
  });
});

describe("/airwallex: connected accounts, the PAID payout first and the refusals folded with their cause", () => {
  const facts = JSON.parse(read(PLATFORM_FACTS_FILE)) as PlatformFact[];
  const md = read(PLATFORM_RUN_FILE);
  const p = platformRun(facts, md)!;

  it("reads the PAID payout, both fees and the refusals from the run's facts", () => {
    const paid = facts.flatMap((c) => c.transfers).filter((t) => t.status === "PAID");
    expect(paid).toHaveLength(1);
    expect(p.paid).toMatchObject({ transferId: paid[0]!.transfer_id, amount: paid[0]!.amount, airwallexFee: paid[0]!.airwallex_fee });
    const fee = facts.flatMap((c) => c.purser_fees).find((f) => f.with_payout === paid[0]!.transfer_id)!;
    expect(p.paid.purserFee).toBe(fee.amount);
    expect(p.paid.purserFeeStatus).toBe(fee.status);
    expect(p.accounts).toBe(facts.length);
    expect(p.refused).toBe(facts.flatMap((c) => c.transfers).filter((t) => !t.transfer_id && t.failure).length);
    expect(p.refusedAccounts).toBe(facts.filter((c) => c.transfers.some((t) => !t.transfer_id && t.failure)).length);
    expect(p.local).toBe(true);
    // The cause is the run log's: the field Airwallex named, and how the two new accounts were opened.
    expect(md).toContain(`source \`${p.cause!.field}\``);
    expect(md).toMatch(/opened as \*\*non-registered sole traders\*\*/);
    expect(md).toMatch(/open\s+it as a registered sole trader[\s\S]*That is for a later run/);
    expect(p.testPasskey).toBe(true);
  });

  it("heads the tile with the PAID payout, its transfer id and Purser's fee, and keeps the refusals out of sight", () => {
    const t = tiles.find((x) => x.key === "connected")!;
    expect(t.id).toBe(p.paid.transferId);
    expect(t.value).toBe(`€${p.paid.amount}`);
    expect(t.what).toContain("PAID");
    expect(t.what).toContain(`€${p.paid.purserFee} fee`);
    expect(t.href).toBe("#platform-run");
    const open = text(withoutFolds(main(awx)));
    expect(open).not.toMatch(/refused|refusal/i);
    const fold = /<details class="fold" id="platform-run"[\s\S]*?<\/details>/.exec(awx)![0];
    const ft = text(fold);
    expect(ft).toContain(p.paid.transferId);
    expect(ft).toContain(`Airwallex fee ${p.paid.airwallexFee}`);
    expect(ft).toContain(`${p.refused} payouts from the ${p.refusedAccounts} new test accounts were refused by Airwallex at create`);
    expect(ft).toContain("opened as non-registered sole traders");
    expect(ft).toContain(p.cause!.field);
    expect(ft).toContain("A test company opened with a registration number has not run yet.");
    expect(ft).toMatch(/test passkey, not Face ID/);
    // The refusals are a sentence in the fold, never a large figure.
    expect(awx).not.toMatch(/<span class="v">[^<]*<\/span>[^<]*<[^>]*>[^<]*refus/i);
  });

  it("gives no tile when no payout is PAID with Purser's fee", () => {
    expect(platformRun(facts.map((c) => ({ ...c, transfers: c.transfers.map((t) => ({ ...t, status: "CANCELLED" })) })), md)).toBeNull();
    expect(platformRun([], md)).toBeNull();
  });
});

describe("/airwallex: payment acceptance, the SWIFT line, the docs and the folds", () => {
  it("reads the card payment from its run log: the amount, the PaymentIntent and its status as read back", () => {
    const md = read(ACCEPTANCE_RUN_FILE);
    const a = acceptanceRun(md)!;
    expect(md).toContain(`| \`GET /api/v1/pa/payment_intents/${a.intentId}\` | 200, \`${a.status}\``);
    expect(a.status).toBe("SUCCEEDED");
    expect(md).toContain(`EUR ${a.amount}`);
    expect(md).toMatch(/Booked the receipt only from the status it read back/);
    const t = tiles.find((x) => x.key === "acceptance")!;
    expect(t).toMatchObject({ id: a.intentId, value: `€${a.amount}` });
    expect(t.what).toContain("SUCCEEDED");
    expect(acceptanceRun("# nothing")).toBeNull();
    // Booked only after SUCCEEDED: a run log that read another status gives no tile.
    expect(acceptanceRun(md.replace(/200, `SUCCEEDED`, card ending/, "200, `REQUIRES_PAYMENT_METHOD`, card ending"))).toBeNull();
  });

  it("names the kit as the reason for SWIFT, in the kit's own words, and links the SEPA payout with its fee", () => {
    const k = kitSwift(read(KIT_FILE))!;
    expect(read(KIT_FILE)).toContain(`"${k}"`);
    expect(k).toMatch(/SWIFT payout/);
    expect(kitSwift("| K1 | \"nothing\" |")).toBeNull();
    const line = /<p class="awswift"[^>]*>[\s\S]*?<\/p>/.exec(withoutFolds(main(awx)))?.[0] ?? "";
    const p = platformRun(JSON.parse(read(PLATFORM_FACTS_FILE)) as PlatformFact[], read(PLATFORM_RUN_FILE))!;
    expect(text(line)).toMatch(/^Why SWIFT: the hackathon kit asks for a SWIFT payout\./);
    expect(text(line)).toContain(`Airwallex fee ${p.paid.airwallexFee}`);
    expect(line).toMatch(/<a [^>]*href="#platform-run"[^>]*>[^<]*SEPA/);
    expect(read(PLATFORM_RUN_FILE)).toMatch(/SEPA, LOCAL/);
  });

  it("links docs for all seven products in the docs fold, each on Airwallex's own docs site", () => {
    const fold = /<details class="fold"><summary>The Airwallex products and their docs<\/summary>[\s\S]*?<\/details>/.exec(awx)![0];
    const docs = productDocs();
    expect(docs.map((d) => d.key)).toEqual([...PRODUCT_ORDER]);
    for (const d of docs) {
      expect(d.docs.length).toBeGreaterThan(0);
      expect(fold).toContain(`<li>${d.name}: `);
      for (const x of d.docs) { expect(x.href.startsWith("https://www.airwallex.com/docs/")).toBe(true); expect(fold).toContain(`href="${x.href}"`); }
    }
    expect(docs.map((d) => d.name)).toEqual(tiles.map((t) => t.name));
  });

  it("keeps the hash block, with no other full hash in sight, and every fold closed", () => {
    const open = text(withoutFolds(main(awx)));
    expect(open).toContain("The hash the CFO signed travels with the payment.");
    expect(open).toContain("Match: the same hash");
    expect(open.match(/\b[0-9a-f]{64}\b/g)).toHaveLength(2);
    expect(awx).not.toMatch(/<details[^>]*\sopen/);
    // The tiles come first: before the hash block and before any fold.
    expect(awx.indexOf('<section class="awp"')).toBeLessThan(awx.indexOf('id="awx-hash"'));
    expect(awx.indexOf('<section class="awp"')).toBeLessThan(awx.indexOf("<details", awx.indexOf("<main")));
    // The first screen is Airwallex's products: Metal earnings and the simulated deposit are in a fold.
    expect(open).not.toMatch(/Metal earnings/);
    expect(open).not.toMatch(/0\.69/);
    const metal = /<details class="fold" id="main-run"[\s\S]*?<\/details>/.exec(awx)![0];
    expect(text(metal)).toMatch(/Metal earnings booked at Airwallex/);
    expect(text(metal)).toMatch(/0\.69 USD booked\s+simulated deposit/);
  });

  it("keeps every label of what is simulated", () => {
    const fold = text(/<details class="fold"><summary>What is simulated<\/summary>[\s\S]*?<\/details>/.exec(awx)![0]);
    for (const want of ["The Airwallex sandbox, with test money only.", "Purser moves the sandbox transfer to SENT, then PAID, through Airwallex's simulation API", "simulated sandbox deposit", "Card charges at merchants are simulated by the sandbox",
      "verification simulated", "labelled test passkey", "not Face ID"]) expect({ want, has: fold.includes(want) }).toEqual({ want, has: true });
  });

  it("has a target on /airwallex for every link into it, from every page the site serves", () => {
    const ids = new Set([...awx.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
    const wanted = new Map<string, string>();
    // Every page of the site, with the hands-on demo off and on (the judge's tour is served with it on), agents' pages too.
    const strings = (v: unknown, name: string): [string, string][] => typeof v === "string" ? [[name, v]] : v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => strings(x, `${name}.${k}`)) : [];
    for (const [variant, env] of [["off", {}], ["on", { TRY_SIGN_ENABLED: "on" }]] as const) {
      const built = buildPages(env as NodeJS.ProcessEnv) as unknown as Record<string, unknown>;
      // The page's ids are the same in both builds (only the menu's Try link differs).
      expect([...String(built.airwallex).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])).toEqual([...ids]);
      for (const [name, html] of strings(built, variant)) for (const m of html.matchAll(/["'(/]airwallex#([A-Za-z0-9_-]+)/g)) wanted.set(m[1]!, name);
    }
    for (const id of ["controls", "card-sourcing", "awx-1", "awx-1-steps", "airi-run-steps", "awx-hash"]) expect({ id, linked: wanted.has(id) }).toEqual({ id, linked: true });
    for (const [id, from] of wanted) expect({ id, from, on: ids.has(id) }).toEqual({ id, from, on: true });
    // And the page's own links into itself.
    for (const m of main(awx).matchAll(/href="#([^"]+)"/g)) expect({ id: m[1], on: ids.has(m[1]!) }).toEqual({ id: m[1], on: true });
    // A target inside a fold opens with the page's one script (OPEN_TARGET_JS walks every <details> around it).
    for (const id of ["awx-1", "awx-1-steps", "airi-run-steps", "card-sourcing"]) {
      const before = awx.slice(0, awx.indexOf(` id="${id}"`));
      expect({ id, inFold: (before.match(/<details\b/g) ?? []).length > (before.match(/<\/details>/g) ?? []).length }).toEqual({ id, inFold: true });
    }
  });
});
