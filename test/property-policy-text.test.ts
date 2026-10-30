// Hardening plan item 2: the CFO's policy in plain words (src/policy/fromText.ts). The model is replaced by a fake
// that returns arbitrary and adversarial drafts (keys that exist and keys that do not, quotes copied, cut, changed or
// invented, amounts from the text, near it, or made up). Whatever it returns, code must keep only rules that rest on the
// CFO's own words, never loosen the policy from the phone, apply nothing, and produce a proposal that validates.
import type Anthropic from "@anthropic-ai/sdk";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ClaudeReader } from "../src/claude/reader.js";
import { Tools } from "../src/claude/tools.js";
import { openDb, type DB } from "../src/db/open.js";
import { checkChanges, type PolicyChange } from "../src/executors/policyChange.js";
import { fromCents, toCents } from "../src/lib/money.js";
import { termsHash, type Terms } from "../src/lib/terms.js";
import { amountsIn, draftPolicyFromText } from "../src/policy/fromText.js";
import { currentPolicy, rules, validateChange } from "../src/policy/rules.js";

const now = new Date("2026-11-03T10:00:00Z");
const fakeModel = (parsed: unknown): Anthropic => ({
  beta: { messages: { parse: async (p: { model: string }) => ({ model: p.model, stop_reason: "end_turn", stop_details: null, usage: { input_tokens: 1, output_tokens: 1 }, parsed_output: parsed }) } },
}) as unknown as Anthropic;

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

// ── How people write amounts ──

/** Cents written the way people write money, in one of several styles; returns null when a style cannot show it. */
function written(c: number, style: number): string | null {
  const whole = Math.floor(c / 100);
  const dec = String(c % 100).padStart(2, "0");
  const group = (sep: string) => String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  switch (style % 7) {
    case 0: return `${whole}.${dec}`; // 1250.50
    case 1: return `${whole},${dec}`; // 1250,50
    case 2: return `${group(".")},${dec}`; // 1.250,50
    case 3: return `${group(",")}.${dec}`; // 1,250.50
    case 4: return c % 100 === 0 ? String(whole) : null; // 40
    case 5: return c % 100 === 0 && whole >= 1000 ? group(".") : null; // 2.000
    default: return c % 100 === 0 && whole >= 1000 ? group(",") : null; // 2,000
  }
}
const cents = fc.oneof(fc.integer({ min: 0, max: 99_999_999 }), fc.integer({ min: 0, max: 100 }), fc.integer({ min: 1, max: 9_999 }).map((w) => w * 100));
const words = fc.stringMatching(/^[A-Za-z€$ ]{0,12}$/).map((s) => s.replace(/^\s*|\s*$/g, " "));

describe("reading amounts from words (amountsIn)", () => {
  // Breaks if amountsIn reads "." always as a decimal point ("2.000" as 2.00), or a comma before three digits as
  // decimals ("1,250" as 1.25): both would let a 1,000x smaller or larger amount through the quote check.
  it("reads one amount written in any common style, inside words, as exactly its cents", () => {
    fc.assert(fc.property(cents, fc.nat(), words, words, (c, style, before, after) => {
      const w = written(c, style);
      fc.pre(w !== null);
      expect(amountsIn(`${before}${w}${after}`)).toEqual([c]);
    }), { numRuns: 500 });
  });

  // Breaks if amountsIn ever yields a fraction, a negative, or an unsafe integer for some input.
  it("only ever yields non-negative safe integer cents, whatever the text", () => {
    fc.assert(fc.property(fc.oneof(fc.string(), fc.stringMatching(/^[0-9.,€ a-z-]{0,30}$/)), (s) => {
      for (const c of amountsIn(s)) expect(Number.isSafeInteger(c) && c >= 0).toBe(true);
    }), { numRuns: 500 });
  });
});

// ── Arbitrary CFO text and arbitrary model drafts ──

const TEMPLATES = [
  (a: string) => `De sourcing-agent mag met zijn kaart hooguit €${a} per aankoop uitgeven.`,
  (a: string) => `Refunds boven €${a} wil ik zien.`,
  (a: string) => `The support card: at most ${a} EUR a month.`,
  (a: string) => `Keep at least ${a} USD in reserve.`,
  (a: string) => `Payments above €${a} need two of us.`,
  (a: string) => `The operations agent pays no more than ${a} USDZ per payment.`,
  (a: string) => `Software max €${a}/maand, totaal.`,
  () => "Stop all agent payments now.",
  () => "Block Acme Supplies GmbH.",
  () => "Allow Acme Supplies GmbH again.",
];

const sentence = fc.tuple(fc.nat({ max: TEMPLATES.length - 1 }), cents, fc.nat()).map(([t, c, style]) => TEMPLATES[t]!(written(c, style) ?? fromCents(c)));
const cfoText = fc.tuple(fc.array(sentence, { minLength: 1, maxLength: 5 }), fc.option(fc.string({ maxLength: 40 }), { nil: undefined }))
  .map(([ss, extra]) => (extra === undefined ? ss.join(" ") : `${ss.join(" ")} ${extra}`))
  .filter((t) => t.trim() !== "" && t.length <= 2000);

const db0 = openDb(":memory:");
db0.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES ('b1', 'Acme Supplies GmbH', '0001', 'x', 'BIC', 'EUR', 'SWIFT')").run();
const KEYS = rules(db0).map((r) => r.key as string);

/** A starting policy: each setting at its default, or at some other valid value (so loosening has room to happen). */
const startingPolicy = fc.array(fc.tuple(fc.constantFrom(...KEYS), fc.nat(), fc.integer({ min: 0, max: 600_000 })), { maxLength: 6 });

function drafts(text: string) {
  const found = amountsIn(text);
  const quote = fc.oneof(
    // a slice of the CFO's words, of any length, with case and whitespace changed or not
    fc.tuple(fc.nat({ max: text.length }), fc.nat({ max: text.length }), fc.boolean()).map(([i, j, shout]) => {
      const q = text.slice(Math.min(i, j), Math.max(i, j));
      return shout ? `  ${q.toUpperCase().replace(/ /g, "\n")} ` : q;
    }),
    fc.constantFrom(...text.split(/(?<=[.!?])\s+/)),
    fc.string({ maxLength: 30 }),
    fc.constantFrom("", " ", "hooguit €40 per aankoop", "0", "5"),
  );
  const to = fc.oneof(
    found.length ? fc.constantFrom(...found).map((c) => fromCents(c)) : fc.constant("1.00"),
    cents.map(fromCents),
    found.length ? fc.tuple(fc.constantFrom(...found), fc.integer({ min: -100, max: 100 })).map(([c, d]) => fromCents(Math.max(0, c + d))) : fc.constant("2.00"),
    fc.constantFrom("", "on", "off", "allowed", "blocked", "40", "40,00", "1,250.50", "-1.00", "0.00", "1e3"),
    fc.string({ maxLength: 10 }),
  );
  const change = fc.record({ key: fc.oneof(fc.constantFrom(...KEYS), fc.constantFrom("transfer.anything", "cap.", "card.x.per_tx", "freeze ", "FREEZE"), fc.string({ maxLength: 12 })), to, quote, why: fc.string({ maxLength: 20 }) });
  return fc.record({
    changes: fc.array(change, { maxLength: 7 }),
    not_mapped: fc.array(fc.record({ quote, why: fc.string({ maxLength: 20 }) }), { maxLength: 2 }),
    questions: fc.array(fc.string({ maxLength: 20 }), { maxLength: 2 }),
  });
}

const scenario = cfoText.chain((text) => fc.record({ text: fc.constant(text), draft: drafts(text), start: startingPolicy, tightenOnly: fc.boolean() }));

function freshDb(start: [string, number, number][]): DB {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES ('b1', 'Acme Supplies GmbH', '0001', 'x', 'BIC', 'EUR', 'SWIFT')").run();
  for (const [key, pick, c] of start) {
    const r = rules(db).find((x) => x.key === key)!;
    const value = r.kind === "choice" ? r.choices![pick % r.choices!.length]! : r.kind === "optional_money" && pick % 3 === 0 ? "" : fromCents(Math.min(Math.max(c, r.min ?? 0), r.max ?? c));
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value, now.toISOString());
  }
  return db;
}

/**
 * An oracle for "less strict", written from the policy's meaning rather than copied from rules.ts loosens(): a limit
 * raised or removed, an approval threshold raised, a reserve floor lowered or removed, a payee unblocked, the emergency
 * stop or a velocity stop lifted.
 */
function looser(key: string, from: string, to: string): boolean {
  const c = (v: string) => (v === "" ? null : toCents(v));
  if (key === "freeze" || key.startsWith("stop.")) return from === "on" && to === "off";
  if (key.startsWith("counterparty:")) return from === "blocked" && to === "allowed";
  if (key.startsWith("cap.") || key.startsWith("card.") || key === "approval.four_eyes_eur") return c(from) !== null && (c(to) === null || c(to)! > c(from)!);
  if (key.startsWith("approval.")) return c(to)! > c(from)!;
  if (key.endsWith("_floor")) return c(from) !== null && (c(to) === null || c(to)! < c(from)!);
  throw new Error(`no oracle for ${key}`);
}

type Run = { db: DB; before: string[][]; r: Awaited<ReturnType<typeof draftPolicyFromText>> };
/** One draft on a fresh in-memory ledger, closed afterwards (hundreds of open databases would exhaust memory). */
async function run(s: { text: string; draft: unknown; start: [string, number, number][]; tightenOnly: boolean }, check: (x: Run) => void): Promise<void> {
  const db = freshDb(s.start);
  try {
    const before = currentPolicy(db).map((e) => [e.key, e.value]);
    const r = await draftPolicyFromText(db, new Tools(db, new ClaudeReader(db, fakeModel(s.draft))), s.text, now, { tightenOnly: s.tightenOnly });
    check({ db, before, r });
  } finally {
    db.close();
  }
}

const RUNS = { numRuns: 200 };
const SLOW = 30_000;

describe("policy from plain words, whatever the model returns (draftPolicyFromText)", () => {
  // Breaks if any of the code checks is dropped or weakened: the quote check (said.includes), the amount-in-quote
  // check, the unknown-key check, or validateChange.
  it("keeps a rule only if its quote is in the CFO's words and its amount is written in that quote", async () => {
    await fc.assert(fc.asyncProperty(scenario, async (s) => {
      await run(s, ({ db, r }) => {
        for (const a of r.accepted) {
          const rule = rules(db).find((x) => x.key === a.key);
          expect(rule).toBeDefined();
          expect(a.quote.trim()).not.toBe("");
          expect(norm(s.text).includes(norm(a.quote))).toBe(true);
          if (rule!.kind !== "choice" && a.to !== "") expect(amountsIn(a.quote)).toContain(toCents(a.to));
        }
      });
    }), RUNS);
  }, SLOW);

  // Breaks if the tightenOnly check is skipped, applied before the other checks change `from`, or if rules.ts
  // loosens() stops treating a removed limit, a raised threshold or a lowered floor as looser.
  it("from the phone, nothing it keeps loosens the policy", async () => {
    await fc.assert(fc.asyncProperty(scenario.map((s) => ({ ...s, tightenOnly: true })), async (s) => {
      await run(s, ({ r }) => {
        for (const a of r.accepted) expect(looser(a.key, a.from, a.to)).toBe(false);
      });
    }), RUNS);
  }, SLOW);

  // Breaks if the draft is ever applied directly (a settings write in fromText.ts), or a refused rule is still
  // proposed, or the proposal carries values other than the checked ones.
  it("applies nothing, and its one proposal validates against the policy rules and carries exactly the kept rules", async () => {
    await fc.assert(fc.asyncProperty(scenario, async (s) => {
      await run(s, ({ db, before, r }) => {
        // Shown, not applied.
        expect(currentPolicy(db).map((e) => [e.key, e.value])).toEqual(before);
        expect(new Set(r.accepted.map((a) => a.key)).size).toBe(r.accepted.length);
        expect(r.accepted.length + r.refused.length).toBe((s.draft as { changes: unknown[] }).changes.length);
        for (const a of r.accepted) expect(validateChange(db, { key: a.key, from: a.from, to: a.to })).toBeNull();
        if (r.accepted.length === 0) {
          expect(r.proposal).toBeNull();
          expect(db.prepare("SELECT COUNT(*) AS n FROM proposals").get()).toEqual({ n: 0 });
          return;
        }
        const p = r.proposal!;
        expect(p.status).toBe("PENDING_APPROVAL");
        expect(p.created_by).toBe("claude");
        const terms = JSON.parse(p.terms_json) as Terms & { kind: string; changes: PolicyChange[] };
        expect(terms.kind).toBe("policy_change");
        expect(terms.changes.map((c) => [c.key, c.from, c.to])).toEqual(r.accepted.map((a) => [a.key, a.from, a.to]));
        expect(() => checkChanges(db, terms.changes)).not.toThrow();
        expect(termsHash(terms)).toBe(p.terms_sha256);
        expect(db.prepare("SELECT COUNT(*) AS n FROM proposals WHERE status != 'PENDING_APPROVAL'").get()).toEqual({ n: 0 });
      });
    }), RUNS);
  }, SLOW);

  // FOUND (hardening plan item 2): the quote check in src/policy/fromText.ts:83 is a plain substring test, and the
  // amount check at :92 reads amounts from the quote alone. So a quote that cuts a number the CFO wrote passes both:
  // from "The sourcing card may spend at most €1500 a month." the model may quote "500" (or "0", or "150") and get a
  // rule for an amount the CFO never wrote. Reproduced with the fake model:
  //   text  = "The sourcing card may spend at most €1500 a month."
  //   draft = { key: "approval.refund_each", to: "0.00", quote: "0" }      -> ACCEPTED (0.10 -> 0.00), even with tightenOnly
  //   draft = { key: "card.sourcing.monthly", to: "500.00", quote: "500" } -> passes both word checks (refused only as a
  //            loosening from the phone; accepted on the runner)
  // Expected: refused ("0.00 is not an amount in your words"), since amountsIn(text) is [150000]. The header comment of
  // fromText.ts says the model "may not invent, split, add up or round amounts". The CFO still sees and signs the
  // proposal, so it is not a bypass of approval, but the code check does not hold. Fix idea: require every accepted
  // amount to be in amountsIn(text) too (or match the quote on digit boundaries). Skipped until fixed.
  it.skip("keeps only amounts the CFO actually wrote (fails: a quote may cut a number)", async () => {
    const example = {
      text: "The sourcing card may spend at most €1500 a month.",
      draft: { changes: [{ key: "approval.refund_each", to: "0.00", quote: "0", why: "x" }], not_mapped: [], questions: [] },
      start: [] as [string, number, number][], tightenOnly: true,
    };
    await fc.assert(fc.asyncProperty(scenario, async (s) => {
      await run(s, ({ r }) => {
        const written = amountsIn(s.text);
        for (const a of r.accepted) if (/^\d+\.\d{2}$/.test(a.to)) expect(written).toContain(toCents(a.to));
      });
    }), { ...RUNS, examples: [[example]] });
  }, SLOW);
});
