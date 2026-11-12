// "As reported by the Airwallex sandbox" on /visa (12 Nov): a folded block under the two Airi runs with what Airwallex's
// own record says about the Airi run's two payments. Every value is read again here from the record
// (docs/runs/airwallex-vic-payment-intents-<date>.json, written by npm run vic-readback from one GET per PaymentIntent)
// and shown under Airwallex's own field name; a field Airwallex did not return is not shown; nothing is called a
// cryptogram, a token or a Visa transaction id; no long number is on the page; and the record holds no secret, card
// number, expiry, name or device data.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VIC_INTENTS_PREFIX, assertRecordSafe, luhnValid, type IntentsRecord } from "../src/airwallex/intentReadback.js";
import { airiRun } from "../src/redesign/airiRun.js";
import { latestRecordFile } from "../src/redesign/airwallexProof.js";
import { visaPage } from "../src/redesign/partners.js";
import { VIC_NETWORK_FIELDS, VIC_NETWORK_ID, VIC_NETWORK_LABEL, vicNetwork, vicNetworkHtml, vicNetworkRecord } from "../src/redesign/vicNetwork.js";

const file = latestRecordFile(VIC_INTENTS_PREFIX)!;
const RAW = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const rec = JSON.parse(RAW) as IntentsRecord;
const run = airiRun()!;
const text = (html: string) => html.replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const at = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((v, k) => (v as Record<string, unknown> | undefined)?.[k], o);
const html = visaPage();
const block = new RegExp(`<details class="fold" id="${VIC_NETWORK_ID}">[\\s\\S]*?</details>`).exec(html)?.[0] ?? "";

describe("the record of what Airwallex reports for the Airi run's payments", () => {
  it("is dated, GET only, test money, read within the approved budget, and is the Airi run's two PaymentIntents", () => {
    expect(file).toMatch(/^docs\/runs\/airwallex-vic-payment-intents-\d{4}-\d{2}-\d{2}\.json$/);
    expect(file).toContain(rec.read_at.slice(0, 10));
    expect(rec.method).toMatch(/^GET only, Airwallex sandbox: GET \/api\/v1\/pa\/payment_intents\/\{id\}/);
    expect(rec.method).toMatch(/Nothing was created, updated or cancelled/);
    expect(rec).toMatchObject({ run: "docs/demo/airi-run.json", test_money: true });
    // 1 login and 1 GET per PaymentIntent, at most 1 spare: within the 4 calls approved for this read-back.
    expect(rec.budget).toBeLessThanOrEqual(4);
    expect(rec.calls.length).toBeLessThanOrEqual(rec.budget);
    expect(rec.calls.map((c) => `${c.method} ${c.endpoint}`)).toEqual(["POST /authentication/login", ...rec.payment_intents.map(() => "GET /pa/{id}/{id}")]);
    const paid = run.purchases.filter((p) => p.payment_intent_id);
    expect(rec.payment_intents.map((p) => [p.purchase, p.id])).toEqual(paid.map((p) => [p.step, p.payment_intent_id]));
    for (const p of rec.payment_intents) {
      const mine = paid.find((x) => x.step === p.purchase)!;
      expect(p.intent).toMatchObject({ id: mine.payment_intent_id, amount: Number(mine.amount), currency: mine.currency, status: mine.outcome });
      expect(String(at(p.intent, "latest_payment_attempt.payment_intent_id"))).toBe(mine.payment_intent_id);
    }
  });

  it("holds no secret, no card number, expiry, CVC, name or device data: each is a marker, listed with its reason", () => {
    expect(() => assertRecordSafe(rec)).not.toThrow();
    for (const p of rec.payment_intents) {
      expect(p.redacted.map((r) => r.path)).toEqual(expect.arrayContaining(["client_secret", "latest_payment_attempt.payment_method.card.expiry_month", "latest_payment_attempt.payment_method.card.expiry_year"]));
      for (const r of p.redacted) expect({ path: r.path, marker: String(at(p.intent, r.path)).includes("[redacted: ") }).toEqual({ path: r.path, marker: true });
    }
    expect(RAW).not.toMatch(/eyJ[\w-]{10,}\./);
    expect(RAW).not.toMatch(/"(cvc|cvv|number|expiry_month|expiry_year|fingerprint|name|email|ip_address)": "(?!\[redacted: )/);
    // A long number in it is an id, not a card number: none passes the card check digit.
    for (const run of RAW.match(/\d{13,19}/g) ?? []) expect({ run, card: luhnValid(run) }).toEqual({ run, card: false });
    // Of the card itself only what Airwallex returns apart: brand, type, first digits and last four.
    for (const p of rec.payment_intents) expect(String(at(p.intent, "latest_payment_attempt.payment_method.card.last4"))).toMatch(/^\d{4}$/);
  });
});

describe("\"As reported by the Airwallex sandbox\" on /visa", () => {
  it("shows each field under Airwallex's own name, with the value the record holds for each payment", () => {
    const n = vicNetwork(vicNetworkRecord()!, run);
    expect(n.purchases.map((p) => p.step)).toEqual(rec.payment_intents.map((p) => p.purchase));
    expect(n.rows.length).toBeGreaterThanOrEqual(8);
    for (const row of n.rows) {
      expect(VIC_NETWORK_FIELDS).toContain(row.path);
      // The name shown is the tail of Airwallex's own path, never a word of ours.
      expect(row.path.endsWith(row.name)).toBe(true);
      expect(row.values).toEqual(rec.payment_intents.map((p) => String(at(p.intent, row.path))));
      for (const v of row.values) expect(text(block)).toContain(v);
      expect(block).toContain(`<code title="${row.path}">${row.name}</code>`);
    }
    // The fields a payments reader looks for first, as Airwallex names and returns them.
    const shown = Object.fromEntries(n.rows.map((r) => [r.name, r.values]));
    expect(shown["card.number_type"]).toEqual(rec.payment_intents.map((p) => at(p.intent, "latest_payment_attempt.payment_method.card.number_type")));
    expect(shown["card.brand"]).toEqual(["visa", "visa"]);
    expect(shown.authorization_code!.every((v) => /^\w{4,8}$/.test(v))).toBe(true);
  });

  it("leaves out a field Airwallex did not return, and does not build when the record is another run's", () => {
    const without = JSON.parse(RAW) as IntentsRecord;
    for (const p of without.payment_intents) delete (p.intent.latest_payment_attempt as Record<string, unknown>).authorization_code;
    const n = vicNetwork({ file, rec: without }, run);
    expect(n.rows.map((r) => r.name)).not.toContain("authorization_code");
    expect(vicNetworkHtml(n)).not.toMatch(/authorization_code/);
    const other = JSON.parse(RAW) as IntentsRecord;
    other.payment_intents[0]!.id = "int_other";
    expect(() => vicNetwork({ file, rec: other }, run)).toThrow(/int_other/);
    const amount = JSON.parse(RAW) as IntentsRecord;
    amount.payment_intents[1]!.intent.amount = 46;
    expect(() => vicNetwork({ file, rec: amount }, run)).toThrow(/amount/);
    expect(vicNetworkHtml(null)).toBe("");
  });

  it("is one folded row under the two Airi runs, labelled, with its source: the read date, the calls and the record", () => {
    expect(block.length).toBeGreaterThan(0);
    const summary = text(/<summary>([\s\S]*?)<\/summary>/.exec(block)![1]!);
    expect(summary.startsWith(VIC_NETWORK_LABEL)).toBe(true);
    expect(VIC_NETWORK_LABEL).toBe("As reported by the Airwallex sandbox");
    expect(summary).toBe(`${VIC_NETWORK_LABEL}: ${rec.payment_intents.length} payments ${rec.payment_intents[0]!.intent.status as string}`);
    expect(html.indexOf(`id="${VIC_NETWORK_ID}"`)).toBeGreaterThan(html.indexOf('id="airi-run-2"'));
    expect(html.indexOf(`id="${VIC_NETWORK_ID}"`)).toBeLessThan(html.indexOf('id="visa-tap"'));
    expect(block).not.toMatch(/<details[^>]* open/);
    const t = text(block);
    expect(t).toContain(`GET /pa/payment_intents/{id}, read ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(rec.read_at))}, sandbox, test money`);
    expect(t).toContain(`${rec.calls.length} calls`);
    expect(block).toContain(`href="https://github.com/agamemnon-coder/x402-business-agents/blob/main/${file}"`);
    expect(existsSync(new URL(`../${file}`, import.meta.url))).toBe(true);
  });

  it("calls nothing a cryptogram, a token or a Visa transaction id, and says plainly which of those Airwallex did not return", () => {
    const t = text(block);
    const keys = new Set<string>();
    const walk = (v: unknown): void => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); } };
    for (const p of rec.payment_intents) walk(p.intent);
    const has = (re: RegExp) => [...keys].some((k) => re.test(k));
    // None of these came back in this record, and the block says so in as many words.
    expect([has(/cryptogram|cavv/i), has(/token/i), has(/three_?ds|3ds|eci/i)]).toEqual([false, false, false]);
    expect(t).toContain("Airwallex returned no field for a cryptogram, a token or a 3-D Secure result.");
    expect(t).not.toMatch(/Visa transaction id|network transaction id|tokeni[sz]ed/i);
    // Airi's word for the credential and Airwallex's, side by side, each attributed.
    const types = [...new Set(rec.payment_intents.map((p) => String(at(p.intent, "latest_payment_attempt.payment_method.card.number_type"))))];
    expect([run.purchases.find((p) => p.step === "B")!.credential_type, types]).toEqual(["DPAN", ["PAN"]]);
    expect(t).toContain("Airi's receipt named the credential's type DPAN (a token that stands in for the card number); Airwallex's record says number_type PAN (the card number itself).");
  });

  it("puts no long number and nothing private on the page", () => {
    expect(block).not.toMatch(/\d{13,}/);
    expect(block).not.toMatch(/\[redacted/);
    expect(text(block)).not.toMatch(/client_secret|fingerprint|expiry|billing|device_data|issuer_name/);
    // The two long ids Airwallex returns stay in the record, linked; the page does not print them.
    for (const p of rec.payment_intents) for (const k of ["provider_transaction_id", "payment_method_transaction_id"]) expect(block).not.toContain(String(at(p.intent, `latest_payment_attempt.${k}`)));
  });

  it("is said in docs/claims.md as the record has it: the file, the calls, each field's value", () => {
    const claims = readFileSync(new URL("../docs/claims.md", import.meta.url), "utf8");
    const row = claims.split("\n").find((l) => l.startsWith('| "As reported by the Airwallex sandbox"'))!;
    expect(row).toContain(`\`${file}\``);
    expect(row).toContain(`${rec.calls.length} calls of the ${rec.budget} approved (1 login, ${rec.payment_intents.length} GET)`);
    const n = vicNetwork(vicNetworkRecord()!, run);
    // Every value the page shows is in the row, under the same field name.
    for (const r of n.rows) for (const v of r.values) expect({ field: r.name, v, said: row.includes(v) && row.includes(r.name.split(".").at(-1)!) }).toEqual({ field: r.name, v, said: true });
    for (const p of rec.payment_intents) expect(row).toContain(`\`${p.id}\``);
  });

  it("has no number the record does not hold", () => {
    const inRecord = new Set(RAW.match(/\d+(?:\.\d+)*/g) ?? []);
    const amounts = new Set(run.purchases.map((p) => p.amount));
    const t = text(block).replace(/\bint_[a-z0-9]+/g, " ").replace(/airwallex-vic-payment-intents-[\d-]+\.json/g, " ").replace(/3-D Secure/g, " ");
    const day = String(new Date(rec.read_at).getUTCDate());
    expect((t.match(/\d+(?:\.\d+)*/g) ?? []).filter((x) => !inRecord.has(x) && !amounts.has(x) && x !== day && x !== String(rec.calls.length) && x !== String(rec.payment_intents.length))).toEqual([]);
  });
});
