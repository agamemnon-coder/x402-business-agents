// An Apple Wallet pass for "a payment is waiting for your signature" (docs/integrations/workplace.md, "Apple Wallet").
// The pass only TELLS and LINKS: its one link (on the back, and as the QR code on the front) opens the invoice's page
// in Purser Cloud, where the CFO signs in with their passkey and signs the exact terms. The pass has no web service, no
// authentication token, no NFC payload and no action; holding it approves nothing.
//
// The package is Apple's .pkpass layout (developer.apple.com/documentation/walletpasses/building-a-pass and
// .../creating-the-source-for-a-pass): pass.json (formatVersion 1, passTypeIdentifier, teamIdentifier, serialNumber,
// organizationName, description, a `generic` style with its field lists, `barcodes`), icon.png (29 x 29 points),
// manifest.json (each file's SHA-1, hex) and `signature`: a detached PKCS #7 signature of manifest.json made with
// the owner's Pass Type ID certificate and Apple's WWDR intermediate certificate.
//
// Signing is the owner's step: it needs an Apple Developer account's Pass Type ID certificate and private key, which
// never come near this code or git. This file builds and tests everything up to the signature (test/workplace-apple.test.ts);
// packPass zips the files with the signature the owner's signer returns. Built and tested against the documented
// structure; needs the owner's Pass Type ID certificate to install on a phone.

import { deflateSync, crc32 } from "node:zlib";
import { zipStore } from "../lib/zip.js";
import { clean, setting, WorkplaceError } from "./http.js";

export interface PassIdentity {
  /** The owner's Pass Type ID (pass.com.example.purser), from PURSER_WALLET_PASS_TYPE_ID. */
  passTypeIdentifier: string;
  /** The owner's Apple Developer Team ID (ten characters), from PURSER_WALLET_TEAM_ID. */
  teamIdentifier: string;
  organizationName: string;
}

export function passIdentityFromEnv(env: Record<string, string | undefined>): PassIdentity {
  const passTypeIdentifier = setting(env, "PURSER_WALLET_PASS_TYPE_ID");
  const teamIdentifier = setting(env, "PURSER_WALLET_TEAM_ID");
  if (!/^pass\.[A-Za-z0-9.-]{3,200}$/.test(passTypeIdentifier)) throw new WorkplaceError("config", "PURSER_WALLET_PASS_TYPE_ID must be a Pass Type ID, like pass.com.example.purser");
  if (!/^[A-Z0-9]{10}$/.test(teamIdentifier)) throw new WorkplaceError("config", "PURSER_WALLET_TEAM_ID must be the ten-character Team ID");
  return { passTypeIdentifier, teamIdentifier, organizationName: clean(env.PURSER_WALLET_ORGANIZATION ?? "Purser", 64) || "Purser" };
}

/** A payment waiting for the CFO, as the pass shows it. */
export interface WaitingPayment {
  proposalId: string;
  invoiceId: string;
  /** Two decimals, as the records hold it. */
  amount: string;
  currency: string;
  payee: string;
  dueDate?: string;
  /** Purser Cloud's origin (https); the link is built from it. */
  origin: string;
  testMoney: boolean;
  /** When the proposal was filed (RFC 3339). */
  filedAt: string;
}

/** The invoice's page in Purser Cloud, where the passkey signs: the same link the approval alerts send. */
export function passkeyPageLink(origin: string, invoiceId: string): string {
  let u: URL;
  try { u = new URL(origin); } catch { throw new WorkplaceError("config", "the Purser Cloud origin is not a URL"); }
  if (u.protocol !== "https:" || u.pathname !== "/" || u.search || u.hash || u.username || u.password) throw new WorkplaceError("config", "the Purser Cloud origin must be a plain https origin");
  return `${u.origin}/#/invoices/${encodeURIComponent(invoiceId)}`;
}

/** pass.json for one waiting payment. */
export function passJson(p: WaitingPayment, id: PassIdentity): Record<string, unknown> {
  if (!/^P-[A-Za-z0-9-]{1,40}$/.test(p.proposalId)) throw new WorkplaceError("invalid", "not a proposal id");
  if (!/^[A-Za-z0-9-]{1,40}$/.test(p.invoiceId)) throw new WorkplaceError("invalid", "not an invoice id");
  if (!/^\d{1,12}\.\d{2}$/.test(p.amount) || !/^[A-Z]{3}$/.test(p.currency)) throw new WorkplaceError("invalid", "the amount must be two decimals and the currency three letters");
  const link = passkeyPageLink(p.origin, p.invoiceId);
  const payee = clean(p.payee, 60);
  const amount = `${p.currency} ${p.amount}`;
  return {
    formatVersion: 1,
    passTypeIdentifier: id.passTypeIdentifier,
    teamIdentifier: id.teamIdentifier,
    serialNumber: `purser-${p.proposalId}`,
    organizationName: id.organizationName,
    description: `Payment ${p.proposalId} waits for your signature`,
    logoText: "Purser",
    foregroundColor: "rgb(255, 255, 255)",
    backgroundColor: "rgb(23, 37, 84)",
    labelColor: "rgb(191, 219, 254)",
    relevantDate: p.filedAt,
    ...(p.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(p.dueDate) ? { expirationDate: `${p.dueDate}T23:59:59Z` } : {}),
    sharingProhibited: true,
    generic: {
      headerFields: [{ key: "status", label: "STATUS", value: "Waiting for your passkey" }],
      primaryFields: [{ key: "amount", label: "AMOUNT", value: amount }],
      secondaryFields: [{ key: "payee", label: "PAYEE", value: payee }, { key: "invoice", label: "INVOICE", value: p.invoiceId }],
      auxiliaryFields: [{ key: "proposal", label: "PROPOSAL", value: p.proposalId }, ...(p.testMoney ? [{ key: "money", label: "MONEY", value: "Test money" }] : [])],
      backFields: [
        { key: "sign", label: "Sign in Purser", value: link, attributedValue: `<a href="${link}">Open the payment and sign with your passkey</a>` },
        { key: "rule", label: "How approval works", value: "This pass only tells you a payment is waiting. It cannot approve or pay. Only your passkey, on the payment's page in Purser, signs the exact terms; one changed cent breaks the signature." },
      ],
    },
    barcodes: [{ format: "PKBarcodeFormatQR", message: link, messageEncoding: "iso-8859-1", altText: "Open in Purser" }],
  };
}

/** A square PNG of one colour (the pass's icon), made here so the package needs no image file. */
export function solidPng(size: number, rgb: [number, number, number]): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

/** The pass's files and manifest.json: everything but the signature. */
export async function buildPass(p: WaitingPayment, id: PassIdentity): Promise<{ files: Record<string, Uint8Array>; manifest: Record<string, string> }> {
  const files: Record<string, Uint8Array> = {
    "pass.json": new TextEncoder().encode(JSON.stringify(passJson(p, id), null, 2)),
    // The one image Apple requires. Higher-resolution icons (@2x, @3x) and a logo are the owner's design step.
    "icon.png": solidPng(29, [23, 37, 84]),
  };
  const manifest: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(files)) manifest[name] = hex(await crypto.subtle.digest("SHA-1", new Uint8Array(bytes)));
  return { files, manifest };
}

/**
 * The owner's signer: a detached PKCS #7 (DER) signature of manifest.json with the Pass Type ID certificate and Apple's
 * WWDR certificate, e.g. `openssl smime -binary -sign -certfile wwdr.pem -signer pass.pem -inkey pass.key -in
 * manifest.json -out signature -outform DER`. Not in this code: the certificate and key are the owner's.
 */
export type PassSigner = (manifest: Uint8Array) => Promise<Uint8Array>;

/** The .pkpass zip: the files, manifest.json and the owner's signature. Without a signer there is no pass to install. */
export async function packPass(p: WaitingPayment, id: PassIdentity, sign: PassSigner, at = p.filedAt): Promise<Buffer> {
  const { files, manifest } = await buildPass(p, id);
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  const signature = await sign(manifestBytes);
  if (signature.length < 16) throw new WorkplaceError("invalid", "the signer returned no signature");
  return zipStore([...Object.entries(files).map(([path, content]) => ({ path, content })), { path: "manifest.json", content: manifestBytes }, { path: "signature", content: signature }], at);
}
