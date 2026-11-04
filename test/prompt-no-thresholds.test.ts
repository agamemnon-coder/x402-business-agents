// No threshold or amount from the policy is typed into an agent's prompt. The model explains; code holds every
// number (src/config/policy.ts, the CFO policy's rules in src/policy/rules.ts). This test reads the STATIC prompt text
// in the source: every string literal of a system prompt (a const named SYSTEM, PROMPT or INSTRUCTIONS), of a tool's
// `description`, and of a zod `.describe(...)`, in the agent, autonomy, Claude, /try and platform modules. A value code
// passes in at runtime (`${fromCents(TOTAL_BUDGET_CENTS)}`, or the facts a tool returns) is a code fact, not prompt
// text: the static parts around it are checked, the value itself is not. Ids, model names and dates are allowed.
import ts from "typescript";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as policy from "../src/config/policy.js";
import { openDb } from "../src/db/open.js";
import { fromCents } from "../src/lib/money.js";
import { rules } from "../src/policy/rules.js";

const DIRS = ["src/autonomy", "src/agents", "src/claude", "src/try", "src/platform"];
const PROMPT_VAR = /SYSTEM|PROMPT|INSTRUCTION/i;
const PROMPT_PROP = /^(description|system|instructions|systemPrompt)$/;

/** The static text of every prompt and tool description in one source file. */
export function promptTexts(path: string, source: string): string[] {
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const collect = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    else if (ts.isTemplateExpression(n)) {
      out.push(n.head.text);
      for (const s of n.templateSpans) out.push(s.literal.text);
    }
    ts.forEachChild(n, collect);
  };
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && PROMPT_VAR.test(n.name.text) && n.initializer) collect(n.initializer);
    else if (ts.isPropertyAssignment(n) && PROMPT_PROP.test(n.name.getText(sf).replace(/["']/g, ""))) collect(n.initializer);
    else if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "describe") n.arguments.forEach(collect);
    else ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Every number in the policy, as it would be written: cents as "20.00", other counts as "30". Zero is left out. */
function policyNumbers(): Map<string, string> {
  const out = new Map<string, string>();
  const add = (value: string, where: string) => { if (!out.has(value)) out.set(value, where); };
  const walk = (v: unknown, path: string, centsKey: boolean): void => {
    if (typeof v === "number" && Number.isInteger(v) && v !== 0) add(centsKey ? fromCents(v) : String(v), path);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, centsKey));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`, /cents/i.test(k) || centsKey);
  };
  for (const [name, v] of Object.entries(policy)) walk(v, name, /CENTS/.test(name));
  for (const r of rules(openDb(":memory:"))) {
    if (r.kind === "money" || r.kind === "optional_money") {
      if (r.fallback && r.fallback !== "0.00") add(r.fallback, `rule ${r.key} (default)`);
      if (r.min) add(fromCents(r.min), `rule ${r.key} (min)`);
      if (r.max) add(fromCents(r.max), `rule ${r.key} (max)`);
    }
  }
  return out;
}

/** The numbers in a text, after the allowed tokens (dates, ids, model names) are taken out. */
function numbersIn(text: string): string[] {
  const cleaned = text
    .replace(/\b\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?\b/g, " ")
    .replace(/\b[A-Z]{1,4}-\d{2,}\b/g, " ")
    .replace(/\bclaude-[a-z0-9.-]+\b/gi, " ")
    .replace(/\b[a-z]+\d+[a-z0-9]*\b/gi, " ");
  return cleaned.match(/\d+(?:\.\d+)?/g) ?? [];
}

function files(): string[] {
  return DIRS.flatMap((d) => readdirSync(d, { recursive: true }).map(String).filter((f) => f.endsWith(".ts")).map((f) => `${d}/${f}`));
}

describe("agent prompts", () => {
  const values = policyNumbers();

  it("knows the policy's numbers", () => {
    // Sanity: the set holds the limits this test is about.
    expect(values.get(fromCents(policy.TOTAL_BUDGET_CENTS))).toBeDefined();
    expect(values.get(fromCents(policy.REFUND_AUTO_EACH_CENTS))).toBeDefined();
    expect(values.get("300.00")).toBeDefined();
    expect(values.get(String(policy.VELOCITY.sourcing.perMinute))).toBeDefined();
  });

  it("finds the prompts it checks", () => {
    const all = files().flatMap((f) => promptTexts(f, readFileSync(f, "utf8")));
    // Fails if: the extractor stops seeing the agents' system prompts and tool descriptions (it would then pass on nothing).
    expect(all.some((t) => t.startsWith("You are the Treasury agent"))).toBe(true);
    expect(all.some((t) => t.startsWith("You are the Support agent"))).toBe(true);
    expect(all.some((t) => t.startsWith("Submit your rebalance"))).toBe(true);
    expect(all.length).toBeGreaterThan(100);
  });

  it("flags a policy number typed into a prompt (the check itself works)", () => {
    const planted = `const SYSTEM = ["Never refund more than 0.10 a sale", \`at most \${x} test USD\`];\nconst tool = { description: "Keep at least 25000.00 EUR" };`;
    const hits = promptTexts("planted.ts", planted).flatMap(numbersIn).filter((n) => values.has(n));
    expect(hits).toEqual(["0.10", "25000.00"]);
  });

  it("states no threshold or amount from the policy in any static prompt text", () => {
    const found: string[] = [];
    for (const f of files()) {
      for (const t of promptTexts(f, readFileSync(f, "utf8"))) {
        for (const n of numbersIn(t)) if (values.has(n)) found.push(`${f}: "${n}" (= ${values.get(n)}) in "${t.slice(0, 80)}"`);
      }
    }
    // Fails if: a prompt or tool description types in a number the policy holds. Pass it in from code instead.
    expect(found).toEqual([]);
  });
});
