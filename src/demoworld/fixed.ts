// A fixed clock and fixed randomness for building the demo world (src/demoworld/build.ts), so two builds give the same
// bytes: the same ids, the same timestamps, the same hashes. While `fixed` runs, `new Date()` and `Date.now()` give the
// world's own time (moved on only by `clock.set`), and every random id, token and UUID comes from a counter hashed
// with the seed. Everything is put back when it ends, also when it throws.
//
// Only for a labelled test world. Nothing here is fit for a real key or a real token: the "random" bytes are public.

import { createHash } from "node:crypto";
import { createRequire, syncBuiltinESMExports } from "node:module";

export interface FixedClock {
  now(): Date;
  /** Move the world's time to this instant (never backwards: a world's records only move forward). */
  set(iso: string): Date;
  /** Move the world's time on by this many minutes. */
  tick(minutes: number): Date;
}

const RealDate = Date;
let running = false;

/** Runs `fn` with the clock fixed at `start` and all randomness derived from `seed`. One at a time: a second call while one runs throws. */
export async function fixed<T>(seed: string, start: string, fn: (clock: FixedClock) => Promise<T>): Promise<T> {
  if (running) throw new Error("a fixed world is already being built in this process: one at a time");
  let ms = RealDate.parse(start);
  if (Number.isNaN(ms)) throw new Error(`not a time: ${start}`);
  let counter = 0;
  const bytes = (n: number): Buffer => {
    const parts: Buffer[] = [];
    for (let have = 0; have < n; have += 32) parts.push(createHash("sha256").update(`${seed}:${counter++}`).digest());
    return Buffer.concat(parts).subarray(0, n);
  };
  const uuid = (): `${string}-${string}-${string}-${string}-${string}` => {
    const b = bytes(16);
    b[6] = (b[6]! & 0x0f) | 0x40;
    b[8] = (b[8]! & 0x3f) | 0x80;
    const h = b.toString("hex");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };

  const FixedDate = new Proxy(RealDate, {
    construct: (target, args: unknown[]) => (args.length ? new (target as unknown as new (...a: unknown[]) => Date)(...args) : new target(ms)),
    apply: () => new RealDate(ms).toString(),
    get: (target, key, receiver) => (key === "now" ? () => ms : Reflect.get(target, key, receiver) as unknown),
  });

  // node:crypto's own exports (what `import { randomUUID } from "node:crypto"` binds to) and the Web Crypto object.
  const nodeCrypto = createRequire(import.meta.url)("node:crypto") as Record<string, unknown>;
  const kept = { randomUUID: nodeCrypto.randomUUID, randomBytes: nodeCrypto.randomBytes, randomInt: nodeCrypto.randomInt, mathRandom: Math.random };
  const web = globalThis.crypto as unknown as Record<string, unknown>;
  const clock: FixedClock = {
    now: () => new RealDate(ms),
    set: (iso) => {
      const to = RealDate.parse(iso);
      if (Number.isNaN(to) || to < ms) throw new Error(`the world's clock only moves forward: ${iso} is before ${new RealDate(ms).toISOString()}`);
      ms = to;
      return new RealDate(ms);
    },
    tick: (minutes) => { ms += Math.round(minutes * 60_000); return new RealDate(ms); },
  };
  running = true;
  try {
    nodeCrypto.randomUUID = uuid;
    nodeCrypto.randomBytes = (n: number, cb?: (err: null, buf: Buffer) => void) => { const b = bytes(n); if (cb) { cb(null, b); return undefined; } return b; };
    nodeCrypto.randomInt = (a: number, b?: number | ((err: null, n: number) => void)) => {
      const [min, max] = typeof b === "number" ? [a, b] : [0, a];
      return min + (bytes(6).readUIntBE(0, 6) % (max - min));
    };
    syncBuiltinESMExports();
    Object.defineProperty(web, "getRandomValues", { configurable: true, value: <A extends ArrayBufferView>(a: A): A => { new Uint8Array(a.buffer, a.byteOffset, a.byteLength).set(bytes(a.byteLength)); return a; } });
    Object.defineProperty(web, "randomUUID", { configurable: true, value: uuid });
    Math.random = () => bytes(6).readUIntBE(0, 6) / 2 ** 48;
    globalThis.Date = FixedDate;
    return await fn(clock);
  } finally {
    running = false;
    globalThis.Date = RealDate;
    Math.random = kept.mathRandom;
    delete web.getRandomValues;
    delete web.randomUUID;
    nodeCrypto.randomUUID = kept.randomUUID;
    nodeCrypto.randomBytes = kept.randomBytes;
    nodeCrypto.randomInt = kept.randomInt;
    syncBuiltinESMExports();
  }
}
