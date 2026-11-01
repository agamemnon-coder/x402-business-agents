// The JSON schema a strict tool is sent with, from its zod schema. Pure (zod only), so the relay Worker uses it too (D21).
import { z } from "zod";

// Strict tools do not accept number bounds and the like (dry-96: Haiku answered 400 to an integer with minimum/maximum). The schema
// Claude sees says them in words instead; the tool's own zod schema still checks every input before it runs.
// Review (1 Nov): string and list bounds too, so a future z.string().min() cannot bring the 400 back.
const NUMBER_BOUNDS = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems"] as const;
function dropBounds(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(dropBounds);
  if (!node || typeof node !== "object") return node;
  const o = { ...(node as Record<string, unknown>) };
  const said: string[] = [];
  for (const k of NUMBER_BOUNDS) if (k in o) { said.push(`${k} ${String(o[k])}`); delete o[k]; }
  if (said.length) o.description = `${o.description ? `${String(o.description)} ` : ""}(${said.join(", ")})`;
  for (const [k, v] of Object.entries(o)) {
    if (k === "description") continue;
    // A map of names (properties, $defs): its keys are field names, not keywords; only its values are schemas.
    o[k] = (k === "properties" || k === "$defs" || k === "definitions") && v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([n, x]) => [n, dropBounds(x)]))
      : dropBounds(v);
  }
  return o;
}

/** The JSON schema a strict tool is sent with: the zod schema without the number bounds the API refuses. */
export function apiInputSchema(input: z.ZodType): Record<string, unknown> {
  return dropBounds(z.toJSONSchema(input)) as Record<string, unknown>;
}
