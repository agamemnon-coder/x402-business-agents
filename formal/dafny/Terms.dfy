// canonicalTerms and the bytes termsHash hashes (src/lib/terms.ts):
//
//   canonicalTerms(terms)  refuses unless terms.schema === "kit11.approval-terms/v1" and terms.expires_at is a string
//                          matching /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/, refuses any number anywhere,
//                          then returns jcs(terms)
//   termsHash(terms)       SHA-256 of the UTF-8 bytes of canonicalTerms(terms)
//
// A JavaScript object is a finite map from keys to values. The model receives its members in any order (Object.keys
// order) and sorts them by key in UTF-16 code-unit order, as Object.keys(v).sort() does. Numbers are outside the
// model's Json type because canonicalTerms refuses them; the differential test checks that it does.
//
// Main result (TermsBytesInjective, FieldChangeChangesBytes): two terms objects with the same canonical bytes are the
// same map, recursively; so terms that differ in any field (payee, account, amount, currency, due date, ...) have
// different bytes, and the same SHA-256 for them would be a SHA-256 collision. Nothing here is about SHA-256 itself.

include "Jcs.dfy"
include "Utf8.dfy"

module Terms {
  import opened Text
  import opened Jcs
  import Utf8

  // ---- Jcs output is well-formed UTF-16 ------------------------------------------------------------------------------

  lemma AsciiWellFormed(s: Str)
    requires forall i | 0 <= i < |s| :: s[i] < 0x80
    ensures Utf8.WellFormed(s)
  {
    Utf8.WellFormedNoSurrogates(s);
  }

  lemma EscUnitWellFormed(c: Unit)
    ensures Utf8.WellFormed(EscUnit(c))
  {
    var e := EscUnit(c);
    if c < 0x20 || IsSurrogate(c) || c == QUOTE || c == BSLASH || c == 0x08 || c == 0x09 || c == 0x0A || c == 0x0C || c == 0x0D {
      AsciiWellFormed(e);
    } else {
      Utf8.WellFormedNoSurrogates(e);
    }
  }

  lemma EscapeWellFormed(s: Str)
    ensures Utf8.WellFormed(Escape(s))
    decreases |s|
  {
    if |s| > 0 {
      if |s| >= 2 && IsHigh(s[0]) && IsLow(s[1]) {
        EscapeWellFormed(s[2..]);
        var p: Str := [s[0], s[1]];
        assert Utf8.WellFormed(p[2..]);
        assert Utf8.WellFormed(p);
        Utf8.WellFormedConcat(p, Escape(s[2..]));
      } else {
        EscapeWellFormed(s[1..]);
        EscUnitWellFormed(s[0]);
        Utf8.WellFormedConcat(EscUnit(s[0]), Escape(s[1..]));
      }
    }
  }

  lemma QuoteWellFormed(s: Str)
    ensures Utf8.WellFormed(Quote(s))
  {
    EscapeWellFormed(s);
    AsciiWellFormed([QUOTE]);
    Utf8.WellFormedConcat([QUOTE], Escape(s));
    Utf8.WellFormedConcat([QUOTE] + Escape(s), [QUOTE]);
  }

  lemma SerWellFormed(j: Json)
    ensures Utf8.WellFormed(Ser(j))
    decreases j, 1
  {
    match j
    case JNull => AsciiWellFormed(NULL_LIT);
    case JBool(b) => AsciiWellFormed(TRUE_LIT); AsciiWellFormed(FALSE_LIT);
    case JStr(s) => QuoteWellFormed(s);
    case JArr(items) =>
      SerItemsWellFormed(items, j);
      AsciiWellFormed([LBRACK]);
      AsciiWellFormed([RBRACK]);
      Utf8.WellFormedConcat([LBRACK], SerItems(items, j));
      Utf8.WellFormedConcat([LBRACK] + SerItems(items, j), [RBRACK]);
    case JObj(ms) =>
      SerMembersWellFormed(ms, j);
      AsciiWellFormed([LBRACE]);
      AsciiWellFormed([RBRACE]);
      Utf8.WellFormedConcat([LBRACE], SerMembers(ms, j));
      Utf8.WellFormedConcat([LBRACE] + SerMembers(ms, j), [RBRACE]);
  }

  lemma SerItemsWellFormed(items: seq<Json>, parent: Json)
    requires forall i | 0 <= i < |items| :: items[i] < parent
    ensures Utf8.WellFormed(SerItems(items, parent))
    decreases parent, 0, |items|
  {
    if |items| == 1 {
      SerWellFormed(items[0]);
    } else if |items| > 1 {
      SerWellFormed(items[0]);
      SerItemsWellFormed(items[1..], parent);
      AsciiWellFormed([COMMA]);
      Utf8.WellFormedConcat(Ser(items[0]), [COMMA]);
      Utf8.WellFormedConcat(Ser(items[0]) + [COMMA], SerItems(items[1..], parent));
    }
  }

  lemma SerMemberWellFormed(m: Member, parent: Json)
    requires m.value < parent
    ensures Utf8.WellFormed(SerMember(m, parent))
    decreases parent, 0, 0
  {
    QuoteWellFormed(m.key);
    SerWellFormed(m.value);
    AsciiWellFormed([COLON]);
    Utf8.WellFormedConcat(Quote(m.key), [COLON]);
    Utf8.WellFormedConcat(Quote(m.key) + [COLON], Ser(m.value));
  }

  lemma SerMembersWellFormed(ms: seq<Member>, parent: Json)
    requires forall i | 0 <= i < |ms| :: ms[i].value < parent
    ensures Utf8.WellFormed(SerMembers(ms, parent))
    decreases parent, 0, |ms|
  {
    if |ms| == 1 {
      SerMemberWellFormed(ms[0], parent);
    } else if |ms| > 1 {
      SerMemberWellFormed(ms[0], parent);
      SerMembersWellFormed(ms[1..], parent);
      AsciiWellFormed([COMMA]);
      Utf8.WellFormedConcat(SerMember(ms[0], parent), [COMMA]);
      Utf8.WellFormedConcat(SerMember(ms[0], parent) + [COMMA], SerMembers(ms[1..], parent));
    }
  }

  // ---- Key order: Array.prototype.sort's default, UTF-16 code units --------------------------------------------------

  predicate Lt(a: Str, b: Str)
    decreases |a|
  {
    if |a| == 0 then |b| > 0
    else if |b| == 0 then false
    else a[0] < b[0] || (a[0] == b[0] && Lt(a[1..], b[1..]))
  }

  lemma LtIrreflexive(a: Str)
    ensures !Lt(a, a)
    decreases |a|
  {
    if |a| > 0 { LtIrreflexive(a[1..]); }
  }

  lemma LtAsymmetric(a: Str, b: Str)
    requires Lt(a, b)
    ensures !Lt(b, a)
    decreases |a|
  {
    if |a| > 0 && |b| > 0 && a[0] == b[0] { LtAsymmetric(a[1..], b[1..]); }
  }

  lemma LtTransitive(a: Str, b: Str, c: Str)
    requires Lt(a, b) && Lt(b, c)
    ensures Lt(a, c)
    decreases |a|
  {
    if |a| > 0 && |b| > 0 && |c| > 0 && a[0] == b[0] && b[0] == c[0] { LtTransitive(a[1..], b[1..], c[1..]); }
  }

  lemma LtTotal(a: Str, b: Str)
    requires a != b
    ensures Lt(a, b) || Lt(b, a)
    decreases |a|
  {
    if |a| > 0 && |b| > 0 && a[0] == b[0] {
      assert a == [a[0]] + a[1..] && b == [b[0]] + b[1..];
      LtTotal(a[1..], b[1..]);
    }
  }

  predicate StrictlySorted(ms: seq<Member>) {
    forall i, k | 0 <= i < k < |ms| :: Lt(ms[i].key, ms[k].key)
  }

  predicate DistinctKeys(ms: seq<Member>) {
    forall i, k | 0 <= i < k < |ms| :: ms[i].key != ms[k].key
  }

  function Insert(m: Member, ms: seq<Member>): seq<Member>
    decreases |ms|
  {
    if |ms| == 0 then [m]
    else if Lt(m.key, ms[0].key) then [m] + ms
    else [ms[0]] + Insert(m, ms[1..])
  }

  function SortMembers(ms: seq<Member>): seq<Member>
    decreases |ms|
  {
    if |ms| == 0 then [] else Insert(ms[0], SortMembers(ms[1..]))
  }

  lemma InsertSorted(m: Member, ms: seq<Member>)
    requires StrictlySorted(ms)
    requires forall i | 0 <= i < |ms| :: ms[i].key != m.key
    ensures StrictlySorted(Insert(m, ms))
    ensures multiset(Insert(m, ms)) == multiset(ms) + multiset{m}
    ensures |Insert(m, ms)| > 0 && (Insert(m, ms)[0] == m || (|ms| > 0 && Insert(m, ms)[0] == ms[0]))
    decreases |ms|
  {
    if |ms| > 0 {
      if Lt(m.key, ms[0].key) {
        forall k | 0 <= k < |ms| ensures Lt(m.key, ms[k].key) {
          if k > 0 { LtTransitive(m.key, ms[0].key, ms[k].key); }
        }
        assert multiset([m] + ms) == multiset{m} + multiset(ms);
      } else {
        LtTotal(m.key, ms[0].key);
        InsertSorted(m, ms[1..]);
        var r := Insert(m, ms[1..]);
        assert ms == [ms[0]] + ms[1..];
        forall x: Member | x in multiset(r) ensures Lt(ms[0].key, x.key) {
          assert x in multiset(ms[1..]) + multiset{m};
          if x == m {
          } else {
            assert x in ms[1..];
            var k :| 0 <= k < |ms[1..]| && ms[1..][k] == x;
            assert ms[k + 1] == x;
          }
        }
        forall i, k | 0 <= i < k < |[ms[0]] + r| ensures Lt(([ms[0]] + r)[i].key, ([ms[0]] + r)[k].key) {
          if i == 0 {
            assert ([ms[0]] + r)[k] == r[k - 1];
            assert r[k - 1] in multiset(r);
          }
        }
        assert multiset([ms[0]] + r) == multiset{ms[0]} + multiset(r);
      }
    }
  }

  lemma SortSorted(ms: seq<Member>)
    requires DistinctKeys(ms)
    ensures StrictlySorted(SortMembers(ms))
    ensures multiset(SortMembers(ms)) == multiset(ms)
    decreases |ms|
  {
    if |ms| > 0 {
      var tail := ms[1..];
      assert DistinctKeys(tail) by {
        forall i, k | 0 <= i < k < |tail| ensures tail[i].key != tail[k].key { assert ms[i + 1].key != ms[k + 1].key; }
      }
      SortSorted(tail);
      var s := SortMembers(tail);
      forall i | 0 <= i < |s| ensures s[i].key != ms[0].key {
        assert s[i] in multiset(tail);
        var k :| 0 <= k < |tail| && tail[k] == s[i];
        assert ms[k + 1] == s[i];
      }
      InsertSorted(ms[0], s);
      assert ms == [ms[0]] + tail;
      assert multiset(ms) == multiset{ms[0]} + multiset(tail);
    }
  }

  /** Two strictly sorted member lists with the same members are the same list: the sorted order is unique. */
  lemma SortedUnique(xs: seq<Member>, ys: seq<Member>)
    requires StrictlySorted(xs) && StrictlySorted(ys) && multiset(xs) == multiset(ys)
    ensures xs == ys
    decreases |xs|
  {
    if |xs| == 0 {
      assert |multiset(ys)| == 0;
    } else {
      assert |ys| == |xs| by { assert |multiset(xs)| == |xs| && |multiset(ys)| == |ys|; }
      if xs[0] != ys[0] {
        assert xs[0] in multiset(ys);
        var k :| 0 <= k < |ys| && ys[k] == xs[0];
        assert ys[0] in multiset(xs);
        var k2 :| 0 <= k2 < |xs| && xs[k2] == ys[0];
        assert k > 0 && k2 > 0;
        assert Lt(ys[0].key, xs[0].key);
        assert Lt(xs[0].key, ys[0].key);
        LtAsymmetric(xs[0].key, ys[0].key);
      }
      assert xs == [xs[0]] + xs[1..] && ys == [ys[0]] + ys[1..];
      assert multiset(xs) == multiset{xs[0]} + multiset(xs[1..]);
      assert multiset(ys) == multiset{ys[0]} + multiset(ys[1..]);
      assert xs[0] == ys[0];
      assert multiset(xs[1..]) == multiset(xs) - multiset{xs[0]};
      assert multiset(ys[1..]) == multiset(ys) - multiset{ys[0]};
      assert multiset(xs[1..]) == multiset(ys[1..]);
      SortedUnique(xs[1..], ys[1..]);
    }
  }

  // ---- Normalise: what jcs serialises -------------------------------------------------------------------------------

  function Normalize(j: Json): Json
    decreases j, 1
  {
    match j
    case JArr(items) => JArr(NormItems(items, j))
    case JObj(ms) => JObj(SortMembers(NormMembers(ms, j)))
    case _ => j
  }

  function NormItems(items: seq<Json>, ghost parent: Json): seq<Json>
    requires forall i | 0 <= i < |items| :: items[i] < parent
    ensures |NormItems(items, parent)| == |items|
    decreases parent, 0, |items|
  {
    if |items| == 0 then [] else [Normalize(items[0])] + NormItems(items[1..], parent)
  }

  function NormMembers(ms: seq<Member>, ghost parent: Json): seq<Member>
    requires forall i | 0 <= i < |ms| :: ms[i].value < parent
    ensures |NormMembers(ms, parent)| == |ms|
    ensures forall i | 0 <= i < |ms| :: NormMembers(ms, parent)[i].key == ms[i].key
    decreases parent, 0, |ms|
  {
    if |ms| == 0 then [] else [Member(ms[0].key, Normalize(ms[0].value))] + NormMembers(ms[1..], parent)
  }

  lemma NormMembersAt(ms: seq<Member>, parent: Json, i: nat)
    requires forall k | 0 <= k < |ms| :: ms[k].value < parent
    requires i < |ms|
    ensures NormMembers(ms, parent)[i] == Member(ms[i].key, Normalize(ms[i].value))
    decreases i
  {
    if i > 0 { NormMembersAt(ms[1..], parent, i - 1); }
  }

  /**
   * An object's canonical form: its members, each value in canonical form, sorted strictly by key. With distinct
   * keys (every JavaScript object), the sorted list is a permutation of the members.
   */
  lemma NormalizeObject(ms: seq<Member>)
    requires DistinctKeys(ms)
    ensures Normalize(JObj(ms)).JObj?
    ensures StrictlySorted(Normalize(JObj(ms)).members)
    ensures multiset(Normalize(JObj(ms)).members) == multiset(NormMembers(ms, JObj(ms)))
  {
    var n := NormMembers(ms, JObj(ms));
    assert DistinctKeys(n);
    SortSorted(n);
  }

  /**
   * Two objects have the same canonical form exactly when they have the same members (key and canonical value),
   * in whatever order: the canonical form depends on the object as a map and on nothing else.
   */
  lemma SameCanonicalFormIffSameMembers(ms1: seq<Member>, ms2: seq<Member>)
    requires DistinctKeys(ms1) && DistinctKeys(ms2)
    ensures Normalize(JObj(ms1)) == Normalize(JObj(ms2))
      <==> multiset(NormMembers(ms1, JObj(ms1))) == multiset(NormMembers(ms2, JObj(ms2)))
  {
    NormalizeObject(ms1);
    NormalizeObject(ms2);
    if multiset(NormMembers(ms1, JObj(ms1))) == multiset(NormMembers(ms2, JObj(ms2))) {
      SortedUnique(Normalize(JObj(ms1)).members, Normalize(JObj(ms2)).members);
    }
  }

  // ---- canonicalTerms -----------------------------------------------------------------------------------------------

  /** "kit11.approval-terms/v1" */
  const SCHEMA: Str := [0x6B, 0x69, 0x74, 0x31, 0x31, 0x2E, 0x61, 0x70, 0x70, 0x72, 0x6F, 0x76, 0x61, 0x6C, 0x2D, 0x74,
                        0x65, 0x72, 0x6D, 0x73, 0x2F, 0x76, 0x31]
  const KEY_SCHEMA: Str := [0x73, 0x63, 0x68, 0x65, 0x6D, 0x61]                                // schema
  const KEY_EXPIRES_AT: Str := [0x65, 0x78, 0x70, 0x69, 0x72, 0x65, 0x73, 0x5F, 0x61, 0x74]  // expires_at

  function Get(ms: seq<Member>, k: Str): Option<Json>
    decreases |ms|
  {
    if |ms| == 0 then None else if ms[0].key == k then Some(ms[0].value) else Get(ms[1..], k)
  }

  /** /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/ */
  predicate IsoUtc(e: Str) {
    (|e| == 20 || (|e| == 24 && e[19] == DOT && IsDigit(e[20]) && IsDigit(e[21]) && IsDigit(e[22])))
    && e[|e| - 1] == 0x5A
    && IsDigit(e[0]) && IsDigit(e[1]) && IsDigit(e[2]) && IsDigit(e[3]) && e[4] == 0x2D
    && IsDigit(e[5]) && IsDigit(e[6]) && e[7] == 0x2D && IsDigit(e[8]) && IsDigit(e[9]) && e[10] == 0x54
    && IsDigit(e[11]) && IsDigit(e[12]) && e[13] == COLON && IsDigit(e[14]) && IsDigit(e[15]) && e[16] == COLON
    && IsDigit(e[17]) && IsDigit(e[18])
  }

  /** canonicalTerms' own checks (the refusal of numbers is the Json type itself). */
  predicate TermsOk(j: Json) {
    j.JObj?
    && Get(j.members, KEY_SCHEMA) == Some(JStr(SCHEMA))
    && match Get(j.members, KEY_EXPIRES_AT)
       case Some(JStr(e)) => IsoUtc(e)
       case _ => false
  }

  /** canonicalTerms: the JCS text, or None where the TypeScript throws. */
  function CanonicalTerms(j: Json): Option<Str> {
    if TermsOk(j) then Some(Ser(Normalize(j))) else None
  }

  /** The bytes termsHash gives SHA-256. */
  function TermsBytes(j: Json): Option<seq<Utf8.Byte>> {
    if TermsOk(j) then
      SerWellFormed(Normalize(j));
      Some(Utf8.Encode(Ser(Normalize(j))))
    else None
  }

  // ---- The theorem --------------------------------------------------------------------------------------------------

  /** The canonical text is injective on canonical forms. */
  lemma CanonicalTermsInjective(a: Json, b: Json)
    requires CanonicalTerms(a).Some? && CanonicalTerms(a) == CanonicalTerms(b)
    ensures Normalize(a) == Normalize(b)
  {
    SerInjective(Normalize(a), Normalize(b));
  }

  /** The bytes SHA-256 reads are injective on canonical forms: equal bytes, equal terms (as maps, recursively). */
  lemma TermsBytesInjective(a: Json, b: Json)
    requires TermsBytes(a).Some? && TermsBytes(a) == TermsBytes(b)
    ensures Normalize(a) == Normalize(b)
  {
    SerWellFormed(Normalize(a));
    SerWellFormed(Normalize(b));
    Utf8.EncodeInjective(Ser(Normalize(a)), Ser(Normalize(b)));
    SerInjective(Normalize(a), Normalize(b));
  }

  lemma GetIndex(ms: seq<Member>, k: Str) returns (i: nat)
    requires Get(ms, k).Some?
    ensures i < |ms| && ms[i].key == k && ms[i].value == Get(ms, k).value
    decreases |ms|
  {
    if ms[0].key == k { i := 0; } else { var r := GetIndex(ms[1..], k); i := r + 1; }
  }

  lemma GetAbsent(ms: seq<Member>, k: Str)
    requires Get(ms, k).None?
    ensures forall i | 0 <= i < |ms| :: ms[i].key != k
    decreases |ms|
  {
    if |ms| > 0 { GetAbsent(ms[1..], k); }
  }

  /**
   * Change any one field of a terms object (the payee, the account, the amount, the currency, the due date, any key
   * at all), or add or drop one, and the canonical bytes change. A forged invoice with the same terms hash as the one
   * the CFO signed therefore needs two different byte strings with the same SHA-256: a SHA-256 collision.
   */
  lemma FieldChangeChangesBytes(ms1: seq<Member>, ms2: seq<Member>, k: Str)
    requires DistinctKeys(ms1) && DistinctKeys(ms2)
    requires TermsBytes(JObj(ms1)).Some?
    requires Get(ms1, k).Some?
    requires Get(ms2, k).None? || Normalize(Get(ms2, k).value) != Normalize(Get(ms1, k).value)
    ensures TermsBytes(JObj(ms1)) != TermsBytes(JObj(ms2))
  {
    if TermsBytes(JObj(ms1)) == TermsBytes(JObj(ms2)) {
      TermsBytesInjective(JObj(ms1), JObj(ms2));
      SameCanonicalFormIffSameMembers(ms1, ms2);
      var i := GetIndex(ms1, k);
      var n1 := NormMembers(ms1, JObj(ms1));
      var n2 := NormMembers(ms2, JObj(ms2));
      NormMembersAt(ms1, JObj(ms1), i);
      assert n1[i] in multiset(n2);
      var i2 :| 0 <= i2 < |n2| && n2[i2] == n1[i];
      NormMembersAt(ms2, JObj(ms2), i2);
      assert ms2[i2].key == k;
      if Get(ms2, k).None? {
        GetAbsent(ms2, k);
      } else {
        var j2 := GetIndex(ms2, k);
        assert j2 == i2;
      }
    }
  }
}
