# Machine-checked proofs about the code that guards money (Dafny)

The TLA+ model ([formal-model.md](formal-model.md)) checks the payment state machine, with hashes taken as identities.
This record goes one step closer to the code: three pieces of TypeScript that decide whether money moves are modelled
function by function in [Dafny](https://dafny.org), and the properties below are proven for **every** input, not
sampled. The model is then bound to the real TypeScript by a differential test that runs the verified functions and the
production code side by side.

`npm run formal:dafny` runs it again (CI job `formal-dafny`). Run on 19 November 2026 on Linux x64.

## Result

| | |
|---|---|
| Proofs | [`formal/dafny/`](../../formal/dafny): `Text.dfy`, `Money.dfy`, `Limit.dfy`, `Jcs.dfy`, `Utf8.dfy`, `Terms.dfy`, `Reference.dfy` |
| Verifier | **`Dafny program verifier finished with 172 verified, 0 errors`** (about 25 to 70 s, 2 cores) |
| What 172 counts | Dafny's verification tasks: every lemma (61), every function's well-formedness and termination, and the two `by method` implementations proven equal to their functions. Not a count of theorems |
| Nothing assumed inside | no `assume`, `{:axiom}`, `{:verify false}`, `{:extern}` or body-less lemma; `scripts/formal-dafny.sh` refuses to run if one appears, and fails on any verifier warning |
| Tool | Dafny 4.11.0+fcb2042d6d043a2634f0854338c08feeaaaf4ae2 with its bundled Z3 4.12.1, from the official release `dafny-4.11.0-x64-ubuntu-22.04.zip`, SHA-256 `a46a9ff7cdd720f7955854c78e95df13f4cfe6b80691b05f8654fe19e8267179` (pinned in `scripts/formal-dafny.sh`) |
| Link to the code | [`test/formal-dafny-differential.test.ts`](../../test/formal-dafny-differential.test.ts): about 57,500 comparisons per run (fresh random inputs each run), **0 differences** |
| Record and badge | [`formal-proofs.json`](formal-proofs.json), [`docs/badges/dafny.json`](../badges/dafny.json); `npm run formal:dafny` fails while either differs from what the verifier prints |
| Bugs found | one input-validation gap in `canonicalTerms`, fixed with a regression test; one float computation in the pay-alone check, replaced (below) |

## What is proven

### 1. The canonical terms encoding is injective

The CFO's passkey signs `termsHash(terms)` = SHA-256 of the UTF-8 bytes of `canonicalTerms(terms)` (`src/lib/terms.ts`),
which is RFC 8785 JCS as metal-pay's `jcs` computes it, on terms that contain no numbers.

**Proven:** two terms objects with the same canonical bytes are the same object (as a map from keys to values,
recursively). Equivalently: terms that differ in **any** field (payee, account, amount, currency, due date, reference,
an evidence hash, a nested balance, any key at all), or that have a field added or removed, have **different** canonical
bytes. So a forged invoice whose terms hash to what the CFO signed needs two different byte strings with the same
SHA-256: **a real SHA-256 collision**. Nothing here proves SHA-256 has no collisions; that is a computational assumption
(below).

| Lemma (Dafny name) | Statement |
|---|---|
| `Terms.TermsBytesInjective` | `TermsBytes(a) == TermsBytes(b)` (both accepted) implies `Normalize(a) == Normalize(b)` |
| `Terms.FieldChangeChangesBytes` | if key `k` is in `a`, and in `b` it is missing or holds a value with another canonical form, then `TermsBytes(a) != TermsBytes(b)` |
| `Terms.SameCanonicalFormIffSameMembers` | two objects (distinct keys, as every JavaScript object) have the same canonical form exactly when they have the same members in any order: the form depends on the object as a map and on nothing else |
| `Terms.CanonicalTermsInjective` | the same at the level of the canonical text (UTF-16) |
| `Jcs.SerInjective` | JCS serialisation of JSON without numbers is injective. Proven constructively: `Jcs.ParseSer` shows a decoder that reads `Ser(v) + rest` back to exactly `(v, rest)`, for every value and every suffix; `Jcs.DecodeEscape` does the same for `JSON.stringify`'s string escaping, including `\uXXXX` for control characters and for lone surrogates |
| `Utf8.EncodeInjective` | UTF-8 encoding is injective on well-formed UTF-16 (`Utf8.DecodeEncode`: decode after encode is the identity) |
| `Terms.SerWellFormed` | JCS output is always well-formed UTF-16 (a lone surrogate is escaped, never emitted), so the UTF-8 step loses nothing |
| `Terms.SortSorted`, `Terms.SortedUnique`, `Terms.NormalizeObject` | the keys are put in strict UTF-16 code-unit order, as `Object.keys(v).sort()` does, the members are a permutation of the object's, and the sorted order is unique |

**Unicode and whitespace.** `canonicalTerms` does **no** normalisation (no NFC/NFKC, no trimming, no case folding), and
the model does none either. Injectivity is over UTF-16 code units, so all of these are different terms with different
bytes, and the proof covers them: `"Bergtex"` and `"Bergtex "` (trailing space), a normal and a no-break space
(U+00A0), `"é"` in NFC (U+00E9) and NFD (`e` + U+0301), Latin `A` and Cyrillic `А` or fullwidth `Ａ`, a zero-width space
(U+200B) or BOM inserted anywhere, a right-to-left override (U+202E), `\n` against `\r\n`, a lone surrogate. A hash
match therefore means the exact same code points. Whether a person looking at the phone can *see* the difference
between two such payees is a display question; it is not covered here.

**What the model of canonicalTerms includes:** the refusal unless `schema` is `"kit11.approval-terms/v1"` and
`expires_at` is a string matching `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$` (`Terms.TermsOk`); `null`, booleans,
strings, arrays and objects. Numbers are outside the model's `Json` type because `canonicalTerms` refuses them; the
differential test checks that it does.

### 2. Amount parsing is exact

`toCents` and `fromCents` (`src/lib/money.ts`):

| Lemma | Statement |
|---|---|
| `Money.ToCentsOfFromCents` | for every integer `0 <= c <= 2^53 - 1`: `toCents(fromCents(c)) == c` |
| `Money.FromCentsOfToCents` | for every string `toCents` accepts: `fromCents(toCents(s)) == s` |
| `Money.AcceptedIffRendering` | `toCents` accepts **exactly** the strings `fromCents` writes; everything else is refused |
| `Money.ToCentsInjective` | two different accepted strings never give the same cents |
| `Money.ToCentsIsExact` | the cents are exactly 100 times the written decimal number (a rational, no rounding) |
| `Money.ToCentsMonotone` | the order of cents is the order of the written amounts |
| `Money.RefusedExamples` | refused, by the verifier: `1850.0`, `1850.000`, `01850.00`, `1,850.00`, `-1.00`, `+1.00`, `" 1.00"`, `"1.00\n"`, `1e3.00`, `.50`, Arabic-Indic and fullwidth digits |

### 3. The limit checks compare integer cents correctly

| Lemma | Statement |
|---|---|
| `Limit.PaidAloneIffWithinLimit` | the pay-alone check (`aloneDecision` in `src/policy/withinLimit.ts`, the amount test of `approveWithinLimit` in `src/policy/approvals.ts`) says **within** exactly when the limit is a plain amount above zero, the amount is a plain amount (a string), the currency is the limit's own, and `amount_cents <= limit_cents` |
| `Limit.PaidAloneIffWrittenAmountAtMostLimit` | for plain amounts, that comparison is exactly the comparison of the written decimal numbers |
| `Limit.OneCentOverIsNotWithin`, `Limit.OtherCurrencyIsNotWithin`, `Limit.WithinIsDownwardClosed` | one cent over is never paid alone; another currency never; lowering an amount within the limit keeps it within |
| `Limit.PlainCentsBound` | plain amounts are at most 99,999,999,999 cents, far inside the integers a JavaScript number holds exactly |
| `Limit.PlainAgreesWithToCents` | the two readers agree on every amount `fromCents` writes (up to 9 whole digits) |
| `Limit.CapPassesIffAtMostCap` | the agent's cap in `capRefusal` (`src/policy/rules.ts`): a payment passes exactly when there is no cap or `cents <= cap`, and a cap `toCents` refuses makes `capRefusal` throw (it never passes) |

## What is assumed

1. **SHA-256 is collision resistant.** Injectivity moves the question from "different terms, same canonical bytes"
   (proven impossible) to "different bytes, same SHA-256" (a collision). No collision of SHA-256 is publicly known;
   that is a computational assumption, not a proof.
2. **The model is the code.** Dafny proves facts about the Dafny functions. That they compute what the TypeScript
   computes is not proven; it is tested, by the differential test below, on fresh random inputs every run and on
   exhaustive boundary ranges. A difference the generators never reach would not be found.
3. **The JavaScript runtime behaves as ECMA-262 and Node document:** `JSON.stringify` on strings (QuoteJSONString,
   well-formed since ES2019), `Array.prototype.sort` without a comparator (UTF-16 code-unit order), `RegExp` `\d` and
   `$` without flags (ASCII digits, end of input), Node's UTF-8 encoder, and IEEE-754 doubles being exact on integers
   below 2^53. The differential test exercises all of them against the model.
4. **Floating point in money.ts is exact on its domain** (a hand argument, checked by tests, not by Dafny).
   `toCents` computes `Number(whole) * 100 + Number(fraction)` in doubles. While the true value is at most 2^53 - 1,
   every step is an integer below 2^53, so exact; when the true value is 2^53 or more, rounding is monotone and 2^53 is
   representable, so the result is at least 2^53 and `Number.isSafeInteger` refuses it. `fromCents` computes
   `Math.floor(cents / 100)`: for cents below 2^53 the quotient is below 2^47, where doubles are spaced at most 2^-6
   apart, so `k - 0.01` (the largest fraction below an integer `k`) never rounds up to `k`. The test checks every cent
   amount in the top 3,000 of the safe range and 3,000 around each of 2^46 and 2^47 cents, where the spacing changes.
5. **Dafny and Z3 are sound**, and Dafny's JavaScript translation of `Reference.dfy` computes what Dafny verified. The
   runtime's big integers run on a small BigInt class in `test/support/dafnyReference.ts` instead of the npm package
   bignumber.js (not a dependency here); it is integer-only and its division and modulo are tested against their
   definitions.
6. **Terms are plain JSON values** (`null`, booleans, strings, arrays, plain objects), as the `Json` type enforces at
   compile time and `JSON.parse` returns. A `Date`, a class instance, `undefined` or an array with holes is outside the
   model (metal-pay's `jcs` would serialise a `Date` as `{}`); no code path builds terms from those.

## How the proof is bound to the TypeScript

- `npm run formal:dafny` translates `formal/dafny/Reference.dfy` (the verified functions, called unchanged) to
  JavaScript and fails unless the result is byte for byte the committed
  [`formal/dafny/out/reference.js`](../../formal/dafny/out/reference.js). The translation is deterministic.
- `test/formal-dafny-differential.test.ts` (in the normal test suite, about 25 s) loads that file and compares, with
  fast-check:
  - `canonicalTerms`, the UTF-8 bytes, `termsHash`, and the **phone's own** `canonicalize` + `TextEncoder`
    (`src/approve/client.ts`), against `Terms.CanonicalTerms`, `Terms.TermsBytes` and SHA-256 of the model's bytes, on
    1,500 generated invoice-like terms (tricky Unicode in every string, wrong schemas, wrong expiries, a number
    somewhere) and on 1,500 arbitrary JSON values; the TypeScript's text is also read back by the verified decoder
    (`Jcs.ParseValue`) to the model's canonical form;
  - `toCents` on 6,000 amount-like strings (separators, signs, exponents, non-ASCII digits, values around 2^53 cents),
    `fromCents` on 6,000 integers and, exhaustively, on 10,504 boundary amounts;
  - `aloneDecision` on 6,000 generated cases and every cent within 3 euros of three limits; the integer check against
    the float formula it replaced on 20,000 plain amounts; and `capRefusal` on a real in-memory ledger, 1,500 cases.
  - Last local run: 57,550 comparisons, all identical.

## Found while modelling

- **`canonicalTerms` accepted an expiry that is not a string** (fixed). `ISO_UTC.test(terms.expires_at)` coerces its
  argument, so `expires_at: ["2026-11-19T10:00:00Z"]` (or `[[...]]`, or an object whose `toString` gives an ISO date)
  passed the check and was hashed as an array. Not a way to move money: terms are built by code with a string, and
  terms edited after signing no longer hash to the signed hash. But it broke the function's own contract, and the model
  could not state it. Now `typeof terms.expires_at !== "string"` is refused too; regression test in the differential
  test ("regression (19 Nov)").
- **The pay-alone check computed cents in floating point** (replaced). `approveWithinLimit` used
  `Math.round(Number(a) * 100)`. On its domain (at most 9 whole digits) that was always right: the relative error of
  `Number(a)` and of the product is far below half a cent. It now uses integer arithmetic only
  (`src/policy/withinLimit.ts`), so the proven model is the code; the test checks that the old and new formulas agree
  on 20,000 plain amounts, so behaviour is unchanged.
- **Observation, not changed:** `validateChange` (`src/policy/rules.ts`) accepts a money value by `/^\d{1,9}\.\d{2}$/`
  and then reads it with `toCents`, which refuses leading zeros, so `"01.00"` throws instead of returning a reason. The
  change is refused either way (fail-closed); only the message differs.

## What is not covered

- **SHA-256 itself**, the passkey (WebAuthn) signature and its verification, and the relay Worker.
- **The rest of `approveWithinLimit`:** the proposal's status, kind, stored-hash check, batch, expiry, four eyes and the
  second key are database steps; only the amount, currency and limit comparison is proven. The same for `capRefusal`:
  the emergency stop, pause and velocity stop before the cap are not modelled.
- **`available.ts`** (what is available = limit or balance − held − pending) sums rows from SQLite; it is not modelled.
- **The invoice reader** (`readAmount` / `readNumber` in `src/lib/numbers.ts`), which turns supplier notations
  (`1.850,00`, `€1850`) into the two-decimal form: not modelled; its output goes through `toCents`, which is.
- **Other float conversions** that are not on the paths above, for example `Math.round(Number(x) * 100)` in
  `src/policy/payoutLock.ts` (`owedPlatformFeeCents`), `src/agents/treasuryAgent.ts` and `src/metal/pauseChain.ts`.
- **Display:** whether the phone shows two different payees differently (homoglyphs, invisible characters).
  `src/lib/invoiceKey.ts` folds invoice numbers with NFKC for duplicate detection; that key is deliberately not
  injective and is not part of the hash.
- **Terms that are not plain JSON** (assumption 6), and numbers inside terms beyond the check that they are refused.
