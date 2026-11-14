// Alta review (6 November, docs/metal-review.md): metal-agent knows a pull's payment id only under the mandate it was
// sent under, so "a retry ... under a credential that renewed or replaced it, signs a new payout" (metal-agent 0.3.3,
// `mandate pull`). A refund or sweep retried after a mandate replace first asks the old credential how its pull ended,
// and pays under the new one only when the old pull was refused.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CliResult } from "../src/metal/agentCli.js";
import { keptPullDir, pullWith, type PullDeps } from "../src/metal/pull.js";

const TO = "0x00000000000000000000000000000000000000a1";
const OLD = { credentialPath: "/keys/support.credential.json", keyFile: "/keys/support.key.json", reference: `0x${"01".repeat(32)}` as `0x${string}` };
const NEW = { credentialPath: "/keys/support.P-0007.credential.json", keyFile: "/keys/support.key.json", reference: `0x${"02".repeat(32)}` as `0x${string}` };
const answer = (code: number, out: string): CliResult => ({ code, out, fields: new Map(out.split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf(" ")), [l.slice(l.indexOf(" ") + 1)]])) });

function world(keptUnderOld: boolean, oldAnswer: CliResult) {
  const sent: string[] = [];
  const deps: PullDeps = {
    active: async () => NEW,
    all: () => [OLD, NEW],
    kept: (ref) => keptUnderOld && ref === OLD.reference,
    run: (args) => {
      const cred = args[args.indexOf("--credential") + 1]!;
      sent.push(cred);
      return cred === OLD.credentialPath ? oldAnswer : answer(0, "outcome paid\ntransaction 0xnew\n");
    },
  };
  return { pull: pullWith(deps)({ agent: "support", to: TO, amountCents: 5, paymentId: "refund-7" }), sent };
}

describe("a pull retried after its mandate was replaced", () => {
  it("is sent under the bound mandate when no earlier pull of that id is kept under another", async () => {
    const w = world(false, answer(0, ""));
    expect((await w.pull).outcome).toBe("PAID");
    expect(w.sent).toEqual([NEW.credentialPath]);
  });

  it("reports the old pull when it paid, and sends nothing under the new mandate", async () => {
    const w = world(true, answer(0, "already paid, nothing sent\ntransaction 0xold\n"));
    expect(await w.pull).toEqual({ outcome: "PAID", tx: "0xold", reason: null, already: true });
    expect(w.sent).toEqual([OLD.credentialPath]);
  });

  it("keeps a pull still pending under the old mandate pending: it may land, so no second payout is signed", async () => {
    const w = world(true, answer(3, "outcome pending\n"));
    expect((await w.pull).outcome).toBe("PENDING");
    expect(w.sent).toEqual([OLD.credentialPath]);
  });

  it("keeps a held pull held", async () => {
    const w = world(true, answer(4, "already held, nothing sent\n"));
    expect((await w.pull).outcome).toBe("HELD");
    expect(w.sent).toEqual([OLD.credentialPath]);
  });

  it("pays under the new mandate once the old one refused it (a replaced mandate is revoked)", async () => {
    const w = world(true, answer(1, "outcome refused, not sent\nreason mandate_revoked\n"));
    expect(await w.pull).toEqual({ outcome: "PAID", tx: "0xnew", reason: null, already: false });
    expect(w.sent).toEqual([OLD.credentialPath, NEW.credentialPath]);
  });

  it("looks where metal-agent 0.3.3 keeps the pull: ~/.metal-agent/pulls/<reference>/payment-<sha256 of the id>", () => {
    const src = readFileSync(new URL("../node_modules/@metalntwx/metal-agent/dist/commands/mandate.js", import.meta.url), "utf8");
    const keystore = readFileSync(new URL("../node_modules/@metalntwx/metal-agent/dist/keystore.js", import.meta.url), "utf8");
    expect(src).toContain("`payment-${createHash(\"sha256\").update(args.paymentId).digest(\"hex\")}`");
    expect(keystore).toContain('join(agentHome(), "pulls", reference)');
    expect(keystore).toContain('join(home, ".metal-agent")');
    expect(keptPullDir("/h", OLD.reference, "refund-7")).toBe(`/h/.metal-agent/pulls/${OLD.reference}/payment-${createHash("sha256").update("refund-7").digest("hex")}`);
  });
});
