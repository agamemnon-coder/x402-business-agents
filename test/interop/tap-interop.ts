// D25 interop test against Visa's reference at commit 16d59bd, run unchanged in CI (.github/workflows/tap-interop.yml):
// its agent registry on localhost:9002 and its CDN proxy on localhost:3001 must be running. The proxy forwards
// /product/* to localhost:3000, where this script runs our merchant: it records the raw header lines and a hash of the
// body it received, and answers with our merchant layer's verdict (200 accepted, 422 refused). Nothing of Visa's code
// is in this repo; this script talks to it over HTTP and, for the reverse direction, calls the reference agent's own
// Ed25519 signing function in a Python subprocess (TAP_REF_DIR, TAP_REF_PYTHON).
//
//   a. our agent -> Visa's verifier: a signed checkout passes the proxy (200) and our merchant accepts it; the body
//      and the signed headers arrive byte for byte;
//   b. refused by the proxy itself (403, our merchant never sees them): unknown keyId, expired, other domain, other
//      path, a changed signature, a replay;
//   c. passed by the proxy, refused by our merchant (422): wrong tag, window over 8 minutes, query appended, tampered
//      body, recomputed digest, signature 2 moved under another TAP request;
//   d. Visa's signer -> our verifier: the reference agent's create_ed25519_signature, headless, verified by our
//      signature-1 check; the same with another path is refused; its request passes the proxy, and our merchant
//      refuses it only for lacking our signature 2.
//
// The test key is made fresh for each run and never printed. Exit code 0 only when every case holds.

import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { request, createServer, type IncomingMessage, type Server } from "node:http";
import { openDb } from "../../src/db/open.js";
import { registerAgent } from "../../src/visa/tap.js";
import { tapMerchantConfig, verifyTapCheckout, type TapMerchantVerdict } from "../../src/visa/tapMerchant.js";
import {
  contentDigest, ed25519FromSeed, newNonce, parseSig1, sig1Base, signTapCheckout, signTapCheckoutUnchecked, verifyEd25519,
  type TapHeaders, type TapSignOptions,
} from "../../src/visa/tapSig.js";

const PROXY = { host: "localhost", port: Number(process.env.TAP_PROXY_PORT ?? 3001) };
// The registry listens on 127.0.0.1 only; the proxy reaches it as localhost (Node 22 tries both address families).
const REGISTRY = process.env.TAP_REGISTRY_URL ?? "http://127.0.0.1:9002";
const MERCHANT_PORT = Number(process.env.TAP_MERCHANT_PORT ?? 3000);
const AUTHORITY = `${PROXY.host}:${PROXY.port}`;
const CHECKOUT = "/product/checkout";
const BODY = '{"plan":"packwise-starter"}';
const SIGNED = ["signature-input", "signature", "content-digest", "purser-signature-input", "purser-signature"] as const;

const db = openDb(":memory:");
const cfg = tapMerchantConfig({ authority: AUTHORITY, checkoutPath: CHECKOUT });
const seed = randomBytes(32);
const key = { keyId: `purser-interop-${randomBytes(6).toString("hex")}`, ...ed25519FromSeed(seed) };
const strangerKey = { keyId: `purser-stranger-${randomBytes(6).toString("hex")}`, ...ed25519FromSeed(randomBytes(32)) };
// Our pinned list holds the agent's key for this authority only; Visa's registry is only for the proxy.
registerAgent(db, { agent: "sourcing", keyid: key.keyId, publicJwk: key.publicKey.export({ format: "jwk" }), domains: [AUTHORITY], notAfter: Math.floor(Date.now() / 1000) + 3600 });

// ---- our merchant on :3000 -----------------------------------------------------------------------------------------

interface Received { method: string; url: string; rawHeaders: string[]; bodySha256: string; verdict: TapMerchantVerdict }
const received: Received[] = [];

function merchant(req: IncomingMessage, body: Buffer): { status: number; json: unknown } {
  const verdict = verifyTapCheckout(db, { method: req.method ?? "", target: req.url ?? "", rawHeaders: req.rawHeaders, body }, cfg);
  received.push({ method: req.method ?? "", url: req.url ?? "", rawHeaders: [...req.rawHeaders], bodySha256: createHash("sha256").update(body).digest("hex"), verdict });
  return verdict.ok ? { status: 200, json: { accepted: true, agent: verdict.agent, keyId: verdict.keyId } } : { status: 422, json: { accepted: false, reason: verdict.reason } };
}

async function listen(host: string): Promise<Server | null> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const r = merchant(req, Buffer.concat(chunks));
      res.writeHead(r.status, { "content-type": "application/json" }).end(JSON.stringify(r.json));
    });
  });
  return new Promise((ok) => {
    server.once("error", () => ok(null));
    server.listen(MERCHANT_PORT, host, () => ok(server));
  });
}

// ---- HTTP to the proxy and the registry -----------------------------------------------------------------------------

function send(o: { path: string; headers: Record<string, string>; body: string; method?: string }): Promise<{ status: number; text: string }> {
  return new Promise((ok, fail) => {
    const body = Buffer.from(o.body);
    const r = request({ ...PROXY, method: o.method ?? "POST", path: o.path, headers: { "content-type": "application/json", "content-length": String(body.length), ...o.headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => ok({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
    });
    r.on("error", fail);
    r.end(body);
  });
}

async function registerWithVisasRegistry(): Promise<void> {
  const res = await fetch(`${REGISTRY}/agents/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Purser interop test agent", domain: "https://purser-interop.example", description: "D25 interop test, a fresh test key per run",
      keys: [{ key_id: key.keyId, public_key: key.publicRaw.toString("base64"), algorithm: "ed25519", description: "test key", is_active: "true" }],
    }),
  });
  if (!res.ok) throw new Error(`the reference registry refused the registration: ${res.status} ${(await res.text()).slice(0, 300)}`);
  const k = await fetch(`${REGISTRY}/keys/${key.keyId}`);
  if (!k.ok) throw new Error(`the reference registry does not return the key: ${k.status}`);
}

// ---- cases -----------------------------------------------------------------------------------------------------------

const now = () => Math.floor(Date.now() / 1000);
const sign = (o: Partial<TapSignOptions> & { unchecked?: boolean; k?: typeof key } = {}): TapHeaders => {
  const k = o.k ?? key;
  const opts: TapSignOptions = { authority: AUTHORITY, target: CHECKOUT, method: "POST", body: BODY, keyId: k.keyId, privateKey: k.privateKey, created: now(), nonce: newNonce(), tag: "agent-payer-auth", ...o };
  return o.unchecked ? signTapCheckoutUnchecked(opts) : signTapCheckout(opts);
};
const asRecord = (h: TapHeaders) => ({ ...h }) as Record<string, string>;

const results: { group: string; name: string; ok: boolean; detail: string }[] = [];
const record = (group: string, name: string, ok: boolean, detail: string) => {
  results.push({ group, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${group}  ${name}: ${detail}`);
};

/** b: the proxy itself answers 403, and our merchant receives nothing. */
async function proxyRefuses(name: string, o: { path?: string; headers: Record<string, string>; body?: string }) {
  const before = received.length;
  const r = await send({ path: o.path ?? CHECKOUT, headers: o.headers, body: o.body ?? BODY });
  const title = /<title>([^<]*)<\/title>/.exec(r.text)?.[1]?.trim() ?? "";
  record("b proxy refuses", name, r.status === 403 && received.length === before, `status ${r.status}${title ? ` (${title})` : ""}, merchant saw ${received.length - before}`);
}

/** c: the proxy passes it on, and our merchant refuses it with the expected reason. */
async function merchantRefuses(name: string, why: RegExp, o: { path?: string; headers: Record<string, string>; body?: string }) {
  const before = received.length;
  const r = await send({ path: o.path ?? CHECKOUT, headers: o.headers, body: o.body ?? BODY });
  const last = received[received.length - 1];
  const reason = last && !last.verdict.ok ? last.verdict.reason : "";
  record("c merchant refuses", name, r.status === 422 && received.length === before + 1 && why.test(reason), `status ${r.status}, reason: ${reason || r.text.slice(0, 120)}`);
}

async function main(): Promise<void> {
  const servers = (await Promise.all([listen("127.0.0.1"), listen("::1")])).filter((s): s is Server => s !== null);
  if (!servers.length) throw new Error(`our merchant could not listen on port ${MERCHANT_PORT}`);
  await registerWithVisasRegistry();

  // a. A signed checkout passes the unmodified proxy and our merchant; everything arrives byte for byte.
  const good = sign();
  const r = await send({ path: CHECKOUT, headers: asRecord(good), body: BODY });
  const got = received[received.length - 1];
  const lines = new Map<string, string[]>();
  for (let i = 0; got && i < got.rawHeaders.length; i += 2) lines.set(got.rawHeaders[i]!.toLowerCase(), [...(lines.get(got.rawHeaders[i]!.toLowerCase()) ?? []), got.rawHeaders[i + 1]!]);
  const intact = SIGNED.every((h) => JSON.stringify(lines.get(h)) === JSON.stringify([good[h]]));
  const bodyIntact = got?.bodySha256 === createHash("sha256").update(BODY).digest("hex");
  record("a our agent -> Visa's verifier", "signed checkout", r.status === 200 && got?.verdict.ok === true, `status ${r.status}, our merchant: ${got ? (got.verdict.ok ? "accepted, sig1 and sig2 verified" : got.verdict.reason) : "nothing received"}`);
  record("a our agent -> Visa's verifier", "headers and body byte for byte", intact && bodyIntact && got?.url === CHECKOUT, `signed headers ${intact ? "identical" : "CHANGED"}, body ${bodyIntact ? "identical" : "CHANGED"}, target ${got?.url}, Host as received ${lines.get("host")?.join(",")}`);

  // b. Refused by the proxy itself.
  await proxyRefuses("unknown keyId", { headers: asRecord(sign({ k: strangerKey })) });
  await proxyRefuses("expired", { headers: asRecord(sign({ created: now() - 600, expiresIn: 300 })) });
  await proxyRefuses("other domain", { headers: asRecord(sign({ authority: "shop.example" })) });
  await proxyRefuses("other path", { path: "/product/other", headers: asRecord(sign()) });
  const changed = sign();
  await proxyRefuses("changed signature", { headers: { ...asRecord(changed), signature: changed.signature.replace(/^sig2=:(.)/, (_m, c: string) => `sig2=:${c === "A" ? "B" : "A"}`) } });
  await proxyRefuses("replay of the accepted checkout", { headers: asRecord(good) });

  // c. Passed by the proxy (it checks none of this), refused by our merchant.
  await merchantRefuses("wrong tag", /wrong tag agent-browser-auth/, { headers: asRecord(sign({ tag: "agent-browser-auth" })) });
  await merchantRefuses("window over 8 minutes", /window of 600 s/, { headers: asRecord(sign({ expiresIn: 600, unchecked: true })) });
  await merchantRefuses("query appended (signed)", /query/, { path: `${CHECKOUT}?coupon=1`, headers: asRecord(sign({ target: `${CHECKOUT}?coupon=1` })) });
  await merchantRefuses("tampered body", /Content-Digest does not match/, { headers: asRecord(sign()), body: '{"plan":"packwise-pro"}' });
  const tampered = '{"plan":"packwise-pro"}';
  await merchantRefuses("recomputed digest", /signature 2 does not verify/, { headers: { ...asRecord(sign()), "content-digest": contentDigest(tampered) }, body: tampered });
  const a = sign(), b = sign({ body: tampered });
  await merchantRefuses("signature 2 moved under another TAP request", /nonces of signature 1 and signature 2 differ/, {
    headers: { ...asRecord(b), "content-digest": a["content-digest"], "purser-signature-input": a["purser-signature-input"], "purser-signature": a["purser-signature"] },
  });

  // d. Visa's signer -> our verifier.
  await referenceSigner();

  for (const s of servers) s.close();
  const failed = results.filter((x) => !x.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} interop cases hold (reference commit 16d59bd)`);
  process.exit(failed.length ? 1 : 0);
}

/** The reference agent's own create_ed25519_signature (tap-agent/agent_app.py), called headless with our test key. */
function referenceSign(a: { authority: string; path: string; keyId: string; nonce: string; created: number; expires: number; tag: string }): { signatureInput: string; signature: string } {
  const dir = process.env.TAP_REF_DIR, python = process.env.TAP_REF_PYTHON;
  if (!dir || !python) throw new Error("TAP_REF_DIR and TAP_REF_PYTHON must name the reference clone and a Python with its tap-agent requirements");
  const code = [
    "import json, os, sys",
    "sys.path.insert(0, os.getcwd())",
    "import agent_app",
    "a = json.loads(sys.argv[1])",
    "si, s = agent_app.create_ed25519_signature('', a['authority'], a['path'], a['keyId'], a['nonce'], a['created'], a['expires'], a['tag'])",
    "print('PURSER-RESULT ' + json.dumps({'signatureInput': si, 'signature': s}))",
  ].join("\n");
  // The key goes to the child's environment only; its output (which echoes part of the key) is parsed, never printed.
  const r = spawnSync(python, ["-c", code, JSON.stringify(a)], {
    cwd: `${dir}/tap-agent`, encoding: "utf8", timeout: 120_000,
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ED25519_PRIVATE_KEY: seed.toString("base64"), ED25519_PUBLIC_KEY: key.publicRaw.toString("base64") },
  });
  const line = (r.stdout ?? "").split("\n").find((l) => l.startsWith("PURSER-RESULT "));
  if (!line) throw new Error(`the reference agent did not sign (exit ${r.status}): ${(r.stderr ?? "").split("\n").filter((l) => !/KEY/i.test(l)).slice(-5).join(" | ")}`);
  return JSON.parse(line.slice("PURSER-RESULT ".length)) as { signatureInput: string; signature: string };
}

async function referenceSigner(): Promise<void> {
  const created = now();
  const args = { authority: AUTHORITY, path: CHECKOUT, keyId: key.keyId, nonce: randomUUID(), created, expires: created + 480, tag: "agent-payer-auth" };
  let ref: { signatureInput: string; signature: string };
  try {
    ref = referenceSign(args);
  } catch (e) {
    record("d Visa's signer -> our verifier", "reference agent signs headless (Ed25519)", false, (e as Error).message);
    return;
  }
  const p = parseSig1(ref.signatureInput, ref.signature);
  const ok = p.ok && verifyEd25519(key.publicKey, sig1Base(AUTHORITY, CHECKOUT, p.value.paramsText), p.value.signature);
  record("d Visa's signer -> our verifier", "our signature-1 check accepts the reference's signature", ok, p.ok ? `keyId ${p.value.keyId}, nonce ${p.value.nonce}, tag ${p.value.tag}` : p.reason);
  const moved = p.ok && verifyEd25519(key.publicKey, sig1Base(AUTHORITY, "/product/other", p.value.paramsText), p.value.signature);
  record("d Visa's signer -> our verifier", "the same signature for another path is refused", p.ok && !moved, moved ? "ACCEPTED" : "refused");
  // Its request through the proxy: the proxy passes it; our merchant refuses it only for lacking our signature 2.
  const before = received.length;
  const r = await send({ path: CHECKOUT, headers: { "signature-input": ref.signatureInput, signature: ref.signature }, body: BODY });
  const last = received[received.length - 1];
  record("d Visa's signer -> our verifier", "the reference's request passes the proxy; our merchant wants signature 2",
    r.status === 422 && received.length === before + 1 && !!last && !last.verdict.ok && /missing header/.test(last.verdict.reason),
    `status ${r.status}${last && !last.verdict.ok ? `, ${last.verdict.reason}` : ""}`);
}

main().catch((e: unknown) => {
  console.error(`interop test stopped: ${(e as Error).message}`);
  process.exit(1);
});
