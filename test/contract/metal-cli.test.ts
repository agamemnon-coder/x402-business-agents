// Contract tests for the pinned metal-agent CLI (0.3.3) as Purser runs it for refunds and sweeps (src/metal/pull.ts):
// its exit codes are outcomes (0 paid, 1 refused, 3 pending, 4 held), its output is "key value" lines, and an
// "error:" line means the command did not run, whatever the exit code. Offline: spawnSync is stubbed with the CLI's
// documented answers and the mandate lookup is a stand-in; no chain, no key.
//
// Sources:
//   [CLI]  https://docs.metalntwx.com/agents/metal-agent (mandate pull; what a mandate enforces)
//   [M9]   docs/feedback-for-metal-and-airwallex.md M4 (until 6 Nov: M9; exit 1 both for a refusal and for a setup error; the incident)
//   [RUN-S1] docs/runs/2026-10-29-s1.md (mandate_cap_exceeded; mandate_revoked for the replaced credential)
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ next: { status: 0, stdout: "", stderr: "" }, args: [] as string[][] }));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawnSync: (_bin: string, args: string[]) => { h.args.push(args); return { ...h.next }; },
}));
vi.mock("../../src/metal/mandate.js", () => ({
  activeMandate: async (agent: string) => ({ agent, credentialPath: `/keys/${agent}.credential.json`, keyFile: `/keys/${agent}.key.json`, reference: `0x${"0a".repeat(32)}` }),
  credentialFiles: () => [],
  loadCredentialFile: () => { throw new Error("no credential files in this test"); },
}));

process.env.KIT11_KEYS_DIR = mkdtempSync(join(tmpdir(), "kit11-contract-keys-"));
const { livePull } = await import("../../src/metal/pull.js");
const { CliError } = await import("../../src/metal/agentCli.js");

const TO = "0x00000000000000000000000000000000000000a1";
const pull = () => livePull({ agent: "support", to: TO, amountCents: 4, paymentId: "refund-12" });
const answer = (status: number, stdout: string, stderr = "") => { h.next = { status, stdout, stderr }; };

beforeEach(() => { h.args.length = 0; });

describe("contract: metal-agent mandate pull [CLI]", () => {
  it("sends the credential, key, payee, amount and payment id, on testnet", async () => {
    answer(0, "status paid\ntransaction 0xabc\n");
    await pull();
    expect(h.args[0]).toEqual(["mandate", "pull", "--credential", "/keys/support.credential.json", "--mandate-key-file", "/keys/support.key.json", "--to", TO, "--amount", "0.04", "--payment-id", "refund-12", "--network", "testnet"]);
  });

  it("exit 0: paid, with its transaction", async () => {
    answer(0, "status paid\ntransaction 0xabc\n");
    expect(await pull()).toEqual({ outcome: "PAID", tx: "0xabc", reason: null, already: false });
  });

  it("a repeat of the same payment id: 'already paid, nothing sent', so a crashed refund is retried safely", async () => {
    answer(0, "already paid, nothing sent\ntransaction 0xabc\n");
    expect(await pull()).toMatchObject({ outcome: "PAID", already: true });
  });

  for (const reason of ["mandate_cap_exceeded", "mandate_revoked", "mandate_expired", "mandate_budget_spent"]) {
    it(`exit 1 with ${reason}: refused, nothing moved [RUN-S1]`, async () => {
      answer(1, `status refused\nreason ${reason}\n`);
      expect(await pull()).toEqual({ outcome: "REFUSED", tx: null, reason, already: false });
    });
  }

  it("exit 1 with an 'error:' line is a setup error, never recorded as refused [M9]", async () => {
    answer(1, "", "error: HOME is home not an absolute path\n");
    const e = await pull().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CliError);
  });

  it("exit 3 pending and exit 4 held are outcomes (looked up again later), not errors", async () => {
    answer(3, "status pending\ntransaction 0xdef\n");
    expect(await pull()).toMatchObject({ outcome: "PENDING", tx: "0xdef" });
    answer(4, "status held\nreason recipient_refuses\n");
    expect(await pull()).toMatchObject({ outcome: "HELD", reason: "recipient_refuses" });
  });

  it("any other exit code is an error, not an outcome; the RPC credential never reaches the message", async () => {
    answer(2, "", "could not reach https://rpc.example/v1/SECRETKEY123456789012345678901234567890\n");
    const e = (await pull().catch((x: unknown) => x)) as Error;
    expect(e).toBeInstanceOf(CliError);
    expect(e.message).not.toMatch(/SECRETKEY123456789012345678901234567890/);
  });
});
