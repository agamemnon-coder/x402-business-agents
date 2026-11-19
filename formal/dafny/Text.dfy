// Text as the TypeScript code sees it: a JavaScript string is a sequence of UTF-16 code units, so a code unit here is
// an integer 0..0xFFFF (Dafny's own `char` excludes surrogates and could not model a lone one). Decimal digits are the
// ASCII ones only, as `\d` in a JavaScript regular expression without the `u` flag.

module Text {
  type Unit = c: int | 0 <= c < 0x1_0000
  type Str = seq<Unit>

  datatype Option<T> = None | Some(value: T)

  const DOT: Unit := 0x2E
  const ZERO: Unit := 0x30

  predicate IsDigit(c: Unit) { 0x30 <= c <= 0x39 }

  predicate AllDigits(s: Str) { forall i | 0 <= i < |s| :: IsDigit(s[i]) }

  /** The value of a string of ASCII digits, read left to right (leading zeros allowed). */
  function DigitsValue(s: Str): nat
    requires AllDigits(s)
  {
    if |s| == 0 then 0 else DigitsValue(s[..|s| - 1]) * 10 + (s[|s| - 1] - 0x30)
  }

  /** A natural number in decimal without leading zeros ("0" for zero): JavaScript's String(n) for a safe integer. */
  function NatToDigits(n: nat): Str
    decreases n
  {
    if n < 10 then [(0x30 + n) as Unit] else NatToDigits(n / 10) + [(0x30 + n % 10) as Unit]
  }

  /** No leading zero: "0", or a first digit 1..9. */
  predicate NoLeadingZero(s: Str) { |s| >= 1 && (s == [ZERO] || s[0] != ZERO) }

  lemma NatToDigitsShape(n: nat)
    ensures AllDigits(NatToDigits(n)) && NoLeadingZero(NatToDigits(n))
    ensures DigitsValue(NatToDigits(n)) == n
    decreases n
  {
    var s := NatToDigits(n);
    if n >= 10 {
      NatToDigitsShape(n / 10);
      var p := NatToDigits(n / 10);
      assert s[..|s| - 1] == p;
      assert s[0] == p[0];
      if p == [ZERO] { assert DigitsValue(p) == 0; assert false; }
    }
  }

  lemma PositiveIfLeadingNonZero(s: Str)
    requires AllDigits(s) && |s| >= 1 && s[0] != ZERO
    ensures DigitsValue(s) >= 1
    decreases |s|
  {
    if |s| > 1 {
      var p := s[..|s| - 1];
      assert p[0] == s[0];
      PositiveIfLeadingNonZero(p);
    }
  }

  /** Every digit string without a leading zero is the decimal of its own value: the decimal form is unique. */
  lemma DigitsCanonical(s: Str)
    requires AllDigits(s) && NoLeadingZero(s)
    ensures NatToDigits(DigitsValue(s)) == s
    decreases |s|
  {
    if |s| > 1 {
      var p := s[..|s| - 1];
      var d := s[|s| - 1] - 0x30;
      assert p[0] == s[0];
      PositiveIfLeadingNonZero(p);
      var v := DigitsValue(p);
      assert DigitsValue(s) == v * 10 + d;
      assert DigitsValue(s) >= 10;
      assert DigitsValue(s) / 10 == v;
      assert DigitsValue(s) % 10 == d;
      DigitsCanonical(p);
      assert s == p + [s[|s| - 1]];
    }
  }

  lemma DigitsValueBound(s: Str)
    requires AllDigits(s)
    ensures DigitsValue(s) < Pow10(|s|)
    decreases |s|
  {
    if |s| > 0 { DigitsValueBound(s[..|s| - 1]); }
  }

  function Pow10(k: nat): nat { if k == 0 then 1 else 10 * Pow10(k - 1) }
}
