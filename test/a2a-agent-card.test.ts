// The A2A Agent Card (Google's Agent2Agent protocol, 0.3 fields) at /.well-known/agent.json and agent-card.json: the
// required fields are there and of the right kind, each skill reads or proposes (none approves) and names operations
// that exist in the OpenAPI document, the auth scheme is a bearer key, and the card holds no company and no secret.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openApi } from "../cloud/src/app.js";
import { AGENT_SKILLS, agentCard } from "../cloud/src/discovery.js";
import { ORIGIN, testCloud, type TestCloud } from "./support/cloud.js";

type Card = Record<string, unknown> & { skills: Record<string, unknown>[]; capabilities: Record<string, unknown>; securitySchemes: Record<string, Record<string, unknown>>; security: Record<string, string[]>[] };

let c: TestCloud;
beforeAll(() => { c = testCloud(); });
afterAll(() => c.close());

/** The fields A2A requires of an AgentCard, and of each AgentSkill. */
function validate(card: Card): string[] {
  const bad: string[] = [];
  const str = (o: Record<string, unknown>, k: string, where: string) => { if (typeof o[k] !== "string" || !(o[k] as string).length) bad.push(`${where}.${k}`); };
  for (const k of ["protocolVersion", "name", "description", "url", "version"]) str(card, k, "card");
  try { if (new URL(card.url as string).protocol !== "https:") bad.push("card.url is not https"); } catch { bad.push("card.url is not a URL"); }
  if (typeof card.capabilities !== "object" || card.capabilities === null) bad.push("card.capabilities");
  for (const k of ["defaultInputModes", "defaultOutputModes"]) if (!Array.isArray(card[k]) || !(card[k] as unknown[]).every((m) => typeof m === "string")) bad.push(`card.${k}`);
  if (!Array.isArray(card.skills) || !card.skills.length) bad.push("card.skills");
  for (const s of card.skills ?? []) {
    for (const k of ["id", "name", "description"]) str(s, k, `skill ${String(s.id)}`);
    if (!Array.isArray(s.tags) || !(s.tags as unknown[]).length) bad.push(`skill ${String(s.id)}.tags`);
  }
  for (const req of card.security ?? []) for (const name of Object.keys(req)) if (!card.securitySchemes?.[name]) bad.push(`security names an unknown scheme ${name}`);
  return bad;
}

describe("the A2A Agent Card", () => {
  it("is served at both well-known names, with every required field", async () => {
    const a = await c.req("GET", "/.well-known/agent.json");
    const b = await c.req("GET", "/.well-known/agent-card.json");
    expect(a.status).toBe(200);
    expect(a.res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(a.res.headers.get("access-control-allow-origin")).toBe("*");
    expect(b.json).toEqual(a.json);
    const card = a.json as unknown as Card;
    expect(validate(card)).toEqual([]);
    expect(card).toMatchObject({ name: "Purser", url: `${ORIGIN}/mcp`, documentationUrl: `${ORIGIN}/api` });
  });

  it("finds a missing field (the validator itself)", () => {
    const card = agentCard(ORIGIN) as Card;
    expect(validate({ ...card, name: "", skills: [{ id: "x" }] } as Card)).toEqual(expect.arrayContaining(["card.name", "skill x.name", "skill x.description", "skill x.tags"]));
  });

  it("has skills that read or propose, never approve, each on an operation of the OpenAPI document", () => {
    const card = agentCard(ORIGIN) as Card;
    const doc = openApi(ORIGIN) as { paths: Record<string, Record<string, { operationId: string; "x-purser-needs": string }>> };
    const ops = new Map(Object.values(doc.paths).flatMap((m) => Object.values(m)).map((o) => [o.operationId, o["x-purser-needs"]]));
    expect(AGENT_SKILLS.map((s) => s.id)).toEqual(["read-books", "pending-approvals", "propose-payment", "proposal-status"]);
    for (const s of AGENT_SKILLS) {
      for (const op of s["x-purser"].operations) {
        expect(ops.has(op), op).toBe(true);
        expect(["read", s["x-purser"].effect === "proposes" ? "propose" : "read"]).toContain(ops.get(op));
      }
      expect(JSON.stringify(s)).not.toMatch(/"approve|approve_|\/approve/);
    }
    expect(card.capabilities).toMatchObject({ extensions: [{ params: { approves_payments: false, a2a_task_messaging: false } }] });
  });

  it("authenticates with a bearer key, and names no company and no secret", () => {
    const card = agentCard(ORIGIN) as Card;
    expect(card.securitySchemes.bearer).toMatchObject({ type: "http", scheme: "bearer" });
    expect(card.security).toEqual([{ bearer: [] }]);
    const text = JSON.stringify(card);
    expect(text).not.toMatch(/pck_[A-Za-z0-9]|pcs\.|purser-demo-read-only|"t_[A-Za-z0-9]/);
  });
});
