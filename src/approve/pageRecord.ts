// The approval page integrity record (src/approve/integrity.ts): what docs/evidence/approval-page.json holds, made from
// the code as it is. The relay's three phone pages exactly as the Worker serves them, and Purser Cloud's console (where
// an owner or CFO approves in the browser) with its nonces and its deployment's addresses set to placeholders.
// `npm run approval-page-record` writes it; test/approval-page-integrity.test.ts fails when the committed file differs.

import { consoleCsp, consolePage } from "../../cloud/src/console.js";
import { phonePages } from "../relay/assets.js";
import { CLOUD_CFG_PLACEHOLDER, NONCE_PLACEHOLDER, normaliseConsole, sha256Hex, type PageRecord } from "./integrity.js";

export const RECORD_WHAT = "SHA-256 of each approval page's served HTML (script and stylesheet inline) and its Content-Security-Policy, from the code at this commit. Purser Cloud's console: nonces and the deployment's origin, RP id and mail domain set to placeholders first. Check a live page: npm run verify-approval-page -- <url>.";

/** The record, from the code as it is (or from another phone script and stylesheet, for a test). */
export function approvalPageRecord(o: { client?: string; css?: string } = {}): PageRecord {
  const phone = o.client !== undefined || o.css !== undefined ? phonePages(o.client, o.css) : phonePages();
  const relay = (name: "approve" | "enrol" | "policy", path: string) => ({ name, path, served_by: "relay" as const, sha256: sha256Hex(phone[name].page), csp: phone[name].csp, build: phone[name].build });
  const console = normaliseConsole(consolePage(NONCE_PLACEHOLDER, { ...CLOUD_CFG_PLACEHOLDER, engine: true }), consoleCsp(NONCE_PLACEHOLDER));
  return {
    what: RECORD_WHAT,
    pages: [
      relay("approve", "/approve/*"),
      relay("enrol", "/enrol"),
      relay("policy", "/policy"),
      { name: "cloud-console", path: "/", served_by: "cloud", sha256: sha256Hex(console.html), csp: console.csp },
    ],
  };
}

export const recordText = (r: PageRecord) => `${JSON.stringify(r, null, 2)}\n`;
