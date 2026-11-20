// The hands-on /try in `npm run judge`: the same page and the same /v1/try routes as the hosted demo
// (https://kit11.max-31b.workers.dev/try), answered in this process by Purser Cloud's own handler (cloud/src/app.ts) with
// its engine (cloud/src/engine/node.ts), as test/browser/try-rail.check.ts and present.check.ts run it. The run never
// leaves this computer and the page fetches nothing from the internet: an in-memory database (blobs in it too), no
// Claude key (code reads the invoice, and the page says "no Claude call"), no Airwallex key (every transfer is on the
// simulated bank, labelled), no Alta call. The passkey is the judge's own (Face ID, Touch ID, Windows Hello) on
// http://localhost, which browsers treat as a secure origin.

import { createHash, randomBytes } from "node:crypto";
import type express from "express";
import { handle, type CloudEnv } from "../../cloud/src/app.js";
import { nodeEngines } from "../../cloud/src/engine/node.js";
import { sqlBlobs } from "../../cloud/src/blobsSql.js";
import { sqliteSql } from "../../cloud/src/node.js";

/** The words the offline /try shows above the steps (the page itself says "no Claude call" and "simulated bank"). */
export const OFFLINE_TRY_NOTE = "Offline copy (npm run judge): code, not Claude, reads the invoice; transfers run on the simulated bank, test money only; no network.";

// The note sits above the steps; from 1280 px, where the Live engine rail is fixed beside the steps, in the steps' own
// column (cloud/src/try/presentMode.ts), so the rail never covers it.
const NOTE_CSS = ".judge-offline{box-sizing:border-box;margin:12px auto 0;max-width:1180px;padding:8px 14px;border:1px solid #d9a400;border-radius:10px;background:#fff8db;color:#3d2f00;font:600 14px/1.45 Inter,system-ui,sans-serif}"
  + "@media (prefers-color-scheme:dark){.judge-offline{background:#2e2600;border-color:#806300;color:#ffe9a3}}"
  + "@media (max-width:1212px){.judge-offline{margin:12px 16px 0}}"
  + "@media (min-width:1280px){body.pv-shell.pv-staged .judge-offline{max-width:608px;margin-left:calc(max(16px,50% - 525px) + 16px);margin-right:auto}}";

/**
 * The hosted page's fixed words that say Claude reads the invoice or the Airwallex sandbox pays, and what this copy says
 * instead: here code reads it (no Claude key) and the simulated bank pays (no Airwallex key). The page's own live labels
 * ("no Claude call", "No Airwallex sandbox transfer for this payment") already say so and are left as they are.
 * test/judge-try.test.ts checks that each is on the hosted page, so a change of the page's words cannot slip past.
 */
export const OFFLINE_WORDS: readonly (readonly [hosted: string, offline: string])[] = [
  ["Claude reads and checks every supplier invoice.", "Claude reads and checks every supplier invoice (in this offline copy, code reads it)."],
  // Site audit, 20 Nov: the start's fine line opens with the sandbox disclosure (cloud/src/try/presentMode.ts V2_COPY).
  ["Sandbox demo: test money, no real settlement · Purser's real engine · deleted after 24 hours", "Offline copy: test money, simulated bank, no real settlement · Purser's real engine · nothing leaves this computer"],
  ["Test money only · Airwallex sandbox", "Test money only · simulated bank (offline)"],
  ["Claude reads the PDF; code checks what it read.", "In this offline copy code reads the PDF (no Claude call) and checks what it read."],
  ["'Claude reads the PDF'", "'code reads the PDF (offline: no Claude)'"],
  ["'what Claude read'", "'what code read (offline: no Claude call)'"],
  ["'Airwallex sandbox · test money'", "'simulated bank · test money'"],
  // Offline the end screen's main button opens this computer's /proof, the recorded sandbox runs: not "live".
  ["See it run on a live Airwallex sandbox", "See the recorded Airwallex sandbox runs"],
];

/** The hosted site's pages and files this server has too (src/cli/judge.ts): the page's links to them stay on this computer. */
const SITE = /https:\/\/kit11\.max-31b\.workers\.dev\/(home|proof|books|airwallex|alta|visa|security|docs|claude|runs|verify|assets\/logo-airwallex\.png)(?=\\?")/g;

/**
 * The hosted page, offline: one line above the steps that says this is the offline copy (OFFLINE_TRY_NOTE), its style
 * under the page's own nonce, and its links to the site's pages (and the Airwallex logo) to this server's copies, so
 * nothing is fetched from the internet; and OFFLINE_WORDS. Apart from these, it is the hosted page byte for byte.
 */
export function offlinePage(html: string, csp: string): string {
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
  if (!nonce || !html.includes('<main id="main">')) return html;
  for (const [hosted, offline] of OFFLINE_WORDS) html = html.split(hosted).join(offline);
  return html.replace(SITE, (_m, path: string) => `/${path}`).replace("</head>", () => `<style nonce="${nonce}">${NOTE_CSS}</style></head>`)
    .replace('<main id="main">', () => `<p class="judge-offline" role="note">${OFFLINE_TRY_NOTE}</p>\n<main id="main">`);
}

export interface OfflineTry {
  /** The origin the page and its passkeys belong to (http://localhost:<port>). */
  origin: string;
  /** One request through Purser Cloud's handler. */
  fetch(req: Request): Promise<Response>;
  /** The same, from Express. */
  express: (req: express.Request, res: express.Response) => void;
}

/**
 * Purser Cloud for /try on this computer, for `origin` (http://localhost:<port>). Starts are switched on with an admin
 * token made here and kept only in this process (never printed, never sent anywhere); every other switch stays off, so
 * no Claude, Airwallex or Alta leg runs.
 */
export async function offlineTry(origin: string): Promise<OfflineTry> {
  const admin = randomBytes(24).toString("hex");
  const sql = sqliteSql(":memory:");
  const env: CloudEnv = {
    sql, blobs: sqlBlobs(sql), sessionSecret: randomBytes(32).toString("hex"), adminTokenSha256: createHash("sha256").update(admin).digest("hex"),
    rpId: new URL(origin).hostname, origin, tryIt: {},
    // One person on their own computer: the hosted demo's per-address limits would only stop a judge's third run.
    rate: { perMinute: 100_000, signInPerMinute: 100_000, failedAuthPerMinute: 100_000 },
  };
  env.engine = nodeEngines({ sql, blobs: env.blobs, rpId: env.rpId, origin });
  for (const [key, value] of [["starts", "on"], ["starts_per_address_hour", "50"], ["starts_per_48_hour", "200"]] as const) {
    const r = await handle(new Request(`${origin}/v1/try/admin`, { method: "POST", headers: { authorization: `Bearer ${admin}`, "content-type": "application/json" }, body: JSON.stringify({ op: "set", key, value }) }), env);
    if (r.status !== 200) throw new Error(`offline /try: switch ${key} answered ${r.status}`);
  }
  const host = new URL(origin).host;
  const fetch = (req: Request) => handle(req, env);
  return {
    origin, fetch,
    express: (req, res) => {
      // The passkey belongs to localhost: opened as 127.0.0.1, the page goes to the same address under localhost.
      if (req.method === "GET" && req.headers.host && req.headers.host !== host) { res.redirect(302, `${origin}${req.originalUrl}`); return; }
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const ch of req) chunks.push(ch as Buffer);
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
        headers.set("cf-connecting-ip", "127.0.0.1");
        const body = chunks.length && req.method !== "GET" && req.method !== "HEAD" ? Buffer.concat(chunks) : undefined;
        const r = await fetch(new Request(`${origin}${req.originalUrl}`, { method: req.method, headers, ...(body ? { body } : {}) }));
        res.status(r.status);
        r.headers.forEach((v, k) => { if (k !== "set-cookie" && k !== "content-length") res.setHeader(k, v); });
        const cookies = r.headers.getSetCookie();
        if (cookies.length) res.setHeader("set-cookie", cookies);
        const isPage = req.path === "/try" && /^text\/html/.test(r.headers.get("content-type") ?? "");
        res.end(isPage ? offlinePage(await r.text(), r.headers.get("content-security-policy") ?? "") : Buffer.from(await r.arrayBuffer()));
      })().catch((e: unknown) => { if (!res.headersSent) res.status(500).type("text").send(`offline /try: ${e instanceof Error ? e.message : String(e)}`); });
    },
  };
}
