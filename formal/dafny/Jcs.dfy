// RFC 8785 (JCS) as the code runs it: jcs() in @metalntwx/metal-pay/dist/mandates/jcs.js, called by canonicalTerms
// (src/lib/terms.ts) on terms that hold no numbers (canonicalTerms refuses those). For such values jcs is
//
//   null, true, false    JSON.stringify: the literal
//   a string             JSON.stringify(string): ECMA-262 QuoteJSONString, below as Quote
//   an array             "[" + items joined with "," + "]"
//   an object            "{" + for each key of Object.keys(v).sort(): JSON.stringify(key) + ":" + jcs(v[key]),
//                        joined with "," + "}"
//
// This file proves that serialisation is injective, by giving a decoder and proving decode(Ser(v) + rest) == (v, rest)
// for every value v and every rest. Objects are modelled as their member sequence; Terms.dfy sorts it, as the code does.

include "Text.dfy"

module Jcs {
  import opened Text

  datatype Json = JNull | JBool(b: bool) | JStr(s: Str) | JArr(items: seq<Json>) | JObj(members: seq<Member>)
  datatype Member = Member(key: Str, value: Json)

  const QUOTE: Unit := 0x22
  const BSLASH: Unit := 0x5C
  const COMMA: Unit := 0x2C
  const COLON: Unit := 0x3A
  const LBRACK: Unit := 0x5B
  const RBRACK: Unit := 0x5D
  const LBRACE: Unit := 0x7B
  const RBRACE: Unit := 0x7D
  const NULL_LIT: Str := [0x6E, 0x75, 0x6C, 0x6C]         // null
  const TRUE_LIT: Str := [0x74, 0x72, 0x75, 0x65]         // true
  const FALSE_LIT: Str := [0x66, 0x61, 0x6C, 0x73, 0x65]  // false

  predicate IsHigh(c: Unit) { 0xD800 <= c <= 0xDBFF }
  predicate IsLow(c: Unit) { 0xDC00 <= c <= 0xDFFF }
  predicate IsSurrogate(c: Unit) { 0xD800 <= c <= 0xDFFF }

  // ---- Strings: JSON.stringify(string) -----------------------------------------------------------------------------

  /** A lowercase hexadecimal digit, as UnicodeEscape writes it. */
  function HexDigit(n: int): Unit
    requires 0 <= n < 16
  {
    if n < 10 then (0x30 + n) as Unit else (0x61 + n - 10) as Unit
  }

  function Hex4(c: Unit): Str {
    [HexDigit(c / 4096), HexDigit((c / 256) % 16), HexDigit((c / 16) % 16), HexDigit(c % 16)]
  }

  /** One code unit, escaped as QuoteJSONString does when it is not part of a valid surrogate pair. */
  function EscUnit(c: Unit): Str {
    if c == 0x08 then [BSLASH, 0x62]             // \b
    else if c == 0x09 then [BSLASH, 0x74]        // \t
    else if c == 0x0A then [BSLASH, 0x6E]        // \n
    else if c == 0x0C then [BSLASH, 0x66]        // \f
    else if c == 0x0D then [BSLASH, 0x72]        // \r
    else if c == QUOTE then [BSLASH, QUOTE]      // \"
    else if c == BSLASH then [BSLASH, BSLASH]    // \\
    else if c < 0x20 || IsSurrogate(c) then [BSLASH, 0x75] + Hex4(c)  // \u00XX, or a lone surrogate \udXXX
    else [c]
  }

  /** QuoteJSONString's body: a valid surrogate pair is copied, every other code unit goes through EscUnit. */
  function Escape(s: Str): Str
    decreases |s|
  {
    if |s| == 0 then []
    else if |s| >= 2 && IsHigh(s[0]) && IsLow(s[1]) then [s[0], s[1]] + Escape(s[2..])
    else EscUnit(s[0]) + Escape(s[1..])
  } by method {
    // The same function in linear time for the compiled reference; Dafny proves it returns exactly Escape(s).
    var a := new Unit[6 * |s|];
    var i, n := 0, 0;
    while i < |s|
      invariant 0 <= i <= |s| && 0 <= n <= 6 * i
      invariant a[..n] + Escape(s[i..]) == Escape(s)
    {
      ghost var rest := s[i..];
      assert rest[0] == s[i];
      if i + 1 < |s| && IsHigh(s[i]) && IsLow(s[i + 1]) {
        a[n], a[n + 1] := s[i], s[i + 1];
        assert rest[1] == s[i + 1] && rest[2..] == s[i + 2..];
        assert a[..n + 2] == a[..n] + [s[i], s[i + 1]];
        n, i := n + 2, i + 2;
      } else {
        var e := EscUnit(s[i]);
        assert |e| <= 6;
        ghost var prefix := a[..n];
        var k := 0;
        while k < |e|
          invariant 0 <= k <= |e|
          invariant a[..n + k] == prefix + e[..k]
        {
          a[n + k] := e[k];
          assert a[..n + k + 1] == a[..n + k] + [e[k]];
          assert e[..k + 1] == e[..k] + [e[k]];
          k := k + 1;
        }
        assert e[..k] == e;
        assert rest[1..] == s[i + 1..];
        assert Escape(rest) == e + Escape(rest[1..]);
        n, i := n + |e|, i + 1;
      }
    }
    assert s[i..] == [];
    return a[..n];
  }

  function Quote(s: Str): Str { [QUOTE] + Escape(s) + [QUOTE] }

  // ---- Values -------------------------------------------------------------------------------------------------------

  function Ser(j: Json): Str
    decreases j, 1
  {
    match j
    case JNull => NULL_LIT
    case JBool(b) => if b then TRUE_LIT else FALSE_LIT
    case JStr(s) => Quote(s)
    case JArr(items) => [LBRACK] + SerItems(items, j) + [RBRACK]
    case JObj(ms) => [LBRACE] + SerMembers(ms, j) + [RBRACE]
  }

  function SerItems(items: seq<Json>, ghost parent: Json): Str
    requires forall i | 0 <= i < |items| :: items[i] < parent
    decreases parent, 0, |items|
  {
    if |items| == 0 then []
    else if |items| == 1 then Ser(items[0])
    else Ser(items[0]) + [COMMA] + SerItems(items[1..], parent)
  }

  function SerMember(m: Member, ghost parent: Json): Str
    requires m.value < parent
    decreases parent, 0, 0
  {
    Quote(m.key) + [COLON] + Ser(m.value)
  }

  function SerMembers(ms: seq<Member>, ghost parent: Json): Str
    requires forall i | 0 <= i < |ms| :: ms[i].value < parent
    decreases parent, 0, |ms|
  {
    if |ms| == 0 then []
    else if |ms| == 1 then SerMember(ms[0], parent)
    else SerMember(ms[0], parent) + [COMMA] + SerMembers(ms[1..], parent)
  }

  // ---- The decoder --------------------------------------------------------------------------------------------------

  predicate IsHexDigit(c: Unit) { 0x30 <= c <= 0x39 || 0x61 <= c <= 0x66 }

  function HexVal(c: Unit): nat
    requires IsHexDigit(c)
  {
    if c <= 0x39 then c - 0x30 else c - 0x61 + 10
  }

  predicate IsHex4(t: Str) { |t| == 4 && IsHexDigit(t[0]) && IsHexDigit(t[1]) && IsHexDigit(t[2]) && IsHexDigit(t[3]) }

  function Hex4Val(t: Str): Unit
    requires IsHex4(t)
  {
    HexVal(t[0]) * 4096 + HexVal(t[1]) * 256 + HexVal(t[2]) * 16 + HexVal(t[3])
  }

  function Unescape(e: Unit): Option<Unit> {
    if e == 0x62 then Some(0x08)
    else if e == 0x74 then Some(0x09)
    else if e == 0x6E then Some(0x0A)
    else if e == 0x66 then Some(0x0C)
    else if e == 0x72 then Some(0x0D)
    else if e == QUOTE then Some(QUOTE)
    else if e == BSLASH then Some(BSLASH)
    else None
  }

  /** The body of a string literal after its opening quote: the code units, and what follows the closing quote. */
  function DecodeStr(t: Str): Option<(Str, Str)>
    ensures DecodeStr(t).Some? ==> |DecodeStr(t).value.1| < |t|
    decreases |t|
  {
    if |t| == 0 then None
    else if t[0] == QUOTE then Some(([], t[1..]))
    else if t[0] == BSLASH then
      if |t| < 2 then None
      else if t[1] == 0x75 then
        if |t| < 6 || !IsHex4(t[2..6]) then None
        else
          match DecodeStr(t[6..])
          case None => None
          case Some(r) => Some(([Hex4Val(t[2..6])] + r.0, r.1))
      else
        match Unescape(t[1])
        case None => None
        case Some(u) =>
          match DecodeStr(t[2..])
          case None => None
          case Some(r) => Some(([u] + r.0, r.1))
    else
      match DecodeStr(t[1..])
      case None => None
      case Some(r) => Some(([t[0]] + r.0, r.1))
  }

  function ParseValue(t: Str): Option<(Json, Str)>
    ensures ParseValue(t).Some? ==> |ParseValue(t).value.1| < |t|
    decreases |t|, 0
  {
    if |t| == 0 then None
    else if t[0] == 0x6E then (if |t| >= 4 && t[..4] == NULL_LIT then Some((JNull, t[4..])) else None)
    else if t[0] == 0x74 then (if |t| >= 4 && t[..4] == TRUE_LIT then Some((JBool(true), t[4..])) else None)
    else if t[0] == 0x66 then (if |t| >= 5 && t[..5] == FALSE_LIT then Some((JBool(false), t[5..])) else None)
    else if t[0] == QUOTE then
      match DecodeStr(t[1..])
      case None => None
      case Some(r) => Some((JStr(r.0), r.1))
    else if t[0] == LBRACK then
      if |t| >= 2 && t[1] == RBRACK then Some((JArr([]), t[2..]))
      else
        match ParseItems(t[1..])
        case None => None
        case Some(r) => Some((JArr(r.0), r.1))
    else if t[0] == LBRACE then
      if |t| >= 2 && t[1] == RBRACE then Some((JObj([]), t[2..]))
      else
        match ParseMembers(t[1..])
        case None => None
        case Some(r) => Some((JObj(r.0), r.1))
    else None
  }

  /** One or more values separated by commas, then "]". */
  function ParseItems(t: Str): Option<(seq<Json>, Str)>
    ensures ParseItems(t).Some? ==> |ParseItems(t).value.1| < |t|
    decreases |t|, 1
  {
    match ParseValue(t)
    case None => None
    case Some(r) =>
      var rest := r.1;
      if |rest| == 0 then None
      else if rest[0] == RBRACK then Some(([r.0], rest[1..]))
      else if rest[0] == COMMA then
        match ParseItems(rest[1..])
        case None => None
        case Some(r2) => Some(([r.0] + r2.0, r2.1))
      else None
  }

  /** One or more "key":value members separated by commas, then "}". */
  function ParseMembers(t: Str): Option<(seq<Member>, Str)>
    ensures ParseMembers(t).Some? ==> |ParseMembers(t).value.1| < |t|
    decreases |t|, 1
  {
    if |t| == 0 || t[0] != QUOTE then None
    else
      match DecodeStr(t[1..])
      case None => None
      case Some(k) =>
        var afterKey := k.1;
        if |afterKey| == 0 || afterKey[0] != COLON then None
        else
          match ParseValue(afterKey[1..])
          case None => None
          case Some(r) =>
            var rest := r.1;
            if |rest| == 0 then None
            else if rest[0] == RBRACE then Some(([Member(k.0, r.0)], rest[1..]))
            else if rest[0] == COMMA then
              match ParseMembers(rest[1..])
              case None => None
              case Some(r2) => Some(([Member(k.0, r.0)] + r2.0, r2.1))
            else None
  }

  // ---- Round trip ---------------------------------------------------------------------------------------------------

  lemma HexRoundTrip(c: Unit)
    ensures IsHex4(Hex4(c)) && Hex4Val(Hex4(c)) == c
  {
    var h := Hex4(c);
    assert HexVal(h[0]) == c / 4096;
    assert HexVal(h[1]) == (c / 256) % 16;
    assert HexVal(h[2]) == (c / 16) % 16;
    assert HexVal(h[3]) == c % 16;
    DivSplit(c);
  }

  lemma DivSplit(c: nat)
    ensures (c / 4096) * 4096 + ((c / 256) % 16) * 256 + ((c / 16) % 16) * 16 + c % 16 == c
  {
    var q16 := c / 16;
    var q256 := q16 / 16;
    assert c / 256 == q256;
    assert c / 4096 == q256 / 16;
    assert q256 == (q256 / 16) * 16 + q256 % 16;
    assert q16 == q256 * 16 + q16 % 16;
    assert c == q16 * 16 + c % 16;
  }

  lemma DecodeEscape(s: Str, rest: Str)
    ensures DecodeStr(Escape(s) + [QUOTE] + rest) == Some((s, rest))
    decreases |s|
  {
    var t := Escape(s) + [QUOTE] + rest;
    if |s| == 0 {
      assert t == [QUOTE] + rest;
    } else if |s| >= 2 && IsHigh(s[0]) && IsLow(s[1]) {
      var tail := Escape(s[2..]) + [QUOTE] + rest;
      assert t == [s[0], s[1]] + tail;
      DecodeEscape(s[2..], rest);
      assert t[1..] == [s[1]] + tail;
      assert t[1..][1..] == tail;
      assert s == [s[0]] + ([s[1]] + s[2..]);
    } else {
      var c := s[0];
      var tail := Escape(s[1..]) + [QUOTE] + rest;
      assert t == EscUnit(c) + tail;
      DecodeEscape(s[1..], rest);
      assert s == [c] + s[1..];
      if c == 0x08 || c == 0x09 || c == 0x0A || c == 0x0C || c == 0x0D || c == QUOTE || c == BSLASH {
        assert |EscUnit(c)| == 2 && t[0] == BSLASH;
        assert t[2..] == tail;
      } else if c < 0x20 || IsSurrogate(c) {
        HexRoundTrip(c);
        assert t[0] == BSLASH && t[1] == 0x75;
        assert t[2..6] == Hex4(c);
        assert t[6..] == tail;
      } else {
        assert EscUnit(c) == [c];
        assert t[1..] == tail;
      }
    }
  }

  lemma SerFirst(j: Json)
    ensures |Ser(j)| > 0
    ensures Ser(j)[0] == (match j
      case JNull => 0x6E
      case JBool(b) => if b then 0x74 else 0x66
      case JStr(_) => QUOTE
      case JArr(_) => LBRACK
      case JObj(_) => LBRACE)
  {}

  lemma ParseSer(j: Json, rest: Str)
    ensures ParseValue(Ser(j) + rest) == Some((j, rest))
    decreases j, 1
  {
    var t := Ser(j) + rest;
    match j
    case JNull => assert t[..4] == NULL_LIT && t[4..] == rest;
    case JBool(b) =>
      if b { assert t[..4] == TRUE_LIT && t[4..] == rest; }
      else { assert t[..5] == FALSE_LIT && t[5..] == rest; }
    case JStr(s) =>
      assert t[1..] == Escape(s) + [QUOTE] + rest;
      DecodeEscape(s, rest);
    case JArr(items) =>
      if |items| == 0 {
        assert SerItems(items, j) == [];
        assert Ser(j) == [LBRACK, RBRACK];
        assert t == [LBRACK, RBRACK] + rest;
      } else {
        assert Ser(j) == [LBRACK] + SerItems(items, j) + [RBRACK];
        assert t[1..] == SerItems(items, j) + [RBRACK] + rest;
        SerItemsFirst(items, j);
        ParseSerItems(items, j, rest);
      }
    case JObj(ms) =>
      if |ms| == 0 {
        assert SerMembers(ms, j) == [];
        assert Ser(j) == [LBRACE, RBRACE];
        assert t == [LBRACE, RBRACE] + rest;
      } else {
        assert Ser(j) == [LBRACE] + SerMembers(ms, j) + [RBRACE];
        assert t[1..] == SerMembers(ms, j) + [RBRACE] + rest;
        ParseSerMembers(ms, j, rest);
        assert SerMembers(ms, j)[0] == QUOTE;
      }
  }

  lemma SerItemsFirst(items: seq<Json>, parent: Json)
    requires |items| > 0 && forall i | 0 <= i < |items| :: items[i] < parent
    ensures |SerItems(items, parent)| > 0 && SerItems(items, parent)[0] != RBRACK
  {
    SerFirst(items[0]);
    if |items| == 1 {
      assert SerItems(items, parent) == Ser(items[0]);
    } else {
      assert SerItems(items, parent) == Ser(items[0]) + [COMMA] + SerItems(items[1..], parent);
    }
  }

  lemma ParseSerItems(items: seq<Json>, parent: Json, rest: Str)
    requires |items| > 0 && forall i | 0 <= i < |items| :: items[i] < parent
    ensures ParseItems(SerItems(items, parent) + [RBRACK] + rest) == Some((items, rest))
    decreases parent, 0, |items|
  {
    var t := SerItems(items, parent) + [RBRACK] + rest;
    if |items| == 1 {
      ParseSer(items[0], [RBRACK] + rest);
      assert SerItems(items, parent) == Ser(items[0]);
      assert t == Ser(items[0]) + ([RBRACK] + rest);
      assert items == [items[0]];
    } else {
      var more := [COMMA] + SerItems(items[1..], parent) + [RBRACK] + rest;
      assert SerItems(items, parent) == Ser(items[0]) + [COMMA] + SerItems(items[1..], parent);
      assert t == Ser(items[0]) + more;
      ParseSer(items[0], more);
      ParseSerItems(items[1..], parent, rest);
      assert more[1..] == SerItems(items[1..], parent) + [RBRACK] + rest;
      assert items == [items[0]] + items[1..];
    }
  }

  lemma ParseSerMembers(ms: seq<Member>, parent: Json, rest: Str)
    requires |ms| > 0 && forall i | 0 <= i < |ms| :: ms[i].value < parent
    ensures ParseMembers(SerMembers(ms, parent) + [RBRACE] + rest) == Some((ms, rest))
    ensures SerMembers(ms, parent)[0] == QUOTE
    decreases parent, 0, |ms|
  {
    var t := SerMembers(ms, parent) + [RBRACE] + rest;
    var m := ms[0];
    var after := if |ms| == 1 then [RBRACE] + rest else [COMMA] + SerMembers(ms[1..], parent) + [RBRACE] + rest;
    assert SerMember(m, parent) == [QUOTE] + Escape(m.key) + [QUOTE] + [COLON] + Ser(m.value);
    if |ms| == 1 {
      assert SerMembers(ms, parent) == SerMember(m, parent);
    } else {
      assert SerMembers(ms, parent) == SerMember(m, parent) + [COMMA] + SerMembers(ms[1..], parent);
    }
    assert t == [QUOTE] + Escape(m.key) + [QUOTE] + ([COLON] + Ser(m.value) + after);
    assert t[1..] == Escape(m.key) + [QUOTE] + ([COLON] + Ser(m.value) + after);
    DecodeEscape(m.key, [COLON] + Ser(m.value) + after);
    assert ([COLON] + Ser(m.value) + after)[1..] == Ser(m.value) + after;
    ParseSer(m.value, after);
    var x := [COLON] + Ser(m.value) + after;
    assert DecodeStr(t[1..]) == Some((m.key, x));
    assert x[0] == COLON && x[1..] == Ser(m.value) + after;
    assert ParseValue(x[1..]) == Some((m.value, after));
    assert Member(m.key, m.value) == m;
    if |ms| == 1 {
      assert after[0] == RBRACE && after[1..] == rest;
      assert ms == [m];
    }
    if |ms| > 1 {
      ParseSerMembers(ms[1..], parent, rest);
      assert after[1..] == SerMembers(ms[1..], parent) + [RBRACE] + rest;
      assert ms == [m] + ms[1..];
    }
  }

  /** Serialisation is injective: two values with the same JCS text are the same value. */
  lemma SerInjective(a: Json, b: Json)
    requires Ser(a) == Ser(b)
    ensures a == b
  {
    ParseSer(a, []);
    ParseSer(b, []);
    assert Ser(a) + [] == Ser(a);
    assert Ser(b) + [] == Ser(b);
  }
}
