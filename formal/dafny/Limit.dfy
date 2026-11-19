// The limit checks that decide whether money moves without a person.
//
// 1. Paying alone (src/policy/withinLimit.ts aloneDecision, the last check of approveWithinLimit in
//    src/policy/approvals.ts): an invoice payment is approved by code, without the CFO, only when the limit is a plain
//    amount above zero, the payment's amount is a plain amount (a string) in the limit's own currency, and its cents
//    are at or below the limit's cents. Plain is /^(\d{1,9})\.(\d{2})$/ (leading zeros allowed, as before).
// 2. The agent's per-payment cap (src/policy/rules.ts capRefusal, after the emergency stop, pause and velocity checks):
//    the cap is "" (none) or a two-decimal amount read by toCents; a payment of `cents` is refused when cents > cap.

include "Money.dfy"

module Limit {
  import opened Text
  import Money

  /** /^(\d{1,9})\.(\d{2})$/ */
  predicate PlainShape(s: Str) {
    4 <= |s| <= 12 && s[|s| - 3] == DOT && IsDigit(s[|s| - 2]) && IsDigit(s[|s| - 1]) && AllDigits(s[..|s| - 3])
  }

  /** plainCents: whole * 100 + fraction, or None. */
  function PlainCents(s: Str): Option<nat> {
    if PlainShape(s) then Some(DigitsValue(s[..|s| - 3]) * 100 + Money.FracValue(s)) else None
  }

  ghost function PlainValue(s: Str): real
    requires PlainShape(s)
  {
    DigitsValue(s[..|s| - 3]) as real + Money.FracValue(s) as real / 100.0
  }

  datatype Decision = NoLimit | NotWithin | Within

  /**
   * aloneDecision(amount, currency, limit). `amount` and `currency` come from the stored terms and are None when they
   * are not strings there (the TypeScript compares with typeof and with strict !==).
   */
  function AloneDecision(amount: Option<Str>, currency: Option<Str>, limitAmount: Str, limitCurrency: Str): Decision {
    var top := PlainCents(limitAmount);
    if top.None? || top.value <= 0 then NoLimit
    else
      var cents := if amount.Some? then PlainCents(amount.value) else None;
      if cents.None? || currency != Some(limitCurrency) || cents.value > top.value then NotWithin
      else Within
  }

  /** capRefusal's cap test: None where policyCapCents throws (a cap toCents refuses), else whether it refuses. */
  function CapRefuses(cents: int, cap: Str): Option<bool> {
    if cap == [] then Some(false)
    else
      var c := Money.ToCents(cap);
      if c.None? then None else Some(cents > c.value)
  }

  // ---- Lemmas ------------------------------------------------------------------------------------------------------

  /** Plain amounts are at most 99,999,999,999 cents: far inside the integers a JavaScript number holds exactly. */
  lemma PlainCentsBound(s: Str)
    requires PlainCents(s).Some?
    ensures PlainCents(s).value <= 99_999_999_999 < Money.MAX_SAFE
  {
    DigitsValueBound(s[..|s| - 3]);
    assert Pow10(9) == 1_000_000_000;
    PowMono(|s| - 3, 9);
  }

  lemma PowMono(a: nat, b: nat)
    requires a <= b
    ensures Pow10(a) <= Pow10(b)
  {
    if a < b { PowMono(a, b - 1); }
  }

  /** No rounding: plain cents are exactly one hundred times the written number. */
  lemma PlainCentsIsExact(s: Str)
    requires PlainCents(s).Some?
    ensures PlainCents(s).value as real == 100.0 * PlainValue(s)
  {}

  /**
   * The main property: code approves a payment alone exactly when the limit is set (a plain amount above zero), the
   * amount is a plain amount in the limit's currency, and amount_cents <= limit_cents.
   */
  lemma PaidAloneIffWithinLimit(amount: Option<Str>, currency: Option<Str>, limitAmount: Str, limitCurrency: Str)
    ensures AloneDecision(amount, currency, limitAmount, limitCurrency) == Within
      <==> (PlainCents(limitAmount).Some? && PlainCents(limitAmount).value > 0
            && amount.Some? && PlainCents(amount.value).Some?
            && currency == Some(limitCurrency)
            && PlainCents(amount.value).value <= PlainCents(limitAmount).value)
  {}

  /** The same, stated on the written decimal numbers: the cent comparison is the exact comparison of the amounts. */
  lemma PaidAloneIffWrittenAmountAtMostLimit(amount: Str, currency: Str, limitAmount: Str)
    requires PlainShape(amount) && PlainShape(limitAmount) && PlainCents(limitAmount).value > 0
    ensures AloneDecision(Some(amount), Some(currency), limitAmount, currency) == Within
      <==> PlainValue(amount) <= PlainValue(limitAmount)
  {
    PlainCentsIsExact(amount);
    PlainCentsIsExact(limitAmount);
  }

  /** One cent over the limit is never paid alone. */
  lemma OneCentOverIsNotWithin(amount: Option<Str>, currency: Option<Str>, limitAmount: Str, limitCurrency: Str)
    requires PlainCents(limitAmount).Some? && amount.Some? && PlainCents(amount.value).Some?
    requires PlainCents(amount.value).value == PlainCents(limitAmount).value + 1
    ensures AloneDecision(amount, currency, limitAmount, limitCurrency) != Within
  {}

  /** Another currency is never paid alone, whatever the amount. */
  lemma OtherCurrencyIsNotWithin(amount: Option<Str>, currency: Option<Str>, limitAmount: Str, limitCurrency: Str)
    requires currency != Some(limitCurrency)
    ensures AloneDecision(amount, currency, limitAmount, limitCurrency) != Within
  {}

  /** Lowering the amount never turns a payment within the limit into one that is not. */
  lemma WithinIsDownwardClosed(a: Str, b: Str, currency: Option<Str>, limitAmount: Str, limitCurrency: Str)
    requires AloneDecision(Some(a), currency, limitAmount, limitCurrency) == Within
    requires PlainCents(b).Some? && PlainCents(b).value <= PlainCents(a).value
    ensures AloneDecision(Some(b), currency, limitAmount, limitCurrency) == Within
  {}

  /**
   * Both readers agree on what terms carry: an amount fromCents wrote (toCents accepts it) with at most 9 whole digits
   * is read to the same cents by plainCents; and a plain amount without a leading zero is read the same by toCents.
   */
  lemma PlainAgreesWithToCents(s: Str)
    ensures Money.ToCents(s).Some? && |s| <= 12 ==> PlainCents(s) == Money.ToCents(s)
    ensures PlainCents(s).Some? && NoLeadingZero(s[..|s| - 3]) ==> Money.ToCents(s) == PlainCents(s)
  {
    if PlainCents(s).Some? { PlainCentsBound(s); }
  }

  /** capRefusal: a payment passes the cap exactly when there is no cap or cents <= cap (integer cents, exact). */
  lemma CapPassesIffAtMostCap(cents: int, cap: Str)
    requires CapRefuses(cents, cap).Some?
    ensures CapRefuses(cents, cap) == Some(false) <==> cap == [] || cents <= Money.ToCents(cap).value
  {}
}
