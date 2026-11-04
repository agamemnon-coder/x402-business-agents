// D24: the origin of an agent's own purchase survives the in-process HTTP hop to our seller. Without the carrier the
// seller's handler sees no origin (it runs in the server's context), which this test shows first.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { originCarrier } from "../src/provenance/carry.js";
import { currentOrigin, withOrigin, type Origin } from "../src/provenance/origin.js";

const AGENT: Origin = { actor: "agent", agent: "sourcing", model: "claude-haiku-5-5", request_id: "req_c", run_id: "run-sourcing-5-cafe01" };

async function seller(onBuy: (seq: number) => Promise<unknown>) {
  const server = createServer((req, res) => {
    const seq = Number(new URL(req.url ?? "/", "http://x").searchParams.get("seq"));
    void onBuy(seq).then(() => res.end("ok"));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { get: (seq: number) => fetch(`${url}/?seq=${seq}`).then((r) => r.text()), close: () => new Promise<void>((r) => server.close(() => r())) };
}

describe("an origin across the hop to our own seller", () => {
  it("is lost without the carrier: the handler runs outside the sender's code path", async () => {
    let seen: Origin | null | undefined;
    const s = await seller(async () => { seen = currentOrigin(); });
    await withOrigin(AGENT, () => s.get(1));
    await s.close();
    expect(seen).toBeNull();
  });

  it("arrives with the carrier, for that stock check only, and once", async () => {
    const seen: (Origin | null)[] = [];
    const carrier = originCarrier(async () => { seen.push(currentOrigin()); });
    const s = await seller((seq) => carrier.upstream(seq));
    await withOrigin(AGENT, () => carrier.send(7, () => s.get(7)));
    await s.get(7); // the world's next customer query for the same number: code's, not the agent's
    await s.get(8);
    await s.close();
    expect(seen).toEqual([AGENT, null, null]);
  });
});
