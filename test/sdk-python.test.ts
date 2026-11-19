// The Python client (sdk/python, standard library only): its own tests against a local mock, the README's quickstart
// against Purser Cloud in this process (behind a listener on 127.0.0.1), and its operations against openapi/purser.yaml.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { yamlOperations } from "../cloud/src/apiSpec.js";
import { integrationsWorld, listen, type IntegrationsWorld } from "./support/integrationsWorld.js";

const run = promisify(execFile);
// -B: no __pycache__ in the tree. The client's directory is put on the path by each script.
const python = (code: string, env: Record<string, string> = {}) =>
  run("python3", ["-B", "-c", `import sys; sys.path.insert(0, "sdk/python")\n${code}`], { env: { PATH: process.env.PATH ?? "", ...env }, timeout: 60_000 });

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true }); vi.setSystemTime(new Date("2026-11-10T09:00:00Z")); });
afterAll(() => { vi.useRealTimers(); });

let w: IntegrationsWorld, base: string, server: Server;
beforeAll(async () => {
  w = await integrationsWorld();
  ({ base, server } = await listen(w.c));
}, 60_000);
afterAll(() => { server.close(); w.c.close(); });

describe("the Python client", () => {
  it("passes its own tests (a local mock, standard library only)", async () => {
    const out = await run("python3", ["-B", "sdk/python/tests/test_client.py"], { timeout: 60_000 });
    expect(out.stderr).toMatch(/Ran \d+ tests[\s\S]*\nOK\n?$/);
  });

  it("runs the README's quickstart against Purser Cloud: list invoices, propose a payment, read the proposal's status", async () => {
    const out = await python(`
import json
from purser import Purser, PurserError
purser = Purser.from_env()
ids = [i["id"] for i in purser.list_invoices(limit=10)["items"]]
payable = [i["id"] for i in purser.list_payable_invoices() if i["payable"]]
proposal = purser.propose_payment(payable[0])["proposal"]
status = purser.get_proposal(proposal["id"])["status"]
try:
    purser.propose_payment(payable[0])
    again = None
except PurserError as e:
    again = [e.status, e.code]
print(json.dumps({"ids": ids, "payable": payable, "proposal": proposal["id"], "status": status, "again": again}))
`, { PURSER_URL: base, PURSER_API_KEY: w.proposeKey });
    expect(JSON.parse(out.stdout)).toEqual({ ids: ["AP-0001"], payable: ["AP-0001"], proposal: "P-0001", status: "PENDING_APPROVAL", again: [409, "conflict"] });
  });

  it("a read key cannot propose; nothing in the client approves", async () => {
    const out = await python(`
from purser import Purser, PurserError
try:
    Purser.from_env().propose_payment("AP-0001")
    print("filed")
except PurserError as e:
    print(e.status, e.code)
print([n for n in dir(Purser) if "approv" in n.lower()])
`, { PURSER_URL: base, PURSER_API_KEY: w.readKey });
    expect(out.stdout.trim().split("\n")).toEqual(["403 forbidden", "[]"]);
  });

  it("calls only operations of openapi/purser.yaml, under their operationIds", async () => {
    const out = await python("import json, purser; print(json.dumps(purser.OPERATIONS))");
    const ops = JSON.parse(out.stdout) as Record<string, [string, string]>;
    const yaml = readFileSync("openapi/purser.yaml", "utf8");
    const inSpec = new Set(yamlOperations(yaml));
    expect(Object.keys(ops).length).toBeGreaterThanOrEqual(6);
    for (const [id, [method, path]] of Object.entries(ops)) {
      expect(inSpec.has(`${method} ${path}`), `${id}: ${method} ${path}`).toBe(true);
      expect(yaml).toContain(`operationId: ${id}\n`);
    }
  });
});
