// The autonomous dry run a guest sees at /?autonomy (docs/demo/autonomy.json): labelled a dry run with test passkeys,
// with the agents' decisions and chat, and the same public form as the recorded run (no passkey id).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const a = JSON.parse(readFileSync(new URL("../docs/demo/autonomy.json", import.meta.url), "utf8")) as {
  kind: string; run: string; snapshot: { passkey: { credential: unknown }; agent_chat: { kind: string; by?: string }[]; agent_stats: { agent: string; decisions: number; fallback: number; calls_without_request_id: number }[] };
};

describe("the recorded autonomous dry run", () => {
  it("is labelled a dry run with test passkeys and test money", () => {
    expect(a.kind).toBe("autonomous dry run");
    expect(a.run).toMatch(/dry run.*test passkeys.*test money/i);
  });
  it("holds every agent's decisions, each Claude call with its request id, and the chat", () => {
    expect(a.snapshot.agent_stats.map((s) => s.agent).sort()).toEqual(["sourcing", "support", "treasury"]);
    expect(a.snapshot.agent_stats.every((s) => s.decisions > 0 && s.calls_without_request_id === 0)).toBe(true);
    expect(a.snapshot.agent_chat.filter((c) => c.kind === "decision").length).toBeGreaterThan(5);
  });
  it("carries no passkey id", () => {
    expect(a.snapshot.passkey.credential).toBeNull();
  });
});
