// The real Airi client (src/airi/cli.ts) against a scripted execFile: no binary is run, nothing reaches Airi.
// The answers are the shapes airi-cli 0.1.0-beta.4 gave on 7 November (README, skill, and the coordinator's own run).
import { describe, expect, it } from "vitest";
import { AiriRefusal, AiriWaitTimeout, scrubText } from "../src/airi/client.js";
import { AiriCliClient, childEnv, type Exec, type ExecResult } from "../src/airi/cli.js";

const BIN = "/opt/airi/vendor/airi-cli";
const SHA = "a".repeat(64);
const ok = (j: unknown): ExecResult => ({ code: 0, stdout: JSON.stringify(j), stderr: "", timedOut: false });

function client(answers: Record<string, ExecResult | ((args: string[]) => ExecResult)>, o: { version?: string; sha?: string } = {}) {
  const seen: { file: string; args: string[]; env: NodeJS.ProcessEnv; timeoutMs: number }[] = [];
  const exec: Exec = async (file, args, opts) => {
    seen.push({ file, args, env: opts.env, timeoutMs: opts.timeoutMs });
    if (args[0] === "version") return ok({ version: o.version ?? "0.1.0-beta.4" });
    const key = args.slice(0, 2).join(" ");
    const a = answers[key];
    if (!a) throw new Error(`unscripted: ${key}`);
    return typeof a === "function" ? a(args) : a;
  };
  const c = new AiriCliClient({ binary: "/opt/node22/bin/airi-cli", exec, resolve: () => BIN, sha256Of: () => o.sha ?? SHA, expectedSha256: SHA, env: { HOME: "/home/max", AIRWALLEX_API_KEY: "secret-key-value", PATH: "/x" } });
  return { c, seen };
}

describe("AiriCliClient: before anything runs", () => {
  it("refuses a binary that is not the pinned one, and runs nothing", async () => {
    const { c, seen } = client({}, { sha: "b".repeat(64) });
    await expect(c.whoami()).rejects.toThrow(/not the pinned binary/);
    expect(seen).toEqual([]);
  });

  it("refuses any version but 0.1.0-beta.4", async () => {
    const { c, seen } = client({ "auth whoami": ok({ authenticated: true }) }, { version: "0.1.0-beta.5" });
    await expect(c.whoami()).rejects.toThrow(/not 0\.1\.0-beta\.4/);
    expect(seen.map((s) => s.args[0])).toEqual(["version"]);
  });

  it("runs the Go binary itself, with -o json --no-telemetry, and an environment without Purser's keys", async () => {
    const { c, seen } = client({ "auth whoami": ok({ authenticated: true, session_expires: "2026-11-07T12:00:00Z" }) });
    expect(await c.whoami()).toEqual({ authenticated: true, sessionExpires: "2026-11-07T12:00:00Z" });
    const w = seen[1]!;
    expect(w.file).toBe(BIN);
    expect(w.args).toEqual(["auth", "whoami", "-o", "json", "--no-telemetry"]);
    expect(w.env).toEqual({ PATH: "/usr/bin:/bin", HOME: "/home/max", TZ: "UTC", LANG: "C.UTF-8", AIRI_TELEMETRY_DISABLED: "1", DISABLE_TELEMETRY: "1" });
    expect(JSON.stringify(w.env)).not.toContain("secret-key-value");
    expect(childEnv({ AIRWALLEX_API_KEY: "x" }).AIRWALLEX_API_KEY).toBeUndefined();
  });
});

describe("AiriCliClient: the answers, parsed strictly", () => {
  it("payment-methods list: the id and type, and of the card only a plain brand and last four", async () => {
    const card = { brand: "VISA", last4: "1111", number: "4111111111111111", expiry: "12/30", billingAddress: { line1: "Somewhere 1" } };
    const { c } = client({ "payment-methods list": ok([{ asDefault: true, card, createdAt: "2026-11-07T09:00:00Z", nickName: "Test", paymentMethodId: "pm_123", type: "CARD" }]) });
    const m = await c.listPaymentMethods();
    expect(m).toEqual([{ paymentMethodId: "pm_123", type: "CARD", display: "VISA •••• 1111" }]);
    expect(JSON.stringify(m)).not.toMatch(/4111111111111111|Somewhere|12\/30/);
  });

  it("an answer in another shape is refused without repeating it", async () => {
    const { c } = client({ "payment-methods list": ok({ unexpected: "4111111111111111" }) });
    const e = (await c.listPaymentMethods().then(() => null, (x: unknown) => x)) as AiriRefusal;
    expect(e).toBeInstanceOf(AiriRefusal);
    expect(e.code).toBe("AIRI_OUTPUT_UNRECOGNISED");
    expect(e.message).not.toContain("4111");
  });

  it("reads mandate create's camelCase answer, as airi-cli 0.1.0-beta.4 gives it live", async () => {
    const { c } = client({ "mandate create": ok({ expiresAt: "2026-11-07T13:01:47Z", mandateId: "mdt_live", passkeyUrl: "https://app.airi.com/pay/xyz", status: "CREATED" }) });
    const m = await c.createMandate({ source: "Purser sourcing agent", paymentMethodId: "pm_123", merchantName: "Shop", merchantUrl: "https://shop.example/", merchantCountry: "NL", totalAmount: "12.00", currency: "EUR", items: [{ name: "Map", unitPrice: "12.00", quantity: "1" }], description: "order [airi-1]" });
    expect(m).toEqual({ mandateId: "mdt_live", passkeyUrl: "https://app.airi.com/pay/xyz" });
  });

  it("mandate create: the documented flags, the id and the one-time link", async () => {
    const { c, seen } = client({ "mandate create": ok({ mandate_id: "mdt_1", passkey_url: "https://app.airi.com/pay/abc" }) });
    const m = await c.createMandate({ source: "Purser sourcing agent", paymentMethodId: "pm_123", merchantName: "Shop", merchantUrl: "https://shop.example/", merchantCountry: "NL", totalAmount: "12.00", currency: "EUR", items: [{ name: "Map", unitPrice: "12.00", quantity: "1" }], description: "order [airi-1]" });
    expect(m).toEqual({ mandateId: "mdt_1", passkeyUrl: "https://app.airi.com/pay/abc" });
    expect(seen[1]!.args).toEqual(["mandate", "create", "--source", "Purser sourcing agent", "--payment-method-id", "pm_123", "--merchant-name", "Shop", "--merchant-url", "https://shop.example/", "--merchant-country", "NL", "--total-amount", "12.00", "--currency", "EUR", "--item", "name:Map,unit_price:12.00,quantity:1", "--description", "order [airi-1]", "-o", "json", "--no-telemetry"]);
  });

  it("get-credential: --file, a 300 s wait, and only the receipt back", async () => {
    const { c, seen } = client({ "mandate get-credential": ok({ status: "READY", tokenType: "NETWORK_TOKEN", tokenExpiration: "2026-11-07T12:00:00Z" }) });
    expect(await c.getCredential("mdt_1", "/tmp/x/credential.json")).toEqual({ status: "READY", tokenType: "NETWORK_TOKEN", tokenExpiration: "2026-11-07T12:00:00Z" });
    expect(seen[1]!.args).toEqual(["mandate", "get-credential", "--mandate-id", "mdt_1", "--file", "/tmp/x/credential.json", "--timeout", "300", "--interval", "2", "-o", "json", "--no-telemetry"]);
    expect(seen[1]!.timeoutMs).toBe(330_000);
  });

  it("get-credential that waited in vain is a wait timeout, not a refusal", async () => {
    const { c } = client({ "mandate get-credential": { code: 1, stdout: JSON.stringify({ error: { code: "timeout", message: "Timed out after 300s waiting for credential authorization." } }), stderr: "", timedOut: false } });
    await expect(c.getCredential("mdt_1", "/tmp/x/c.json")).rejects.toBeInstanceOf(AiriWaitTimeout);
    const k = client({ "mandate get-credential": { code: null, stdout: "", stderr: "", timedOut: true } });
    await expect(k.c.getCredential("mdt_1", "/tmp/x/c.json")).rejects.toBeInstanceOf(AiriWaitTimeout);
  });

  it("a CLI error keeps Airi's code; its text loses links, long digit runs and e-mails", async () => {
    const { c } = client({ "mandate create": { code: 1, stdout: JSON.stringify({ error: { code: "mandate_rejected", message: "see https://app.airi.com/device/authorize?code=AB-CD for 4111111111111111 (max@example.com)" } }), stderr: "", timedOut: false } });
    const e = (await c.createMandate({ source: "s", paymentMethodId: "p", merchantName: "m", merchantUrl: "https://m.example/", merchantCountry: "NL", totalAmount: "1.00", currency: "EUR", items: [{ name: "i", unitPrice: "1.00", quantity: "1" }], description: "d" }).then(() => null, (x: unknown) => x)) as AiriRefusal;
    expect(e).toBeInstanceOf(AiriRefusal);
    expect(e.code).toBe("mandate_rejected");
    expect(e.message).not.toMatch(/airi\.com|4111|example\.com/);
  });

  it("an error without a code gets the exit status", async () => {
    const { c } = client({ "auth whoami": { code: 3, stdout: "", stderr: "not signed in\n", timedOut: false } });
    await expect(c.whoami()).rejects.toMatchObject({ code: "AIRI_CLI_EXIT_3" });
  });

  it("cancel answers {status: ok}; result and list run with the documented flags", async () => {
    const { c, seen } = client({
      "mandate cancel": ok({ status: "ok" }),
      "mandate result": ok({ status: "ok" }),
      "mandate list": ok({ mandates: [{ mandateId: "mdt_1", status: "CREATED", description: "order [airi-1]" }], hasMore: false }),
    });
    await c.cancelMandate("mdt_1");
    await c.reportResult("mdt_1", "DECLINED", "authorization_failed");
    expect(await c.findMandate("order [airi-1]", "2026-11-07T10:00:00Z")).toEqual({ mandateId: "mdt_1", status: "CREATED" });
    expect(seen.slice(1).map((s) => s.args)).toEqual([
      ["mandate", "cancel", "--mandate-id", "mdt_1", "-o", "json", "--no-telemetry"],
      ["mandate", "result", "--mandate-id", "mdt_1", "--result", "DECLINED", "--reason", "authorization_failed", "-o", "json", "--no-telemetry"],
      ["mandate", "list", "--created-from", "2026-11-07T10:00:00Z", "--size", "100", "-o", "json", "--no-telemetry"],
    ]);
  });
});

describe("AiriCliClient: the mandate read back", () => {
  const tag = `[P-0001 terms:${"ab".repeat(32)}]`;
  it("lists the mandates and returns the one with this id, with the description as Airi stores it", async () => {
    const { c, seen } = client({ "mandate list": ok({ mandates: [{ mandateId: "mdt_0", status: "COMPLETED", description: "an older one" }, { mandateId: "mdt_1", status: "CREATED", description: `order 1 ${tag}`, createdAt: "2026-11-07T10:00:01Z" }], hasMore: false }) });
    expect(await c.readMandate("mdt_1", "2026-11-07T09:59:00Z")).toEqual({ mandateId: "mdt_1", status: "CREATED", description: `order 1 ${tag}` });
    expect(seen[1]!.args).toEqual(["mandate", "list", "--created-from", "2026-11-07T09:59:00Z", "--size", "100", "-o", "json", "--no-telemetry"]);
  });

  it("answers null when the mandate is not listed, and a null description when the row has none", async () => {
    const { c } = client({ "mandate list": ok({ mandates: [{ mandateId: "mdt_1", status: "CREATED" }] }) });
    expect(await c.readMandate("mdt_9", "2026-11-07T09:59:00Z")).toBeNull();
    expect(await c.readMandate("mdt_1", "2026-11-07T09:59:00Z")).toEqual({ mandateId: "mdt_1", status: "CREATED", description: null });
  });

  it("refuses a list in another shape without repeating it, and keeps the CLI's own code when the list fails", async () => {
    const odd = client({ "mandate list": ok({ rows: "4111111111111111" }) });
    await expect(odd.c.readMandate("mdt_1", "2026-11-07T09:59:00Z")).rejects.toMatchObject({ code: "AIRI_OUTPUT_UNRECOGNISED" });
    const down = client({ "mandate list": { code: 1, stdout: JSON.stringify({ error: { code: "unauthenticated", message: "sign in again" } }), stderr: "", timedOut: false } });
    await expect(down.c.readMandate("mdt_1", "2026-11-07T09:59:00Z")).rejects.toMatchObject({ code: "unauthenticated" });
  });
});

describe("scrubText", () => {
  it("keeps codes and words, drops what could be a secret", () => {
    expect(scrubText("declined: cvv 123, card 4111 1111 1111 1111, https://app.airi.com/x")).toBe("declined: cvv [digits], card [digits], [link]");
  });
});
