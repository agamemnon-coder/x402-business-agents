// The Agents page's roster (cloud/src/agentRoster.ts) says only what the code holds: each model is its code's constant,
// each file exists, each switch is read by the code, and every agent the company's records can name is in it.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROSTER } from "../cloud/src/agentRoster.js";
import { consolePage } from "../cloud/src/console.js";
import { MODELS } from "../src/claude/reader.js";
import { CHECKER_MODEL } from "../src/ap/checkerCore.js";
import { PAYER_MODEL } from "../src/ap/payerCore.js";
import { NEGOTIATE_MODEL } from "../src/negotiate/claude.js";
import { AGENT_DISPLAY, AP_AGENT_DISPLAY } from "../src/config/brand.js";

const root = new URL("../", import.meta.url);
const by = (id: string) => ROSTER.find((r) => r.id === id)!;

describe("every agent in Purser", () => {
  it("names each model as its code sets it", () => {
    expect(by("sourcing").model).toBe(NEGOTIATE_MODEL);
    expect(readFileSync(new URL("src/agents/sourcingAgent.ts", root), "utf8")).toContain("MODELS.classify");
    expect(by("sourcing").model).toBe(MODELS.classify);
    expect(by("checker").model).toBe(CHECKER_MODEL);
    expect(by("payer").model).toBe(PAYER_MODEL);
    expect(by("treasury").model).toBe(MODELS.review);
    expect(by("support").model).toBe(MODELS.act);
    expect(by("dispute_desk").model).toBe(MODELS.review);
    expect(by("controller").model).toBe(MODELS.act);
    expect(by("books").model).toBe(MODELS.act);
    expect(by("x402_desk").model).toBeNull();
  });
  it("points at files that exist, and at switches its code reads", () => {
    for (const r of ROSTER) {
      expect(r.code.length).toBeGreaterThan(0);
      for (const p of r.code) expect(existsSync(new URL(p, root)), `${r.id}: ${p}`).toBe(true);
      if (r.switch) expect(r.code.some((p) => readFileSync(new URL(p, root), "utf8").includes(r.switch!)) || readFileSync(new URL("src/config/agents.ts", root), "utf8").includes(r.switch), `${r.id}: ${r.switch}`).toBe(true);
    }
  });
  it("holds every agent the company's records can name, under the same id and name", () => {
    for (const [id, d] of Object.entries({ ...AGENT_DISPLAY, ...AP_AGENT_DISPLAY })) expect(by(id)?.name).toBe(d.name);
  });
  it("is in the console's script, with its words in English and Dutch", () => {
    const html = consolePage("n0nce", { origin: "https://cloud.test", rpId: "cloud.test", mailDomain: "" });
    // In Dutch its words are cloud/src/consoleNl.ts's (27 Nov): the page puts the roster through nxAll, which an English page skips.
    expect(html).toContain("const ROSTER=nxAll([");
    // 26 Nov: the Overview's Agent status card reads it (the count under the agents); the Agents page is the cards.
    expect(html).toContain("function agentStrip(agents)");
    expect(html).toContain('"act_more":"{n} agents in Purser"');
  });
});
