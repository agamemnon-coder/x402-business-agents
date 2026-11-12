// A fixed clock and a counted stream of "random" bytes, the same in Node and in workerd, so that one input gives one
// set of rows and hashes in both (the golden comparison). Test harness only: nothing in the product may use it.
import { createHash } from "crypto";

const RealDate = Date;
let current = RealDate.parse("2026-11-12T10:00:00.000Z");
let counter = 0;

export function setClock(ms: number): void { current = ms; }
export function clock(): number { return current; }
export function resetRandom(): void { counter = 0; }
export function randomCount(): number { return counter; }

/** `new Date()` and `Date.now()` give the set time; every other use of Date is the real one. */
export function installClock(): void {
  if ((globalThis.Date as unknown as { fixed?: boolean }).fixed) return;
  class FixedDate extends RealDate {
    static fixed = true;
    constructor(...args: unknown[]) {
      if (args.length === 0) super(current);
      else super(...(args as [number]));
    }
    static override now(): number { return current; }
    static override [Symbol.hasInstance](v: unknown): boolean { return v instanceof RealDate; }
  }
  globalThis.Date = FixedDate as unknown as DateConstructor;
}

export function detBytes(n: number): Buffer {
  const out: Buffer[] = [];
  for (let have = 0; have < n; have += 32) out.push(createHash("sha256").update(`spike-do-chain:${counter++}`).digest());
  return Buffer.concat(out).subarray(0, n);
}

export function detUuid(): string {
  const h = detBytes(16).toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function detInt(min: number, max?: number): number {
  const [lo, hi] = max === undefined ? [0, min] : [min, max];
  return lo + (detBytes(6).readUIntBE(0, 6) % (hi - lo));
}
