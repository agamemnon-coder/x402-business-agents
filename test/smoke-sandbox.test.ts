// npm run smoke:sandbox (src/smoke/sandbox.ts, src/cli/smokeSandbox.ts) on the Airwallex stand-in: sandbox only, one
// conversion and one transfer, idempotent under its request ids, and never a key in its output. Nothing here reaches the
// real sandbox: the CLI is only started on paths that refuse before any call.
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it } from "vitest";
import { LICENSOR } from "../src/agents/euroBill.js";
import { SANDBOX_BASE } from "../src/airwallex/client.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { sandboxBase, smokeSandbox, SMOKE_EUR_CENTS, STATE_FILE, type SmokeState } from "../src/smoke/sandbox.js";

let awx: FakeAirwallex;
let out: string;
const read = () => JSON.parse(readFileSync(join(out, STATE_FILE), "utf8")) as SmokeState;
const count = (name: string) => awx.calls.filter((c) => c === name).length;

beforeEach(() => {
  awx = new FakeAirwallex();
  awx.bal.USD.availableCents = 1_000_000;
  awx.beneficiaries.push({ id: "ben_licensor", name: LICENSOR.name, iban: LICENSOR.iban, bic: LICENSOR.bic, currency: "EUR" });
  out = mkdtempSync(join(tmpdir(), "smoke-"));
});

describe("sandboxBase", () => {
  it("defaults to the sandbox, never to production", () => {
    expect(sandboxBase({}, false)).toEqual({ ok: true, base: SANDBOX_BASE });
  });
  it("refuses production, with or without --allow-production", () => {
    const prod = { AIRWALLEX_BASE_URL: "https://api.airwallex.com/api/v1" };
    expect(sandboxBase(prod, false)).toMatchObject({ ok: false, reason: expect.stringContaining("sandbox only") });
    expect(sandboxBase(prod, true)).toMatchObject({ ok: false, reason: expect.stringContaining("only talks to the Airwallex sandbox") });
  });
});

describe("smokeSandbox", () => {
  it("makes one EUR 10.00 conversion and one EUR 10.00 transfer to the allowlisted payee, and writes the ids", async () => {
    const s = await smokeSandbox({ rail: awx, outDir: out, commit: "abc1234", now: () => new Date("2026-11-04T12:00:00Z") });
    expect(count("createConversion")).toBe(1);
    expect(count("createTransfer")).toBe(1);
    expect(awx.conversions[0]).toMatchObject({ buyAmountCents: SMOKE_EUR_CENTS, requestId: s.conversion_request_id });
    expect(awx.transfers[0]).toMatchObject({ amountCents: SMOKE_EUR_CENTS, beneficiaryId: "ben_licensor", requestId: s.transfer_request_id });
    expect(read()).toEqual(s);
    expect(s).toMatchObject({ conversion_id: awx.conversions[0]!.conversionId, transfer_id: awx.transfers[0]!.id, commit: "abc1234", finished_at: "2026-11-04T12:00:00.000Z" });
  });

  it("sends nothing again once a run is done", async () => {
    await smokeSandbox({ rail: awx, outDir: out, commit: "c" });
    const calls = awx.calls.length;
    await smokeSandbox({ rail: awx, outDir: out, commit: "c" });
    // Fails if: a second start converts or pays again.
    expect(awx.calls.length).toBe(calls);
    expect(count("createConversion")).toBe(1);
  });

  it("resumes a run that stopped after the conversion under the same request ids: no second conversion", async () => {
    const create = awx.createTransfer.bind(awx);
    awx.createTransfer = async () => { throw new Error("network down"); };
    await expect(smokeSandbox({ rail: awx, outDir: out, commit: "c" })).rejects.toThrow("network down");
    const half = read();
    expect(half.conversion_id).not.toBeNull();
    expect(half.transfer_id).toBeNull();
    awx.createTransfer = create;
    const s = await smokeSandbox({ rail: awx, outDir: out, commit: "c" });
    expect(count("createConversion")).toBe(1);
    expect(awx.transfers).toHaveLength(1);
    expect(s.transfer_request_id).toBe(half.transfer_request_id);
  });

  it("adopts a transfer whose answer was lost, by its request id: never a second transfer", async () => {
    awx.loseNextTransferAnswer = true;
    const s = await smokeSandbox({ rail: awx, outDir: out, commit: "c" });
    expect(awx.transfers).toHaveLength(1);
    expect(s.transfer_id).toBe(awx.transfers[0]!.id);
  });

  it("stops without a transfer when the allowlisted payee is not at Airwallex, and creates none", async () => {
    awx.beneficiaries = [];
    await expect(smokeSandbox({ rail: awx, outDir: out, commit: "c" })).rejects.toThrow(/allowlisted test payee is not at Airwallex/);
    expect(awx.transfers).toEqual([]);
    expect(awx.beneficiaries).toEqual([]);
  });

  it("starts a new run with new ids on --new, keeping the old one", async () => {
    const first = await smokeSandbox({ rail: awx, outDir: out, commit: "c" });
    const second = await smokeSandbox({ rail: awx, outDir: out, commit: "c", newRun: true });
    expect(second.conversion_request_id).not.toBe(first.conversion_request_id);
    expect(count("createConversion")).toBe(2);
    expect(readdirSync(out)).toContain(`smoke-sandbox-${first.run_id}.json`);
  });
});

describe("the CLI", () => {
  const run = (env: Record<string, string>) => promisify(execFile)("npx", ["tsx", "src/cli/smokeSandbox.ts"], { env: { ...process.env, AIRWALLEX_CLIENT_ID: "", AIRWALLEX_API_KEY: "", AIRWALLEX_BASE_URL: "", ...env } })
    .then(() => ({ code: 0, out: "" }), (e: { code: number; stdout: string; stderr: string }) => ({ code: e.code, out: e.stdout + e.stderr }));

  it("refuses a production base URL before reading any key, and prints no key", async () => {
    const r = await run({ AIRWALLEX_BASE_URL: "https://api.airwallex.com/api/v1", AIRWALLEX_CLIENT_ID: "client-id-value-xyz", AIRWALLEX_API_KEY: "api-key-value-xyz" });
    expect(r.code).toBe(2);
    expect(r.out).toContain("sandbox only");
    expect(r.out).not.toContain("client-id-value-xyz");
    expect(r.out).not.toContain("api-key-value-xyz");
  }, 30_000);

  it("refuses without keys and sends nothing", async () => {
    const r = await run({});
    expect(r.code).toBe(2);
    expect(r.out).toContain("must be set in the environment");
  }, 30_000);
});
