// The partners as controls in the product (partner review, 14 Nov): T:0's read-back gates the month close (/t0, Purser
// Cloud's Books, /t0-readback.json) and Purser's three checks sit on Airi's credential (/visa's recorded scene).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T0_READBACK_FILE, type ReadBackRecord } from "../src/accounting/t0Readback.js";
import { t0CloseFacts, t0CloseTileHtml, T0_CLOSE_ID, T0_CLOSE_RULE } from "../src/redesign/t0CloseTile.js";
import { t0Body, t0Data } from "../src/redesign/t0Page.js";
import { cardScene, visaCardSceneHtml, VISA_CARD_SCENE_ID } from "../src/redesign/visaCardScene.js";
import { visaPage } from "../src/redesign/partners.js";
import { buildPages } from "../src/relay/assets.js";
import { pageResponse, notFoundResponse, type Pages } from "../worker/src/core.js";
import { t0CloseLine } from "../cloud/src/t0Close.js";
import { t0CloseGen, t0CloseLineOf } from "../src/accounting/t0CloseLine.js";
import { consolePage } from "../cloud/src/console.js";
import { VIC3_RUN_FILE } from "../src/redesign/vic3Run.js";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const raw = readFileSync(new URL(`../${T0_READBACK_FILE}`, import.meta.url), "utf8");
const rec = JSON.parse(raw) as ReadBackRecord;

describe("/t0: the independent ledger check", () => {
  it("says T:0 agrees in words, computed from the record, and links the read-back", () => {
    const html = t0CloseTileHtml();
    const words = text(html);
    expect(words).toContain("Independent ledger check");
    expect(words).toContain("T:0 agrees: all 95 of our journal entries are in T:0, and every account matches our books to the cent.");
    expect(words).toContain(T0_CLOSE_RULE);
    expect(words).toContain("Read back 14 Nov, read only. T:0 sandbox, test data.");
    expect(words).not.toMatch(/\b95\s*\/\s*95\b|\b95 of 95\b/);
    expect(html).toContain('href="t0-readback.json" download');
    expect(t0Body(t0Data(), { logo: "", pill: "" })).toContain(`id="${T0_CLOSE_ID}"`);
  });

  it("turns red and names the difference when the record disagrees, and shows nothing without a record", () => {
    const changed = structuredClone(rec);
    changed.entries[5]!.lines[0]!.cents += 1;
    changed.entries[5]!.lines[1]!.cents += 1;
    const f = t0CloseFacts(JSON.stringify(changed))!;
    expect(f.check.agrees).toBe(false);
    const html = t0CloseTileHtml(f);
    expect(html).toContain('class="card t0c bad"');
    expect(text(html)).toContain("T:0 does not agree");
    expect(text(html)).toContain("The month stays open");
    expect(t0CloseTileHtml(t0CloseFacts(null))).toBe("");
  });

  it("the site serves the read-back byte for byte as a download, and an older bundle answers 404", async () => {
    const pages = buildPages({} as NodeJS.ProcessEnv);
    const r = pageResponse(new Request("https://kit11.example/t0-readback.json"), pages)!;
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(r.headers.get("content-disposition")).toBe('attachment; filename="t0-readback.json"');
    expect(await r.text()).toBe(raw);
    const { t0Readback: _drop, ...older } = pages;
    const o = pageResponse(new Request("https://kit11.example/t0-readback.json"), older as Pages) ?? notFoundResponse(older as Pages);
    expect(o.status).toBe(404);
  });
});

describe("Purser Cloud's Books: the same check", () => {
  it("carries the computed numbers, never a fixed sentence, with the site's download", () => {
    expect(t0CloseLine()).toEqual({ agrees: true, entries: 95, differences: 0, first: null, read_at: rec.read_at, download: "https://kit11.max-31b.workers.dev/t0-readback.json", page: "https://kit11.max-31b.workers.dev/t0" });
    const off = structuredClone(rec);
    off.entries[0]!.lines[0]!.cents -= 1;
    off.entries[0]!.lines[1]!.cents -= 1;
    expect(t0CloseLineOf(off)).toMatchObject({ agrees: false, differences: 2 });
    expect(t0CloseLineOf(off).first).toMatch(/^account \d{5} differs/);
  });

  it("the cloud's generated line is the check recomputed from the record (npm run t0:readback writes it)", () => {
    expect(t0CloseLine()).toEqual(t0CloseLineOf(rec));
    expect(readFileSync(new URL("../cloud/src/t0Close.gen.ts", import.meta.url), "utf8")).toBe(t0CloseGen(t0CloseLineOf(rec)));
  });

  it("puts it in the console's config, with the words in both languages", () => {
    const html = consolePage("n", { origin: "https://cloud.test", rpId: "cloud.test", mailDomain: "" });
    const cfg = JSON.parse(/<meta name="purser-cloud" content="([^"]+)">/.exec(html)![1]!.replace(/&quot;/g, '"').replace(/&amp;/g, "&")) as { t0Close?: { agrees: boolean; entries: number } };
    expect(cfg.t0Close).toMatchObject({ agrees: true, entries: 95 });
    for (const k of ["cs.books.t0_h", "cs.books.t0_agrees", "cs.books.t0_rule", "cs.books.t0_src", "cs.books.t0_download"]) expect((html.match(new RegExp(`"${k.replace(/\./g, "\\.")}"`, "g")) ?? []).length).toBe(2);
    expect(html).toContain("t0CloseCard()");
  });
});

describe("/visa: the card rail with Purser's three checks, a recorded replay", () => {
  it("reads every id and code from the vic-5 record", () => {
    const s = cardScene()!;
    const v5 = JSON.parse(readFileSync(new URL(`../${VIC3_RUN_FILE}`, import.meta.url), "utf8")) as { purchases: { step: string; mandate_id: string | null; payment_intent_id: string | null; terms_sha256: string | null }[] };
    const b = v5.purchases.find((p) => p.step === "B")!;
    expect(s.paid).toMatchObject({ mandate: b.mandate_id, intent: b.payment_intent_id, hash: b.terms_sha256, amount: "45.00", currency: "EUR", proposal: "P-0002" });
    expect(s.amount).toEqual({ asked: "40.00 EUR", code: "PURSER_CREDENTIAL_AMOUNT_MISMATCH" });
    expect(s.reuse).toEqual({ code: "PURSER_CREDENTIAL_ALREADY_USED" });
    expect([s.from, s.to]).toEqual(["7 Nov", "14 Nov"]);
  });

  it("is labelled recorded, not live, and says the merchant check is in code and tests, not in the run", () => {
    const words = text(visaCardSceneHtml());
    expect(words).toContain("Agent pays with an Airi credential (test card, sandbox; recorded run of 7–14 Nov)");
    expect(words).toContain("Recorded, not live");
    for (const h of ["Bound to one purchase", "Amount and merchant must match the signed terms", "Reuse refused"]) expect(words).toContain(h);
    expect(words).toContain("Another merchant: refused too, in code and tests since 14 Nov, not in the recorded run.");
    expect(words).not.toMatch(/\blive run\b/i);
  });

  it("leaves the scene out when the record does not show the checks as run", () => {
    const v5 = JSON.parse(readFileSync(new URL(`../${VIC3_RUN_FILE}`, import.meta.url), "utf8")) as { purchases: { step: string; outcome: { code?: string } }[] };
    const f2 = v5.purchases.find((p) => p.step === "F2")!;
    f2.outcome.code = "SUCCEEDED";
    expect(cardScene(v5)).toBeNull();
    expect(visaCardSceneHtml(null)).toBe("");
    expect(cardScene({ ...v5, mode: "dry" })).toBeNull();
  });

  it("is on /visa", () => {
    expect(visaPage()).toContain(`id="${VISA_CARD_SCENE_ID}"`);
  });
});
