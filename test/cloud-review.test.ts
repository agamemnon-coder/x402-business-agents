// Purser Cloud review, 13 Nov: (1) at 1440 px an empty band of about 850 px between the charts and "Next", the cards
// below the first screen waiting, invisible, to be scrolled to; (2) "More" marked on every console page; (3) the chip
// "Demo: sandbox data" beside a banner that says made-up data; (4) the Overview counted 33 decisions where the MCP
// tool said 25. Each is held here; the band and the menu also by the browser check (test/browser/console.check.ts).
import { describe, expect, it } from "vitest";
import { consolePage } from "../cloud/src/console.js";
import { dashboard, decisionLog } from "../cloud/src/dashboard.js";
import { t as tr } from "../src/ui/i18n.js";
import { testCloud, ORIGIN, RP } from "./support/cloud.js";
import { DEMO_CONNECTOR_TOKEN } from "../cloud/src/auth.js";

describe("Purser Cloud after the review of 13 Nov", () => {
  it("(1) rises every card in on the next frame, never waiting for it to be scrolled to", () => {
    const html = consolePage("n", { origin: ORIGIN, rpId: RP, mailDomain: "" });
    expect(html).toContain("requestAnimationFrame(()=>{for(const n of box.querySelectorAll('.rise'))n.classList.add('in')});");
    expect(html).not.toContain("whenSeen(n,()=>n.classList.add('in'))");
  });

  it("(2) marks no item of the site's menu on the console: it is not one of the site's pages", () => {
    const head = /<header class="top">[\s\S]*?<\/header>/.exec(consolePage("n", { origin: ORIGIN, rpId: RP, mailDomain: "" }))![0];
    expect(head).not.toMatch(/<summary class="on">|aria-current="page"|class="on"/);
    // Purser Cloud is still in "More", and leads to this console.
    expect(head).toContain('<a href="/">Purser Cloud</a>');
  });

  it("(3) the demo chip says made-up data, as the banner does, never sandbox", () => {
    expect(tr("en", "cs.demo.chip")).toBe("Demo: made-up data");
    expect(tr("nl", "cs.demo.chip")).toBe("Demo: verzonnen gegevens");
    expect(tr("en", "cs.demo.chip")).not.toMatch(/sandbox/i);
  });

  it("(4) counts decisions once: the Overview, company_overview and agent_decisions say the same numbers", async () => {
    const c = testCloud();
    try {
      const g = (await c.req("POST", "/v1/auth/guest", { key: null })).json.session as string;
      const d = (await c.req("GET", "/v1/dashboard", { key: g })).json as { agents: { decisions: number; by_fallback: number } };
      expect(d.agents.decisions).toBeGreaterThan(25);
      const call = async (name: string, args: Record<string, unknown> = {}) => {
        const r = await c.req("POST", "/mcp", { key: DEMO_CONNECTOR_TOKEN, body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, headers: { origin: "null-omit" } });
        return r.json.result as { content: { text: string }[]; structuredContent: Record<string, unknown> };
      };
      const o = await call("company_overview");
      expect(o.content[0]!.text).toContain(`Decisions: ${d.agents.decisions} by agents, ${d.agents.by_fallback} of them by code's fallback (no model).`);
      for (const limit of [5, 25, undefined]) {
        // Undefined: the default, 20 entries (short enough for a phone).
        const a = await call("agent_decisions", limit === undefined ? {} : { limit });
        expect(a.structuredContent).toMatchObject({ agent_decisions: d.agents.decisions, by_fallback: d.agents.by_fallback });
        expect(a.content[0]!.text.startsWith(`${d.agents.decisions} decisions by agents in all, ${d.agents.by_fallback} of them by code's fallback (no model).`)).toBe(true);
        expect((a.structuredContent.items as unknown[]).length).toBe(limit ?? 20);
      }
    } finally {
      c.close();
    }
    // One function holds the counts; the dashboard's feed is its first 14 lines.
    const rows = [
      { seq: 1, ts: "2026-11-01T00:00:00Z", actor: "treasury", event: "card.decline_met", subject: null, payload_json: '{"source":"fallback"}' },
      { seq: 2, ts: "2026-11-02T00:00:00Z", actor: "human", event: "proposal.approved", subject: null, payload_json: '{"proposal_id":"P-1"}' },
    ];
    const log = decisionLog(rows);
    expect(log.by_fallback).toBe(1);
    expect(log.agent_decisions).toBeLessThanOrEqual(log.entries.length);
    expect(typeof dashboard).toBe("function");
  });
});
