// The Apple Wallet pass for "a payment is waiting for your signature" (src/workplace/wallet.ts), held to the structure
// Apple documents for a .pkpass: pass.json's keys, icon.png, manifest.json with each file's SHA-1, and a signature file.
// Signing a real pass needs the owner's Pass Type ID certificate, so the signer here is a stand-in that returns fixed
// bytes: what is tested is the structure, not Apple's acceptance. The pass only links to the passkey page; it carries
// no action, web service or token. No network.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { unzipStore } from "../src/lib/zip.js";
import { buildPass, packPass, passIdentityFromEnv, passJson, passkeyPageLink, solidPng, type WaitingPayment } from "../src/workplace/wallet.js";

const id = { passTypeIdentifier: "pass.com.example.purser", teamIdentifier: "ABCDE12345", organizationName: "Northwind Outdoor" };
const waiting: WaitingPayment = {
  proposalId: "P-0009", invoiceId: "AP-0004", amount: "1309.00", currency: "EUR", payee: "Bergtex Textil GmbH", dueDate: "2026-11-30",
  origin: "https://purser.example", testMoney: true, filedAt: "2026-11-19T09:00:00Z",
};
const stubSigner = async () => new Uint8Array(Buffer.from("not a real PKCS#7 signature: the owner's signer makes it"));

describe("Apple Wallet pass", () => {
  it("pass.json has Apple's required keys, a generic style, and the passkey page as its only link", () => {
    const p = passJson(waiting, id);
    expect(p).toMatchObject({ formatVersion: 1, passTypeIdentifier: "pass.com.example.purser", teamIdentifier: "ABCDE12345", serialNumber: "purser-P-0009", organizationName: "Northwind Outdoor", description: "Payment P-0009 waits for your signature" });
    const g = p.generic as Record<string, { key: string; value: string }[]>;
    expect(g.primaryFields).toEqual([{ key: "amount", label: "AMOUNT", value: "EUR 1309.00" }]);
    expect(g.auxiliaryFields!.find((f) => f.key === "money")!.value).toBe("Test money");
    const link = "https://purser.example/#/invoices/AP-0004";
    expect(p.barcodes).toEqual([{ format: "PKBarcodeFormatQR", message: link, messageEncoding: "iso-8859-1", altText: "Open in Purser" }]);
    const urls = JSON.stringify(p).match(/https?:\/\/[^"<\s\\]+/g) ?? [];
    expect(new Set(urls)).toEqual(new Set([link]));
    // No update channel, no NFC, no app launch: nothing on the pass can act.
    for (const k of ["webServiceURL", "authenticationToken", "nfc", "appLaunchURL", "associatedStoreIdentifiers"]) expect(p).not.toHaveProperty(k);
    expect(JSON.stringify(p)).toMatch(/cannot approve or pay/);
  });

  it("links to the same page the approval alerts send, on a plain https origin only", () => {
    expect(passkeyPageLink("https://purser.example", "AP-0004")).toBe("https://purser.example/#/invoices/AP-0004");
    expect(() => passkeyPageLink("http://purser.example", "AP-0004")).toThrow(/plain https origin/);
    expect(() => passkeyPageLink("https://purser.example/evil?x=1", "AP-0004")).toThrow(/plain https origin/);
    expect(() => passJson({ ...waiting, amount: "1309" }, id)).toThrow(/two decimals/);
    expect(() => passJson({ ...waiting, proposalId: "P-1\"},{\"x" }, id)).toThrow(/not a proposal id/);
  });

  it("manifest.json holds each file's SHA-1, and the .pkpass zips the files, the manifest and the signature", async () => {
    const { files, manifest } = await buildPass(waiting, id);
    expect(Object.keys(files).sort()).toEqual(["icon.png", "pass.json"]);
    for (const [name, bytes] of Object.entries(files)) expect(manifest[name]).toBe(createHash("sha1").update(bytes).digest("hex"));
    const zip = await packPass(waiting, id, stubSigner);
    const entries = unzipStore(zip);
    expect(entries.map((e) => e.path)).toEqual(["pass.json", "icon.png", "manifest.json", "signature"]);
    expect(entries.every((e) => e.crcOk)).toBe(true);
    expect(JSON.parse(entries.find((e) => e.path === "manifest.json")!.content.toString())).toEqual(manifest);
    await expect(packPass(waiting, id, async () => new Uint8Array(0))).rejects.toThrow(/no signature/);
  });

  it("the icon is a valid PNG of 29 by 29 pixels", () => {
    const png = Buffer.from(solidPng(29, [23, 37, 84]));
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.subarray(12, 16).toString("latin1")).toBe("IHDR");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([29, 29]);
  });

  it("takes the Pass Type ID and Team ID from the environment, checked", () => {
    expect(passIdentityFromEnv({ PURSER_WALLET_PASS_TYPE_ID: "pass.com.example.purser", PURSER_WALLET_TEAM_ID: "ABCDE12345" })).toEqual({ ...id, organizationName: "Purser" });
    expect(() => passIdentityFromEnv({ PURSER_WALLET_TEAM_ID: "ABCDE12345" })).toThrow(/^PURSER_WALLET_PASS_TYPE_ID is not set$/);
    expect(() => passIdentityFromEnv({ PURSER_WALLET_PASS_TYPE_ID: "com.example", PURSER_WALLET_TEAM_ID: "ABCDE12345" })).toThrow(/Pass Type ID/);
  });
});
