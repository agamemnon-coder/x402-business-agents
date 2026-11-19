// Tests written from the mutation run (docs/evidence/mutation-testing.md, `npm run mutation`), group "verifier": each
// one fails on a mutant that survived the existing tests (a condition dropped, an operator or boundary changed, a check
// forced to pass) and passes on the code as it is. The offline receipt verifier (src/try/receipt.ts, mutated by
// Stryker) and the proof-bundle verifier /verify runs (PROOF_VERIFY_JS in src/proof/bundle.ts, mutated by
// scripts/mutation-proof-verifier.ts). Offline: no network, no key; signatures are made here with a key of the test's own.
import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { CHAIN_START, RECEIPT_FORMAT, canonicalTerms, chainRowCanonical, receiptOrigin, verifyReceipt, type ChainRowOf, type TryReceipt } from "../src/try/receipt.js";
import { verifyProofBundle, type ProofBundle, type ProofResult } from "../src/proof/bundle.js";

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest();
const hex = (b: Buffer | string) => sha(b).toString("hex");
const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const failedOf = (r: { checks: { check: string; ok: boolean }[] }) => r.checks.filter((c) => !c.ok).map((c) => c.check);
const detailOf = (r: { checks: { check: string; detail: string }[] }, check: string) => r.checks.find((c) => c.check === check)?.detail;

/** A P-256 key of our own, so a test can sign exactly the authenticator data and client data it needs. */
function es256(): { key: KeyObject; x: string; y: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  return { key: privateKey, x: jwk.x, y: jwk.y };
}
const authData = (rpId: string, flags = 0x05) => Buffer.concat([sha(rpId), Buffer.from([flags]), Buffer.from([0, 0, 0, 1])]);
function assertion(key: KeyObject, ad: Buffer, client: Record<string, unknown>) {
  const cdj = Buffer.from(JSON.stringify(client));
  const sig = sign("sha256", Buffer.concat([ad, sha(cdj)]), { key, dsaEncoding: "der" });
  return { authenticatorData: b64u(ad), clientDataJSON: b64u(cdj), signature: b64u(sig) };
}

describe("the offline receipt verifier (src/try/receipt.ts)", () => {
  const RP = "purser.example";
  const ORIGIN = "https://purser.example";
  const k = es256();
  const TERMS = { schema: "kit11.try-terms/v3", proposal_id: "T-0001", amount: "10.00", currency: "EUR", test_world: "w-1" };
  /** A receipt valid in every check, signed here; o changes what is signed. */
  function receipt(o: { terms?: Record<string, unknown>; client?: Record<string, unknown>; ad?: Buffer } = {}): TryReceipt {
    const terms = o.terms ?? TERMS;
    const h = hex(canonicalTerms(terms));
    const client = { type: "webauthn.get", challenge: Buffer.from(h, "hex").toString("base64url"), origin: ORIGIN, crossOrigin: false, ...o.client };
    return {
      receipt: RECEIPT_FORMAT, note: "test", terms, terms_sha256: h, algorithm: "ES256", public_key: { kty: "EC", crv: "P-256", x: k.x, y: k.y },
      credential_id: "c1", rp_id: RP, origin: ORIGIN, assertion: assertion(k.key, o.ad ?? authData(RP), client),
    };
  }

  it("a receipt signed here verifies (the baseline the cases below change one thing in)", () => {
    expect(failedOf(verifyReceipt(receipt()))).toEqual([]);
    expect(verifyReceipt(receipt()).ok).toBe(true);
  });

  it("canonical JSON separates array items with commas, as RFC 8785 does", () => {
    expect(canonicalTerms({ b: [], a: ["x", "y", ["z", "w"]] })).toBe('{"a":["x","y",["z","w"]],"b":[]}');
  });

  it("anything not shaped as a receipt fails the format check alone, and never throws", () => {
    const good = receipt();
    const bad: [string, unknown][] = [
      ["null", null], ["empty", {}], ["another format", { ...good, receipt: "purser.try-sign-receipt/v0" }],
      ["hash not a string", { ...good, terms_sha256: [good.terms_sha256] }],
      ["junk before the hash", { ...good, terms_sha256: `x${good.terms_sha256}` }], ["junk after the hash", { ...good, terms_sha256: `${good.terms_sha256}x` }],
      ["rp id a number", { ...good, rp_id: 5 }], ["origin a number", { ...good, origin: 5 }],
      ["signature not base64url", { ...good, assertion: { ...good.assertion, signature: "not base64url!" } }],
      ["authenticator data a number", { ...good, assertion: { ...good.assertion, authenticatorData: 7 } }],
      ["client data missing", { ...good, assertion: { ...good.assertion, clientDataJSON: undefined } }],
      ["an RSA key", { ...good, public_key: { ...good.public_key, kty: "RSA" } }], ["another curve", { ...good, public_key: { ...good.public_key, crv: "P-384" } }],
      ["x not a string", { ...good, public_key: { ...good.public_key, x: 1 } }], ["y not a string", { ...good, public_key: { ...good.public_key, y: 1 } }],
    ];
    for (const [what, r] of bad) {
      let out: ReturnType<typeof verifyReceipt> | undefined;
      expect(() => { out = verifyReceipt(r); }, what).not.toThrow();
      expect(out!.ok, what).toBe(false);
      expect(out!.checks.map((c) => [c.check, c.ok]), what).toEqual([["format", false]]);
    }
  });

  it("client data that is not JSON fails as such", () => {
    const r = receipt();
    r.assertion.clientDataJSON = b64u("not json");
    const out = verifyReceipt(r);
    expect(failedOf(out)).toEqual(["client data", "signature"]);
    expect(detailOf(out, "client data")).toBe("the client data is not a JSON object");
  });

  it("a registration (webauthn.create) is not an assertion, even with a good signature", () => {
    const out = verifyReceipt(receipt({ client: { type: "webauthn.create" } }));
    expect(failedOf(out)).toEqual(["ceremony"]);
    expect(detailOf(out, "ceremony")).toBe("not an assertion (webauthn.create)");
  });

  it("an assertion made inside a frame on another site fails the origin check", () => {
    const out = verifyReceipt(receipt({ client: { crossOrigin: true } }));
    expect(failedOf(out)).toEqual(["origin"]);
    expect(detailOf(out, "origin")).toBe(`made on ${ORIGIN} inside a frame, not ${ORIGIN}`);
  });

  it("authenticator data under 37 bytes is too short to read, and its flags are not read", () => {
    const out = verifyReceipt(receipt({ ad: authData(RP).subarray(0, 36) }));
    expect(failedOf(out)).toEqual(["authenticator data"]);
    expect(detailOf(out, "authenticator data")).toBe("too short");
    expect(out.checks.map((c) => c.check)).not.toContain("user present");
  });

  it("user verified without user present fails user presence", () => {
    const out = verifyReceipt(receipt({ ad: authData(RP, 0x04) }));
    expect(failedOf(out)).toEqual(["user present"]);
    expect(detailOf(out, "user present")).toBe("no user presence");
  });

  it("an FX block missing its quote id, expiry or rate is not a quote", () => {
    const fx = { quote_id: "q-1", valid_to_at: "2026-11-19T10:00:00Z", client_rate: "1.1000", buy_currency: "EUR", buy_amount: "10.00", sell_currency: "USD", sell_amount: "11.00" };
    expect(failedOf(verifyReceipt(receipt({ terms: { ...TERMS, fx } })))).toEqual([]);
    for (const drop of ["quote_id", "valid_to_at", "client_rate"] as const) {
      const { [drop]: _gone, ...rest } = fx;
      const out = verifyReceipt(receipt({ terms: { ...TERMS, fx: rest } }));
      expect(failedOf(out), drop).toEqual(["fx quote"]);
      expect(detailOf(out, "fx quote"), drop).toBe("the terms' fx block is not a quote");
    }
  });

  describe("the world's hash chain", () => {
    const row = (seq: number, prev: string, o: Partial<ChainRowOf> = {}): ChainRowOf => {
      const base = { seq, at: `2026-11-19T10:00:0${seq}Z`, kind: "note", data_sha256: hex(`row ${seq}`), prev, ...o };
      return { ...base, hash: o.hash ?? hex(chainRowCanonical(base as Omit<ChainRowOf, "hash">)) };
    };
    const signatureData = (r: TryReceipt) => hex(canonicalTerms({ proposal_id: r.terms.proposal_id, terms_sha256: r.terms_sha256 }));
    const chainOf = (rows: ChainRowOf[]) => ({ length: rows.length, head: rows.length ? rows[rows.length - 1]!.hash : null, rows });
    const withChain = (rows: ChainRowOf[] | null, chain?: unknown) => {
      const r = receipt();
      r.chain = (chain ?? chainOf(rows!)) as TryReceipt["chain"];
      return r;
    };
    const signed = (r: TryReceipt) => {
      const one = row(1, CHAIN_START);
      return [one, row(2, one.hash, { kind: "signature", data_sha256: signatureData(r) })];
    };

    it("a chain with a row recording this signature passes", () => {
      const r = receipt();
      r.chain = chainOf(signed(r));
      expect(failedOf(verifyReceipt(r))).toEqual([]);
    });

    it("a chain without rows fails, and never throws", () => {
      for (const c of [{}, { rows: "abc", length: 3, head: null }]) {
        const out = verifyReceipt(withChain(null, c));
        expect(failedOf(out)).toEqual(["chain"]);
        expect(detailOf(out, "chain")).toBe("the chain has no rows");
      }
    });

    it("a row whose fields are not strings is not a chain row, even when its hash covers them", () => {
      for (const field of ["at", "kind", "data_sha256"] as const) {
        const out = verifyReceipt(withChain([row(1, CHAIN_START, { [field]: 5 } as Partial<ChainRowOf>)]));
        expect(detailOf(out, "chain"), field).toBe("row 1 is not a chain row");
      }
      const out = verifyReceipt(withChain([row(1, CHAIN_START, { hash: 5 } as unknown as Partial<ChainRowOf>)]));
      expect(detailOf(out, "chain")).toBe("row 1 is not a chain row");
    });

    it("a row that does not follow the one before fails, though its own hash is right", () => {
      const one = row(1, CHAIN_START);
      const out = verifyReceipt(withChain([one, row(2, "f".repeat(64))]));
      expect(failedOf(out)).toEqual(["chain"]);
      expect(detailOf(out, "chain")).toBe("row 2 does not follow the row before (its prev is not that row's hash)");
    });

    it("a chain whose length is not its rows' fails", () => {
      const one = row(1, CHAIN_START);
      const out = verifyReceipt(withChain(null, { ...chainOf([one]), length: 2 }));
      expect(detailOf(out, "chain")).toBe("the chain's length or head is not its rows'");
    });

    it("only a signature row over this proposal and hash records the signature", () => {
      const r = receipt();
      const one = row(1, CHAIN_START);
      for (const two of [row(2, one.hash, { kind: "note", data_sha256: signatureData(r) }), row(2, one.hash, { kind: "signature", data_sha256: hex("another") })]) {
        r.chain = chainOf([one, two]);
        const out = verifyReceipt(r);
        expect(failedOf(out)).toEqual(["chain signature"]);
      }
    });
  });

  it("the platform end-to-end's steps are checked when the receipt carries them", () => {
    const r = { ...receipt(), e2e: { format: "something else" } };
    const out = verifyReceipt(r);
    expect(out.ok).toBe(false);
    expect(failedOf(out)).toEqual(["e2e"]);
  });

  it("what a receipt is, read only from the receipt; nothing guessed", () => {
    const note = "Approved in the Airwallex sandbox with test money.";
    expect(receiptOrigin({ terms: null, note })).toBe("Airwallex sandbox approval, test money.");
    expect(receiptOrigin({ terms: null })).toBeNull();
    expect(receiptOrigin({ note: "paid with test money" })).toBeNull();
    expect(receiptOrigin({ note: "Airwallex sandbox" })).toBeNull();
    expect(receiptOrigin({ note: [note] })).toBeNull();
    expect(receiptOrigin({ note, verified_by_server_at: ["2026-11-07T10:00:00Z"] })).toBe("Airwallex sandbox approval, test money.");
    expect(receiptOrigin({ note, verified_by_server_at: "x2026-11-07T10:00:00Z" })).toBe("Airwallex sandbox approval, test money.");
    expect(receiptOrigin({ note, verified_by_server_at: "2026-11-07T10:00:00Z" })).toBe("Airwallex sandbox approval of 7 Nov, test money.");
  });
});

describe("the proof-bundle verifier (PROOF_VERIFY_JS in src/proof/bundle.ts, run by /verify and npm run verify-bundle)", () => {
  const sample = (f: string) => JSON.parse(readFileSync(new URL(`../docs/proof/${f}`, import.meta.url), "utf8")) as ProofBundle;
  const PAID = sample("try-paid.json");
  const REFUSED = sample("try-refused.json");
  const failed = (r: ProofResult) => failedOf(r);
  const k = es256();
  /** RFC 8785 for the ledger's values, as the engine hashes an entry: its prev_hash, then the canonical body. */
  const jcs = (v: unknown): string => {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(jcs).join(",")}]`;
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((x) => o[x] !== undefined).sort().map((x) => `${JSON.stringify(x)}:${jcs(o[x])}`).join(",")}}`;
  };
  const entryHash = (e: Record<string, unknown>) => {
    const { entry_hash: _h, prev_hash, ...body } = e;
    return hex(String(prev_hash) + jcs(body));
  };
  const cose = (o: { kty?: number; alg?: number; crv?: number } = {}) => b64u(Buffer.from(isoCBOR.encode(new Map<number, number | Uint8Array>([
    [1, o.kty ?? 2], [3, o.alg ?? -7], [-1, o.crv ?? 1], [-2, new Uint8Array(Buffer.from(k.x, "base64url"))], [-3, new Uint8Array(Buffer.from(k.y, "base64url"))],
  ]))));
  /** The bundle signed again with our own key, so a test controls the authenticator data, client data, key and signature. */
  function resign(b: ProofBundle, o: { flags?: number; adLen?: number; client?: Record<string, unknown>; cose?: { kty?: number; alg?: number; crv?: number }; sig?: (der: Buffer) => Buffer } = {}): ProofBundle {
    const ad = authData(b.rp_id, o.flags ?? 0x05).subarray(0, o.adLen ?? 37);
    const a = assertion(k.key, ad, { type: "webauthn.get", challenge: Buffer.from(b.terms_sha256, "hex").toString("base64url"), origin: b.origin, crossOrigin: false, ...o.client });
    b.assertion = { ...b.assertion, ...a, signature: o.sig ? b64u(o.sig(Buffer.from(a.signature, "base64url"))) : a.signature };
    b.public_key = { ...b.public_key, cose: cose(o.cose) };
    return b;
  }

  it("the committed samples verify, and so do they signed again with a key of our own (the baselines)", async () => {
    expect(failed(await verifyProofBundle(copy(PAID)))).toEqual([]);
    expect(failed(await verifyProofBundle(copy(REFUSED)))).toEqual([]);
    expect(failed(await verifyProofBundle(resign(copy(PAID))))).toEqual([]);
    expect(PAID.ledger.entries.every((e) => entryHash(e as unknown as Record<string, unknown>) === e.entry_hash)).toBe(true);
  });

  it("a file not shaped as a bundle fails the format check alone", async () => {
    for (const [what, b] of [
      ["another format name", { ...copy(PAID), format: "purser.proof-bundle/v0" }],
      ["a hash in capitals", { ...copy(PAID), terms_sha256: PAID.terms_sha256.toUpperCase() }],
      ["an empty rpId", { ...copy(PAID), rp_id: "" }],
      ["a signature not base64url", { ...copy(PAID), assertion: { ...PAID.assertion, signature: "***" } }],
    ] as const) {
      expect(failed(await verifyProofBundle(b)), what).toEqual(["format"]);
    }
  });

  it("a base64url field that cannot be decoded (a length of 4n+1, such as \"A\") fails the format check, naming the field; it never throws (fuzzing: bundle-malformed)", async () => {
    const odd = "A", odd5 = "AAAAA";
    for (const [field, b] of [
      ["assertion.authenticatorData", { ...copy(PAID), assertion: { ...PAID.assertion, authenticatorData: odd } }],
      ["assertion.signature", { ...copy(PAID), assertion: { ...PAID.assertion, signature: odd5 } }],
      ["assertion.clientDataJSON", { ...copy(PAID), assertion: { ...PAID.assertion, clientDataJSON: odd } }],
      ["public_key.cose", { ...copy(PAID), public_key: { ...PAID.public_key, cose: odd5 } }],
    ] as const) {
      let out: ProofResult | undefined;
      expect(() => { void verifyProofBundle(b).then((r) => { out = r; }); }, field).not.toThrow();
      out = await verifyProofBundle(b);
      expect(out.ok, field).toBe(false);
      expect(failed(out), field).toEqual(["format"]);
      expect(detailOf(out, "format"), field).toBe(`${field} is not base64url`);
    }
    // Anything at all is answered with a failed check, never a throw: an object with no prototype as the proposal id too.
    const bare = Object.assign(Object.create(null) as object, { x: 1 });
    for (const v of [{ ...copy(PAID), proposal_id: bare }, bare, Symbol("s"), 10n]) {
      const r = await verifyProofBundle(v);
      expect(r.ok).toBe(false);
    }
  });

  it("the terms hash is the file's own: a changed hash, a changed canonical text or a number in the terms fail", async () => {
    expect(failed(await verifyProofBundle({ ...copy(PAID), terms_sha256: "0".repeat(64) }))).toEqual(["terms hash"]);
    const spaced = await verifyProofBundle({ ...copy(PAID), canonical: `${PAID.canonical} ` });
    expect(failed(spaced)).toEqual(["terms hash"]);
    expect(detailOf(spaced, "terms hash")).toBe("the file's canonical text is not the terms' canonical JSON");
    // A number in the terms, with a hash and canonical text that match it: refused all the same (money is a string).
    const b = copy(PAID);
    b.terms = { ...b.terms, count: 1 };
    b.canonical = jcs(b.terms);
    b.terms_sha256 = hex(b.canonical);
    const out = await verifyProofBundle(resign(b));
    expect(failed(out)).toContain("terms hash");
    expect(detailOf(out, "terms hash")).toBe("the terms carry a number or another value signed terms never have");
  });

  it("client data must be an assertion (webauthn.get), not made in a frame on another site", async () => {
    expect(failed(await verifyProofBundle(resign(copy(PAID), { client: { type: "webauthn.create" } })))).toEqual(["client data"]);
    expect(failed(await verifyProofBundle(resign(copy(PAID), { client: { crossOrigin: true } })))).toEqual(["client data"]);
  });

  it("authenticator data under 37 bytes is too short for an rpId hash; presence without verification, or the reverse, fails", async () => {
    const short = await verifyProofBundle(resign(copy(PAID), { adLen: 36 }));
    expect(failed(short)).toContain("rp id");
    expect(detailOf(short, "rp id")).toBe("the authenticator data is too short");
    expect(failed(await verifyProofBundle(resign(copy(PAID), { flags: 0x04 })))).toEqual(["user verified"]);
    expect(failed(await verifyProofBundle(resign(copy(PAID), { flags: 0x01 })))).toEqual(["user verified"]);
  });

  it("an ES256 signature must be strict DER: no trailing byte, the right lengths, r and s at most 32 bytes", async () => {
    const trailing = (d: Buffer) => { const x = Buffer.concat([d, Buffer.from([0])]); x[1] = x.length - 2; return x; };
    const wrongSeqLength = (d: Buffer) => { const x = Buffer.from(d); x[1] = x[1]! + 1; return x; };
    const longR = (_d: Buffer) => {
      const r = Buffer.concat([Buffer.from([0x01]), Buffer.alloc(32, 0x11)]);
      const s = Buffer.alloc(32, 0x22);
      return Buffer.concat([Buffer.from([0x30, 4 + r.length + s.length, 0x02, r.length]), r, Buffer.from([0x02, s.length]), s]);
    };
    const raw = () => { for (;;) { const s = sign("sha256", Buffer.from("x"), { key: k.key, dsaEncoding: "ieee-p1363" }); if (s[0] !== 0x30) return s; } };
    for (const [what, sig] of [["a trailing byte", trailing], ["a wrong SEQUENCE length", wrongSeqLength], ["an r of 33 bytes", longR], ["raw r and s, not DER", raw]] as const) {
      const out = await verifyProofBundle(resign(copy(PAID), { sig }));
      expect(failed(out), what).toEqual(["signature"]);
      expect(detailOf(out, "signature"), what).toBe("the ES256 signature is not DER");
    }
  });

  it("the key must be ES256 on P-256 (or RS256): another curve, another algorithm or another key type fails", async () => {
    for (const [what, c] of [["curve P-384", { crv: 2 }], ["alg ES384", { alg: -35 }], ["key type OKP", { kty: 1 }]] as const) {
      const out = await verifyProofBundle(resign(copy(PAID), { cose: c }));
      expect(failed(out), what).toEqual(["signature"]);
      expect(detailOf(out, "signature"), what).toMatch(/^a key type this check does not know/);
    }
  });

  describe("the engine's decision", () => {
    const paidWith = (d: Partial<ProofBundle["decision"]>) => ({ ...copy(PAID), decision: { ...copy(PAID.decision), ...d } });
    it("a payment names the signed hash, sent the signed terms, with a verified signature, accepted by the executor", async () => {
      const zero = "0".repeat(64);
      for (const [what, b] of [
        ["another signed hash", paidWith({ signed_sha256: zero })],
        ["other terms sent", paidWith({ sent_sha256: zero })],
        ["paid once, other terms sent", paidWith({ outcome: "paid_once", sent_sha256: zero })],
        ["signature not verified", paidWith({ signature: { verified: false, reason: "x" } })],
        ["not accepted by the executor", paidWith({ executor: { accepted: false, said: "no" } })],
      ] as const) {
        expect(failed(await verifyProofBundle(b)), what).toEqual(["decision"]);
      }
    });
    it("a refusal must have sent other terms or found the signature bad", async () => {
      const b = copy(REFUSED);
      b.decision = { ...b.decision, sent_sha256: b.decision.signed_sha256, signature: { verified: true, reason: "x" } };
      expect(failed(await verifyProofBundle(b))).toEqual(["decision"]);
    });
    it("any other outcome (failed, expired, not signed) only has to name the signed hash", async () => {
      expect(failed(await verifyProofBundle(paidWith({ outcome: "failed", executor: { accepted: false, said: "x" } })))).toEqual([]);
    });
  });

  it("a refusal's asked terms must hash as the file says, differ from the signed ones, and be there", async () => {
    const withAsked = (asked: unknown) => ({ ...copy(REFUSED), asked }) as ProofBundle;
    expect(failed(await verifyProofBundle(withAsked({ ...REFUSED.asked, sha256: "0".repeat(64) })))).toEqual(["asked terms"]);
    expect(failed(await verifyProofBundle(withAsked({ terms: REFUSED.terms, canonical: REFUSED.canonical, sha256: REFUSED.terms_sha256 })))).toEqual(["asked terms"]);
    const missing = await verifyProofBundle(withAsked({}));
    expect(failed(missing)).toEqual(["asked terms"]);
    expect(detailOf(missing, "asked terms")).toBe("the asked terms are missing or not terms");
  });

  describe("the ledger", () => {
    it("an entry of one line does not balance, even at zero", async () => {
      const b = copy(PAID);
      b.ledger.entries[0]!.lines = [{ ...b.ledger.entries[0]!.lines[0]!, debit_cents: 0, credit_cents: 0 }];
      expect(failed(await verifyProofBundle(b))).toContain("ledger balance");
    });
    it("a payment with no entries fails; a refusal with none passes only with a real ledger head", async () => {
      const paid = await verifyProofBundle({ ...copy(PAID), ledger: { ...PAID.ledger, entries: [] } });
      expect(failed(paid)).toEqual(["ledger balance", "ledger chain"]);
      expect(failed(await verifyProofBundle({ ...copy(REFUSED), ledger: { ...REFUSED.ledger, entries: [] } }))).toEqual([]);
      expect(failed(await verifyProofBundle({ ...copy(REFUSED), ledger: { entries: [], head: "not a hash", count: 0 } }))).toEqual(["ledger chain"]);
    });
    it("an entry must cover the one before it, though its own hash is right", async () => {
      const b = copy(PAID);
      const i = b.ledger.entries.findIndex((e, n) => n > 0 && b.ledger.entries[n - 1]!.entry_id + 1 === e.entry_id);
      expect(i).toBeGreaterThan(0);
      const e = b.ledger.entries[i]!;
      e.prev_hash = "f".repeat(64);
      e.entry_hash = entryHash(e as unknown as Record<string, unknown>);
      const out = await verifyProofBundle(b);
      expect(failed(out)).toEqual(["ledger chain"]);
      expect(detailOf(out, "ledger chain")).toBe(`entry ${e.entry_id} does not cover entry ${b.ledger.entries[i - 1]!.entry_id}`);
    });
    it("a number that is not whole is refused, even when the entry's hash covers it", async () => {
      const b = copy(PAID);
      const last = b.ledger.entries[b.ledger.entries.length - 1]! as unknown as Record<string, unknown>;
      last.extra = 0.5;
      last.entry_hash = entryHash(last);
      b.ledger.head = last.entry_hash as string;
      const out = await verifyProofBundle(b);
      expect(failed(out)).toEqual(["ledger chain"]);
      expect(detailOf(out, "ledger chain")).toMatch(/a number that is not whole: 0\.5$/);
    });
    it("an error while checking is a failure, never a pass", async () => {
      const out = await verifyProofBundle({ ...copy(PAID), ledger: { ...PAID.ledger, entries: [null] } } as unknown as ProofBundle);
      expect(out.ok).toBe(false);
      expect(failed(out)).toEqual(["error"]);
    });
  });
});
