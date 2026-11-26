// Purser's transparency log entries (src/transparency/): the hashedrekord entry it proposes, the offline checks of what
// Rekor returns (the SET, the inclusion proof, the checkpoint), each with its tamper cases, the key handling (never in
// the repo, never in an error or a record), and the HTTP client against a mocked fetch. The log here is a fake one built
// in the test with its own key, the way Rekor builds its answers (RFC 6962 tree, RFC 8785 SET payload, signed-note
// checkpoint); nothing here touches the network. Any entry committed under docs/transparency/entries/ is checked
// against the committed keys too.
import { createHash, createPublicKey, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { hashedRekord, httpRekor, keyId, leafHash, parseCheckpoint, readBody, rootFromInclusion, setPayload, verifyCheckpoint, verifySet, type HashedRekordBody, type LogTrust, type RekorClient, type RekorEntry } from "../src/transparency/rekor.js";
import { artifactOf, entryFiles, generateKeyFile, KEY_ENV, KEY_FILE_ENV, loadSigner, proposeEntry, publish, readEntry, readPurserKey, rekorTrust, statementFromRepo, TransparencyError, verifyEntry, type EntryRecord } from "../src/transparency/transparency.js";

const ROOT = process.cwd();
const sha = (b: Buffer) => createHash("sha256").update(b).digest();
const node = (l: Buffer, r: Buffer) => sha(Buffer.concat([Buffer.from([1]), l, r]));
/** RFC 6962 MTH over leaf hashes, and PATH(m, D[n]): the reference the verifier is checked against. */
const mth = (h: Buffer[]): Buffer => { if (h.length === 1) return h[0]!; let k = 1; while (k * 2 < h.length) k *= 2; return node(mth(h.slice(0, k)), mth(h.slice(k))); };
const path = (m: number, h: Buffer[]): Buffer[] => {
  if (h.length <= 1) return [];
  let k = 1; while (k * 2 < h.length) k *= 2;
  return m < k ? [...path(m, h.slice(0, k)), mth(h.slice(k))] : [...path(m - k, h.slice(k)), mth(h.slice(0, k))];
};
const ecKey = () => generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pemOf = (k: KeyObject) => k.export({ type: "spki", format: "pem" }).toString();

/** A fake Rekor: its own key, a tree of leaves, answers built the way the log builds them. */
function fakeLog(origin = "fake.rekor.test", pre = 9, keys = ecKey()) {
  const trust: LogTrust = { publicKeyPem: pemOf(keys.publicKey), origin };
  const logID = keyId(trust.publicKeyPem);
  const leaves: Buffer[] = Array.from({ length: pre }, (_, i) => sha(Buffer.from(`other entry ${i}`)));
  const proposed: HashedRekordBody[] = [];
  const checkpoint = (size: number, root: Buffer, signer = keys.privateKey, name = origin, hint = logID.slice(0, 8)) => {
    const body = `${origin} - 2605736670972794746\n${size}\n${root.toString("base64")}\n`;
    const sig = sign("sha256", Buffer.from(body), signer);
    return `${body}\n— ${name} ${Buffer.concat([Buffer.from(hint, "hex"), sig]).toString("base64")}\n`;
  };
  const client: RekorClient = {
    url: "https://fake.rekor.test",
    async createEntry(b) {
      proposed.push(b);
      const body = Buffer.from(JSON.stringify(b)).toString("base64");
      const index = leaves.length;
      leaves.push(Buffer.from(leafHash(body), "hex"));
      leaves.push(sha(Buffer.from("a later entry")));
      const size = index + 1, root = mth(leaves.slice(0, size));
      const e = { body, integratedTime: 1795000000, logID, logIndex: 123_000_000 + index };
      const entry: RekorEntry = {
        ...e,
        verification: {
          signedEntryTimestamp: sign("sha256", setPayload(e), keys.privateKey).toString("base64"),
          inclusionProof: { logIndex: index, treeSize: size, rootHash: root.toString("hex"), hashes: path(index, leaves.slice(0, size)).map((x) => x.toString("hex")), checkpoint: checkpoint(size, root) },
        },
      };
      return { uuid: `24296fb24b8ad77a${leafHash(body)}`, entry };
    },
  };
  return { trust, client, keys, proposed, checkpoint, leaves };
}

const signer = ecKey();
const SIGNER_PEM = pemOf(signer.publicKey);
const tmp = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "transparency-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

async function goodRecord(log = fakeLog()) {
  const r = await publish(ROOT, signer.privateKey, log.client, log.trust, { purserKeyPem: SIGNER_PEM, now: new Date("2026-11-26T12:00:00Z") });
  return { r, log, trust: { purserKeyPem: SIGNER_PEM, log: log.trust } };
}
const clone = (r: EntryRecord): EntryRecord => JSON.parse(JSON.stringify(r)) as EntryRecord;
const failed = (c: { lines: { ok: boolean; what: string }[] }) => c.lines.filter((l) => !l.ok).map((l) => l.what);

describe("the hashedrekord entry", () => {
  it("is Rekor's hashedrekord v0.0.1: the digest, the signature and the PEM public key in base64", () => {
    const b = hashedRekord("ab".repeat(32), "c2ln", SIGNER_PEM);
    expect(b).toEqual({ apiVersion: "0.0.1", kind: "hashedrekord", spec: { data: { hash: { algorithm: "sha256", value: "ab".repeat(32) } }, signature: { content: "c2ln", publicKey: { content: Buffer.from(SIGNER_PEM).toString("base64") } } } });
    expect(readBody(Buffer.from(JSON.stringify(b)).toString("base64"))).toEqual(b);
    expect(() => hashedRekord("xyz", "c2ln", SIGNER_PEM)).toThrow(/64 hex/);
    expect(readBody(Buffer.from(JSON.stringify({ ...b, kind: "rekord" })).toString("base64"))).toBeNull();
  });

  it("signs the statement's canonical JSON, whose SHA-256 is the entry's hash", () => {
    const s = statementFromRepo(ROOT);
    const { artifactSha256, body } = proposeEntry(s, signer.privateKey, SIGNER_PEM);
    expect(artifactSha256).toBe(createHash("sha256").update(artifactOf(s)).digest("hex"));
    expect(body.spec.data.hash.value).toBe(artifactSha256);
    expect(createPublicKey(SIGNER_PEM).asymmetricKeyType).toBe("ec");
  });

  it("states the anchor head recomputed from the repo, the one the latest Alta anchor carries", () => {
    const s = statementFromRepo(ROOT);
    const rec = JSON.parse(readFileSync(join(ROOT, s.anchor.record), "utf8")) as { head: string; height: number; tx: string; chain_id: number };
    expect(s.anchor).toMatchObject({ schema: "purser.anchor/v1", head: rec.head, height: rec.height, tx: rec.tx, chain_id: rec.chain_id });
    expect(s.manifests).toEqual([]);
    expect(statementFromRepo(ROOT, { manifests: ["docs/transparency/purser-transparency.pub"] }).manifests[0]!.sha256).toBe(createHash("sha256").update(readFileSync(join(ROOT, PURSER_PUB))).digest("hex"));
    expect(() => statementFromRepo(ROOT, { manifests: ["../etc/passwd"] })).toThrow(TransparencyError);
    expect(() => statementFromRepo(ROOT, { manifests: ["package.json"] })).toThrow(/under docs/);
  });
});
const PURSER_PUB = "docs/transparency/purser-transparency.pub";

describe("the inclusion proof (RFC 9162 2.1.3.2)", () => {
  it("leads every leaf of every tree up to 33 leaves to the tree's root, as RFC 6962 computes it", () => {
    for (let n = 1; n <= 33; n++) {
      const leaves = Array.from({ length: n }, (_, i) => sha(Buffer.from(`leaf ${i}`)));
      const root = mth(leaves).toString("hex");
      for (let m = 0; m < n; m++) expect(rootFromInclusion(leaves[m]!.toString("hex"), m, n, path(m, leaves).map((x) => x.toString("hex"))), `${m}/${n}`).toBe(root);
    }
  });

  it("refuses a path too short or too long, an index outside the tree, or a malformed hash", () => {
    const leaves = Array.from({ length: 11 }, (_, i) => sha(Buffer.from(`leaf ${i}`)));
    const p = path(5, leaves).map((x) => x.toString("hex")), leaf = leaves[5]!.toString("hex"), root = mth(leaves).toString("hex");
    expect(rootFromInclusion(leaf, 5, 11, p)).toBe(root);
    expect(rootFromInclusion(leaf, 5, 11, p.slice(1))).not.toBe(root);
    expect(rootFromInclusion(leaf, 5, 11, [...p, p[0]!])).toBeNull();
    expect(rootFromInclusion(leaf, 11, 11, p)).toBeNull();
    expect(rootFromInclusion(leaf, -1, 11, p)).toBeNull();
    expect(rootFromInclusion(leaf, 5, 11, [...p.slice(1), "zz"])).toBeNull();
    expect(rootFromInclusion(leaf, 4, 11, p)).not.toBe(root);
  });
});

describe("an entry's offline check", () => {
  it("verifies a log's answer: statement, body, key, signature, SET, uuid, inclusion proof, checkpoint", async () => {
    const { r, log, trust } = await goodRecord();
    expect(log.proposed).toHaveLength(1);
    const c = verifyEntry(r, trust, ROOT);
    expect(failed(c)).toEqual([]);
    expect(c.lines.map((l) => l.what)).toEqual(["anchor head", "Alta transaction", "statement digest", "entry hash", "entry key", "entry signature", "log id", "signed entry timestamp", "entry uuid", "inclusion proof", "checkpoint", "checkpoint signature"]);
    expect(r).toMatchObject({ schema: "purser.transparency-entry/v1", log: { url: "https://fake.rekor.test", log_id: keyId(log.trust.publicKeyPem) }, signer: { key_id: keyId(SIGNER_PEM), algorithm: "ECDSA P-256 SHA-256" } });
  });

  it("fails on a statement that is not the repo's, or one changed after it was logged", async () => {
    const { r, trust } = await goodRecord();
    const t = clone(r); t.statement.anchor.head = "0".repeat(64);
    expect(failed(verifyEntry(t, trust, ROOT))).toEqual(expect.arrayContaining(["anchor head", "statement digest", "entry hash", "entry signature"]));
    const m = clone(r); m.statement.anchor.tx = `0x${"1".repeat(64)}`;
    expect(failed(verifyEntry(m, trust, ROOT))).toContain("Alta transaction");
    const d = clone(r); d.artifact_sha256 = "f".repeat(64);
    expect(failed(verifyEntry(d, trust))).toEqual(["statement digest"]);
  });

  it("fails on a body the log did not sign: another hash, another key, another signature", async () => {
    const { r, trust } = await goodRecord();
    const body = readBody(r.entry.body)!;
    const reencode = (b: HashedRekordBody) => { const t = clone(r); t.entry.body = Buffer.from(JSON.stringify(b)).toString("base64"); return t; };
    const otherHash = reencode({ ...body, spec: { ...body.spec, data: { hash: { algorithm: "sha256", value: "e".repeat(64) } } } });
    expect(failed(verifyEntry(otherHash, trust))).toEqual(expect.arrayContaining(["entry hash", "signed entry timestamp", "entry uuid", "inclusion proof"]));
    const mallory = ecKey();
    const otherKey = reencode({ ...body, spec: { ...body.spec, signature: { content: sign("sha256", artifactOf(r.statement), mallory.privateKey).toString("base64"), publicKey: { content: Buffer.from(pemOf(mallory.publicKey)).toString("base64") } } } });
    expect(failed(verifyEntry(otherKey, trust))).toEqual(expect.arrayContaining(["entry key", "entry signature", "signed entry timestamp"]));
    // Trusting another Purser key: the logged entry is not by it.
    expect(failed(verifyEntry(r, { ...trust, purserKeyPem: pemOf(mallory.publicKey) }))).toEqual(["entry key", "entry signature"]);
    const t = clone(r); t.entry.body = "not base64 json";
    expect(failed(verifyEntry(t, trust))).toEqual(["entry body"]);
  });

  it("fails on a SET that is not the log's: altered time or index, another log's key, a wrong log id", async () => {
    const { r, trust } = await goodRecord();
    const time = clone(r); time.entry.integratedTime += 1;
    expect(failed(verifyEntry(time, trust))).toEqual(["signed entry timestamp"]);
    const index = clone(r); index.entry.logIndex += 1;
    expect(failed(verifyEntry(index, trust))).toEqual(["signed entry timestamp"]);
    const other = fakeLog("fake.rekor.test");
    expect(failed(verifyEntry(r, { ...trust, log: other.trust }))).toEqual(expect.arrayContaining(["log id", "signed entry timestamp", "checkpoint signature"]));
    expect(verifySet({ ...r.entry, verification: { ...r.entry.verification, signedEntryTimestamp: "" } }, trust.log)).toBe(false);
  });

  it("fails on an inclusion proof that does not reach the root, and on a checkpoint that does not name it or is not signed", async () => {
    const { r, log, trust } = await goodRecord();
    const p = r.entry.verification.inclusionProof!;
    const hash = clone(r); hash.entry.verification.inclusionProof!.hashes[0] = "0".repeat(64);
    expect(failed(verifyEntry(hash, trust))).toEqual(["inclusion proof"]);
    const root = clone(r); root.entry.verification.inclusionProof!.rootHash = "0".repeat(64);
    expect(failed(verifyEntry(root, trust))).toEqual(["inclusion proof", "checkpoint"]);
    const none = clone(r); delete none.entry.verification.inclusionProof;
    expect(failed(verifyEntry(none, trust))).toEqual(["inclusion proof"]);
    // A checkpoint for another tree, though signed by the log.
    const size = clone(r); size.entry.verification.inclusionProof!.checkpoint = log.checkpoint(p.treeSize + 1, Buffer.from(p.rootHash, "hex"));
    expect(failed(verifyEntry(size, trust))).toEqual(["checkpoint"]);
    // The right tree, signed by another key, under the log's name or with the wrong key hint.
    const forged = clone(r); forged.entry.verification.inclusionProof!.checkpoint = log.checkpoint(p.treeSize, Buffer.from(p.rootHash, "hex"), ecKey().privateKey);
    expect(failed(verifyEntry(forged, trust))).toEqual(["checkpoint signature"]);
    const hint = clone(r); hint.entry.verification.inclusionProof!.checkpoint = log.checkpoint(p.treeSize, Buffer.from(p.rootHash, "hex"), log.keys.privateKey, log.trust.origin, "00000000");
    expect(failed(verifyEntry(hint, trust))).toEqual(["checkpoint signature"]);
    const body = clone(r); body.entry.verification.inclusionProof!.checkpoint = p.checkpoint.replace("\n\n", "\nan unsigned extra line\n\n");
    expect(failed(verifyEntry(body, trust))).toEqual(["checkpoint signature"]);
    expect(parseCheckpoint("no blank line")).toBeNull();
    expect(verifyCheckpoint(parseCheckpoint(p.checkpoint)!, { ...trust.log, origin: "rekor.sigstore.dev" })).toBe(false);
    const uuid = clone(r); uuid.uuid = `24296fb24b8ad77a${"0".repeat(64)}`;
    expect(failed(verifyEntry(uuid, trust))).toEqual(["entry uuid"]);
  });

  it("refuses to keep a log's answer that does not verify", async () => {
    const log = fakeLog();
    const bad: RekorClient = { url: log.client.url, async createEntry(b) { const x = await log.client.createEntry(b); x.entry.integratedTime += 5; return x; } };
    await expect(publish(ROOT, signer.privateKey, bad, log.trust, { purserKeyPem: SIGNER_PEM })).rejects.toThrow(/does not verify: signed entry timestamp/);
  });
});

describe("the transparency key", () => {
  const committed = readPurserKey(ROOT);
  it("has its public half committed, ECDSA P-256, and no private key anywhere under docs/transparency", () => {
    const k = createPublicKey(committed);
    expect(k.asymmetricKeyType).toBe("ec");
    expect(k.asymmetricKeyDetails?.namedCurve).toBe("prime256v1");
    const walk = (d: string): string[] => existsSync(d) ? (readdirOf(d)).flatMap((n) => (n.dir ? walk(join(d, n.name)) : [join(d, n.name)])) : [];
    for (const f of [...walk(join(ROOT, "docs/transparency")), ...walk(join(ROOT, "src/transparency"))]) expect(readFileSync(f, "utf8"), f).not.toMatch(/PRIVATE KEY/);
  });

  it("commits Rekor's production key, whose id is Rekor's log id", () => {
    expect(keyId(rekorTrust(ROOT).publicKeyPem)).toBe("c0d23d6ad406973f9559f3ba2d1ca01f84147d8ffc5b8445c224f98b9591801d");
  });

  it("is read from the environment or a 0600 file outside the repo, must match the committed public key, and is never quoted", () => {
    const k = ecKey(), pem = k.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const body = pem.split("\n")[1]!;
    const msg = (f: () => unknown) => { try { f(); return ""; } catch (e) { return (e as Error).message; } };
    expect(msg(() => loadSigner(ROOT, {}))).toMatch(new RegExp(`${KEY_ENV} or ${KEY_FILE_ENV}`));
    const wrong = msg(() => loadSigner(ROOT, { [KEY_ENV]: pem }));
    expect(wrong).toMatch(/is not the key whose public half/);
    expect(wrong).not.toContain(body);
    expect(msg(() => loadSigner(ROOT, { [KEY_ENV]: "-----BEGIN PRIVATE KEY-----\nnonsense\n-----END PRIVATE KEY-----" }))).toBe(`${KEY_ENV} holds no private key`);
    const ed = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    expect(msg(() => loadSigner(ROOT, { [KEY_ENV]: ed }))).toMatch(/not an ECDSA P-256 key/);
    // A key file: outside the repo, 0600; inside the repo or readable by others, refused.
    const loose = join(tmp, "loose.pem"); writeFileSync(loose, pem); chmodSync(loose, 0o644);
    expect(msg(() => loadSigner(ROOT, { [KEY_FILE_ENV]: loose }))).toMatch(/readable by others/);
    expect(msg(() => loadSigner(ROOT, { [KEY_FILE_ENV]: join(ROOT, "package.json") }))).toMatch(/inside the repository/);
    expect(msg(() => loadSigner(ROOT, { [KEY_FILE_ENV]: join(tmp, "none.pem") }))).toMatch(/no key file/);
    // The happy path, in a root of its own whose committed public key is this key's.
    const root = join(tmp, "root"); mkdirSync(join(root, "docs/transparency"), { recursive: true });
    writeFileSync(join(root, PURSER_PUB), pemOf(k.publicKey));
    const file = join(tmp, "key.pem"); writeFileSync(file, pem, { mode: 0o600 });
    expect(loadSigner(root, { [KEY_FILE_ENV]: file }).asymmetricKeyType).toBe("ec");
    expect(loadSigner(root, { [KEY_ENV]: pem }).asymmetricKeyType).toBe("ec");
  });

  it("keygen writes the private key 0600 outside the repo and never over a file; the public key only with --replace", () => {
    const root = join(tmp, "kg"); mkdirSync(root, { recursive: true });
    const out = join(tmp, "keys", "t.key.pem");
    const id = generateKeyFile(root, out);
    expect(id).toBe(keyId(readFileSync(join(root, PURSER_PUB), "utf8")));
    expect(readFileSync(out, "utf8")).toMatch(/BEGIN PRIVATE KEY/);
    expect(statMode(out)).toBe(0o600);
    expect(() => generateKeyFile(root, out)).toThrow(/not overwritten/);
    expect(() => generateKeyFile(root, join(tmp, "keys", "u.key.pem"))).toThrow(/--replace/);
    expect(() => generateKeyFile(root, join(root, "in-repo.key.pem"), { replace: true })).toThrow(/inside the repository/);
    expect(readFileSync(join(root, PURSER_PUB), "utf8")).not.toMatch(/PRIVATE/);
  });

  it("is in no record: the entry record holds the public key only", async () => {
    const { r } = await goodRecord();
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/PRIVATE KEY/);
    expect(text).not.toContain(signer.privateKey.export({ type: "pkcs8", format: "pem" }).toString().split("\n")[1]!);
  });
});

describe("Rekor's REST API (mocked)", () => {
  const entry = (proof = true) => ({ body: "e30=", integratedTime: 1, logID: "a".repeat(64), logIndex: 7, verification: { signedEntryTimestamp: "c2V0", ...(proof ? { inclusionProof: { checkpoint: "", hashes: [], logIndex: 0, rootHash: "b".repeat(64), treeSize: 1 } } : {}) } });
  const uuid = `24296fb24b8ad77a${"c".repeat(64)}`;

  it("POSTs the entry as JSON to /api/v1/log/entries and reads the one entry back from a 201", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const client = httpRekor("https://rekor.example", (async (url: string, init?: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ [uuid]: entry() }), { status: 201 }); }) as typeof fetch);
    const b = hashedRekord("ab".repeat(32), "c2ln", SIGNER_PEM);
    const got = await client.createEntry(b);
    expect(got.uuid).toBe(uuid);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://rekor.example/api/v1/log/entries");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual(b);
  });

  it("reads the entry back by its uuid when the answer has no proof, and on 409 from Location", async () => {
    const urls: string[] = [];
    const f = (first: Response) => (async (url: string) => { urls.push(url); return urls.length === 1 ? first : new Response(JSON.stringify({ [uuid]: entry() }), { status: 200 }); }) as typeof fetch;
    expect((await httpRekor("https://rekor.example", f(new Response(JSON.stringify({ [uuid]: entry(false) }), { status: 201 }))).createEntry(hashedRekord("ab".repeat(32), "c2ln", SIGNER_PEM))).entry.verification.inclusionProof).toBeTruthy();
    expect(urls[1]).toBe(`https://rekor.example/api/v1/log/entries/${uuid}`);
    urls.length = 0;
    await httpRekor("https://rekor.example", f(new Response("{}", { status: 409, headers: { location: `/api/v1/log/entries/${uuid}` } }))).createEntry(hashedRekord("ab".repeat(32), "c2ln", SIGNER_PEM));
    expect(urls[1]).toBe(`https://rekor.example/api/v1/log/entries/${uuid}`);
  });

  it("says only the status on an error, never the log's body", async () => {
    const client = httpRekor("https://rekor.example", (async () => new Response("secret-looking detail", { status: 400 })) as typeof fetch);
    await expect(client.createEntry(hashedRekord("ab".repeat(32), "c2ln", SIGNER_PEM))).rejects.toThrow(/^POST entry: HTTP 400$/);
    const down = httpRekor("https://rekor.example", (async () => { throw new Error("https://rekor.example/?token=x"); }) as typeof fetch);
    await expect(down.createEntry(hashedRekord("ab".repeat(32), "c2ln", SIGNER_PEM))).rejects.toThrow(/^the log did not answer$/);
  });
});

describe("the committed entries", () => {
  it("each verifies offline against the committed keys and this repo", () => {
    const trust = { purserKeyPem: readPurserKey(ROOT), log: rekorTrust(ROOT) };
    for (const f of entryFiles(ROOT)) {
      const r = readEntry(f);
      expect(failed(verifyEntry(r, trust, ROOT)), f).toEqual([]);
      expect(r.log.url).toBe("https://rekor.sigstore.dev");
    }
  });
});

function readdirOf(d: string) { return readdirSync(d, { withFileTypes: true }).map((e) => ({ name: e.name, dir: e.isDirectory() })); }
function statMode(f: string) { return statSync(f).mode & 0o777; }
