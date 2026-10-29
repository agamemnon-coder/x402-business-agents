// Security review M1: the Metal RPC URL is a credential. viem puts it in its error messages; none of it may reach the
// audit log (and so the dashboard and the relay), the runner's verdicts to the phone, or its log lines.
import { relayToken, viewKey } from "../src/relay/config.js";
import { afterEach, describe, expect, it } from "vitest";
import { createPublicClient, http } from "viem";
import { audit } from "../src/audit/log.js";
import { openDb } from "../src/db/open.js";
import { redactSecrets } from "../src/lib/redact.js";
import { buildSnapshot } from "../src/dashboard/snapshot.js";
import { RelayRunner } from "../src/relay/runner.js";

const ID = "a1b2c3d4".repeat(8);
const URL_ = `https://rpc.example.invalid/v1/${ID}`;
const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

async function viemError(): Promise<string> {
  const client = createPublicClient({ transport: http(URL_, { retryCount: 0, timeout: 2000 }) });
  try {
    await client.getBlockNumber();
    return "no error";
  } catch (e) {
    return (e as Error).message;
  }
}

describe("redacting the RPC URL (M1)", () => {
  it("viem's own error message names the URL, which is why this matters", async () => {
    expect(await viemError()).toContain(ID);
  });

  it("removes the configured URL, its endpoint id, any /v1/<id> path and bearer tokens", async () => {
    process.env.METAL_RPC_URL = URL_;
    const msg = await viemError();
    expect(redactSecrets(msg)).not.toContain(ID);
    expect(redactSecrets(msg)).toContain("[rpc-url]");
    expect(redactSecrets(`at https://other.example/v1/${"f".repeat(40)} with Bearer abc.def-ghi`)).toBe("at https://other.example/v1/[redacted] with Bearer [redacted]");
    process.env.AIRWALLEX_API_KEY = "k".repeat(24);
    expect(redactSecrets(`key ${"k".repeat(24)}`)).toBe("key [redacted]");
  });

  it("also removes the relay token derived from the Cloudflare token, and the viewer key (review N7)", () => {
    const env = { CLOUDFLARE_API_TOKEN: "cf-".padEnd(40, "x") };
    const token = relayToken(env)!;
    const text = `token ${token} view ${viewKey(token)}`;
    expect(redactSecrets(text, env)).toBe("token [redacted] view [redacted]");
  });

  it("keeps it out of the audit log, so out of the dashboard and the relay", async () => {
    process.env.METAL_RPC_URL = URL_;
    const db = openDb(":memory:");
    audit(db, "system", "proposal.failed", "P-0001", { error: await viemError(), nested: { list: [`see ${URL_}`] } });
    const row = db.prepare("SELECT payload_json FROM audit_log").get() as { payload_json: string };
    expect(row.payload_json).not.toContain(ID);
    expect(JSON.stringify(buildSnapshot(db, new Date()))).not.toContain(ID);
  });

  it("keeps it out of the runner's verdicts to the phone and its log lines", async () => {
    process.env.METAL_RPC_URL = URL_;
    const db = openDb(":memory:");
    const lines: string[] = [];
    const bodies: string[] = [];
    const fetchFake = (async (_u: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return new Response(JSON.stringify({ need_state: false, inbox: bodies.length === 1 ? [{ ticket: "t-1", kind: "assertion", proposal_id: null, body: "{", received_at: "x" }] : [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const runner = new RelayRunner({ db, cfg: { url: "https://relay.example", origin: "https://relay.example", rpId: "relay.example", token: "t" }, fetch: fetchFake,
      log: (l) => lines.push(l), execute: async () => {} });
    // Make processing throw an error that quotes the URL, as a failing chain read would.
    (runner as unknown as { process: () => Promise<void> }).process = async () => { throw new Error(await viemError()); };
    await runner.syncOnce();
    await runner.syncOnce();
    expect(lines.join("\n")).not.toContain(ID);
    expect(bodies.join("\n")).not.toContain(ID);
    expect(bodies[1]).toContain("[rpc-url]");
  });
});
