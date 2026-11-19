// The chain side of pausing and resuming one agent (src/metal/pauseChain.ts, plan item 4.2). A pause revokes the
// agent's one bound mandate; a resume binds a fresh credential with the revoked one's cap and payees, read back from
// the chain, and only what was left of its budget, so the agent's lifetime limit on chain stays what the CFO approved.
// Each test is one way a careless pause or resume would re-grant money or revoke the wrong mandate. The chain and the
// metal-agent CLI are stand-ins (no network, no key, test money only); the rules about which mandate and how much are
// the real code's.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Mandate = { path: string; hash: string; boundBlock: bigint; revoked: boolean };
const h = vi.hoisted(() => ({
  dir: "",
  mandates: [] as { path: string; hash: string; boundBlock: bigint; revoked: boolean }[],
  cli: [] as string[][],
  status: new Map<string, string[]>(),
}));

vi.mock("../src/metal/agentCli.js", () => ({
  keyPath: (name: string) => `${h.dir}/${name}`,
  metalAgent: (args: string[]) => {
    h.cli.push(args);
    if (args[1] === "status") return { code: 0, fields: h.status, out: "" };
    return { code: 0, fields: new Map([["transaction", [`0xtx-${args[1]}`]]]), out: "" };
  },
}));
vi.mock("../src/metal/mandate.js", () => ({
  credentialFiles: () => h.mandates.map((m) => m.path),
  loadCredentialFile: (agent: string, path: string) => {
    const m = h.mandates.find((x) => x.path === path);
    return { agent, credentialPath: path, keyFile: `${path}.key`, credentialHash: m?.hash ?? "0xfresh", principal: "0xprincipal", reference: `ref:${path}` };
  },
}));
vi.mock("@metalntwx/metal-pay/mandates", () => ({
  readMandateState: async (_client: unknown, _principal: string, reference: string) => {
    const m = h.mandates.find((x) => `ref:${x.path}` === reference)!;
    return { boundBlock: m.boundBlock, revoked: m.revoked };
  },
}));
vi.mock("../src/metal/chain.js", () => ({ publicClient: () => ({}) }));

const { LivePauseChain } = await import("../src/metal/pauseChain.js");

const NOW = Math.floor(Date.now() / 1000);
const mandate = (name: string, boundBlock: number, revoked: boolean, hash = `0x${name}`): Mandate => ({ path: `/keys/${name}.credential.json`, hash, boundBlock: BigInt(boundBlock), revoked });
/** What `mandate status` prints for the revoked mandate: its cap, budget, spent, payees and expiry, as on chain. */
function chainSays(o: { cap?: string; budget?: string; spent?: string; expiry?: number; payees?: string[] } = {}): void {
  h.status = new Map<string, string[]>([
    ["principal", ["0xprincipal"]],
    ["payee", o.payees ?? ["0xaaaa Bergtex GmbH", "0xbbbb Lagerhaus Nord"]],
    ["per-payment-cap", [o.cap ?? "0.1 *USDZ"]],
    ["budget", [o.budget ?? "4 *USDZ until expiry"]],
    ["spent", [o.spent ?? "1.25 *USDZ"]],
    ["expiry", [`${o.expiry ?? NOW + 86_400} (in a day)`]],
  ]);
}
const chain = (paused: string | null = "0xold") => new LivePauseChain(() => "resume-P-0042", () => paused);

beforeEach(() => {
  h.dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "pause-chain-"));
  h.mandates = [];
  h.cli = [];
  chainSays();
});
afterEach(() => rmSync(h.dir, { recursive: true, force: true }));

describe("pausing revokes the agent's one bound mandate", () => {
  it("revokes it with the business owner's key and reports its hash and transaction", async () => {
    h.mandates = [mandate("earlier", 10, true), mandate("live", 20, false)];
    expect(await chain().revoke("sourcing")).toEqual({ tx: "0xtx-revoke", credential_hash: "0xlive" });
    expect(h.cli).toEqual([["mandate", "revoke", "--credential", "/keys/live.credential.json", "--key", `${h.dir}/owner-business.key.json`]]);
  });

  it("on a retry after a revoke that landed, reports the revoked mandate bound last, and revokes nothing", async () => {
    // A rebalance revoked its predecessors earlier; the one this pause revoked is the one bound last.
    h.mandates = [mandate("paused", 30, true), mandate("rebalanced-away", 10, true)];
    expect(await chain().revoke("sourcing")).toEqual({ tx: null, credential_hash: "0xpaused" });
    expect(h.cli).toEqual([]);
  });

  it("refuses when nothing was ever bound", async () => {
    h.mandates = [mandate("never-bound", 0, false)];
    await expect(chain().revoke("sourcing")).rejects.toThrow("sourcing: no mandate bound on chain");
    expect(h.cli).toEqual([]);
  });

  it("refuses to choose when two mandates are bound", async () => {
    h.mandates = [mandate("a", 10, false), mandate("b", 20, false)];
    await expect(chain().revoke("sourcing")).rejects.toThrow("2 mandates bound; expected one");
    expect(h.cli).toEqual([]);
  });
});

describe("resuming binds a fresh mandate with the old limits and only what is left of the budget", () => {
  it("creates a credential with the revoked mandate's cap and payees and the budget left, then binds it", async () => {
    h.mandates = [mandate("old", 20, true)];
    const out = await chain("0xOLD").resume("sourcing");
    expect(out).toEqual({ tx: "0xtx-bind", credential_hash: "0xfresh", spent_before: "1.25", budget: "2.75" });
    const fresh = `${h.dir}/sourcing.resume-P-0042.credential.json`;
    const [status, create, bind] = h.cli;
    expect(status).toEqual(["mandate", "status", "--credential", "/keys/old.credential.json"]);
    // Budget 4.00, spent 1.25: the fresh mandate may spend 2.75, never a new 4.00.
    expect(create).toEqual([
      "mandate", "credential", "create", "--principal", "0xprincipal", "--cap", "0.10", "--budget", "2.75",
      "--payee", "0xaaaa,Bergtex GmbH", "--payee", "0xbbbb,Lagerhaus Nord", "--expires-in", expect.any(String),
      "--description", "kit11 resume-P-0042 sourcing resumed", "--mandate-key-file", "/keys/old.credential.json.key",
      "--key", `${h.dir}/owner-business.key.json`, "--out", fresh,
    ]);
    // It ends when the revoked one would have ended, not later.
    expect(Number(create![create!.indexOf("--expires-in") + 1])).toBeLessThanOrEqual(86_400);
    expect(bind).toEqual(["mandate", "bind", "--credential", fresh, "--key", `${h.dir}/owner-business.key.json`]);
  });

  it("puts back the mandate the pause revoked, not another revoked one", async () => {
    h.mandates = [mandate("rebalanced-away", 10, true), mandate("paused", 20, true)];
    await chain("0xpaused").resume("sourcing");
    expect(h.cli[0]).toEqual(["mandate", "status", "--credential", "/keys/paused.credential.json"]);
  });

  it("refuses when the paused mandate is not among the revoked ones, or no pause was recorded", async () => {
    h.mandates = [mandate("old", 20, true)];
    await expect(chain("0xsomething-else").resume("sourcing")).rejects.toThrow("the mandate the pause revoked (0xsomething-else) is not among its revoked credentials");
    await expect(chain(null).resume("sourcing")).rejects.toThrow("(none recorded)");
    expect(h.cli).toEqual([]);
  });

  it("refuses when nothing is left of the budget: there is nothing to resume", async () => {
    h.mandates = [mandate("old", 20, true)];
    chainSays({ budget: "4 *USDZ until expiry", spent: "4 *USDZ" });
    await expect(chain().resume("sourcing")).rejects.toThrow("nothing left of its 4.00 budget (spent 4.00)");
    expect(h.cli.map((a) => a[1])).toEqual(["status"]);
  });

  it("does not revive a mandate that has expired", async () => {
    h.mandates = [mandate("old", 20, true)];
    chainSays({ expiry: NOW + 30 });
    await expect(chain().resume("sourcing")).rejects.toThrow("the paused mandate has expired");
    expect(h.cli.map((a) => a[1])).toEqual(["status"]);
  });

  it("refuses when the chain's status cannot be read, rather than guessing a cap", async () => {
    h.mandates = [mandate("old", 20, true)];
    chainSays({ cap: "unlimited" });
    await expect(chain().resume("sourcing")).rejects.toThrow("cannot read the cap from the chain's status (unlimited)");
    chainSays({ payees: [] });
    await expect(chain().resume("sourcing")).rejects.toThrow("cannot read the revoked mandate's principal and payees");
  });

  it("is idempotent: with one mandate bound already it changes nothing, and says whether that one is a resume", async () => {
    h.mandates = [mandate("old", 20, true), { ...mandate("x", 30, false), path: "/keys/sourcing.resume-P-0042.credential.json", hash: "0xresumed" }];
    expect(await chain().resume("sourcing")).toEqual({ tx: null, credential_hash: "0xresumed", bound: true });
    // The pause's revoke never landed: the old mandate is still live and nothing was re-granted.
    h.mandates = [mandate("old", 20, false)];
    expect(await chain().resume("sourcing")).toEqual({ tx: null, credential_hash: "0xold", bound: false });
    expect(h.cli).toEqual([]);
  });

  it("refuses to choose when two mandates are bound", async () => {
    h.mandates = [mandate("a", 10, false), mandate("b", 20, false)];
    await expect(chain().resume("sourcing")).rejects.toThrow("2 mandates bound; expected one");
  });

  it("re-binds a credential an earlier try created, instead of creating a second", async () => {
    h.mandates = [mandate("old", 20, true)];
    const fresh = `${h.dir}/sourcing.resume-P-0042.credential.json`;
    const { writeFileSync } = await import("node:fs");
    writeFileSync(fresh, "{}");
    expect(existsSync(fresh)).toBe(true);
    await chain().resume("sourcing");
    expect(h.cli.map((a) => a.slice(0, 2).join(" "))).toEqual(["mandate status", "mandate bind"]);
  });
});
