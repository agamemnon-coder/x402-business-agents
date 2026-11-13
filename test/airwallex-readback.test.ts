// Airwallex read back (section B, 6 Nov): the main run's SWIFT transfer and the agents' cards as the Airwallex sandbox
// returns them (GET only, sanitized, dated records in docs/runs), shown on /proof and /airwallex next to what the CFO
// decided. The match is computed from the two records: the hash the CFO signed (the run's ledger) against the
// transfer's metadata, and each card's controls against the CFO policy. Change either side and the pages say so.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CARD_ACTIVE_DAYS, PLANS } from "../src/config/policy.js";
import { CARDS_PREFIX, HASH_TRAVELS, TRANSFER_PREFIX, cardControlRows, cardsReadback, controlsShortHtml, controlsSideBySideHtml, hashBlockHtml, hashTravel, latestRecordFile, transferReadback, type CardsReadback, type TransferReadback } from "../src/redesign/airwallexProof.js";
import { cardRaiseOf, loadRecord } from "../src/redesign/run.js";
import { buildPages } from "../src/relay/assets.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const { record } = loadRecord();
const transfer = transferReadback()!;
const cards = cardsReadback()!;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const pages = buildPages();
const text = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("Airwallex read back: the records", () => {
  it("are dated, GET only, test money, and the newest of their kind is the one the pages read", () => {
    expect(transfer.file).toMatch(/^docs\/runs\/airwallex-transfer-approval-\d{4}-\d{2}-\d{2}\.json$/);
    expect(cards.file).toMatch(/^docs\/runs\/airwallex-cards-\d{4}-\d{2}-\d{2}\.json$/);
    for (const r of [transfer.rec, cards.rec]) {
      expect(r.method).toMatch(/^GET only, Airwallex sandbox/);
      expect(r.method).toMatch(/Nothing was created, updated or cancelled/);
      expect(r.run).toBe("docs/demo/main-run.json");
      expect((r as unknown as { test_money: boolean }).test_money).toBe(true);
    }
    expect(latestRecordFile(TRANSFER_PREFIX, [`${TRANSFER_PREFIX}-2026-11-01.json`, `${TRANSFER_PREFIX}-2026-11-09.json`, "other.json"])).toBe(`docs/runs/${TRANSFER_PREFIX}-2026-11-09.json`);
    expect(latestRecordFile(CARDS_PREFIX, [])).toBeNull();
  });

  it("keep no card number, CVV, cardholder, payee or payer details, and no field a secret scanner would flag", () => {
    const keysOf = (v: unknown): string[] => Array.isArray(v) ? v.flatMap(keysOf) : v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : [];
    for (const f of [transfer.file, cards.file]) {
      const raw = read(f);
      expect(raw).not.toMatch(/\d{12,}/);
      const keys = keysOf(JSON.parse(raw));
      expect(keys.filter((k) => /card_number|cvv|cvc|cardholder|name_on_card|delivery|^beneficiary$|^beneficiary_id$|^payer$|bank|account|iban|swift_code|address|email/i.test(k))).toEqual([]);
      // Nothing that looks like a key to a scanner (gitleaks runs over the whole history in CI).
      expect(keys.filter((k) => /key|token|secret|auth|access|credential|api/i.test(k))).toEqual([]);
    }
    // Card ids masked to their last four characters; the card number to its last four digits, which the run already shows.
    const runLast4 = (record.snapshot as unknown as { cards: { last4: string }[] }).cards.map((c) => c.last4);
    for (const c of cards.rec.cards) {
      expect(c.card_id_last4).toMatch(/^[0-9a-f]{4}$/);
      expect(runLast4).toContain(c.last4);
    }
  });
});

describe("the hash the CFO signed travels with the payment", () => {
  it("is the hash of the proposal that paid the transfer, approved with Face ID, and Airwallex returns the same one", () => {
    const h = hashTravel(record, transfer)!;
    const ev = record.ledger!.events;
    const executed = ev.find((e) => e.event === "proposal.executed" && e.payload.transfer_id === transfer.rec.transfer.id)!;
    const approved = ev.find((e) => e.event === "proposal.approved" && e.subject === executed.subject)!;
    expect(h).toMatchObject({ proposalId: executed.subject, transferId: transfer.rec.transfer.id, signed: approved.payload.terms_sha256, method: "passkey", transferStatus: "PAID", transferMethod: "SWIFT" });
    expect(h.signed).toMatch(/^[0-9a-f]{64}$/);
    expect(h.carried).toBe(transfer.rec.transfer.metadata!.approval_sha256);
    expect(h.match).toBe(true);
    // Purser's own log said the same when it created the transfer; Airwallex's answer is the independent copy.
    expect(ev.find((e) => e.event === "transfer.created" && e.subject === h.transferId)!.payload.approval_sha256).toBe(h.signed);
  });

  it("is computed, not typed in: another hash at Airwallex, or none, reads as no match on the page", () => {
    for (const metadata of [{ approval_sha256: "0".repeat(64) }, null]) {
      const other = clone(transfer);
      other.rec.transfer.metadata = metadata;
      const h = hashTravel(record, other)!;
      expect(h.match).toBe(false);
      expect(text(hashBlockHtml(h))).toContain("No match");
      expect(text(hashBlockHtml(h))).not.toContain("Match: the same hash");
    }
    const unknown = clone(transfer) as { file: string; rec: TransferReadback };
    unknown.rec.transfer.id = "00000000-0000-0000-0000-000000000000";
    expect(hashTravel(record, unknown)).toBeNull();
  });
});

describe("each agent's card controls, written from the CFO policy and enforced by Airwallex", () => {
  const rows = cardControlRows(record, cards);

  it("covers the run's three agent cards, each with five controls, all as the policy says", () => {
    expect(rows.map((r) => r.agent)).toEqual(["sourcing", "support", "treasury"]);
    for (const r of rows) {
      expect(r.checks.map((c) => c.rule)).toEqual(["Most per purchase", "Most per month", "Merchant categories", "Currency", "End date"]);
      expect(r.match).toBe(true);
      expect(r.createdBy).toBe("Northwind CFO policy");
    }
  });

  it("takes the policy side from the run and the policy code: limits from snapshot.cards, categories from the agents' plans", () => {
    const run = (record.snapshot as unknown as { cards: { agent: string; per_tx: string; monthly: string }[] }).cards;
    for (const r of rows) {
      const want = run.find((c) => c.agent === r.agent)!;
      expect(r.checks[0]!.policy).toBe(`EUR ${want.per_tx}`);
      expect(r.checks[1]!.policy).toBe(`EUR ${want.monthly}`);
      const mccs = [...new Set(Object.values(PLANS).filter((p) => p.agent === r.agent && !/on the .* card$/.test(p.label)).map((p) => p.mcc))];
      for (const m of mccs) expect(r.checks[2]!.policy).toContain(`MCC ${m}`);
      expect(r.checks[3]!.policy).toBe("EUR only");
      expect(r.checks[4]!.policy).toMatch(new RegExp(`^${CARD_ACTIVE_DAYS} days from issue`));
    }
    // The Sourcing card's limit per purchase is the one the CFO raised in the run with Face ID (P-0006), and Airwallex has it.
    const raise = cardRaiseOf(record)!;
    expect(rows[0]!.checks[0]).toMatchObject({ policy: `EUR ${raise.to}`, note: expect.stringContaining(`raised from EUR ${raise.from} by ${raise.proposal}`), ok: true });
  });

  it("says so when Airwallex has anything else: a limit, a category, a currency or an end date", () => {
    const edits: [string, (c: CardsReadback["cards"][number]) => void][] = [
      ["Most per purchase", (c) => { c.controls.transaction_limits!.limits[0]!.amount = 999; }],
      ["Most per month", (c) => { c.controls.transaction_limits!.limits.find((l) => l.interval === "MONTHLY")!.amount = 1; }],
      ["Merchant categories", (c) => { c.controls.allowed_merchant_categories = ["5734", "7311"]; }],
      ["Currency", (c) => { c.controls.allowed_currencies = []; }],
      ["End date", (c) => { c.controls.active_to = "2030-01-01T00:00:00.000+00:00"; }],
    ];
    for (const [rule, edit] of edits) {
      const other = clone(cards) as { file: string; rec: CardsReadback };
      edit(other.rec.cards[0]!);
      const r = cardControlRows(record, other);
      expect({ rule, failed: r[0]!.checks.filter((c) => !c.ok).map((c) => c.rule), match: r[0]!.match }).toEqual({ rule, failed: [rule], match: false });
      expect(r.slice(1).every((x) => x.match)).toBe(true);
      expect(text(controlsShortHtml(r, other.rec.read_at, other.file))).toContain("1 of 3 cards differ from the CFO policy");
      expect(text(controlsSideBySideHtml(r, other.rec.read_at, other.file))).toContain("differs");
    }
  });
});

describe("the pages", () => {
  it("/proof and /airwallex show both hashes, the match, and the cards against the policy, from the records", () => {
    const h = hashTravel(record, transfer)!;
    for (const [name, html] of [["proof", pages.proof!], ["airwallex", pages.airwallex!]] as const) {
      const t = text(html);
      expect({ name, words: t.includes(HASH_TRAVELS) }).toEqual({ name, words: true });
      expect({ name, hashes: t.split(h.signed).length - 1 }).toEqual({ name, hashes: 2 });
      expect(t).toContain("Match: the same hash");
      expect(t).toContain(transfer.file);
      expect(t).toContain(cards.file);
      expect(t).toMatch(/writ(ten|es) [^.]*from the CFO policy/);
    }
    for (const html of [pages.proof!, pages.airwallex!]) expect(text(html)).toContain("3 of 3 cards match the CFO policy");
    // /airwallex (Max, 6 Nov): the hash block and one line at the top; every card's side by side in a collapsed fold.
    const controls = /<div class="card">((?:(?!<div class="card">)[\s\S])*?<details class="fold" id="controls">[\s\S]*?)<\/details><\/div>/.exec(pages.airwallex!)?.[1] ?? "";
    const fold = /<details class="fold" id="controls">[\s\S]*$/.exec(controls)?.[0] ?? "";
    expect(text(controls.slice(0, controls.length - fold.length)).trim()).toBe("3 of 3 cards match the CFO policy");
    expect((fold.match(/class="awcard"/g) ?? []).length).toBe(3);
    expect(fold).not.toMatch(/<details[^>]*\sopen/);
    const side = text(pages.airwallex!);
    expect(side).toContain("CFO policy Airwallex card control");
    for (const r of cardControlRows(record, cards)) for (const c of r.checks) {
      expect(side).toContain(c.policy);
      expect(side).toContain(c.airwallex);
    }
    // No card id beyond its last four characters, no card number beyond its last four digits.
    // A transaction hash in a link to Metal's explorer (/proof's live runs, 13 Nov) is not a card's number.
    for (const html of [pages.proof!, pages.airwallex!]) expect(html.replace(/testnet\.metalntwx\.com\/tx\/0x[0-9a-f]{64}/g, "")).not.toMatch(/\d{12,}/);
  });
});
