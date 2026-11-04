// D20, the runner's half: with KIT11_MFA=on it prints this week's viewer key (the same the Worker computes), syncs each
// enrolled passkey's public key (public, never a secret) so the Worker can verify a sign-in, and redacts the weekly
// keys from its logs like the fixed one. Off, the state and the link are as before.
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { openDb } from "../src/db/open.js";
import { openEnrolment, recordPasskey } from "../src/passkey/ledger.js";
import { buildRelayState } from "../src/relay/state.js";
import { viewerLink, viewKey, viewKeyWeekly } from "../src/relay/config.js";
import { redactSecrets } from "../src/lib/redact.js";
import { viewKeyForWeek } from "../worker/src/core.js";

const TOKEN = "t".repeat(64);
const t0 = new Date("2026-11-05T10:00:00Z");

function coseOf(): { cose: string; x: string; y: string } {
  const jwk = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const m = new Map<number, number | Uint8Array>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y, "base64url")]]);
  return { cose: Buffer.from(isoCBOR.encode(m)).toString("base64url"), x: jwk.x, y: jwk.y };
}
function ledger(cose: string) {
  const db = openDb(":memory:");
  const { window } = openEnrolment(db, { rpId: "relay.example", origin: "https://relay.example" }, t0);
  recordPasskey(db, { window, credentialId: "cred-1", publicKey: cose, counter: 0, transports: null, aaguid: null, registrationJson: "{}", label: "max" }, t0);
  db.prepare("UPDATE passkeys SET status = 'ACTIVE'").run();
  return db;
}

describe("the runner under MFA (D20)", () => {
  it("prints this week's viewer key, the one the Worker accepts", async () => {
    expect(viewKeyWeekly(TOKEN, t0)).toBe(await viewKeyForWeek(TOKEN, t0));
    const cfg = { url: "https://relay.example", token: TOKEN } as never;
    expect(viewerLink(cfg, undefined, { KIT11_MFA: "on" }, t0)).toBe(`https://relay.example/#view=${viewKeyWeekly(TOKEN, t0)}`);
    expect(viewerLink(cfg, undefined, {}, t0)).toBe(`https://relay.example/#view=${viewKey(TOKEN)}`);
  });

  it("syncs each enrolled passkey's public key with MFA on, and not without", () => {
    const k = coseOf();
    const db = ledger(k.cose);
    const on = buildRelayState(db, { rpId: "relay.example", relayToken: TOKEN, mfa: true }, t0);
    expect(on.approvals.passkey.credentials).toEqual([expect.objectContaining({ id: "cred-1", public_key: { x: k.x, y: k.y } })]);
    const off = buildRelayState(db, { rpId: "relay.example", relayToken: TOKEN }, t0);
    expect(off.approvals.passkey.credentials[0]).not.toHaveProperty("public_key");
  });

  it("redacts this week's and last week's viewer keys from what it logs", () => {
    const now = new Date();
    const keys = [viewKeyWeekly(TOKEN, now), viewKeyWeekly(TOKEN, new Date(now.getTime() - 7 * 864e5))];
    const out = redactSecrets(`link #view=${keys[0]} and ${keys[1]}`, { KIT11_RELAY_TOKEN: TOKEN } as never);
    for (const k of keys) expect(out).not.toContain(k);
  });
});
