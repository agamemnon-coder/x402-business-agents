// The verified functions the differential test runs (test/formal-dafny-differential.test.ts). `npm run formal:dafny`
// translates this file to JavaScript (formal/dafny/out/reference.js) and fails if the committed translation differs.
// Every function here is the verified one, called with no change; this module adds no logic of its own.

include "Terms.dfy"
include "Limit.dfy"

module Reference {
  import opened Text
  import Jcs
  import Utf8
  import Terms
  import Money
  import Limit

  function TermsBytes(j: Jcs.Json): Option<seq<Utf8.Byte>> { Terms.TermsBytes(j) }
  function CanonicalTerms(j: Jcs.Json): Option<Str> { Terms.CanonicalTerms(j) }
  function Normalize(j: Jcs.Json): Jcs.Json { Terms.Normalize(j) }

  /** JCS of any value (no terms checks): what the phone's canonicalize (src/approve/client.ts) must also give. */
  function CanonicalText(j: Jcs.Json): Str { Jcs.Ser(Terms.Normalize(j)) }

  function CanonicalBytes(j: Jcs.Json): seq<Utf8.Byte> {
    Terms.SerWellFormed(Terms.Normalize(j));
    Utf8.Encode(Jcs.Ser(Terms.Normalize(j)))
  }

  /** The verified decoder, on a whole canonical text: the value, or None when anything is left over or wrong. */
  function Decode(t: Str): Option<Jcs.Json> {
    match Jcs.ParseValue(t)
    case Some(r) => if r.1 == [] then Some(r.0) else None
    case None => None
  }

  function ToCents(s: Str): Option<nat> { Money.ToCents(s) }
  function FromCents(c: int): Option<Str> { Money.FromCentsChecked(c) }

  function AloneDecision(amount: Option<Str>, currency: Option<Str>, limitAmount: Str, limitCurrency: Str): Limit.Decision {
    Limit.AloneDecision(amount, currency, limitAmount, limitCurrency)
  }

  function CapRefuses(cents: int, cap: Str): Option<bool> { Limit.CapRefuses(cents, cap) }
}
