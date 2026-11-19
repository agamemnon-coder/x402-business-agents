// Loads the JavaScript that Dafny 4.11.0 translated from the verified functions in formal/dafny/Reference.dfy
// (formal/dafny/out/reference.js, checked against the proofs by `npm run formal:dafny`), for the differential test
// (test/formal-dafny-differential.test.ts).
//
// Dafny's JavaScript runtime represents an `int` with the npm package bignumber.js, which this repository does not
// depend on. It uses only integer operations of it, so it gets the small class below instead: the same methods, on
// native BigInt, exact by construction. Dafny's own division and modulo are Euclidean and built from these in its
// runtime (EuclideanDivision); this class supplies what bignumber.js does: dividedToIntegerBy truncates, and mod, with
// the MODULO_MODE EUCLID that the runtime configures, is never negative. test/formal-dafny-differential.test.ts checks
// those two against their definitions.
import { readFileSync } from "node:fs";

type Num = BigNumber | number | string | bigint;

function big(x: Num): bigint {
  if (x instanceof BigNumber) return x.v;
  if (typeof x === "bigint") return x;
  if (typeof x === "number") {
    if (!Number.isSafeInteger(x)) throw new Error(`Dafny reference: not a safe integer: ${x}`);
    return BigInt(x);
  }
  if (!/^-?\d+$/.test(x)) throw new Error(`Dafny reference: not an integer: ${JSON.stringify(x)}`);
  return BigInt(x);
}

export class BigNumber {
  static readonly EUCLID = 9;
  readonly v: bigint;
  constructor(x: Num) {
    this.v = big(x);
  }
  static config(c: { MODULO_MODE?: number }): void {
    if (c.MODULO_MODE !== BigNumber.EUCLID) throw new Error("Dafny reference: only MODULO_MODE EUCLID is supported");
  }
  static isBigNumber(x: unknown): x is BigNumber {
    return x instanceof BigNumber;
  }
  plus(o: Num): BigNumber { return new BigNumber(this.v + big(o)); }
  minus(o: Num): BigNumber { return new BigNumber(this.v - big(o)); }
  multipliedBy(o: Num): BigNumber { return new BigNumber(this.v * big(o)); }
  /** Truncates toward zero, as bignumber.js's dividedToIntegerBy (BigInt division does the same). */
  dividedToIntegerBy(o: Num): BigNumber {
    const d = big(o);
    if (d === 0n) throw new Error("Dafny reference: division by zero");
    return new BigNumber(this.v / d);
  }
  /** MODULO_MODE EUCLID: the remainder is never negative. */
  mod(o: Num): BigNumber {
    const d = big(o);
    if (d === 0n) throw new Error("Dafny reference: modulo by zero");
    const r = this.v % d;
    return new BigNumber(r < 0n ? r + (d < 0n ? -d : d) : r);
  }
  modulo(o: Num): BigNumber { return this.mod(o); }
  exponentiatedBy(o: Num): BigNumber { return new BigNumber(this.v ** big(o)); }
  negated(): BigNumber { return new BigNumber(-this.v); }
  abs(): BigNumber { return new BigNumber(this.v < 0n ? -this.v : this.v); }
  isZero(): boolean { return this.v === 0n; }
  isEqualTo(o: Num): boolean { return this.v === big(o); }
  isLessThan(o: Num): boolean { return this.v < big(o); }
  isLessThanOrEqualTo(o: Num): boolean { return this.v <= big(o); }
  isGreaterThan(o: Num): boolean { return this.v > big(o); }
  isGreaterThanOrEqualTo(o: Num): boolean { return this.v >= big(o); }
  toNumber(): number {
    const n = Number(this.v);
    if (!Number.isSafeInteger(n)) throw new Error(`Dafny reference: ${this.v} is not a safe integer`);
    return n;
  }
  toFixed(): string { return this.v.toString(); }
  toString(): string { return this.v.toString(); }
  /** Array indices and slice bounds: the runtime passes BigNumbers where JavaScript wants a number or a key. */
  valueOf(): string { return this.v.toString(); }
}

/** A Dafny sequence: a JavaScript array with Dafny's methods. */
export type DSeq<T> = T[];
export interface DOption<T> { is_None: boolean; is_Some: boolean; dtor_value: T }
/** Dafny's model of a JSON value (Jcs.Json in formal/dafny/Jcs.dfy). */
export interface DJson { is_JNull: boolean; is_JBool: boolean; is_JStr: boolean; is_JArr: boolean; is_JObj: boolean; equals(o: DJson): boolean }
export interface DDecision { is_NoLimit: boolean; is_NotWithin: boolean; is_Within: boolean }
type Units = DSeq<BigNumber>;

export interface DafnyReference {
  _dafny: { Seq: { of<T>(...xs: T[]): DSeq<T> }; Tuple: unknown };
  Text: { Option: { create_None<T>(): DOption<T>; create_Some<T>(v: T): DOption<T> } };
  Jcs: {
    Json: {
      create_JNull(): DJson;
      create_JBool(b: boolean): DJson;
      create_JStr(s: Units): DJson;
      create_JArr(items: DSeq<DJson>): DJson;
      create_JObj(members: DSeq<unknown>): DJson;
    };
    Member: { create_Member(key: Units, value: DJson): unknown };
  };
  Reference: {
    __default: {
      TermsBytes(j: DJson): DOption<DSeq<BigNumber>>;
      CanonicalTerms(j: DJson): DOption<Units>;
      CanonicalText(j: DJson): Units;
      CanonicalBytes(j: DJson): DSeq<BigNumber>;
      Normalize(j: DJson): DJson;
      Decode(t: Units): DOption<DJson>;
      ToCents(s: Units): DOption<BigNumber>;
      FromCents(c: BigNumber): DOption<Units>;
      AloneDecision(amount: DOption<Units>, currency: DOption<Units>, limitAmount: Units, limitCurrency: Units): DDecision;
      CapRefuses(cents: BigNumber, cap: Units): DOption<boolean>;
    };
  };
}

const MODULES = ["_dafny", "Text", "Jcs", "Utf8", "Terms", "Money", "Limit", "Reference"];

/** Evaluates the committed translation with the BigInt class above in place of bignumber.js. */
export function loadDafnyReference(): DafnyReference {
  const src = readFileSync(new URL("../../formal/dafny/out/reference.js", import.meta.url), "utf8");
  const requireShim = (name: string): unknown => {
    if (name === "bignumber.js") return BigNumber;
    throw new Error(`Dafny reference: unexpected require(${JSON.stringify(name)})`);
  };
  // The translation is a script of top-level `let` modules; this returns them. Nothing else is in scope.
  const evaluate = new Function("require", `"use strict";\n${src}\nreturn { ${MODULES.join(", ")} };`) as (r: typeof requireShim) => DafnyReference;
  return evaluate(requireShim);
}

// ── Converting between JavaScript values and the model's ──

export class Reference {
  readonly r: DafnyReference;
  constructor() {
    this.r = loadDafnyReference();
  }
  get fn(): DafnyReference["Reference"]["__default"] {
    return this.r.Reference.__default;
  }
  /** A JavaScript string as its UTF-16 code units. */
  units(s: string): Units {
    const out: BigNumber[] = [];
    for (let i = 0; i < s.length; i++) out.push(new BigNumber(s.charCodeAt(i)));
    return this.r._dafny.Seq.of(...out);
  }
  text(u: Units): string {
    let s = "";
    for (const c of u) s += String.fromCharCode(c.toNumber());
    return s;
  }
  bytes(b: DSeq<BigNumber>): Buffer {
    return Buffer.from(b.map((x) => x.toNumber()));
  }
  some<T>(v: T): DOption<T> {
    return this.r.Text.Option.create_Some(v);
  }
  none<T>(): DOption<T> {
    return this.r.Text.Option.create_None();
  }
  /**
   * The model of a plain JSON value without numbers, or null when the value is outside the model: a number anywhere,
   * or anything JSON.parse never gives (undefined, functions, class instances, array holes).
   */
  json(v: unknown): DJson | null {
    const J = this.r.Jcs.Json;
    if (v === null) return J.create_JNull();
    if (typeof v === "boolean") return J.create_JBool(v);
    if (typeof v === "string") return J.create_JStr(this.units(v));
    if (Array.isArray(v)) {
      const items: DJson[] = [];
      for (let i = 0; i < v.length; i++) {
        if (!(i in v)) return null;
        const m = this.json(v[i]);
        if (m === null) return null;
        items.push(m);
      }
      return J.create_JArr(this.r._dafny.Seq.of(...items));
    }
    if (typeof v === "object") {
      const proto = Object.getPrototypeOf(v) as unknown;
      if (proto !== Object.prototype && proto !== null) return null;
      const members: unknown[] = [];
      // Object.keys order, unsorted: the verified model sorts, as jcs does.
      for (const k of Object.keys(v)) {
        const m = this.json((v as Record<string, unknown>)[k]);
        if (m === null) return null;
        members.push(this.r.Jcs.Member.create_Member(this.units(k), m));
      }
      return J.create_JObj(this.r._dafny.Seq.of(...members));
    }
    return null;
  }
}
