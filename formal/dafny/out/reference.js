// Dafny program Reference.dfy compiled into JavaScript
// Copyright by the contributors to the Dafny Project
// SPDX-License-Identifier: MIT

const BigNumber = require('bignumber.js');
BigNumber.config({ MODULO_MODE: BigNumber.EUCLID })
let _dafny = (function() {
  let $module = {};
  $module.areEqual = function(a, b) {
    if (typeof a === 'string' && b instanceof _dafny.Seq) {
      // Seq.equals(string) works as expected,
      // and the catch-all else block handles that direction.
      // But the opposite direction doesn't work; handle it here.
      return b.equals(a);
    } else if (typeof a === 'number' && BigNumber.isBigNumber(b)) {
      // This conditional would be correct even without the `typeof a` part,
      // but in most cases it's probably faster to short-circuit on a `typeof`
      // than to call `isBigNumber`. (But it remains to properly test this.)
      return b.isEqualTo(a);
    } else if (typeof a !== 'object' || a === null || b === null) {
      return a === b;
    } else if (BigNumber.isBigNumber(a)) {
      return a.isEqualTo(b);
    } else if (a._tname !== undefined || (Array.isArray(a) && a.constructor.name == "Array")) {
      return a === b;  // pointer equality
    } else {
      return a.equals(b);  // value-type equality
    }
  }
  $module.toString = function(a) {
    if (a === null) {
      return "null";
    } else if (typeof a === "number") {
      return a.toFixed();
    } else if (BigNumber.isBigNumber(a)) {
      return a.toFixed();
    } else if (a._tname !== undefined) {
      return a._tname;
    } else {
      return a.toString();
    }
  }
  $module.escapeCharacter = function(cp) {
    let s = String.fromCodePoint(cp.value)
    switch (s) {
      case '\n': return "\\n";
      case '\r': return "\\r";
      case '\t': return "\\t";
      case '\0': return "\\0";
      case '\'': return "\\'";
      case '\"': return "\\\"";
      case '\\': return "\\\\";
      default: return s;
    };
  }
  $module.NewObject = function() {
    return { _tname: "object" };
  }
  $module.InstanceOfTrait = function(obj, trait) {
    return obj._parentTraits !== undefined && obj._parentTraits().includes(trait);
  }
  $module.Rtd_bool = class {
    static get Default() { return false; }
  }
  $module.Rtd_char = class {
    static get Default() { return 'D'; }  // See CharType.DefaultValue in Dafny source code
  }
  $module.Rtd_codepoint = class {
    static get Default() { return new _dafny.CodePoint('D'.codePointAt(0)); }
  }
  $module.Rtd_int = class {
    static get Default() { return BigNumber(0); }
  }
  $module.Rtd_number = class {
    static get Default() { return 0; }
  }
  $module.Rtd_ref = class {
    static get Default() { return null; }
  }
  $module.Rtd_array = class {
    static get Default() { return []; }
  }
  $module.ZERO = new BigNumber(0);
  $module.ONE = new BigNumber(1);
  $module.NUMBER_LIMIT = new BigNumber(0x20).multipliedBy(0x1000000000000);  // 2^53
  $module.Tuple = class Tuple extends Array {
    constructor(...elems) {
      super(...elems);
    }
    toString() {
      return "(" + arrayElementsToString(this) + ")";
    }
    equals(other) {
      if (this === other) {
        return true;
      }
      for (let i = 0; i < this.length; i++) {
        if (!_dafny.areEqual(this[i], other[i])) {
          return false;
        }
      }
      return true;
    }
    static Default(...values) {
      return Tuple.of(...values);
    }
    static Rtd(...rtdArgs) {
      return {
        Default: Tuple.from(rtdArgs, rtd => rtd.Default)
      };
    }
  }
  $module.Set = class Set extends Array {
    constructor() {
      super();
    }
    static get Default() {
      return Set.Empty;
    }
    toString() {
      return "{" + arrayElementsToString(this) + "}";
    }
    static get Empty() {
      if (this._empty === undefined) {
        this._empty = new Set();
      }
      return this._empty;
    }
    static fromElements(...elmts) {
      let s = new Set();
      for (let k of elmts) {
        s.add(k);
      }
      return s;
    }
    contains(k) {
      for (let i = 0; i < this.length; i++) {
        if (_dafny.areEqual(this[i], k)) {
          return true;
        }
      }
      return false;
    }
    add(k) {  // mutates the Set; use only during construction
      if (!this.contains(k)) {
        this.push(k);
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.length !== other.length) {
        return false;
      }
      for (let e of this) {
        if (!other.contains(e)) {
          return false;
        }
      }
      return true;
    }
    get Elements() {
      return this;
    }
    Union(that) {
      if (this.length === 0) {
        return that;
      } else if (that.length === 0) {
        return this;
      } else {
        let s = Set.of(...this);
        for (let k of that) {
          s.add(k);
        }
        return s;
      }
    }
    Intersect(that) {
      if (this.length === 0) {
        return this;
      } else if (that.length === 0) {
        return that;
      } else {
        let s = new Set();
        for (let k of this) {
          if (that.contains(k)) {
            s.push(k);
          }
        }
        return s;
      }
    }
    Difference(that) {
      if (this.length == 0 || that.length == 0) {
        return this;
      } else {
        let s = new Set();
        for (let k of this) {
          if (!that.contains(k)) {
            s.push(k);
          }
        }
        return s;
      }
    }
    IsDisjointFrom(that) {
      for (let k of this) {
        if (that.contains(k)) {
          return false;
        }
      }
      return true;
    }
    IsSubsetOf(that) {
      if (that.length < this.length) {
        return false;
      }
      for (let k of this) {
        if (!that.contains(k)) {
          return false;
        }
      }
      return true;
    }
    IsProperSubsetOf(that) {
      if (that.length <= this.length) {
        return false;
      }
      for (let k of this) {
        if (!that.contains(k)) {
          return false;
        }
      }
      return true;
    }
    get AllSubsets() {
      return this.AllSubsets_();
    }
    *AllSubsets_() {
      // Start by putting all set elements into a list, but don't include null
      let elmts = Array.of(...this);
      let n = elmts.length;
      let which = new Array(n);
      which.fill(false);
      let a = [];
      while (true) {
        yield Set.of(...a);
        // "add 1" to "which", as if doing a carry chain.  For every digit changed, change the membership of the corresponding element in "a".
        let i = 0;
        for (; i < n && which[i]; i++) {
          which[i] = false;
          // remove elmts[i] from a
          for (let j = 0; j < a.length; j++) {
            if (_dafny.areEqual(a[j], elmts[i])) {
              // move the last element of a into slot j
              a[j] = a[-1];
              a.pop();
              break;
            }
          }
        }
        if (i === n) {
          // we have cycled through all the subsets
          break;
        }
        which[i] = true;
        a.push(elmts[i]);
      }
    }
  }
  $module.MultiSet = class MultiSet extends Array {
    constructor() {
      super();
    }
    static get Default() {
      return MultiSet.Empty;
    }
    toString() {
      let s = "multiset{";
      let sep = "";
      for (let e of this) {
        let [k, n] = e;
        let ks = _dafny.toString(k);
        while (!n.isZero()) {
          n = n.minus(1);
          s += sep + ks;
          sep = ", ";
        }
      }
      s += "}";
      return s;
    }
    static get Empty() {
      if (this._empty === undefined) {
        this._empty = new MultiSet();
      }
      return this._empty;
    }
    static fromElements(...elmts) {
      let s = new MultiSet();
      for (let e of elmts) {
        s.add(e, _dafny.ONE);
      }
      return s;
    }
    static FromArray(arr) {
      let s = new MultiSet();
      for (let e of arr) {
        s.add(e, _dafny.ONE);
      }
      return s;
    }
    cardinality() {
      let c = _dafny.ZERO;
      for (let e of this) {
        let [k, n] = e;
        c = c.plus(n);
      }
      return c;
    }
    clone() {
      let s = new MultiSet();
      for (let e of this) {
        let [k, n] = e;
        s.push([k, n]);  // make sure to create a new array [k, n] here
      }
      return s;
    }
    findIndex(k) {
      for (let i = 0; i < this.length; i++) {
        if (_dafny.areEqual(this[i][0], k)) {
          return i;
        }
      }
      return this.length;
    }
    get(k) {
      let i = this.findIndex(k);
      if (i === this.length) {
        return _dafny.ZERO;
      } else {
        return this[i][1];
      }
    }
    contains(k) {
      return !this.get(k).isZero();
    }
    add(k, n) {
      let i = this.findIndex(k);
      if (i === this.length) {
        this.push([k, n]);
      } else {
        let m = this[i][1];
        this[i] = [k, m.plus(n)];
      }
    }
    update(k, n) {
      let i = this.findIndex(k);
      if (i < this.length && this[i][1].isEqualTo(n)) {
        return this;
      } else if (i === this.length && n.isZero()) {
        return this;
      } else if (i === this.length) {
        let m = this.slice();
        m.push([k, n]);
        return m;
      } else {
        let m = this.slice();
        m[i] = [k, n];
        return m;
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      }
      for (let e of this) {
        let [k, n] = e;
        let m = other.get(k);
        if (!n.isEqualTo(m)) {
          return false;
        }
      }
      return this.cardinality().isEqualTo(other.cardinality());
    }
    get Elements() {
      return this.Elements_();
    }
    *Elements_() {
      for (let i = 0; i < this.length; i++) {
        let [k, n] = this[i];
        while (!n.isZero()) {
          yield k;
          n = n.minus(1);
        }
      }
    }
    get UniqueElements() {
      return this.UniqueElements_();
    }
    *UniqueElements_() {
      for (let e of this) {
        let [k, n] = e;
        if (!n.isZero()) {
          yield k;
        }
      }
    }
    Union(that) {
      if (this.length === 0) {
        return that;
      } else if (that.length === 0) {
        return this;
      } else {
        let s = this.clone();
        for (let e of that) {
          let [k, n] = e;
          s.add(k, n);
        }
        return s;
      }
    }
    Intersect(that) {
      if (this.length === 0) {
        return this;
      } else if (that.length === 0) {
        return that;
      } else {
        let s = new MultiSet();
        for (let e of this) {
          let [k, n] = e;
          let m = that.get(k);
          if (!m.isZero()) {
            s.push([k, m.isLessThan(n) ? m : n]);
          }
        }
        return s;
      }
    }
    Difference(that) {
      if (this.length === 0 || that.length === 0) {
        return this;
      } else {
        let s = new MultiSet();
        for (let e of this) {
          let [k, n] = e;
          let d = n.minus(that.get(k));
          if (d.isGreaterThan(0)) {
            s.push([k, d]);
          }
        }
        return s;
      }
    }
    IsDisjointFrom(that) {
      let intersection = this.Intersect(that);
      return intersection.cardinality().isZero();
    }
    IsSubsetOf(that) {
      for (let e of this) {
        let [k, n] = e;
        let m = that.get(k);
        if (!n.isLessThanOrEqualTo(m)) {
          return false;
        }
      }
      return true;
    }
    IsProperSubsetOf(that) {
      return this.IsSubsetOf(that) && this.cardinality().isLessThan(that.cardinality());
    }
  }
  $module.CodePoint = class CodePoint {
    constructor(value) {
      this.value = value
    }
    equals(other) {
      if (this === other) {
        return true;
      }
      return this.value === other.value
    }
    isLessThan(other) {
      return this.value < other.value
    }
    isLessThanOrEqual(other) {
      return this.value <= other.value
    }
    toString() {
      return "'" + $module.escapeCharacter(this) + "'";
    }
    static isCodePoint(i) {
      return (
        (_dafny.ZERO.isLessThanOrEqualTo(i) && i.isLessThan(new BigNumber(0xD800))) ||
        (new BigNumber(0xE000).isLessThanOrEqualTo(i) && i.isLessThan(new BigNumber(0x11_0000))))
    }
  }
  $module.Seq = class Seq extends Array {
    constructor(...elems) {
      super(...elems);
    }
    static get Default() {
      return Seq.of();
    }
    static Create(n, init) {
      return Seq.from({length: n}, (_, i) => init(new BigNumber(i)));
    }
    static UnicodeFromString(s) {
      return new Seq(...([...s].map(c => new _dafny.CodePoint(c.codePointAt(0)))))
    }
    toString() {
      return "[" + arrayElementsToString(this) + "]";
    }
    toVerbatimString(asLiteral) {
      if (asLiteral) {
        return '"' + this.map(c => _dafny.escapeCharacter(c)).join("") + '"';
      } else {
        return this.map(c => String.fromCodePoint(c.value)).join("");
      }
    }
    static update(s, i, v) {
      if (typeof s === "string") {
        let p = s.slice(0, i);
        let q = s.slice(i.toNumber() + 1);
        return p.concat(v, q);
      } else {
        let t = s.slice();
        t[i] = v;
        return t;
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.length !== other.length) {
        return false;
      }
      for (let i = 0; i < this.length; i++) {
        if (!_dafny.areEqual(this[i], other[i])) {
          return false;
        }
      }
      return true;
    }
    static contains(s, k) {
      if (typeof s === "string") {
        return s.includes(k);
      } else {
        for (let x of s) {
          if (_dafny.areEqual(x, k)) {
            return true;
          }
        }
        return false;
      }
    }
    get Elements() {
      return this;
    }
    get UniqueElements() {
      return _dafny.Set.fromElements(...this);
    }
    static Concat(a, b) {
      if (typeof a === "string" || typeof b === "string") {
        // string concatenation, so make sure both operands are strings before concatenating
        if (typeof a !== "string") {
          // a must be a Seq
          a = a.join("");
        }
        if (typeof b !== "string") {
          // b must be a Seq
          b = b.join("");
        }
        return a + b;
      } else {
        // ordinary concatenation
        let r = Seq.of(...a);
        r.push(...b);
        return r;
      }
    }
    static JoinIfPossible(x) {
      try { return x.join(""); } catch(_error) { return x; }
    }
    static IsPrefixOf(a, b) {
      if (b.length < a.length) {
        return false;
      }
      for (let i = 0; i < a.length; i++) {
        if (!_dafny.areEqual(a[i], b[i])) {
          return false;
        }
      }
      return true;
    }
    static IsProperPrefixOf(a, b) {
      if (b.length <= a.length) {
        return false;
      }
      for (let i = 0; i < a.length; i++) {
        if (!_dafny.areEqual(a[i], b[i])) {
          return false;
        }
      }
      return true;
    }
  }
  $module.Map = class Map extends Array {
    constructor() {
      super();
    }
    static get Default() {
      return Map.of();
    }
    toString() {
      return "map[" + this.map(maplet => _dafny.toString(maplet[0]) + " := " + _dafny.toString(maplet[1])).join(", ") + "]";
    }
    static get Empty() {
      if (this._empty === undefined) {
        this._empty = new Map();
      }
      return this._empty;
    }
    findIndex(k) {
      for (let i = 0; i < this.length; i++) {
        if (_dafny.areEqual(this[i][0], k)) {
          return i;
        }
      }
      return this.length;
    }
    get(k) {
      let i = this.findIndex(k);
      if (i === this.length) {
        return undefined;
      } else {
        return this[i][1];
      }
    }
    contains(k) {
      return this.findIndex(k) < this.length;
    }
    update(k, v) {
      let m = this.slice();
      m.updateUnsafe(k, v);
      return m;
    }
    // Similar to update, but make the modification in-place.
    // Meant to be used in the map constructor.
    updateUnsafe(k, v) {
      let m = this;
      let i = m.findIndex(k);
      m[i] = [k, v];
      return m;
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.length !== other.length) {
        return false;
      }
      for (let e of this) {
        let [k, v] = e;
        let w = other.get(k);
        if (w === undefined || !_dafny.areEqual(v, w)) {
          return false;
        }
      }
      return true;
    }
    get Keys() {
      let s = new _dafny.Set();
      for (let e of this) {
        let [k, v] = e;
        s.push(k);
      }
      return s;
    }
    get Values() {
      let s = new _dafny.Set();
      for (let e of this) {
        let [k, v] = e;
        s.add(v);
      }
      return s;
    }
    get Items() {
      let s = new _dafny.Set();
      for (let e of this) {
        let [k, v] = e;
        s.push(_dafny.Tuple.of(k, v));
      }
      return s;
    }
    Merge(that) {
      let m = that.slice();
      for (let e of this) {
        let [k, v] = e;
        let i = m.findIndex(k);
        if (i == m.length) {
          m[i] = [k, v];
        }
      }
      return m;
    }
    Subtract(keys) {
      if (this.length === 0 || keys.length === 0) {
        return this;
      }
      let m = new Map();
      for (let e of this) {
        let [k, v] = e;
        if (!keys.contains(k)) {
          m[m.length] = e;
        }
      }
      return m;
    }
  }
  $module.newArray = function(initValue, ...dims) {
    return { dims: dims, elmts: buildArray(initValue, ...dims) };
  }
  $module.BigOrdinal = class BigOrdinal {
    static get Default() {
      return _dafny.ZERO;
    }
    static IsLimit(ord) {
      return ord.isZero();
    }
    static IsSucc(ord) {
      return ord.isGreaterThan(0);
    }
    static Offset(ord) {
      return ord;
    }
    static IsNat(ord) {
      return true;  // at run time, every ORDINAL is a natural number
    }
  }
  $module.BigRational = class BigRational {
    static get ZERO() {
      if (this._zero === undefined) {
        this._zero = new BigRational(_dafny.ZERO);
      }
      return this._zero;
    }
    constructor (n, d) {
      // requires d === undefined || 1 <= d
      this.num = n;
      this.den = d === undefined ? _dafny.ONE : d;
      // invariant 1 <= den || (num == 0 && den == 0)
    }
    static get Default() {
      return _dafny.BigRational.ZERO;
    }
    // We need to deal with the special case `num == 0 && den == 0`, because
    // that's what C#'s default struct constructor will produce for BigRational. :(
    // To deal with it, we ignore `den` when `num` is 0.
    toString() {
      if (this.num.isZero() || this.den.isEqualTo(1)) {
        return this.num.toFixed() + ".0";
      }
      let answer = this.dividesAPowerOf10(this.den);
      if (answer !== undefined) {
        let n = this.num.multipliedBy(answer[0]);
        let log10 = answer[1];
        let sign, digits;
        if (this.num.isLessThan(0)) {
          sign = "-"; digits = n.negated().toFixed();
        } else {
          sign = ""; digits = n.toFixed();
        }
        if (log10 < digits.length) {
          let digitCount = digits.length - log10;
          return sign + digits.slice(0, digitCount) + "." + digits.slice(digitCount);
        } else {
          return sign + "0." + "0".repeat(log10 - digits.length) + digits;
        }
      } else {
        return "(" + this.num.toFixed() + ".0 / " + this.den.toFixed() + ".0)";
      }
    }
    isPowerOf10(x) {
      if (x.isZero()) {
        return undefined;
      }
      let log10 = 0;
      while (true) {  // invariant: x != 0 && x * 10^log10 == old(x)
        if (x.isEqualTo(1)) {
          return log10;
        } else if (x.mod(10).isZero()) {
          log10++;
          x = x.dividedToIntegerBy(10);
        } else {
          return undefined;
        }
      }
    }
    dividesAPowerOf10(i) {
      let factor = _dafny.ONE;
      let log10 = 0;
      if (i.isLessThanOrEqualTo(_dafny.ZERO)) {
        return undefined;
      }

      // invariant: 1 <= i && i * 10^log10 == factor * old(i)
      while (i.mod(10).isZero()) {
        i = i.dividedToIntegerBy(10);
       log10++;
      }

      while (i.mod(5).isZero()) {
        i = i.dividedToIntegerBy(5);
        factor = factor.multipliedBy(2);
        log10++;
      }
      while (i.mod(2).isZero()) {
        i = i.dividedToIntegerBy(2);
        factor = factor.multipliedBy(5);
        log10++;
      }

      if (i.isEqualTo(_dafny.ONE)) {
        return [factor, log10];
      } else {
        return undefined;
      }
    }
    toBigNumber() {
      if (this.num.isZero() || this.den.isEqualTo(1)) {
        return this.num;
      } else if (this.num.isGreaterThan(0)) {
        return this.num.dividedToIntegerBy(this.den);
      } else {
        return this.num.minus(this.den).plus(1).dividedToIntegerBy(this.den);
      }
    }
    isInteger() {
      return this.equals(new _dafny.BigRational(this.toBigNumber(), _dafny.ONE));
    }
    // Returns values such that aa/dd == a and bb/dd == b.
    normalize(b) {
      let a = this;
      let aa, bb, dd;
      if (a.num.isZero()) {
        aa = a.num;
        bb = b.num;
        dd = b.den;
      } else if (b.num.isZero()) {
        aa = a.num;
        dd = a.den;
        bb = b.num;
      } else {
        let gcd = BigNumberGcd(a.den, b.den);
        let xx = a.den.dividedToIntegerBy(gcd);
        let yy = b.den.dividedToIntegerBy(gcd);
        // We now have a == a.num / (xx * gcd) and b == b.num / (yy * gcd).
        aa = a.num.multipliedBy(yy);
        bb = b.num.multipliedBy(xx);
        dd = a.den.multipliedBy(yy);
      }
      return [aa, bb, dd];
    }
    compareTo(that) {
      // simple things first
      let asign = this.num.isZero() ? 0 : this.num.isLessThan(0) ? -1 : 1;
      let bsign = that.num.isZero() ? 0 : that.num.isLessThan(0) ? -1 : 1;
      if (asign < 0 && 0 <= bsign) {
        return -1;
      } else if (asign <= 0 && 0 < bsign) {
        return -1;
      } else if (bsign < 0 && 0 <= asign) {
        return 1;
      } else if (bsign <= 0 && 0 < asign) {
        return 1;
      }
      let [aa, bb, dd] = this.normalize(that);
      if (aa.isLessThan(bb)) {
        return -1;
      } else if (aa.isEqualTo(bb)){
        return 0;
      } else {
        return 1;
      }
    }
    equals(that) {
      return this.compareTo(that) === 0;
    }
    isLessThan(that) {
      return this.compareTo(that) < 0;
    }
    isAtMost(that) {
      return this.compareTo(that) <= 0;
    }
    plus(b) {
      let [aa, bb, dd] = this.normalize(b);
      return new BigRational(aa.plus(bb), dd);
    }
    minus(b) {
      let [aa, bb, dd] = this.normalize(b);
      return new BigRational(aa.minus(bb), dd);
    }
    negated() {
      return new BigRational(this.num.negated(), this.den);
    }
    multipliedBy(b) {
      return new BigRational(this.num.multipliedBy(b.num), this.den.multipliedBy(b.den));
    }
    dividedBy(b) {
      let a = this;
      // Compute the reciprocal of b
      let bReciprocal;
      if (b.num.isGreaterThan(0)) {
        bReciprocal = new BigRational(b.den, b.num);
      } else {
        // this is the case b.num < 0
        bReciprocal = new BigRational(b.den.negated(), b.num.negated());
      }
      return a.multipliedBy(bReciprocal);
    }
  }
  $module.EuclideanDivisionNumber = function(a, b) {
    if (0 <= a) {
      if (0 <= b) {
        // +a +b: a/b
        return Math.floor(a / b);
      } else {
        // +a -b: -(a/(-b))
        return -Math.floor(a / -b);
      }
    } else {
      if (0 <= b) {
        // -a +b: -((-a-1)/b) - 1
        return -Math.floor((-a-1) / b) - 1;
      } else {
        // -a -b: ((-a-1)/(-b)) + 1
        return Math.floor((-a-1) / -b) + 1;
      }
    }
  }
  $module.EuclideanDivision = function(a, b) {
    if (a.isGreaterThanOrEqualTo(0)) {
      if (b.isGreaterThanOrEqualTo(0)) {
        // +a +b: a/b
        return a.dividedToIntegerBy(b);
      } else {
        // +a -b: -(a/(-b))
        return a.dividedToIntegerBy(b.negated()).negated();
      }
    } else {
      if (b.isGreaterThanOrEqualTo(0)) {
        // -a +b: -((-a-1)/b) - 1
        return a.negated().minus(1).dividedToIntegerBy(b).negated().minus(1);
      } else {
        // -a -b: ((-a-1)/(-b)) + 1
        return a.negated().minus(1).dividedToIntegerBy(b.negated()).plus(1);
      }
    }
  }
  $module.EuclideanModuloNumber = function(a, b) {
    let bp = Math.abs(b);
    if (0 <= a) {
      // +a: a % bp
      return a % bp;
    } else {
      // c = ((-a) % bp)
      // -a: bp - c if c > 0
      // -a: 0 if c == 0
      let c = (-a) % bp;
      return c === 0 ? c : bp - c;
    }
  }
  $module.ShiftLeft = function(b, n) {
    return b.multipliedBy(new BigNumber(2).exponentiatedBy(n));
  }
  $module.ShiftRight = function(b, n) {
    return b.dividedToIntegerBy(new BigNumber(2).exponentiatedBy(n));
  }
  $module.RotateLeft = function(b, n, w) {  // truncate(b << n) | (b >> (w - n))
    let x = _dafny.ShiftLeft(b, n).mod(new BigNumber(2).exponentiatedBy(w));
    let y = _dafny.ShiftRight(b, w - n);
    return x.plus(y);
  }
  $module.RotateRight = function(b, n, w) {  // (b >> n) | truncate(b << (w - n))
    let x = _dafny.ShiftRight(b, n);
    let y = _dafny.ShiftLeft(b, w - n).mod(new BigNumber(2).exponentiatedBy(w));;
    return x.plus(y);
  }
  $module.BitwiseAnd = function(a, b) {
    let r = _dafny.ZERO;
    const m = _dafny.NUMBER_LIMIT;  // 2^53
    let h = _dafny.ONE;
    while (!a.isZero() && !b.isZero()) {
      let a0 = a.mod(m);
      let b0 = b.mod(m);
      r = r.plus(h.multipliedBy(a0 & b0));
      a = a.dividedToIntegerBy(m);
      b = b.dividedToIntegerBy(m);
      h = h.multipliedBy(m);
    }
    return r;
  }
  $module.BitwiseOr = function(a, b) {
    let r = _dafny.ZERO;
    const m = _dafny.NUMBER_LIMIT;  // 2^53
    let h = _dafny.ONE;
    while (!a.isZero() && !b.isZero()) {
      let a0 = a.mod(m);
      let b0 = b.mod(m);
      r = r.plus(h.multipliedBy(a0 | b0));
      a = a.dividedToIntegerBy(m);
      b = b.dividedToIntegerBy(m);
      h = h.multipliedBy(m);
    }
    r = r.plus(h.multipliedBy(a | b));
    return r;
  }
  $module.BitwiseXor = function(a, b) {
    let r = _dafny.ZERO;
    const m = _dafny.NUMBER_LIMIT;  // 2^53
    let h = _dafny.ONE;
    while (!a.isZero() && !b.isZero()) {
      let a0 = a.mod(m);
      let b0 = b.mod(m);
      r = r.plus(h.multipliedBy(a0 ^ b0));
      a = a.dividedToIntegerBy(m);
      b = b.dividedToIntegerBy(m);
      h = h.multipliedBy(m);
    }
    r = r.plus(h.multipliedBy(a | b));
    return r;
  }
  $module.BitwiseNot = function(a, bits) {
    let r = _dafny.ZERO;
    let h = _dafny.ONE;
    for (let i = 0; i < bits; i++) {
      let bit = a.mod(2);
      if (bit.isZero()) {
        r = r.plus(h);
      }
      a = a.dividedToIntegerBy(2);
      h = h.multipliedBy(2);
    }
    return r;
  }
  $module.Quantifier = function(vals, frall, pred) {
    for (let u of vals) {
      if (pred(u) !== frall) { return !frall; }
    }
    return frall;
  }
  $module.PlusChar = function(a, b) {
    return String.fromCharCode(a.charCodeAt(0) + b.charCodeAt(0));
  }
  $module.UnicodePlusChar = function(a, b) {
    return new _dafny.CodePoint(a.value + b.value);
  }
  $module.MinusChar = function(a, b) {
    return String.fromCharCode(a.charCodeAt(0) - b.charCodeAt(0));
  }
  $module.UnicodeMinusChar = function(a, b) {
    return new _dafny.CodePoint(a.value - b.value);
  }
  $module.AllBooleans = function*() {
    yield false;
    yield true;
  }
  $module.AllChars = function*() {
    for (let i = 0; i < 0x10000; i++) {
      yield String.fromCharCode(i);
    }
  }
  $module.AllUnicodeChars = function*() {
    for (let i = 0; i < 0xD800; i++) {
      yield new _dafny.CodePoint(i);
    }
    for (let i = 0xE0000; i < 0x110000; i++) {
      yield new _dafny.CodePoint(i);
    }
  }
  $module.AllIntegers = function*() {
    yield _dafny.ZERO;
    for (let j = _dafny.ONE;; j = j.plus(1)) {
      yield j;
      yield j.negated();
    }
  }
  $module.IntegerRange = function*(lo, hi) {
    if (lo === null) {
      while (true) {
        hi = hi.minus(1);
        yield hi;
      }
    } else if (hi === null) {
      while (true) {
        yield lo;
        lo = lo.plus(1);
      }
    } else {
      while (lo.isLessThan(hi)) {
        yield lo;
        lo = lo.plus(1);
      }
    }
  }
  $module.SingleValue = function*(v) {
    yield v;
  }
  $module.HaltException = class HaltException extends Error {
    constructor(message) {
      super(message)
    }
  }
  $module.HandleHaltExceptions = function(f) {
    try {
      f()
    } catch (e) {
      if (e instanceof _dafny.HaltException) {
        process.stdout.write("[Program halted] " + e.message + "\n")
        process.exitCode = 1
      } else {
        throw e
      }
    }
  }
  $module.FromMainArguments = function(args) {
    var a = [...args];
    a.splice(0, 2, args[0] + " " + args[1]);
    return a;
  }
  $module.UnicodeFromMainArguments = function(args) {
    return $module.FromMainArguments(args).map(_dafny.Seq.UnicodeFromString);
  }
  return $module;

  // What follows are routines private to the Dafny runtime
  function buildArray(initValue, ...dims) {
    if (dims.length === 0) {
      return initValue;
    } else {
      let a = Array(dims[0].toNumber());
      let b = Array.from(a, (x) => buildArray(initValue, ...dims.slice(1)));
      return b;
    }
  }
  function arrayElementsToString(a) {
    // like `a.join(", ")`, but calling _dafny.toString(x) on every element x instead of x.toString()
    let s = "";
    let sep = "";
    for (let x of a) {
      s += sep + _dafny.toString(x);
      sep = ", ";
    }
    return s;
  }
  function BigNumberGcd(a, b){  // gcd of two non-negative BigNumber's
    while (true) {
      if (a.isZero()) {
        return b;
      } else if (b.isZero()) {
        return a;
      }
      if (a.isLessThan(b)) {
        b = b.modulo(a);
      } else {
        a = a.modulo(b);
      }
    }
  }
})();
// Dafny program systemModulePopulator.dfy compiled into JavaScript
let _System = (function() {
  let $module = {};

  $module.nat = class nat {
    constructor () {
    }
    static get Default() {
      return _dafny.ZERO;
    }
    static _Is(__source) {
      let _0_x = (__source);
      return (_dafny.ZERO).isLessThanOrEqualTo(_0_x);
    }
  };

  return $module;
})(); // end of module _System
let Text = (function() {
  let $module = {};

  $module.__default = class __default {
    constructor () {
      this._tname = "Text._default";
    }
    _parentTraits() {
      return [];
    }
    static IsDigit(c) {
      return ((new BigNumber(48)).isLessThanOrEqualTo(c)) && ((c).isLessThanOrEqualTo(new BigNumber(57)));
    };
    static AllDigits(s) {
      return _dafny.Quantifier(_dafny.IntegerRange(_dafny.ZERO, new BigNumber((s).length)), true, function (_forall_var_0) {
        let _0_i = _forall_var_0;
        return !(((_dafny.ZERO).isLessThanOrEqualTo(_0_i)) && ((_0_i).isLessThan(new BigNumber((s).length)))) || (Text.__default.IsDigit((s)[_0_i]));
      });
    };
    static DigitsValue(s) {
      if ((new BigNumber((s).length)).isEqualTo(_dafny.ZERO)) {
        return _dafny.ZERO;
      } else {
        return ((Text.__default.DigitsValue((s).slice(0, (new BigNumber((s).length)).minus(_dafny.ONE)))).multipliedBy(new BigNumber(10))).plus(((s)[(new BigNumber((s).length)).minus(_dafny.ONE)]).minus(new BigNumber(48)));
      }
    };
    static NatToDigits(n) {
      let _0___accumulator = _dafny.Seq.of();
      TAIL_CALL_START: while (true) {
        if ((n).isLessThan(new BigNumber(10))) {
          return _dafny.Seq.Concat(_dafny.Seq.of(((new BigNumber(48)).plus(n))), _0___accumulator);
        } else {
          _0___accumulator = _dafny.Seq.Concat(_dafny.Seq.of(((new BigNumber(48)).plus((n).mod(new BigNumber(10))))), _0___accumulator);
          let _in0 = _dafny.EuclideanDivision(n, new BigNumber(10));
          n = _in0;
          continue TAIL_CALL_START;
        }
      }
    };
    static NoLeadingZero(s) {
      return ((_dafny.ONE).isLessThanOrEqualTo(new BigNumber((s).length))) && ((_dafny.areEqual(s, _dafny.Seq.of(Text.__default.ZERO))) || (!((s)[_dafny.ZERO]).isEqualTo(Text.__default.ZERO)));
    };
    static Pow10(k) {
      let _0___accumulator = _dafny.ONE;
      TAIL_CALL_START: while (true) {
        if ((k).isEqualTo(_dafny.ZERO)) {
          return (_dafny.ONE).multipliedBy(_0___accumulator);
        } else {
          _0___accumulator = (_0___accumulator).multipliedBy(new BigNumber(10));
          let _in0 = (k).minus(_dafny.ONE);
          k = _in0;
          continue TAIL_CALL_START;
        }
      }
    };
    static get DOT() {
      return new BigNumber(46);
    };
    static get ZERO() {
      return new BigNumber(48);
    };
  };

  $module.Unit = class Unit {
    constructor () {
    }
    static get Default() {
      return _dafny.ZERO;
    }
    static _Is(__source) {
      let _0_c = (__source);
      return ((_dafny.ZERO).isLessThanOrEqualTo(_0_c)) && ((_0_c).isLessThan(new BigNumber(65536)));
    }
  };

  $module.Option = class Option {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_None() {
      let $dt = new Option(0);
      return $dt;
    }
    static create_Some(value) {
      let $dt = new Option(1);
      $dt.value = value;
      return $dt;
    }
    get is_None() { return this.$tag === 0; }
    get is_Some() { return this.$tag === 1; }
    get dtor_value() { return this.value; }
    toString() {
      if (this.$tag === 0) {
        return "Text.Option.None";
      } else if (this.$tag === 1) {
        return "Text.Option.Some" + "(" + _dafny.toString(this.value) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0;
      } else if (this.$tag === 1) {
        return other.$tag === 1 && _dafny.areEqual(this.value, other.value);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return Text.Option.create_None();
    }
    static Rtd() {
      return class {
        static get Default() {
          return Option.Default();
        }
      };
    }
  }
  return $module;
})(); // end of module Text
let Jcs = (function() {
  let $module = {};

  $module.__default = class __default {
    constructor () {
      this._tname = "Jcs._default";
    }
    _parentTraits() {
      return [];
    }
    static IsHigh(c) {
      return ((new BigNumber(55296)).isLessThanOrEqualTo(c)) && ((c).isLessThanOrEqualTo(new BigNumber(56319)));
    };
    static IsLow(c) {
      return ((new BigNumber(56320)).isLessThanOrEqualTo(c)) && ((c).isLessThanOrEqualTo(new BigNumber(57343)));
    };
    static IsSurrogate(c) {
      return ((new BigNumber(55296)).isLessThanOrEqualTo(c)) && ((c).isLessThanOrEqualTo(new BigNumber(57343)));
    };
    static HexDigit(n) {
      if ((n).isLessThan(new BigNumber(10))) {
        return ((new BigNumber(48)).plus(n));
      } else {
        return (((new BigNumber(97)).plus(n)).minus(new BigNumber(10)));
      }
    };
    static Hex4(c) {
      return _dafny.Seq.of(Jcs.__default.HexDigit(_dafny.EuclideanDivision(c, new BigNumber(4096))), Jcs.__default.HexDigit((_dafny.EuclideanDivision(c, new BigNumber(256))).mod(new BigNumber(16))), Jcs.__default.HexDigit((_dafny.EuclideanDivision(c, new BigNumber(16))).mod(new BigNumber(16))), Jcs.__default.HexDigit((c).mod(new BigNumber(16))));
    };
    static EscUnit(c) {
      if ((c).isEqualTo(new BigNumber(8))) {
        return _dafny.Seq.of(Jcs.__default.BSLASH, new BigNumber(98));
      } else if ((c).isEqualTo(new BigNumber(9))) {
        return _dafny.Seq.of(Jcs.__default.BSLASH, new BigNumber(116));
      } else if ((c).isEqualTo(new BigNumber(10))) {
        return _dafny.Seq.of(Jcs.__default.BSLASH, new BigNumber(110));
      } else if ((c).isEqualTo(new BigNumber(12))) {
        return _dafny.Seq.of(Jcs.__default.BSLASH, new BigNumber(102));
      } else if ((c).isEqualTo(new BigNumber(13))) {
        return _dafny.Seq.of(Jcs.__default.BSLASH, new BigNumber(114));
      } else if ((c).isEqualTo(Jcs.__default.QUOTE)) {
        return _dafny.Seq.of(Jcs.__default.BSLASH, Jcs.__default.QUOTE);
      } else if ((c).isEqualTo(Jcs.__default.BSLASH)) {
        return _dafny.Seq.of(Jcs.__default.BSLASH, Jcs.__default.BSLASH);
      } else if (((c).isLessThan(new BigNumber(32))) || (Jcs.__default.IsSurrogate(c))) {
        return _dafny.Seq.Concat(_dafny.Seq.of(Jcs.__default.BSLASH, new BigNumber(117)), Jcs.__default.Hex4(c));
      } else {
        return _dafny.Seq.of(c);
      }
    };
    static Escape(s) {
      let _hresult = _dafny.Seq.of();
      let _0_a;
      let _nw0 = Array(((new BigNumber(6)).multipliedBy(new BigNumber((s).length))).toNumber()).fill(_dafny.ZERO);
      _0_a = _nw0;
      let _1_i;
      let _2_n;
      let _rhs0 = _dafny.ZERO;
      let _rhs1 = _dafny.ZERO;
      _1_i = _rhs0;
      _2_n = _rhs1;
      while ((_1_i).isLessThan(new BigNumber((s).length))) {
        if (((((_1_i).plus(_dafny.ONE)).isLessThan(new BigNumber((s).length))) && (Jcs.__default.IsHigh((s)[_1_i]))) && (Jcs.__default.IsLow((s)[(_1_i).plus(_dafny.ONE)]))) {
          let _index0 = (_2_n).plus(_dafny.ONE);
          let _rhs2 = (s)[_1_i];
          let _rhs3 = (s)[(_1_i).plus(_dafny.ONE)];
          let _lhs0 = _0_a;
          let _lhs1 = _2_n;
          let _lhs2 = _0_a;
          let _lhs3 = (_2_n).plus(_dafny.ONE);
          _lhs0[_lhs1] = _rhs2;
          _lhs2[_lhs3] = _rhs3;
          let _rhs4 = (_2_n).plus(new BigNumber(2));
          let _rhs5 = (_1_i).plus(new BigNumber(2));
          _2_n = _rhs4;
          _1_i = _rhs5;
        } else {
          let _3_e;
          _3_e = Jcs.__default.EscUnit((s)[_1_i]);
          let _4_k;
          _4_k = _dafny.ZERO;
          while ((_4_k).isLessThan(new BigNumber((_3_e).length))) {
            let _index1 = (_2_n).plus(_4_k);
            (_0_a)[_index1] = (_3_e)[_4_k];
            _4_k = (_4_k).plus(_dafny.ONE);
          }
          let _rhs6 = (_2_n).plus(new BigNumber((_3_e).length));
          let _rhs7 = (_1_i).plus(_dafny.ONE);
          _2_n = _rhs6;
          _1_i = _rhs7;
        }
      }
      _hresult = _dafny.Seq.of(...(_0_a).slice(0, _2_n));
      return _hresult;
      return _hresult;
    }
    static Quote(s) {
      return _dafny.Seq.Concat(_dafny.Seq.Concat(_dafny.Seq.of(Jcs.__default.QUOTE), Jcs.__default.Escape(s)), _dafny.Seq.of(Jcs.__default.QUOTE));
    };
    static Ser(j) {
      let _source0 = j;
      {
        if (_source0.is_JNull) {
          return Jcs.__default.NULL__LIT;
        }
      }
      {
        if (_source0.is_JBool) {
          let _0_b = (_source0).b;
          if (_0_b) {
            return Jcs.__default.TRUE__LIT;
          } else {
            return Jcs.__default.FALSE__LIT;
          }
        }
      }
      {
        if (_source0.is_JStr) {
          let _1_s = (_source0).s;
          return Jcs.__default.Quote(_1_s);
        }
      }
      {
        if (_source0.is_JArr) {
          let _2_items = (_source0).items;
          return _dafny.Seq.Concat(_dafny.Seq.Concat(_dafny.Seq.of(Jcs.__default.LBRACK), Jcs.__default.SerItems(_2_items)), _dafny.Seq.of(Jcs.__default.RBRACK));
        }
      }
      {
        let _3_ms = (_source0).members;
        return _dafny.Seq.Concat(_dafny.Seq.Concat(_dafny.Seq.of(Jcs.__default.LBRACE), Jcs.__default.SerMembers(_3_ms)), _dafny.Seq.of(Jcs.__default.RBRACE));
      }
    };
    static SerItems(items) {
      if ((new BigNumber((items).length)).isEqualTo(_dafny.ZERO)) {
        return _dafny.Seq.of();
      } else if ((new BigNumber((items).length)).isEqualTo(_dafny.ONE)) {
        return Jcs.__default.Ser((items)[_dafny.ZERO]);
      } else {
        return _dafny.Seq.Concat(_dafny.Seq.Concat(Jcs.__default.Ser((items)[_dafny.ZERO]), _dafny.Seq.of(Jcs.__default.COMMA)), Jcs.__default.SerItems((items).slice(_dafny.ONE)));
      }
    };
    static SerMember(m) {
      return _dafny.Seq.Concat(_dafny.Seq.Concat(Jcs.__default.Quote((m).dtor_key), _dafny.Seq.of(Jcs.__default.COLON)), Jcs.__default.Ser((m).dtor_value));
    };
    static SerMembers(ms) {
      if ((new BigNumber((ms).length)).isEqualTo(_dafny.ZERO)) {
        return _dafny.Seq.of();
      } else if ((new BigNumber((ms).length)).isEqualTo(_dafny.ONE)) {
        return Jcs.__default.SerMember((ms)[_dafny.ZERO]);
      } else {
        return _dafny.Seq.Concat(_dafny.Seq.Concat(Jcs.__default.SerMember((ms)[_dafny.ZERO]), _dafny.Seq.of(Jcs.__default.COMMA)), Jcs.__default.SerMembers((ms).slice(_dafny.ONE)));
      }
    };
    static IsHexDigit(c) {
      return (((new BigNumber(48)).isLessThanOrEqualTo(c)) && ((c).isLessThanOrEqualTo(new BigNumber(57)))) || (((new BigNumber(97)).isLessThanOrEqualTo(c)) && ((c).isLessThanOrEqualTo(new BigNumber(102))));
    };
    static HexVal(c) {
      if ((c).isLessThanOrEqualTo(new BigNumber(57))) {
        return (c).minus(new BigNumber(48));
      } else {
        return ((c).minus(new BigNumber(97))).plus(new BigNumber(10));
      }
    };
    static IsHex4(t) {
      return (((((new BigNumber((t).length)).isEqualTo(new BigNumber(4))) && (Jcs.__default.IsHexDigit((t)[_dafny.ZERO]))) && (Jcs.__default.IsHexDigit((t)[_dafny.ONE]))) && (Jcs.__default.IsHexDigit((t)[new BigNumber(2)]))) && (Jcs.__default.IsHexDigit((t)[new BigNumber(3)]));
    };
    static Hex4Val(t) {
      return ((((Jcs.__default.HexVal((t)[_dafny.ZERO])).multipliedBy(new BigNumber(4096))).plus((Jcs.__default.HexVal((t)[_dafny.ONE])).multipliedBy(new BigNumber(256)))).plus((Jcs.__default.HexVal((t)[new BigNumber(2)])).multipliedBy(new BigNumber(16)))).plus(Jcs.__default.HexVal((t)[new BigNumber(3)]));
    };
    static Unescape(e) {
      if ((e).isEqualTo(new BigNumber(98))) {
        return Text.Option.create_Some(new BigNumber(8));
      } else if ((e).isEqualTo(new BigNumber(116))) {
        return Text.Option.create_Some(new BigNumber(9));
      } else if ((e).isEqualTo(new BigNumber(110))) {
        return Text.Option.create_Some(new BigNumber(10));
      } else if ((e).isEqualTo(new BigNumber(102))) {
        return Text.Option.create_Some(new BigNumber(12));
      } else if ((e).isEqualTo(new BigNumber(114))) {
        return Text.Option.create_Some(new BigNumber(13));
      } else if ((e).isEqualTo(Jcs.__default.QUOTE)) {
        return Text.Option.create_Some(Jcs.__default.QUOTE);
      } else if ((e).isEqualTo(Jcs.__default.BSLASH)) {
        return Text.Option.create_Some(Jcs.__default.BSLASH);
      } else {
        return Text.Option.create_None();
      }
    };
    static DecodeStr(t) {
      if ((new BigNumber((t).length)).isEqualTo(_dafny.ZERO)) {
        return Text.Option.create_None();
      } else if (((t)[_dafny.ZERO]).isEqualTo(Jcs.__default.QUOTE)) {
        return Text.Option.create_Some(_dafny.Tuple.of(_dafny.Seq.of(), (t).slice(_dafny.ONE)));
      } else if (((t)[_dafny.ZERO]).isEqualTo(Jcs.__default.BSLASH)) {
        if ((new BigNumber((t).length)).isLessThan(new BigNumber(2))) {
          return Text.Option.create_None();
        } else if (((t)[_dafny.ONE]).isEqualTo(new BigNumber(117))) {
          if (((new BigNumber((t).length)).isLessThan(new BigNumber(6))) || (!(Jcs.__default.IsHex4((t).slice(new BigNumber(2), new BigNumber(6)))))) {
            return Text.Option.create_None();
          } else {
            let _source0 = Jcs.__default.DecodeStr((t).slice(new BigNumber(6)));
            {
              if (_source0.is_None) {
                return Text.Option.create_None();
              }
            }
            {
              let _0_r = (_source0).value;
              return Text.Option.create_Some(_dafny.Tuple.of(_dafny.Seq.Concat(_dafny.Seq.of(Jcs.__default.Hex4Val((t).slice(new BigNumber(2), new BigNumber(6)))), (_0_r)[0]), (_0_r)[1]));
            }
          }
        } else {
          let _source1 = Jcs.__default.Unescape((t)[_dafny.ONE]);
          {
            if (_source1.is_None) {
              return Text.Option.create_None();
            }
          }
          {
            let _1_u = (_source1).value;
            let _source2 = Jcs.__default.DecodeStr((t).slice(new BigNumber(2)));
            {
              if (_source2.is_None) {
                return Text.Option.create_None();
              }
            }
            {
              let _2_r = (_source2).value;
              return Text.Option.create_Some(_dafny.Tuple.of(_dafny.Seq.Concat(_dafny.Seq.of(_1_u), (_2_r)[0]), (_2_r)[1]));
            }
          }
        }
      } else {
        let _source3 = Jcs.__default.DecodeStr((t).slice(_dafny.ONE));
        {
          if (_source3.is_None) {
            return Text.Option.create_None();
          }
        }
        {
          let _3_r = (_source3).value;
          return Text.Option.create_Some(_dafny.Tuple.of(_dafny.Seq.Concat(_dafny.Seq.of((t)[_dafny.ZERO]), (_3_r)[0]), (_3_r)[1]));
        }
      }
    };
    static ParseValue(t) {
      if ((new BigNumber((t).length)).isEqualTo(_dafny.ZERO)) {
        return Text.Option.create_None();
      } else if (((t)[_dafny.ZERO]).isEqualTo(new BigNumber(110))) {
        if (((new BigNumber(4)).isLessThanOrEqualTo(new BigNumber((t).length))) && (_dafny.areEqual((t).slice(0, new BigNumber(4)), Jcs.__default.NULL__LIT))) {
          return Text.Option.create_Some(_dafny.Tuple.of(Jcs.Json.create_JNull(), (t).slice(new BigNumber(4))));
        } else {
          return Text.Option.create_None();
        }
      } else if (((t)[_dafny.ZERO]).isEqualTo(new BigNumber(116))) {
        if (((new BigNumber(4)).isLessThanOrEqualTo(new BigNumber((t).length))) && (_dafny.areEqual((t).slice(0, new BigNumber(4)), Jcs.__default.TRUE__LIT))) {
          return Text.Option.create_Some(_dafny.Tuple.of(Jcs.Json.create_JBool(true), (t).slice(new BigNumber(4))));
        } else {
          return Text.Option.create_None();
        }
      } else if (((t)[_dafny.ZERO]).isEqualTo(new BigNumber(102))) {
        if (((new BigNumber(5)).isLessThanOrEqualTo(new BigNumber((t).length))) && (_dafny.areEqual((t).slice(0, new BigNumber(5)), Jcs.__default.FALSE__LIT))) {
          return Text.Option.create_Some(_dafny.Tuple.of(Jcs.Json.create_JBool(false), (t).slice(new BigNumber(5))));
        } else {
          return Text.Option.create_None();
        }
      } else if (((t)[_dafny.ZERO]).isEqualTo(Jcs.__default.QUOTE)) {
        let _source0 = Jcs.__default.DecodeStr((t).slice(_dafny.ONE));
        {
          if (_source0.is_None) {
            return Text.Option.create_None();
          }
        }
        {
          let _0_r = (_source0).value;
          return Text.Option.create_Some(_dafny.Tuple.of(Jcs.Json.create_JStr((_0_r)[0]), (_0_r)[1]));
        }
      } else if (((t)[_dafny.ZERO]).isEqualTo(Jcs.__default.LBRACK)) {
        if (((new BigNumber(2)).isLessThanOrEqualTo(new BigNumber((t).length))) && (((t)[_dafny.ONE]).isEqualTo(Jcs.__default.RBRACK))) {
          return Text.Option.create_Some(_dafny.Tuple.of(Jcs.Json.create_JArr(_dafny.Seq.of()), (t).slice(new BigNumber(2))));
        } else {
          let _source1 = Jcs.__default.ParseItems((t).slice(_dafny.ONE));
          {
            if (_source1.is_None) {
              return Text.Option.create_None();
            }
          }
          {
            let _1_r = (_source1).value;
            return Text.Option.create_Some(_dafny.Tuple.of(Jcs.Json.create_JArr((_1_r)[0]), (_1_r)[1]));
          }
        }
      } else if (((t)[_dafny.ZERO]).isEqualTo(Jcs.__default.LBRACE)) {
        if (((new BigNumber(2)).isLessThanOrEqualTo(new BigNumber((t).length))) && (((t)[_dafny.ONE]).isEqualTo(Jcs.__default.RBRACE))) {
          return Text.Option.create_Some(_dafny.Tuple.of(Jcs.Json.create_JObj(_dafny.Seq.of()), (t).slice(new BigNumber(2))));
        } else {
          let _source2 = Jcs.__default.ParseMembers((t).slice(_dafny.ONE));
          {
            if (_source2.is_None) {
              return Text.Option.create_None();
            }
          }
          {
            let _2_r = (_source2).value;
            return Text.Option.create_Some(_dafny.Tuple.of(Jcs.Json.create_JObj((_2_r)[0]), (_2_r)[1]));
          }
        }
      } else {
        return Text.Option.create_None();
      }
    };
    static ParseItems(t) {
      let _source0 = Jcs.__default.ParseValue(t);
      {
        if (_source0.is_None) {
          return Text.Option.create_None();
        }
      }
      {
        let _0_r = (_source0).value;
        let _1_rest = (_0_r)[1];
        if ((new BigNumber((_1_rest).length)).isEqualTo(_dafny.ZERO)) {
          return Text.Option.create_None();
        } else if (((_1_rest)[_dafny.ZERO]).isEqualTo(Jcs.__default.RBRACK)) {
          return Text.Option.create_Some(_dafny.Tuple.of(_dafny.Seq.of((_0_r)[0]), (_1_rest).slice(_dafny.ONE)));
        } else if (((_1_rest)[_dafny.ZERO]).isEqualTo(Jcs.__default.COMMA)) {
          let _source1 = Jcs.__default.ParseItems((_1_rest).slice(_dafny.ONE));
          {
            if (_source1.is_None) {
              return Text.Option.create_None();
            }
          }
          {
            let _2_r2 = (_source1).value;
            return Text.Option.create_Some(_dafny.Tuple.of(_dafny.Seq.Concat(_dafny.Seq.of((_0_r)[0]), (_2_r2)[0]), (_2_r2)[1]));
          }
        } else {
          return Text.Option.create_None();
        }
      }
    };
    static ParseMembers(t) {
      if (((new BigNumber((t).length)).isEqualTo(_dafny.ZERO)) || (!((t)[_dafny.ZERO]).isEqualTo(Jcs.__default.QUOTE))) {
        return Text.Option.create_None();
      } else {
        let _source0 = Jcs.__default.DecodeStr((t).slice(_dafny.ONE));
        {
          if (_source0.is_None) {
            return Text.Option.create_None();
          }
        }
        {
          let _0_k = (_source0).value;
          let _1_afterKey = (_0_k)[1];
          if (((new BigNumber((_1_afterKey).length)).isEqualTo(_dafny.ZERO)) || (!((_1_afterKey)[_dafny.ZERO]).isEqualTo(Jcs.__default.COLON))) {
            return Text.Option.create_None();
          } else {
            let _source1 = Jcs.__default.ParseValue((_1_afterKey).slice(_dafny.ONE));
            {
              if (_source1.is_None) {
                return Text.Option.create_None();
              }
            }
            {
              let _2_r = (_source1).value;
              let _3_rest = (_2_r)[1];
              if ((new BigNumber((_3_rest).length)).isEqualTo(_dafny.ZERO)) {
                return Text.Option.create_None();
              } else if (((_3_rest)[_dafny.ZERO]).isEqualTo(Jcs.__default.RBRACE)) {
                return Text.Option.create_Some(_dafny.Tuple.of(_dafny.Seq.of(Jcs.Member.create_Member((_0_k)[0], (_2_r)[0])), (_3_rest).slice(_dafny.ONE)));
              } else if (((_3_rest)[_dafny.ZERO]).isEqualTo(Jcs.__default.COMMA)) {
                let _source2 = Jcs.__default.ParseMembers((_3_rest).slice(_dafny.ONE));
                {
                  if (_source2.is_None) {
                    return Text.Option.create_None();
                  }
                }
                {
                  let _4_r2 = (_source2).value;
                  return Text.Option.create_Some(_dafny.Tuple.of(_dafny.Seq.Concat(_dafny.Seq.of(Jcs.Member.create_Member((_0_k)[0], (_2_r)[0])), (_4_r2)[0]), (_4_r2)[1]));
                }
              } else {
                return Text.Option.create_None();
              }
            }
          }
        }
      }
    };
    static get BSLASH() {
      return new BigNumber(92);
    };
    static get QUOTE() {
      return new BigNumber(34);
    };
    static get NULL__LIT() {
      return _dafny.Seq.of(new BigNumber(110), new BigNumber(117), new BigNumber(108), new BigNumber(108));
    };
    static get TRUE__LIT() {
      return _dafny.Seq.of(new BigNumber(116), new BigNumber(114), new BigNumber(117), new BigNumber(101));
    };
    static get FALSE__LIT() {
      return _dafny.Seq.of(new BigNumber(102), new BigNumber(97), new BigNumber(108), new BigNumber(115), new BigNumber(101));
    };
    static get LBRACK() {
      return new BigNumber(91);
    };
    static get COMMA() {
      return new BigNumber(44);
    };
    static get RBRACK() {
      return new BigNumber(93);
    };
    static get LBRACE() {
      return new BigNumber(123);
    };
    static get COLON() {
      return new BigNumber(58);
    };
    static get RBRACE() {
      return new BigNumber(125);
    };
  };

  $module.Json = class Json {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_JNull() {
      let $dt = new Json(0);
      return $dt;
    }
    static create_JBool(b) {
      let $dt = new Json(1);
      $dt.b = b;
      return $dt;
    }
    static create_JStr(s) {
      let $dt = new Json(2);
      $dt.s = s;
      return $dt;
    }
    static create_JArr(items) {
      let $dt = new Json(3);
      $dt.items = items;
      return $dt;
    }
    static create_JObj(members) {
      let $dt = new Json(4);
      $dt.members = members;
      return $dt;
    }
    get is_JNull() { return this.$tag === 0; }
    get is_JBool() { return this.$tag === 1; }
    get is_JStr() { return this.$tag === 2; }
    get is_JArr() { return this.$tag === 3; }
    get is_JObj() { return this.$tag === 4; }
    get dtor_b() { return this.b; }
    get dtor_s() { return this.s; }
    get dtor_items() { return this.items; }
    get dtor_members() { return this.members; }
    toString() {
      if (this.$tag === 0) {
        return "Jcs.Json.JNull";
      } else if (this.$tag === 1) {
        return "Jcs.Json.JBool" + "(" + _dafny.toString(this.b) + ")";
      } else if (this.$tag === 2) {
        return "Jcs.Json.JStr" + "(" + _dafny.toString(this.s) + ")";
      } else if (this.$tag === 3) {
        return "Jcs.Json.JArr" + "(" + _dafny.toString(this.items) + ")";
      } else if (this.$tag === 4) {
        return "Jcs.Json.JObj" + "(" + _dafny.toString(this.members) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0;
      } else if (this.$tag === 1) {
        return other.$tag === 1 && this.b === other.b;
      } else if (this.$tag === 2) {
        return other.$tag === 2 && _dafny.areEqual(this.s, other.s);
      } else if (this.$tag === 3) {
        return other.$tag === 3 && _dafny.areEqual(this.items, other.items);
      } else if (this.$tag === 4) {
        return other.$tag === 4 && _dafny.areEqual(this.members, other.members);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return Jcs.Json.create_JNull();
    }
    static Rtd() {
      return class {
        static get Default() {
          return Json.Default();
        }
      };
    }
  }

  $module.Member = class Member {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_Member(key, value) {
      let $dt = new Member(0);
      $dt.key = key;
      $dt.value = value;
      return $dt;
    }
    get is_Member() { return this.$tag === 0; }
    get dtor_key() { return this.key; }
    get dtor_value() { return this.value; }
    toString() {
      if (this.$tag === 0) {
        return "Jcs.Member.Member" + "(" + _dafny.toString(this.key) + ", " + _dafny.toString(this.value) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.key, other.key) && _dafny.areEqual(this.value, other.value);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return Jcs.Member.create_Member(_dafny.Seq.of(), Jcs.Json.Default());
    }
    static Rtd() {
      return class {
        static get Default() {
          return Member.Default();
        }
      };
    }
  }
  return $module;
})(); // end of module Jcs
let Utf8 = (function() {
  let $module = {};

  $module.__default = class __default {
    constructor () {
      this._tname = "Utf8._default";
    }
    _parentTraits() {
      return [];
    }
    static IsHigh(c) {
      return ((new BigNumber(55296)).isLessThanOrEqualTo(c)) && ((c).isLessThanOrEqualTo(new BigNumber(56319)));
    };
    static IsLow(c) {
      return ((new BigNumber(56320)).isLessThanOrEqualTo(c)) && ((c).isLessThanOrEqualTo(new BigNumber(57343)));
    };
    static WellFormed(s) {
      if ((new BigNumber((s).length)).isEqualTo(_dafny.ZERO)) {
        return true;
      } else if (Utf8.__default.IsHigh((s)[_dafny.ZERO])) {
        return (((new BigNumber(2)).isLessThanOrEqualTo(new BigNumber((s).length))) && (Utf8.__default.IsLow((s)[_dafny.ONE]))) && (Utf8.__default.WellFormed((s).slice(new BigNumber(2))));
      } else if (Utf8.__default.IsLow((s)[_dafny.ZERO])) {
        return false;
      } else {
        return Utf8.__default.WellFormed((s).slice(_dafny.ONE));
      }
    };
    static Encode(s) {
      let _hresult = _dafny.Seq.of();
      let _0_a;
      let _nw0 = Array(((new BigNumber(4)).multipliedBy(new BigNumber((s).length))).toNumber()).fill(_dafny.ZERO);
      _0_a = _nw0;
      let _1_i;
      let _2_n;
      let _rhs0 = _dafny.ZERO;
      let _rhs1 = _dafny.ZERO;
      _1_i = _rhs0;
      _2_n = _rhs1;
      while ((_1_i).isLessThan(new BigNumber((s).length))) {
        let _3_c;
        _3_c = (s)[_1_i];
        if ((_3_c).isLessThan(new BigNumber(128))) {
          (_0_a)[(_2_n)] = (_3_c);
          let _rhs2 = (_2_n).plus(_dafny.ONE);
          let _rhs3 = (_1_i).plus(_dafny.ONE);
          _2_n = _rhs2;
          _1_i = _rhs3;
        } else if ((_3_c).isLessThan(new BigNumber(2048))) {
          let _index0 = (_2_n).plus(_dafny.ONE);
          let _rhs4 = ((new BigNumber(192)).plus(_dafny.EuclideanDivision(_3_c, new BigNumber(64))));
          let _rhs5 = ((new BigNumber(128)).plus((_3_c).mod(new BigNumber(64))));
          let _lhs0 = _0_a;
          let _lhs1 = _2_n;
          let _lhs2 = _0_a;
          let _lhs3 = (_2_n).plus(_dafny.ONE);
          _lhs0[_lhs1] = _rhs4;
          _lhs2[_lhs3] = _rhs5;
          let _rhs6 = (_2_n).plus(new BigNumber(2));
          let _rhs7 = (_1_i).plus(_dafny.ONE);
          _2_n = _rhs6;
          _1_i = _rhs7;
        } else if (Utf8.__default.IsHigh(_3_c)) {
          let _4_cp;
          _4_cp = ((new BigNumber(65536)).plus(((_3_c).minus(new BigNumber(55296))).multipliedBy(new BigNumber(1024)))).plus(((s)[(_1_i).plus(_dafny.ONE)]).minus(new BigNumber(56320)));
          let _index1 = (_2_n).plus(_dafny.ONE);
          let _index2 = (_2_n).plus(new BigNumber(2));
          let _index3 = (_2_n).plus(new BigNumber(3));
          let _rhs8 = ((new BigNumber(240)).plus(_dafny.EuclideanDivision(_4_cp, new BigNumber(262144))));
          let _rhs9 = ((new BigNumber(128)).plus((_dafny.EuclideanDivision(_4_cp, new BigNumber(4096))).mod(new BigNumber(64))));
          let _rhs10 = ((new BigNumber(128)).plus((_dafny.EuclideanDivision(_4_cp, new BigNumber(64))).mod(new BigNumber(64))));
          let _rhs11 = ((new BigNumber(128)).plus((_4_cp).mod(new BigNumber(64))));
          let _lhs4 = _0_a;
          let _lhs5 = _2_n;
          let _lhs6 = _0_a;
          let _lhs7 = (_2_n).plus(_dafny.ONE);
          let _lhs8 = _0_a;
          let _lhs9 = (_2_n).plus(new BigNumber(2));
          let _lhs10 = _0_a;
          let _lhs11 = (_2_n).plus(new BigNumber(3));
          _lhs4[_lhs5] = _rhs8;
          _lhs6[_lhs7] = _rhs9;
          _lhs8[_lhs9] = _rhs10;
          _lhs10[_lhs11] = _rhs11;
          let _rhs12 = (_2_n).plus(new BigNumber(4));
          let _rhs13 = (_1_i).plus(new BigNumber(2));
          _2_n = _rhs12;
          _1_i = _rhs13;
        } else {
          let _index4 = (_2_n).plus(_dafny.ONE);
          let _index5 = (_2_n).plus(new BigNumber(2));
          let _rhs14 = ((new BigNumber(224)).plus(_dafny.EuclideanDivision(_3_c, new BigNumber(4096))));
          let _rhs15 = ((new BigNumber(128)).plus((_dafny.EuclideanDivision(_3_c, new BigNumber(64))).mod(new BigNumber(64))));
          let _rhs16 = ((new BigNumber(128)).plus((_3_c).mod(new BigNumber(64))));
          let _lhs12 = _0_a;
          let _lhs13 = _2_n;
          let _lhs14 = _0_a;
          let _lhs15 = (_2_n).plus(_dafny.ONE);
          let _lhs16 = _0_a;
          let _lhs17 = (_2_n).plus(new BigNumber(2));
          _lhs12[_lhs13] = _rhs14;
          _lhs14[_lhs15] = _rhs15;
          _lhs16[_lhs17] = _rhs16;
          let _rhs17 = (_2_n).plus(new BigNumber(3));
          let _rhs18 = (_1_i).plus(_dafny.ONE);
          _2_n = _rhs17;
          _1_i = _rhs18;
        }
      }
      _hresult = _dafny.Seq.of(...(_0_a).slice(0, _2_n));
      return _hresult;
      return _hresult;
    }
    static Cont(b) {
      return ((new BigNumber(128)).isLessThanOrEqualTo(b)) && ((b).isLessThan(new BigNumber(192)));
    };
    static Decode(b) {
      if ((new BigNumber((b).length)).isEqualTo(_dafny.ZERO)) {
        return Text.Option.create_Some(_dafny.Seq.of());
      } else {
        let _0_b0 = (b)[_dafny.ZERO];
        let _1_b1 = (((new BigNumber(2)).isLessThanOrEqualTo(new BigNumber((b).length))) ? ((b)[_dafny.ONE]) : (_dafny.ZERO));
        let _2_b2 = (((new BigNumber(3)).isLessThanOrEqualTo(new BigNumber((b).length))) ? ((b)[new BigNumber(2)]) : (_dafny.ZERO));
        let _3_b3 = (((new BigNumber(4)).isLessThanOrEqualTo(new BigNumber((b).length))) ? ((b)[new BigNumber(3)]) : (_dafny.ZERO));
        if ((_0_b0).isLessThan(new BigNumber(128))) {
          return Utf8.__default.Prepend(_dafny.Seq.of((_0_b0)), Utf8.__default.Decode((b).slice(_dafny.ONE)));
        } else if (((((new BigNumber(192)).isLessThanOrEqualTo(_0_b0)) && ((_0_b0).isLessThan(new BigNumber(224)))) && ((new BigNumber(2)).isLessThanOrEqualTo(new BigNumber((b).length)))) && (Utf8.__default.Cont((b)[_dafny.ONE]))) {
          return Utf8.__default.Prepend(_dafny.Seq.of(((((_0_b0).minus(new BigNumber(192))).multipliedBy(new BigNumber(64))).plus((_1_b1).minus(new BigNumber(128))))), Utf8.__default.Decode((b).slice(new BigNumber(2))));
        } else if ((((((new BigNumber(224)).isLessThanOrEqualTo(_0_b0)) && ((_0_b0).isLessThan(new BigNumber(240)))) && ((new BigNumber(3)).isLessThanOrEqualTo(new BigNumber((b).length)))) && (Utf8.__default.Cont((b)[_dafny.ONE]))) && (Utf8.__default.Cont((b)[new BigNumber(2)]))) {
          return Utf8.__default.Prepend(_dafny.Seq.of((((((_0_b0).minus(new BigNumber(224))).multipliedBy(new BigNumber(4096))).plus(((_1_b1).minus(new BigNumber(128))).multipliedBy(new BigNumber(64)))).plus((_2_b2).minus(new BigNumber(128))))), Utf8.__default.Decode((b).slice(new BigNumber(3))));
        } else if (((((((new BigNumber(240)).isLessThanOrEqualTo(_0_b0)) && ((_0_b0).isLessThan(new BigNumber(248)))) && ((new BigNumber(4)).isLessThanOrEqualTo(new BigNumber((b).length)))) && (Utf8.__default.Cont((b)[_dafny.ONE]))) && (Utf8.__default.Cont((b)[new BigNumber(2)]))) && (Utf8.__default.Cont((b)[new BigNumber(3)]))) {
          let _4_cp = (((((_0_b0).minus(new BigNumber(240))).multipliedBy(new BigNumber(262144))).plus(((_1_b1).minus(new BigNumber(128))).multipliedBy(new BigNumber(4096)))).plus(((_2_b2).minus(new BigNumber(128))).multipliedBy(new BigNumber(64)))).plus((_3_b3).minus(new BigNumber(128)));
          if (((new BigNumber(65536)).isLessThanOrEqualTo(_4_cp)) && ((_4_cp).isLessThan(new BigNumber(1114112)))) {
            return Utf8.__default.Prepend(_dafny.Seq.of(((new BigNumber(55296)).plus(_dafny.EuclideanDivision((_4_cp).minus(new BigNumber(65536)), new BigNumber(1024)))), ((new BigNumber(56320)).plus(((_4_cp).minus(new BigNumber(65536))).mod(new BigNumber(1024))))), Utf8.__default.Decode((b).slice(new BigNumber(4))));
          } else {
            return Text.Option.create_None();
          }
        } else {
          return Text.Option.create_None();
        }
      }
    };
    static Prepend(p, r) {
      if ((r).is_None) {
        return Text.Option.create_None();
      } else {
        return Text.Option.create_Some(_dafny.Seq.Concat(p, (r).dtor_value));
      }
    };
  };

  $module.Byte = class Byte {
    constructor () {
    }
    static get Default() {
      return _dafny.ZERO;
    }
    static _Is(__source) {
      let _0_b = (__source);
      return ((_dafny.ZERO).isLessThanOrEqualTo(_0_b)) && ((_0_b).isLessThan(new BigNumber(256)));
    }
  };
  return $module;
})(); // end of module Utf8
let Terms = (function() {
  let $module = {};

  $module.__default = class __default {
    constructor () {
      this._tname = "Terms._default";
    }
    _parentTraits() {
      return [];
    }
    static Lt(a, b) {
      if ((new BigNumber((a).length)).isEqualTo(_dafny.ZERO)) {
        return (_dafny.ZERO).isLessThan(new BigNumber((b).length));
      } else if ((new BigNumber((b).length)).isEqualTo(_dafny.ZERO)) {
        return false;
      } else {
        return (((a)[_dafny.ZERO]).isLessThan((b)[_dafny.ZERO])) || ((((a)[_dafny.ZERO]).isEqualTo((b)[_dafny.ZERO])) && (Terms.__default.Lt((a).slice(_dafny.ONE), (b).slice(_dafny.ONE))));
      }
    };
    static StrictlySorted(ms) {
      return _dafny.Quantifier(_dafny.IntegerRange(_dafny.ZERO, new BigNumber((ms).length)), true, function (_forall_var_0) {
        let _0_i = _forall_var_0;
        return _dafny.Quantifier(_dafny.IntegerRange((_0_i).plus(_dafny.ONE), new BigNumber((ms).length)), true, function (_forall_var_1) {
          let _1_k = _forall_var_1;
          return !((((_dafny.ZERO).isLessThanOrEqualTo(_0_i)) && ((_0_i).isLessThan(_1_k))) && ((_1_k).isLessThan(new BigNumber((ms).length)))) || (Terms.__default.Lt(((ms)[_0_i]).dtor_key, ((ms)[_1_k]).dtor_key));
        });
      });
    };
    static DistinctKeys(ms) {
      return _dafny.Quantifier(_dafny.IntegerRange(_dafny.ZERO, new BigNumber((ms).length)), true, function (_forall_var_0) {
        let _0_i = _forall_var_0;
        return _dafny.Quantifier(_dafny.IntegerRange((_0_i).plus(_dafny.ONE), new BigNumber((ms).length)), true, function (_forall_var_1) {
          let _1_k = _forall_var_1;
          return !((((_dafny.ZERO).isLessThanOrEqualTo(_0_i)) && ((_0_i).isLessThan(_1_k))) && ((_1_k).isLessThan(new BigNumber((ms).length)))) || (!_dafny.areEqual(((ms)[_0_i]).dtor_key, ((ms)[_1_k]).dtor_key));
        });
      });
    };
    static Insert(m, ms) {
      let _0___accumulator = _dafny.Seq.of();
      TAIL_CALL_START: while (true) {
        if ((new BigNumber((ms).length)).isEqualTo(_dafny.ZERO)) {
          return _dafny.Seq.Concat(_0___accumulator, _dafny.Seq.of(m));
        } else if (Terms.__default.Lt((m).dtor_key, ((ms)[_dafny.ZERO]).dtor_key)) {
          return _dafny.Seq.Concat(_0___accumulator, _dafny.Seq.Concat(_dafny.Seq.of(m), ms));
        } else {
          _0___accumulator = _dafny.Seq.Concat(_0___accumulator, _dafny.Seq.of((ms)[_dafny.ZERO]));
          let _in0 = m;
          let _in1 = (ms).slice(_dafny.ONE);
          m = _in0;
          ms = _in1;
          continue TAIL_CALL_START;
        }
      }
    };
    static SortMembers(ms) {
      if ((new BigNumber((ms).length)).isEqualTo(_dafny.ZERO)) {
        return _dafny.Seq.of();
      } else {
        return Terms.__default.Insert((ms)[_dafny.ZERO], Terms.__default.SortMembers((ms).slice(_dafny.ONE)));
      }
    };
    static Normalize(j) {
      let _source0 = j;
      {
        if (_source0.is_JArr) {
          let _0_items = (_source0).items;
          return Jcs.Json.create_JArr(Terms.__default.NormItems(_0_items));
        }
      }
      {
        if (_source0.is_JObj) {
          let _1_ms = (_source0).members;
          return Jcs.Json.create_JObj(Terms.__default.SortMembers(Terms.__default.NormMembers(_1_ms)));
        }
      }
      {
        return j;
      }
    };
    static NormItems(items) {
      if ((new BigNumber((items).length)).isEqualTo(_dafny.ZERO)) {
        return _dafny.Seq.of();
      } else {
        return _dafny.Seq.Concat(_dafny.Seq.of(Terms.__default.Normalize((items)[_dafny.ZERO])), Terms.__default.NormItems((items).slice(_dafny.ONE)));
      }
    };
    static NormMembers(ms) {
      if ((new BigNumber((ms).length)).isEqualTo(_dafny.ZERO)) {
        return _dafny.Seq.of();
      } else {
        return _dafny.Seq.Concat(_dafny.Seq.of(Jcs.Member.create_Member(((ms)[_dafny.ZERO]).dtor_key, Terms.__default.Normalize(((ms)[_dafny.ZERO]).dtor_value))), Terms.__default.NormMembers((ms).slice(_dafny.ONE)));
      }
    };
    static Get(ms, k) {
      TAIL_CALL_START: while (true) {
        if ((new BigNumber((ms).length)).isEqualTo(_dafny.ZERO)) {
          return Text.Option.create_None();
        } else if (_dafny.areEqual(((ms)[_dafny.ZERO]).dtor_key, k)) {
          return Text.Option.create_Some(((ms)[_dafny.ZERO]).dtor_value);
        } else {
          let _in0 = (ms).slice(_dafny.ONE);
          let _in1 = k;
          ms = _in0;
          k = _in1;
          continue TAIL_CALL_START;
        }
      }
    };
    static IsoUtc(e) {
      return ((((((((((((((((((((((new BigNumber((e).length)).isEqualTo(new BigNumber(20))) || ((((((new BigNumber((e).length)).isEqualTo(new BigNumber(24))) && (((e)[new BigNumber(19)]).isEqualTo(Text.__default.DOT))) && (Text.__default.IsDigit((e)[new BigNumber(20)]))) && (Text.__default.IsDigit((e)[new BigNumber(21)]))) && (Text.__default.IsDigit((e)[new BigNumber(22)])))) && (((e)[(new BigNumber((e).length)).minus(_dafny.ONE)]).isEqualTo(new BigNumber(90)))) && (Text.__default.IsDigit((e)[_dafny.ZERO]))) && (Text.__default.IsDigit((e)[_dafny.ONE]))) && (Text.__default.IsDigit((e)[new BigNumber(2)]))) && (Text.__default.IsDigit((e)[new BigNumber(3)]))) && (((e)[new BigNumber(4)]).isEqualTo(new BigNumber(45)))) && (Text.__default.IsDigit((e)[new BigNumber(5)]))) && (Text.__default.IsDigit((e)[new BigNumber(6)]))) && (((e)[new BigNumber(7)]).isEqualTo(new BigNumber(45)))) && (Text.__default.IsDigit((e)[new BigNumber(8)]))) && (Text.__default.IsDigit((e)[new BigNumber(9)]))) && (((e)[new BigNumber(10)]).isEqualTo(new BigNumber(84)))) && (Text.__default.IsDigit((e)[new BigNumber(11)]))) && (Text.__default.IsDigit((e)[new BigNumber(12)]))) && (((e)[new BigNumber(13)]).isEqualTo(Jcs.__default.COLON))) && (Text.__default.IsDigit((e)[new BigNumber(14)]))) && (Text.__default.IsDigit((e)[new BigNumber(15)]))) && (((e)[new BigNumber(16)]).isEqualTo(Jcs.__default.COLON))) && (Text.__default.IsDigit((e)[new BigNumber(17)]))) && (Text.__default.IsDigit((e)[new BigNumber(18)]));
    };
    static TermsOk(j) {
      return (((j).is_JObj) && (_dafny.areEqual(Terms.__default.Get((j).dtor_members, Terms.__default.KEY__SCHEMA), Text.Option.create_Some(Jcs.Json.create_JStr(Terms.__default.SCHEMA))))) && (function () {
        let _source0 = Terms.__default.Get((j).dtor_members, Terms.__default.KEY__EXPIRES__AT);
        {
          if (_source0.is_Some) {
            let value0 = (_source0).value;
            if (value0.is_JStr) {
              let _0_e = (value0).s;
              return Terms.__default.IsoUtc(_0_e);
            }
          }
        }
        {
          return false;
        }
      }());
    };
    static CanonicalTerms(j) {
      if (Terms.__default.TermsOk(j)) {
        return Text.Option.create_Some(Jcs.__default.Ser(Terms.__default.Normalize(j)));
      } else {
        return Text.Option.create_None();
      }
    };
    static TermsBytes(j) {
      if (Terms.__default.TermsOk(j)) {
        return Text.Option.create_Some(Utf8.__default.Encode(Jcs.__default.Ser(Terms.__default.Normalize(j))));
      } else {
        return Text.Option.create_None();
      }
    };
    static get KEY__SCHEMA() {
      return _dafny.Seq.of(new BigNumber(115), new BigNumber(99), new BigNumber(104), new BigNumber(101), new BigNumber(109), new BigNumber(97));
    };
    static get SCHEMA() {
      return _dafny.Seq.of(new BigNumber(107), new BigNumber(105), new BigNumber(116), new BigNumber(49), new BigNumber(49), new BigNumber(46), new BigNumber(97), new BigNumber(112), new BigNumber(112), new BigNumber(114), new BigNumber(111), new BigNumber(118), new BigNumber(97), new BigNumber(108), new BigNumber(45), new BigNumber(116), new BigNumber(101), new BigNumber(114), new BigNumber(109), new BigNumber(115), new BigNumber(47), new BigNumber(118), new BigNumber(49));
    };
    static get KEY__EXPIRES__AT() {
      return _dafny.Seq.of(new BigNumber(101), new BigNumber(120), new BigNumber(112), new BigNumber(105), new BigNumber(114), new BigNumber(101), new BigNumber(115), new BigNumber(95), new BigNumber(97), new BigNumber(116));
    };
  };
  return $module;
})(); // end of module Terms
let Money = (function() {
  let $module = {};

  $module.__default = class __default {
    constructor () {
      this._tname = "Money._default";
    }
    _parentTraits() {
      return [];
    }
    static DecimalShape(s) {
      return ((((((new BigNumber(4)).isLessThanOrEqualTo(new BigNumber((s).length))) && (((s)[(new BigNumber((s).length)).minus(new BigNumber(3))]).isEqualTo(Text.__default.DOT))) && (Text.__default.IsDigit((s)[(new BigNumber((s).length)).minus(new BigNumber(2))]))) && (Text.__default.IsDigit((s)[(new BigNumber((s).length)).minus(_dafny.ONE)]))) && (Text.__default.AllDigits((s).slice(0, (new BigNumber((s).length)).minus(new BigNumber(3)))))) && (Text.__default.NoLeadingZero((s).slice(0, (new BigNumber((s).length)).minus(new BigNumber(3)))));
    };
    static FracValue(s) {
      return ((((s)[(new BigNumber((s).length)).minus(new BigNumber(2))]).minus(new BigNumber(48))).multipliedBy(new BigNumber(10))).plus(((s)[(new BigNumber((s).length)).minus(_dafny.ONE)]).minus(new BigNumber(48)));
    };
    static ToCents(s) {
      if (!(Money.__default.DecimalShape(s))) {
        return Text.Option.create_None();
      } else {
        let _0_c = ((Text.__default.DigitsValue((s).slice(0, (new BigNumber((s).length)).minus(new BigNumber(3))))).multipliedBy(new BigNumber(100))).plus(Money.__default.FracValue(s));
        if ((_0_c).isLessThanOrEqualTo(Money.__default.MAX__SAFE)) {
          return Text.Option.create_Some(_0_c);
        } else {
          return Text.Option.create_None();
        }
      }
    };
    static FromCents(c) {
      return _dafny.Seq.Concat(Text.__default.NatToDigits(_dafny.EuclideanDivision(c, new BigNumber(100))), _dafny.Seq.of(Text.__default.DOT, ((new BigNumber(48)).plus(_dafny.EuclideanDivision((c).mod(new BigNumber(100)), new BigNumber(10)))), ((new BigNumber(48)).plus((c).mod(new BigNumber(10))))));
    };
    static FromCentsChecked(c) {
      if (((_dafny.ZERO).isLessThanOrEqualTo(c)) && ((c).isLessThanOrEqualTo(Money.__default.MAX__SAFE))) {
        return Text.Option.create_Some(Money.__default.FromCents(c));
      } else {
        return Text.Option.create_None();
      }
    };
    static A(s) {
      return _dafny.Seq.Create(new BigNumber((s).length), ((_0_s) => function (_1_i) {
        return (new BigNumber(((_0_s)[_1_i]).value));
      })(s));
    };
    static get MAX__SAFE() {
      return new BigNumber(9007199254740991);
    };
  };
  return $module;
})(); // end of module Money
let Limit = (function() {
  let $module = {};

  $module.__default = class __default {
    constructor () {
      this._tname = "Limit._default";
    }
    _parentTraits() {
      return [];
    }
    static PlainShape(s) {
      return ((((((new BigNumber(4)).isLessThanOrEqualTo(new BigNumber((s).length))) && ((new BigNumber((s).length)).isLessThanOrEqualTo(new BigNumber(12)))) && (((s)[(new BigNumber((s).length)).minus(new BigNumber(3))]).isEqualTo(Text.__default.DOT))) && (Text.__default.IsDigit((s)[(new BigNumber((s).length)).minus(new BigNumber(2))]))) && (Text.__default.IsDigit((s)[(new BigNumber((s).length)).minus(_dafny.ONE)]))) && (Text.__default.AllDigits((s).slice(0, (new BigNumber((s).length)).minus(new BigNumber(3)))));
    };
    static PlainCents(s) {
      if (Limit.__default.PlainShape(s)) {
        return Text.Option.create_Some(((Text.__default.DigitsValue((s).slice(0, (new BigNumber((s).length)).minus(new BigNumber(3))))).multipliedBy(new BigNumber(100))).plus(Money.__default.FracValue(s)));
      } else {
        return Text.Option.create_None();
      }
    };
    static AloneDecision(amount, currency, limitAmount, limitCurrency) {
      let _0_top = Limit.__default.PlainCents(limitAmount);
      if (((_0_top).is_None) || (((_0_top).dtor_value).isLessThanOrEqualTo(_dafny.ZERO))) {
        return Limit.Decision.create_NoLimit();
      } else {
        let _1_cents = (((amount).is_Some) ? (Limit.__default.PlainCents((amount).dtor_value)) : (Text.Option.create_None()));
        if ((((_1_cents).is_None) || (!_dafny.areEqual(currency, Text.Option.create_Some(limitCurrency)))) || (((_0_top).dtor_value).isLessThan((_1_cents).dtor_value))) {
          return Limit.Decision.create_NotWithin();
        } else {
          return Limit.Decision.create_Within();
        }
      }
    };
    static CapRefuses(cents, cap) {
      if (_dafny.areEqual(cap, _dafny.Seq.of())) {
        return Text.Option.create_Some(false);
      } else {
        let _0_c = Money.__default.ToCents(cap);
        if ((_0_c).is_None) {
          return Text.Option.create_None();
        } else {
          return Text.Option.create_Some(((_0_c).dtor_value).isLessThan(cents));
        }
      }
    };
  };

  $module.Decision = class Decision {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_NoLimit() {
      let $dt = new Decision(0);
      return $dt;
    }
    static create_NotWithin() {
      let $dt = new Decision(1);
      return $dt;
    }
    static create_Within() {
      let $dt = new Decision(2);
      return $dt;
    }
    get is_NoLimit() { return this.$tag === 0; }
    get is_NotWithin() { return this.$tag === 1; }
    get is_Within() { return this.$tag === 2; }
    static get AllSingletonConstructors() {
      return this.AllSingletonConstructors_();
    }
    static *AllSingletonConstructors_() {
      yield Decision.create_NoLimit();
      yield Decision.create_NotWithin();
      yield Decision.create_Within();
    }
    toString() {
      if (this.$tag === 0) {
        return "Limit.Decision.NoLimit";
      } else if (this.$tag === 1) {
        return "Limit.Decision.NotWithin";
      } else if (this.$tag === 2) {
        return "Limit.Decision.Within";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0;
      } else if (this.$tag === 1) {
        return other.$tag === 1;
      } else if (this.$tag === 2) {
        return other.$tag === 2;
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return Limit.Decision.create_NoLimit();
    }
    static Rtd() {
      return class {
        static get Default() {
          return Decision.Default();
        }
      };
    }
  }
  return $module;
})(); // end of module Limit
let Reference = (function() {
  let $module = {};

  $module.__default = class __default {
    constructor () {
      this._tname = "Reference._default";
    }
    _parentTraits() {
      return [];
    }
    static TermsBytes(j) {
      return Terms.__default.TermsBytes(j);
    };
    static CanonicalTerms(j) {
      return Terms.__default.CanonicalTerms(j);
    };
    static Normalize(j) {
      return Terms.__default.Normalize(j);
    };
    static CanonicalText(j) {
      return Jcs.__default.Ser(Terms.__default.Normalize(j));
    };
    static CanonicalBytes(j) {
      return Utf8.__default.Encode(Jcs.__default.Ser(Terms.__default.Normalize(j)));
    };
    static Decode(t) {
      let _source0 = Jcs.__default.ParseValue(t);
      {
        if (_source0.is_Some) {
          let _0_r = (_source0).value;
          if (_dafny.areEqual((_0_r)[1], _dafny.Seq.of())) {
            return Text.Option.create_Some((_0_r)[0]);
          } else {
            return Text.Option.create_None();
          }
        }
      }
      {
        return Text.Option.create_None();
      }
    };
    static ToCents(s) {
      return Money.__default.ToCents(s);
    };
    static FromCents(c) {
      return Money.__default.FromCentsChecked(c);
    };
    static AloneDecision(amount, currency, limitAmount, limitCurrency) {
      return Limit.__default.AloneDecision(amount, currency, limitAmount, limitCurrency);
    };
    static CapRefuses(cents, cap) {
      return Limit.__default.CapRefuses(cents, cap);
    };
  };
  return $module;
})(); // end of module Reference
let _module = (function() {
  let $module = {};

  return $module;
})(); // end of module _module
