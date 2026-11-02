// npm run visa -- setup | run
// Agent recognition (the agent-recognition profile of Visa's Trusted Agent Protocol spec), live with the Airwallex
// sandbox. setup: each agent with a card gets an Ed25519 key (a key file in KIT11_KEYS_DIR, never printed) and its
// public key goes into our self-hosted registry for the merchant we run (Packwise, on 127.0.0.1). run: the merchant
// listens over HTTP; the Sourcing agent signs a checkout and pays with its own Airwallex card (a simulated
// authorisation in the sandbox, inside the CFO limit); then the red team sends what the merchant must refuse, over
// the same HTTP. Writes docs/runs/visa-tap.json (RUN_OUT names another run). Registry and keys are ours, not Visa's.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import express from "express";
import { issuingFromEnv } from "../airwallex/issuing.js";
import { cardRows } from "../policy/cards.js";
import { openDb } from "../db/open.js";
import { keyPath } from "../metal/agentCli.js";
import { tapCheckout, TAP_MERCHANT } from "../visa/merchant.js";
import { newAgentKey, registerAgent, revokeAgent, signTapRequest, type TapAgentKey } from "../visa/tap.js";
import { TAP_RAIL_MERCHANT } from "../visa/tapRail.js";

const cmd = process.argv[2] ?? "run";
const PORT = Number(process.env.TAP_MERCHANT_PORT ?? 4410);
const AUTHORITY = `127.0.0.1:${PORT}`;
const db = openDb();
const keyFile = (agent: string) => keyPath(`tap-${agent}.key.json`);

async function loadKey(agent: string): Promise<TapAgentKey> {
  const k = JSON.parse(readFileSync(keyFile(agent), "utf8")) as { keyid: string; privateJwk: JsonWebKey; publicJwk: JsonWebKey };
  const privateKey = await crypto.subtle.importKey("jwk", k.privateJwk, { name: "Ed25519" }, false, ["sign"]);
  return { agent, keyid: k.keyid, privateKey, publicJwk: k.publicJwk };
}

if (cmd === "setup") {
  const agents = cardRows(db).map((c) => c.agent).filter((a) => a.indexOf("task:") !== 0);
  if (!agents.length) { console.error("no agent cards yet: npm run cards -- setup"); process.exit(2); }
  for (const agent of agents) {
    if (!existsSync(keyFile(agent))) {
      const k = await newAgentKey(agent);
      // The private key goes to a key file only (0600); nothing secret is printed.
      const privateJwk = await crypto.subtle.exportKey("jwk", k.privateKey);
      writeFileSync(keyFile(agent), JSON.stringify({ keyid: k.keyid, privateJwk, publicJwk: k.publicJwk }), { mode: 0o600 });
    }
    const k = await loadKey(agent);
    // D25: the same key is pinned for Packwise's TAP card rail (KIT11_TAP_RAIL=on), the merchant we run.
    registerAgent(db, { agent, keyid: k.keyid, publicJwk: k.publicJwk, domains: [AUTHORITY, TAP_RAIL_MERCHANT.authority], notAfter: Math.floor(Date.now() / 1000) + 30 * 86_400 });
    console.log(`registered ${agent}: key ${k.keyid} for ${AUTHORITY} and ${TAP_RAIL_MERCHANT.authority} (self-hosted registry, test key)`);
  }
  process.exit(0);
}

const awx = issuingFromEnv();
if (!awx) { console.error("the Airwallex sandbox keys are not set; nothing was done"); process.exit(2); }

// The merchant over HTTP: the request as received, rebuilt for the check with its own Host header.
const app = express();
app.use(express.text({ type: "*/*" }));
app.post("/checkout", async (req, res) => {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  const r = await tapCheckout(db, awx.sim, new Request(`http://${req.headers.host}${req.originalUrl}`, { method: "POST", headers, body: typeof req.body === "string" ? req.body : "" }));
  res.status(r.recognised ? (r.approved ? 200 : 402) : 401).json(r);
});
const server = await new Promise<import("node:http").Server>((ok) => { const s = app.listen(PORT, "127.0.0.1", () => ok(s)); });
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const ops = await loadKey("sourcing");
const send = async (req: Request) => {
  const headers = new Headers(req.headers);
  const res = await fetch(base + new URL(req.url).pathname, { method: "POST", headers, body: await req.text() });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const checkout = (key: TapAgentKey, o: Partial<Parameters<typeof signTapRequest>[0]> = {}) =>
  signTapRequest({ url: `http://${AUTHORITY}/checkout`, method: "POST", key, tag: "agent-payer-auth", body: JSON.stringify({ plan: "packwise-starter" }), ...o });

const steps: { step: string; expect: string; status: number; result: Record<string, unknown> }[] = [];
const step = async (name: string, expect: string, r: Promise<{ status: number; body: Record<string, unknown> }>) => {
  const { status, body } = await r;
  steps.push({ step: name, expect, status, result: body });
  console.log(`${status}  ${name}: ${String(body.reason ?? (body.approved ? "approved by Airwallex" : ""))}`);
};

const good = await checkout(ops);
await step("the Sourcing agent buys Packwise Starter (EUR 19.99), signed", "recognised, approved by Airwallex", send(good.clone()));
await step("the same signed request again", "refused: nonce replay", send(good));
await step("no signature", "refused", send(new Request(`http://${AUTHORITY}/checkout`, { method: "POST", body: JSON.stringify({ plan: "packwise-starter" }) })));
await step("signed for another merchant, sent here", "refused: the signature covers the other host", send(await checkout(ops, { url: "http://other.example/checkout" })));
await step("a browsing signature at checkout", "refused: wrong tag", send(await checkout(ops, { tag: "agent-browser-auth" })));
await step("a stranger's key", "refused: unknown key", send(await checkout(await newAgentKey("stranger"))));
await step("signed ten minutes ago", "refused: expired", send(await checkout(ops, { now: Math.floor(Date.now() / 1000) - 600 })));
await step("the Sourcing agent buys Packwise Pro (EUR 45.00), over its card limit", "recognised, declined by Airwallex", send(await checkout(ops, { body: JSON.stringify({ plan: "packwise-pro" }) })));
revokeAgent(db, ops.keyid);
await step("after the key is revoked", "refused: revoked", send(await checkout(ops)));
registerAgent(db, { agent: "sourcing", keyid: ops.keyid, publicJwk: ops.publicJwk, domains: [AUTHORITY], notAfter: Math.floor(Date.now() / 1000) + 30 * 86_400 });

server.close();
const out = { ran_at: new Date().toISOString(), merchant: TAP_MERCHANT.name, authority: AUTHORITY, profile: "agent recognition per Visa's TAP spec (RFC 9421, tags agent-browser-auth / agent-payer-auth, 8-minute window, nonce replay block)", registry: "self-hosted, test keys; not Visa's directory", card_payments: "Airwallex sandbox simulated authorisations", steps };
// RUN_OUT_DIR: a dry run keeps its records in its own output folder, not in docs/runs.
const dir = process.env.RUN_OUT_DIR ? resolve(process.env.RUN_OUT_DIR) : resolve(import.meta.dirname, "../../docs/runs");
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, `${process.env.RUN_OUT ?? "visa-tap"}.json`), JSON.stringify(out, null, 2) + "\n");
console.log(`\n${steps.length} steps written to ${process.env.RUN_OUT_DIR ? "the run's output folder" : "docs/runs"}/${process.env.RUN_OUT ?? "visa-tap"}.json`);
process.exit(0);
