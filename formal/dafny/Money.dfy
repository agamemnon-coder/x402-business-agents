// Amount parsing, as src/lib/money.ts does it.
//
//   toCents(amount)   /^(0|[1-9]\d*)\.(\d{2})$/, then whole * 100 + fraction, refused unless a safe integer
//   fromCents(cents)  refused unless a safe non-negative integer; `${floor(cents / 100)}.${cents % 100 padded to 2}`
//
// The model computes on mathematical integers. That TypeScript's Number arithmetic gives the same integers is an
// assumption about the JavaScript runtime (IEEE-754 doubles are exact on integers below 2^53), argued in
// docs/evidence/formal-proofs.md and checked on the boundary by the differential test.

include "Text.dfy"

module Money {
  import opened Text

  /** Number.MAX_SAFE_INTEGER, 2^53 - 1. */
  const MAX_SAFE: nat := 9007199254740991

  /** The regular expression ^(0|[1-9]\d*)\.(\d{2})$ of toCents. */
  predicate DecimalShape(s: Str) {
    |s| >= 4 && s[|s| - 3] == DOT && IsDigit(s[|s| - 2]) && IsDigit(s[|s| - 1])
    && AllDigits(s[..|s| - 3]) && NoLeadingZero(s[..|s| - 3])
  }

  /** The two digits after the dot, as a number 0..99. */
  function FracValue(s: Str): nat
    requires |s| >= 2 && IsDigit(s[|s| - 2]) && IsDigit(s[|s| - 1])
  {
    (s[|s| - 2] - 0x30) * 10 + (s[|s| - 1] - 0x30)
  }

  /** toCents: Some(cents), or None where the TypeScript throws. */
  function ToCents(s: Str): Option<nat> {
    if !DecimalShape(s) then None
    else
      var c := DigitsValue(s[..|s| - 3]) * 100 + FracValue(s);
      if c <= MAX_SAFE then Some(c) else None
  }

  /** fromCents on a non-negative integer. */
  function FromCents(c: nat): Str {
    NatToDigits(c / 100) + [DOT, (0x30 + (c % 100) / 10) as Unit, (0x30 + c % 10) as Unit]
  }

  /** fromCents with its guard: None where the TypeScript throws (negative or above MAX_SAFE). */
  function FromCentsChecked(c: int): Option<Str> {
    if 0 <= c <= MAX_SAFE then Some(FromCents(c)) else None
  }

  /** The written amount as a rational number: whole part plus hundredths. */
  ghost function DecimalValue(s: Str): real
    requires DecimalShape(s)
  {
    DigitsValue(s[..|s| - 3]) as real + FracValue(s) as real / 100.0
  }

  // ---- Lemmas ------------------------------------------------------------------------------------------------------

  /** Cents -> string -> cents gives back the same cents, for every safe amount. */
  lemma ToCentsOfFromCents(c: nat)
    requires c <= MAX_SAFE
    ensures ToCents(FromCents(c)) == Some(c)
  {
    var s := FromCents(c);
    var w := NatToDigits(c / 100);
    NatToDigitsShape(c / 100);
    assert s[..|s| - 3] == w;
    assert s[|s| - 3] == DOT;
    assert FracValue(s) == c % 100;
  }

  /** String -> cents -> string gives back the same string: toCents accepts only the exact rendering of a cent amount. */
  lemma FromCentsOfToCents(s: Str)
    requires ToCents(s).Some?
    ensures FromCents(ToCents(s).value) == s
  {
    var c := ToCents(s).value;
    var w := s[..|s| - 3];
    DigitsCanonical(w);
    assert c / 100 == DigitsValue(w);
    assert c % 100 == FracValue(s);
    assert s == w + [s[|s| - 3], s[|s| - 2], s[|s| - 1]];
  }

  /** Two different accepted strings never give the same cents. */
  lemma ToCentsInjective(s: Str, t: Str)
    requires ToCents(s).Some? && ToCents(s) == ToCents(t)
    ensures s == t
  {
    FromCentsOfToCents(s);
    FromCentsOfToCents(t);
  }

  /** Accepted strings are exactly the renderings fromCents produces; anything else is refused. */
  lemma AcceptedIffRendering(s: Str)
    ensures ToCents(s).Some? <==> exists c: nat :: c <= MAX_SAFE && s == FromCents(c)
  {
    if ToCents(s).Some? { FromCentsOfToCents(s); }
    if c: nat :| c <= MAX_SAFE && s == FromCents(c) { ToCentsOfFromCents(c); }
  }

  /** No rounding: the cents are exactly one hundred times the written decimal number. */
  lemma ToCentsIsExact(s: Str)
    requires ToCents(s).Some?
    ensures ToCents(s).value as real == 100.0 * DecimalValue(s)
  {}

  /** The cent order is the order of the written numbers. */
  lemma ToCentsMonotone(s: Str, t: Str)
    requires ToCents(s).Some? && ToCents(t).Some?
    ensures ToCents(s).value <= ToCents(t).value <==> DecimalValue(s) <= DecimalValue(t)
  {
    ToCentsIsExact(s);
    ToCentsIsExact(t);
  }

  // Examples of what is refused (each is checked by the verifier, not just written down).
  function A(s: string): Str
    requires forall i | 0 <= i < |s| :: s[i] as int < 0x1_0000
  {
    seq(|s|, i requires 0 <= i < |s| => s[i] as int as Unit)
  }

  lemma RefusedExamples()
    ensures ToCents(A("1850.0")) == None      // one decimal
    ensures ToCents(A("1850.000")) == None    // three decimals
    ensures ToCents(A("01850.00")) == None    // leading zero
    ensures ToCents(A("1,850.00")) == None    // grouping
    ensures ToCents(A("-1.00")) == None       // sign
    ensures ToCents(A("+1.00")) == None
    ensures ToCents(A(" 1.00")) == None       // whitespace
    ensures ToCents(A("1.00\n")) == None
    ensures ToCents(A("1e3.00")) == None      // exponent
    ensures ToCents(A(".50")) == None         // no whole part
    ensures ToCents(A("\U{0661}.00")) == None   // ARABIC-INDIC DIGIT ONE: not an ASCII digit
    ensures ToCents(A("\U{FF11}.00")) == None   // FULLWIDTH DIGIT ONE
  {
    var lz := A("01850.00");
    assert |lz| == 8 && lz[1] == 0x31;
    assert lz[..|lz| - 3][0] == ZERO && lz[..|lz| - 3] != [ZERO];
    var gr := A("1,850.00");
    assert |gr| == 8 && gr[1] == 0x2C && !IsDigit(gr[..|gr| - 3][1]);
    var ex := A("1e3.00");
    assert |ex| == 6 && ex[1] == 0x65 && !IsDigit(ex[..|ex| - 3][1]);
    var ar := A("\U{0661}.00");
    assert |ar| == 4 && ar[0] == 0x661;
    assert !IsDigit(ar[..|ar| - 3][0]);
    var fw := A("\U{FF11}.00");
    assert |fw| == 4 && fw[0] == 0xFF11;
    assert !IsDigit(fw[..|fw| - 3][0]);
  }

  lemma AcceptedExample()
    ensures ToCents(A("1850.00")) == Some(185000)
  {
    var s := A("1850.00");
    assert s == [0x31, 0x38, 0x35, 0x30, DOT, 0x30, 0x30];
    var w: Str := [0x31, 0x38, 0x35, 0x30];
    assert s[..|s| - 3] == w;
    assert w[..|w| - 1] == [0x31, 0x38, 0x35];
    assert [0x31, 0x38, 0x35][..2] == [0x31, 0x38];
    assert [0x31, 0x38][..1] == [0x31];
    var one: Str := [0x31];
    assert one[..0] == [];
    assert DigitsValue([0x31]) == 1;
    assert DigitsValue([0x31, 0x38]) == 18;
    assert DigitsValue([0x31, 0x38, 0x35]) == 185;
    assert DigitsValue(w) == 1850;
    assert FracValue(s) == 0;
  }
}
