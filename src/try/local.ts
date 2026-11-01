// Try Purser on a local server (npm run judge, the dashboard): no model is asked, so code reads a typed task and code
// decides a world change (D21), and each answer says why. One handler for both servers.
import { TRY_MAX_CHARS, tryPurserSafely } from "./engine.js";
import { tryWorld, worldChange } from "./world.js";

export async function localTryAnswer(body: unknown, why: string, now = new Date()): Promise<{ status: number; json: unknown }> {
  const b = (body && typeof body === "object" ? body : {}) as { text?: unknown; world?: unknown };
  if (b.world !== undefined) {
    if (typeof b.world !== "string" || !worldChange(b.world)) return { status: 400, json: { error: "pick one of the world changes on the page" } };
    return { status: 200, json: await tryWorld(b.world, null, now, why) };
  }
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text) return { status: 400, json: { error: "type what an agent should do" } };
  if (text.length > TRY_MAX_CHARS) return { status: 413, json: { error: `at most ${TRY_MAX_CHARS} characters` } };
  return { status: 200, json: await tryPurserSafely(text, null, now, why) };
}
