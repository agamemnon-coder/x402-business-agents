// Home, "Built for agentic banking" and "For your security review" (the owner, 20 Nov: "what really completes this Home
// for agentic banking, fintech and enterprise"). The agents are first-class: each with its own Airwallex card and limits
// and its own mandate cap on Alta, every value from its record; six controls, each with the link to its proof; then the
// security team's links (only pages and files that exist) and every connection with the label the connections hub gives it.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AUDIT_LOG_DOC, AUDIT_LOG_RECORD, CLAUDE_ADDS, FEATURES, INTEGRATIONS, ROSTER_NOTE, ROSTER_RECORDS, STOP_DRILL_DOC, STOP_DRILL_RECORD, TRUST_LINKS,
  agentRoster, agenticControls, auditRows, homePage, stopDrillFacts,
} from "../src/redesign/home.js";
import { REPO_BLOB } from "../src/redesign/metalStory.js";
import { buildPages } from "../src/relay/assets.js";
import { connectionsCatalogue } from "../cloud/src/connections.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const ENT: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&#39;": "'", "&lt;": "<", "&gt;": ">" };
const text = (html: string) => html.replace(/<svg\b[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/&(?:amp|quot|#39|lt|gt);/g, (e) => ENT[e]!).replace(/\s+/g, " ").trim();
const ON = homePage(undefined, { trySign: true }), OFF = homePage();
const section = (html: string, cls: string) => new RegExp(`<section class="${cls}"[\\s\\S]*?</section>`).exec(html)?.[0] ?? "";

const AWX = JSON.parse(read("docs/demo/airwallex-run.json")) as { cards: { agent: string; read_back: { per_tx: string; monthly: string; currency: string; last4: string; status: string } }[] };
const MAIN = JSON.parse(read("docs/demo/main-run.json")) as { snapshot: { agents: { id: string; name: string; mandate: { cap: string } }[] } };
const DRILL = JSON.parse(read(STOP_DRILL_RECORD)) as { test_money: boolean; cards: unknown[]; passes: { stopped: unknown; timings: { fully_blocked_ms: number } | null; steps: { id: string; pass: boolean; facts: { changed?: string[]; failure_reason?: string } | null }[] }[] };

describe("Built for agentic banking, on Home", () => {
  it("shows each agent with its own card and limits as Airwallex read them back, and its mandate cap on Alta", () => {
    const roster = agentRoster();
    expect(roster).toEqual(AWX.cards.map((c) => ({
      id: c.agent, name: MAIN.snapshot.agents.find((a) => a.id === c.agent)!.name, last4: c.read_back.last4, currency: c.read_back.currency,
      perTx: c.read_back.per_tx, monthly: c.read_back.monthly, altaCap: MAIN.snapshot.agents.find((a) => a.id === c.agent)!.mandate.cap,
    })));
    expect(roster.map((a) => a.id)).toEqual(["sourcing", "support", "treasury"]);
    for (const html of [ON, OFF]) {
      const feat = section(html, "e-feat");
      // Each agent's tile and the note under them name both records (the numbers' check, test/redesign-numbers.test.ts).
      expect(feat.match(/<li class="reveal ag-\w+" data-rec="([^"]+)">/g)?.length).toBe(roster.length);
      expect(feat).toContain(`data-rec="${ROSTER_RECORDS}"`);
      const t = text(feat);
      for (const a of roster) expect(t).toContain(`${a.name} ••${a.last4} Per purchase ${a.currency} ${a.perTx} Per month ${a.currency} ${a.monthly} Alta cap USD ${a.altaCap}`);
      expect(t).toContain(ROSTER_NOTE);
    }
    // No card read back as active: no roster.
    expect(agentRoster(null)).toEqual([]);
    expect(agentRoster({ ...AWX, cards: AWX.cards.map((c) => ({ ...c, read_back: { ...c.read_back, status: "INACTIVE" } })) } as never)).toEqual([]);
  });

  it("states the emergency stop as the drill's record holds it: the last full pass, every card frozen, every check after it blocked", () => {
    const pass = [...DRILL.passes].reverse().find((p) => !p.stopped && p.steps.some((s) => s.id === "stop.pull" && s.pass))!;
    expect(DRILL.test_money).toBe(true);
    expect(pass.steps.filter((s) => s.id.startsWith("blocked.")).every((s) => s.pass)).toBe(true);
    expect(pass.steps.find((s) => s.id === "stop.pull")!.facts!.changed).toHaveLength(DRILL.cards.length);
    const facts = stopDrillFacts();
    expect(facts).toEqual({ agents: DRILL.cards.length, seconds: (pass.timings!.fully_blocked_ms / 1000).toFixed(1) });
    expect(DRILL.cards).toHaveLength(3);
    for (const html of [ON, OFF]) expect(text(section(html, "e-feat"))).toContain(`One signed stop froze all three agents' cards at Airwallex in ${facts!.seconds} s. Sandbox drill record`);
    // A pass the drill halted, or one where a check got through, does not count; none left: no stop control.
    expect(stopDrillFacts({ ...DRILL, passes: DRILL.passes.map((p) => ({ ...p, stopped: "halted" })) } as never)).toBeNull();
    expect(stopDrillFacts({ ...DRILL, passes: DRILL.passes.map((p) => ({ ...p, steps: p.steps.map((s) => s.id === "blocked.purchase" ? { ...s, pass: false } : s) })) } as never)).toBeNull();
    expect(stopDrillFacts({ ...DRILL, test_money: false } as never)).toBeNull();
    expect(agenticControls({ stop: null }).map((c) => c.title)).not.toContain("Emergency stop");
  });

  it("counts the audit log's rows from the log itself, as its README says", () => {
    const rows = read(AUDIT_LOG_RECORD).split("\n").filter((l) => l.trim()).length;
    expect(auditRows()).toBe(rows);
    expect(read(AUDIT_LOG_DOC)).toContain(`**${rows} rows**`);
    for (const html of [ON, OFF]) expect(text(section(html, "e-feat"))).toContain(`the recorded run's ${rows} rows check offline.`);
    expect(agenticControls({ rows: 0 }).map((c) => c.title)).not.toContain("An audit log you can check");
  });

  it("gives every control its proof: a page anchor that is served, or a file of this repository", () => {
    const pages = buildPages({} as NodeJS.ProcessEnv) as unknown as Record<string, string>;
    const page: Record<string, string> = { alta: pages.metal!, proof: pages.proof!, privacy: pages.privacy!, security: pages.security! };
    expect(FEATURES.map((c) => c.title)).toEqual(["Its own mandate", "Its own card and limits", "Passkey on the exact terms", "Emergency stop", "An audit log you can check", "What Claude adds"]);
    expect(FEATURES.find((c) => c.title === "What Claude adds")!.text).toBe(CLAUDE_ADDS);
    for (const link of [...FEATURES.map((c) => c.href), ...TRUST_LINKS.map((l) => l.href)]) {
      if (link.startsWith(REPO_BLOB)) { expect({ link, exists: existsSync(new URL(`../${link.slice(REPO_BLOB.length).replace(/#.*$/, "")}`, import.meta.url)) }).toEqual({ link, exists: true }); continue; }
      if (link === "/verify") continue; // the verifier, served by the site (test/home-story.test.ts's fourth step)
      const [name, anchor] = link.split("#");
      expect({ link, page: typeof page[name!] }).toEqual({ link, page: "string" });
      if (anchor) expect({ link, anchor: page[name!]!.includes(`id="${anchor}"`) }).toEqual({ link, anchor: true });
    }
    expect(FEATURES.find((c) => c.title === "Emergency stop")!.href).toBe(`${REPO_BLOB}${STOP_DRILL_DOC}`);
    // Without /verify, the passkey's proof is /proof.
    expect(agenticControls({ verifyUrl: "" }).find((c) => c.title === "Passkey on the exact terms")!.href).toBe("proof");
    for (const html of [ON, OFF]) for (const c of FEATURES) expect(section(html, "e-feat")).toContain(`<a class="pf" href="${c.href.replace(/&/g, "&amp;")}"`);
  });
});

describe("For your security review, on Home", () => {
  it("names each connection with the label the connections hub gives it, never stronger", () => {
    const cat = connectionsCatalogue("https://cloud.example");
    const kind = (n: string) => [...cat.connections, ...cat.money].find((c) => c.name === n)?.kind;
    const shown: Record<string, string> = { live: "running", "format export": "CSV export", sandbox: "sandbox", testnet: "testnet" };
    for (const x of INTEGRATIONS) for (const h of x.hub) expect({ h, label: x.label }).toEqual({ h, label: shown[kind(h) ?? ""] ?? "missing" });
    for (const html of [ON, OFF]) {
      const t = text(section(html, "e-trust"));
      for (const x of INTEGRATIONS) expect(t).toContain(`${x.name} ${x.label}`);
      for (const l of TRUST_LINKS) expect(t).toContain(`${l.label} ${l.sub}`);
      // No customer, price, certification or endorsement is claimed here.
      expect(t).not.toMatch(/customer|pricing|price|certified|compliant|SOC ?2|ISO 27001|endorse|design partner/i);
    }
  });
});
