// The last step from a JavaScript string to the bytes SHA-256 reads: createHash("sha256").update(text, "utf8") in
// sha256Hex (src/lib/terms.ts) encodes the string's code units as UTF-8. On a well-formed string (every surrogate in a
// valid pair) that encoding is the standard one below. Jcs output is always well-formed (Terms.dfy, SerWellFormed).
// This file proves the encoding injective on well-formed strings, by a decoder and decode(encode(s)) == s.

include "Text.dfy"

module Utf8 {
  import opened Text

  type Byte = b: int | 0 <= b < 256

  predicate IsHigh(c: Unit) { 0xD800 <= c <= 0xDBFF }
  predicate IsLow(c: Unit) { 0xDC00 <= c <= 0xDFFF }

  /** Well-formed UTF-16: no lone surrogate. */
  predicate WellFormed(s: Str)
    decreases |s|
  {
    if |s| == 0 then true
    else if IsHigh(s[0]) then |s| >= 2 && IsLow(s[1]) && WellFormed(s[2..])
    else if IsLow(s[0]) then false
    else WellFormed(s[1..])
  }

  function Encode(s: Str): seq<Byte>
    requires WellFormed(s)
    decreases |s|
  {
    if |s| == 0 then []
    else
      var c: int := s[0];
      if c < 0x80 then [c as Byte] + Encode(s[1..])
      else if c < 0x800 then [(0xC0 + c / 64) as Byte, (0x80 + c % 64) as Byte] + Encode(s[1..])
      else if IsHigh(c) then
        var cp := 0x10000 + (c - 0xD800) * 1024 + (s[1] as int - 0xDC00);
        [(0xF0 + cp / 262144) as Byte, (0x80 + (cp / 4096) % 64) as Byte, (0x80 + (cp / 64) % 64) as Byte, (0x80 + cp % 64) as Byte]
          + Encode(s[2..])
      else [(0xE0 + c / 4096) as Byte, (0x80 + (c / 64) % 64) as Byte, (0x80 + c % 64) as Byte] + Encode(s[1..])
  } by method {
    // The same function in linear time for the compiled reference (sequence concatenation copies in JavaScript);
    // Dafny proves it returns exactly Encode(s).
    var a := new Byte[4 * |s|];
    var i, n := 0, 0;
    while i < |s|
      invariant 0 <= i <= |s| && 0 <= n <= 4 * i
      invariant WellFormed(s[i..])
      invariant a[..n] + Encode(s[i..]) == Encode(s)
    {
      var c: int := s[i];
      ghost var rest := s[i..];
      assert rest[0] == s[i];
      if c < 0x80 {
        a[n] := c as Byte;
        assert rest[1..] == s[i + 1..];
        assert a[..n + 1] == a[..n] + [c as Byte];
        n, i := n + 1, i + 1;
      } else if c < 0x800 {
        a[n], a[n + 1] := (0xC0 + c / 64) as Byte, (0x80 + c % 64) as Byte;
        assert rest[1..] == s[i + 1..];
        assert a[..n + 2] == a[..n] + [(0xC0 + c / 64) as Byte, (0x80 + c % 64) as Byte];
        n, i := n + 2, i + 1;
      } else if IsHigh(c) {
        var cp := 0x10000 + (c - 0xD800) * 1024 + (s[i + 1] as int - 0xDC00);
        a[n], a[n + 1], a[n + 2], a[n + 3] := (0xF0 + cp / 262144) as Byte, (0x80 + (cp / 4096) % 64) as Byte, (0x80 + (cp / 64) % 64) as Byte, (0x80 + cp % 64) as Byte;
        assert rest[1] == s[i + 1] && rest[2..] == s[i + 2..];
        assert a[..n + 4] == a[..n] + [(0xF0 + cp / 262144) as Byte, (0x80 + (cp / 4096) % 64) as Byte, (0x80 + (cp / 64) % 64) as Byte, (0x80 + cp % 64) as Byte];
        n, i := n + 4, i + 2;
      } else {
        a[n], a[n + 1], a[n + 2] := (0xE0 + c / 4096) as Byte, (0x80 + (c / 64) % 64) as Byte, (0x80 + c % 64) as Byte;
        assert rest[1..] == s[i + 1..];
        assert a[..n + 3] == a[..n] + [(0xE0 + c / 4096) as Byte, (0x80 + (c / 64) % 64) as Byte, (0x80 + c % 64) as Byte];
        n, i := n + 3, i + 1;
      }
    }
    assert s[i..] == [];
    return a[..n];
  }

  predicate Cont(b: Byte) { 0x80 <= b < 0xC0 }

  function Decode(b: seq<Byte>): Option<Str>
    decreases |b|
  {
    if |b| == 0 then Some([])
    else
      var b0: int := b[0];
      var b1: int := if |b| >= 2 then b[1] else 0;
      var b2: int := if |b| >= 3 then b[2] else 0;
      var b3: int := if |b| >= 4 then b[3] else 0;
      if b0 < 0x80 then Prepend([b0 as Unit], Decode(b[1..]))
      else if 0xC0 <= b0 < 0xE0 && |b| >= 2 && Cont(b[1]) then
        Prepend([((b0 - 0xC0) * 64 + (b1 - 0x80)) as Unit], Decode(b[2..]))
      else if 0xE0 <= b0 < 0xF0 && |b| >= 3 && Cont(b[1]) && Cont(b[2]) then
        Prepend([((b0 - 0xE0) * 4096 + (b1 - 0x80) * 64 + (b2 - 0x80)) as Unit], Decode(b[3..]))
      else if 0xF0 <= b0 < 0xF8 && |b| >= 4 && Cont(b[1]) && Cont(b[2]) && Cont(b[3]) then
        var cp := (b0 - 0xF0) * 262144 + (b1 - 0x80) * 4096 + (b2 - 0x80) * 64 + (b3 - 0x80);
        if 0x10000 <= cp < 0x110000 then
          Prepend([(0xD800 + (cp - 0x10000) / 1024) as Unit, (0xDC00 + (cp - 0x10000) % 1024) as Unit], Decode(b[4..]))
        else None
      else None
  }

  function Prepend(p: Str, r: Option<Str>): Option<Str> {
    if r.None? then None else Some(p + r.value)
  }

  lemma Split2(c: nat)
    ensures c == (c / 64) * 64 + c % 64
  {}

  lemma Split3(c: nat)
    ensures c == (c / 4096) * 4096 + ((c / 64) % 64) * 64 + c % 64
    ensures c / 4096 == (c / 64) / 64
  {
    var q := c / 64;
    assert c == q * 64 + c % 64;
    assert q == (q / 64) * 64 + q % 64;
    assert c / 4096 == q / 64;
  }

  lemma Split4(c: nat)
    ensures c == (c / 262144) * 262144 + ((c / 4096) % 64) * 4096 + ((c / 64) % 64) * 64 + c % 64
  {
    var q := c / 64;
    var r := q / 64;
    assert c == q * 64 + c % 64;
    assert q == r * 64 + q % 64;
    assert r == (r / 64) * 64 + r % 64;
    assert c / 4096 == r;
    assert c / 262144 == r / 64;
  }

  lemma DecodeEncode(s: Str)
    requires WellFormed(s)
    ensures Decode(Encode(s)) == Some(s)
    decreases |s|
  {
    if |s| > 0 {
      var c := s[0];
      if c < 0x80 {
        DecodeEncode(s[1..]);
        assert Encode(s)[1..] == Encode(s[1..]);
        assert s == [c] + s[1..];
      } else if c < 0x800 {
        DecodeEncode(s[1..]);
        var e := Encode(s);
        assert e[2..] == Encode(s[1..]);
        Split2(c);
        assert (e[0] as int - 0xC0) * 64 + (e[1] as int - 0x80) == c;
        assert s == [c] + s[1..];
      } else if IsHigh(c) {
        DecodeEncode(s[2..]);
        var e := Encode(s);
        var lo: int := s[1];
        var cp := 0x10000 + (c as int - 0xD800) * 1024 + (lo - 0xDC00);
        assert 0x10000 <= cp < 0x110000;
        assert e[4..] == Encode(s[2..]);
        Split4(cp);
        assert (e[0] as int - 0xF0) * 262144 + (e[1] as int - 0x80) * 4096 + (e[2] as int - 0x80) * 64 + (e[3] as int - 0x80) == cp;
        assert (cp - 0x10000) / 1024 == c as int - 0xD800;
        assert (cp - 0x10000) % 1024 == lo - 0xDC00;
        assert s == [c, lo] + s[2..];
      } else {
        DecodeEncode(s[1..]);
        var e := Encode(s);
        assert e[3..] == Encode(s[1..]);
        Split3(c);
        assert c / 4096 < 16;
        assert (e[0] as int - 0xE0) * 4096 + (e[1] as int - 0x80) * 64 + (e[2] as int - 0x80) == c;
        assert s == [c] + s[1..];
      }
    }
  }

  /** UTF-8 is injective on well-formed strings. */
  lemma EncodeInjective(s: Str, t: Str)
    requires WellFormed(s) && WellFormed(t) && Encode(s) == Encode(t)
    ensures s == t
  {
    DecodeEncode(s);
    DecodeEncode(t);
  }

  /** Concatenating well-formed strings gives a well-formed string. */
  lemma WellFormedConcat(a: Str, b: Str)
    requires WellFormed(a) && WellFormed(b)
    ensures WellFormed(a + b)
    decreases |a|
  {
    if |a| > 0 {
      assert (a + b)[0] == a[0];
      if IsHigh(a[0]) {
        assert |a| >= 2 && (a + b)[1] == a[1];
        WellFormedConcat(a[2..], b);
        assert (a + b)[2..] == a[2..] + b;
      } else {
        WellFormedConcat(a[1..], b);
        assert (a + b)[1..] == a[1..] + b;
      }
    } else {
      assert a + b == b;
    }
  }

  lemma WellFormedNoSurrogates(s: Str)
    requires forall i | 0 <= i < |s| :: !(0xD800 <= s[i] <= 0xDFFF)
    ensures WellFormed(s)
    decreases |s|
  {
    if |s| > 0 {
      assert !(0xD800 <= s[0] <= 0xDFFF);
      WellFormedNoSurrogates(s[1..]);
    }
  }
}
