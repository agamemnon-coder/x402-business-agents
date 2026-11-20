// The agent card's Apple Wallet pass (cloud/src/walletPass.ts): its structure (pass.json, images, manifest.json with
// each file's SHA-1, a detached PKCS#7 signature over the manifest that names the signer and carries the WWDR
// certificate), and that it is offered only when every part of the configuration is there. The certificates and the key
// are made here, at run time, and thrown away: a throwaway self-signed "Pass Type ID" and "WWDR", nothing committed.
import { createHash, createPublicKey, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { buildPkpass, certIds, children, manifestOf, oid, passConfigFrom, passFiles, passJson, readDer, type AgentPassData, type PassConfig } from "../cloud/src/walletPass.js";
import { throwawayPassEnv } from "./support/passCert.js";

// A throwaway certificate and key, made at run time (test/support/passCert.ts).
const { cert: CERT, wwdr: WWDR, passKeys, env: ENV } = throwawayPassEnv();
const DATA: AgentPassData = {
  company: "Northwind Outdoor (demo company)", tenant: "t_demo_company", agent: "support", name: "Support agent", role: "Support", card_last4: "2361", currency: "EUR",
  per_purchase: "60.00", per_month: "150.00", status: "active", token: { token_id: "tok_42983d88d4542323", status: "active", mandate_sha256: "b".repeat(64) }, console_url: "https://cloud.example/console#/agents",
};

/** A stored zip's files, read the way Wallet reads them: local headers, names, data. */
function unzip(z: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const v = new DataView(z.buffer, z.byteOffset, z.byteLength);
  for (let o = 0; v.getUint32(o, true) === 0x04034b50;) {
    const method = v.getUint16(o + 8, true), size = v.getUint32(o + 18, true), n = v.getUint16(o + 26, true), x = v.getUint16(o + 28, true);
    expect(method).toBe(0);
    const nameS = new TextDecoder().decode(z.subarray(o + 30, o + 30 + n));
    out.set(nameS, z.subarray(o + 30 + n + x, o + 30 + n + x + size));
    o += 30 + n + x + size;
  }
  return out;
}

describe("configuration: no pass unless every part is there", () => {
  it("reads a complete configuration", () => {
    const c = passConfigFrom(ENV);
    expect(c).toMatchObject({ passTypeId: "pass.test.purser.agents", teamId: "ABCDE12345", organization: "Purser" });
  });
  it.each(["PASS_TYPE_ID", "TEAM_ID", "PASS_CERT_PEM", "PASS_KEY_PEM", "PASS_WWDR_PEM"])("offers none without %s", (k) => {
    expect(passConfigFrom({ ...ENV, [k]: undefined })).toBeNull();
    expect(passConfigFrom({ ...ENV, [k]: "" })).toBeNull();
  });
  it("offers none for a malformed id, team, certificate or key, or an encrypted key", () => {
    expect(passConfigFrom({ ...ENV, PASS_TYPE_ID: "com.example" })).toBeNull();
    expect(passConfigFrom({ ...ENV, TEAM_ID: "abc" })).toBeNull();
    expect(passConfigFrom({ ...ENV, PASS_CERT_PEM: "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----" })).toBeNull();
    expect(passConfigFrom({ ...ENV, PASS_KEY_PEM: "-----BEGIN ENCRYPTED PRIVATE KEY-----\nAAAA\n-----END ENCRYPTED PRIVATE KEY-----" })).toBeNull();
  });
  it("takes a PKCS#1 key too", () => {
    expect(passConfigFrom({ ...ENV, PASS_KEY_PEM: passKeys.privateKey.export({ type: "pkcs1", format: "pem" }) as string })).not.toBeNull();
  });
});

describe("the pass", () => {
  const cfg = passConfigFrom(ENV) as PassConfig;
  const at = new Date("2026-11-21T10:00:00Z");

  it("shows the agent's name, limits, card's last four and status, and holds no card number", () => {
    const j = passJson(cfg, DATA, "purser-x") as { generic: Record<string, { key: string; value: string }[]>; voided?: boolean } & Record<string, unknown>;
    expect(j).toMatchObject({ formatVersion: 1, passTypeIdentifier: "pass.test.purser.agents", teamIdentifier: "ABCDE12345", serialNumber: "purser-x", organizationName: "Purser" });
    const f = Object.fromEntries(Object.values(j.generic).flat().map((x) => [x.key, x.value]));
    expect(f).toMatchObject({ agent: "Support agent", per_purchase: "EUR 60.00", per_month: "EUR 150.00", card: "•••• 2361", status: "Active" });
    expect(f.token).toContain("tok_42983d88d4542323");
    expect(JSON.stringify(j)).not.toMatch(/\d{12,}/);
    expect(j.voided).toBeUndefined();
    expect((passJson(cfg, { ...DATA, status: "revoked" }, "s") as { voided?: boolean }).voided).toBe(true);
  });

  it("is a zip of pass.json, its images, manifest.json with each file's SHA-1, and the signature", async () => {
    const files = unzip(await buildPkpass(cfg, DATA, at));
    expect([...files.keys()].sort()).toEqual(["icon.png", "icon@2x.png", "icon@3x.png", "logo.png", "logo@2x.png", "manifest.json", "pass.json", "signature"]);
    const manifest = JSON.parse(new TextDecoder().decode(files.get("manifest.json"))) as Record<string, string>;
    expect(Object.keys(manifest).sort()).toEqual(["icon.png", "icon@2x.png", "icon@3x.png", "logo.png", "logo@2x.png", "pass.json"]);
    for (const [n, h] of Object.entries(manifest)) expect(createHash("sha1").update(files.get(n)!).digest("hex")).toBe(h);
    expect(await manifestOf(await passFiles(cfg, DATA))).toEqual(manifest);
    // Each image is a PNG of the size Wallet asks for.
    const sizes = Object.fromEntries(["icon.png", "icon@2x.png", "icon@3x.png", "logo.png", "logo@2x.png"].map((n) => { const p = PNG.sync.read(Buffer.from(files.get(n)!)); return [n, [p.width, p.height]]; }));
    expect(sizes).toEqual({ "icon.png": [29, 29], "icon@2x.png": [58, 58], "icon@3x.png": [87, 87], "logo.png": [160, 50], "logo@2x.png": [320, 100] });
  });

  it("signs the manifest: a detached PKCS#7 naming the pass certificate, carrying the WWDR one, verifiable with its public key", async () => {
    const files = unzip(await buildPkpass(cfg, DATA, at));
    const sig = files.get("signature")!, manifest = files.get("manifest.json")!;
    const top = readDer(sig);
    const [ctype, body] = children(sig, top);
    expect(Buffer.from(sig.subarray(ctype!.start, ctype!.end)).toString("hex")).toBe(Buffer.from(oid("1.2.840.113549.1.7.2")).toString("hex"));
    const signedData = children(sig, body!)[0]!;
    const sd = children(sig, signedData);
    // version, digest algorithms, the content info (detached: no content), certificates, signer infos.
    expect(sd.map((n) => n.tag)).toEqual([0x02, 0x31, 0x30, 0xa0, 0x31]);
    expect(children(sig, sd[2]!)).toHaveLength(1);
    const certs = children(sig, sd[3]!).map((n) => Buffer.from(sig.subarray(n.start, n.end)).toString("hex"));
    expect(certs).toEqual([Buffer.from(CERT).toString("hex"), Buffer.from(WWDR).toString("hex")]);
    const si = children(sig, children(sig, sd[4]!)[0]!);
    // The signer is named by the pass certificate's issuer and serial number.
    const ids = certIds(CERT);
    const sid = children(sig, si[1]!).map((n) => Buffer.from(sig.subarray(n.start, n.end)).toString("hex"));
    expect(sid).toEqual([Buffer.from(ids.issuer).toString("hex"), Buffer.from(ids.serial).toString("hex")]);
    // The signed attributes: content type, signing time, and the manifest's SHA-256.
    const attrsNode = si[3]!;
    expect(attrsNode.tag).toBe(0xa0);
    const attrs = new Uint8Array(sig.subarray(attrsNode.start, attrsNode.end));
    const digestAttr = children(attrs, readDer(attrs)).map((a) => children(attrs, a)).find((a) => Buffer.from(attrs.subarray(a[0]!.start, a[0]!.end)).equals(Buffer.from(oid("1.2.840.113549.1.9.4"))))!;
    const octet = children(attrs, digestAttr[1]!)[0]!;
    expect(Buffer.from(attrs.subarray(octet.contentStart, octet.end)).toString("hex")).toBe(createHash("sha256").update(manifest).digest("hex"));
    // The signature is over the attributes as a DER SET (the [0] tag replaced by SET's), with the pass key.
    attrs[0] = 0x31;
    const value = si[5]!;
    expect(verify("sha256", attrs, createPublicKey(ENV.PASS_CERT_PEM), Buffer.from(sig.subarray(value.contentStart, value.end)))).toBe(true);
    const tampered = Buffer.from(attrs); tampered.writeUInt8(tampered.readUInt8(tampered.length - 1) ^ 1, tampered.length - 1);
    expect(verify("sha256", tampered, createPublicKey(ENV.PASS_CERT_PEM), Buffer.from(sig.subarray(value.contentStart, value.end)))).toBe(false);
  });

  it("is a signature OpenSSL accepts over the manifest, and refuses over a changed one (when openssl is installed)", async () => {
    let have = true;
    try { execFileSync("openssl", ["version"], { stdio: "ignore" }); } catch { have = false; }
    if (!have) return;
    const files = unzip(await buildPkpass(cfg, DATA, at));
    const dir = mkdtempSync(join(tmpdir(), "purser-pkpass-"));
    try {
      writeFileSync(join(dir, "signature"), files.get("signature")!);
      writeFileSync(join(dir, "manifest.json"), files.get("manifest.json")!);
      writeFileSync(join(dir, "other.json"), "{}");
      const run = (content: string) => { try { execFileSync("openssl", ["cms", "-verify", "-binary", "-noverify", "-inform", "DER", "-in", join(dir, "signature"), "-content", join(dir, content), "-out", join(dir, "out")], { stdio: "pipe" }); return true; } catch { return false; } };
      expect(run("manifest.json")).toBe(true);
      expect(run("other.json")).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
