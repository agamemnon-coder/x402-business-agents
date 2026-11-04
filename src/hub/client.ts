// The two calls to Max's hub. Each gives up after 3 s, and neither ever throws: a push that fails is logged and
// forgotten, a decisions read that fails says why in one word. Neither the hub's URL nor its token is ever in a log
// line or an error: failures are reported as "timeout", "network", "http <status>" or "invalid response".

import { z } from "zod";
import type { DB } from "../db/open.js";
import { HUB_TIMEOUT_MS, hubEndpoint, type HubEndpoint } from "./config.js";
import { assertSafeBody, buildPushBody, type HubBody } from "./runs.js";

export interface HubDeps {
  fetch: typeof fetch;
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  timeoutMs?: number;
  now?: () => Date;
}

export type HubFailure = "not configured" | "timeout" | "network" | `http ${number}` | "invalid response" | "unsafe body";

function failure(e: unknown): HubFailure {
  const name = (e as { name?: string } | null)?.name;
  return name === "TimeoutError" || name === "AbortError" ? "timeout" : "network";
}

/** Sends the last runs to the hub. Resolves with what happened; never rejects. */
export async function pushRuns(db: DB, deps: HubDeps): Promise<{ ok: true; runs: number } | { ok: false; reason: HubFailure }> {
  const env = deps.env ?? process.env;
  const ep = hubEndpoint(env);
  if (!ep) return { ok: false, reason: "not configured" };
  let body: HubBody;
  try {
    body = buildPushBody(db, env);
    assertSafeBody(body, [ep.url, ep.token]);
  } catch {
    deps.log?.("hub      push withheld: the body failed its safety check; nothing was sent");
    return { ok: false, reason: "unsafe body" };
  }
  try {
    const res = await deps.fetch(`${ep.url}/push/purser`, {
      method: "POST",
      headers: { "X-Push-Token": ep.token, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(deps.timeoutMs ?? HUB_TIMEOUT_MS),
    });
    if (!res.ok) {
      deps.log?.(`hub      push failed (http ${res.status}); ignored`);
      return { ok: false, reason: `http ${res.status}` };
    }
    return { ok: true, runs: body.runs.length };
  } catch (e) {
    const reason = failure(e);
    deps.log?.(`hub      push failed (${reason}); ignored`);
    return { ok: false, reason };
  }
}

/** One decision as the hub keeps it. Anything else in an entry makes that entry count as no decision. */
const DecisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  at: z.string().max(40).optional(),
  by: z.string().max(40).optional(),
});
export type HubDecision = z.infer<typeof DecisionSchema>;

/** The response's outer shape; a response that does not have it counts as an erroring hub. */
const ResponseSchema = z.object({ decisions: z.record(z.string().max(80), z.unknown()) });

const MAX_RESPONSE_BYTES = 256 * 1024;

export type DecisionsRead = { ok: true; decisions: Map<string, HubDecision> } | { ok: false; reason: HubFailure };

/** Reads the hub's decisions. Entries that do not validate are dropped (they decide nothing). Never rejects. */
export async function fetchDecisions(deps: HubDeps, ep: HubEndpoint | null = hubEndpoint(deps.env ?? process.env)): Promise<DecisionsRead> {
  if (!ep) return { ok: false, reason: "not configured" };
  let text: string;
  try {
    const res = await deps.fetch(`${ep.url}/purser/decisions`, {
      method: "GET",
      headers: { "X-Push-Token": ep.token, accept: "application/json" },
      signal: AbortSignal.timeout(deps.timeoutMs ?? HUB_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, reason: `http ${res.status}` };
    text = await res.text();
  } catch (e) {
    return { ok: false, reason: failure(e) };
  }
  if (text.length > MAX_RESPONSE_BYTES) return { ok: false, reason: "invalid response" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid response" };
  }
  const outer = ResponseSchema.safeParse(parsed);
  if (!outer.success) return { ok: false, reason: "invalid response" };
  const decisions = new Map<string, HubDecision>();
  for (const [id, raw] of Object.entries(outer.data.decisions)) {
    const d = DecisionSchema.safeParse(raw);
    if (d.success) decisions.set(id, d.data);
  }
  return { ok: true, decisions };
}
