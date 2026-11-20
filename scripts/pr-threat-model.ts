// The pull request threat-model gate (ASVS 4.0.3 V1.1.2; .github/workflows/threat-model.yml): every pull request's
// description has a "## Threat model" section that is filled in, and one that touches the security-sensitive code
// cannot answer "None". It reads the description from PR_BODY and the changed files from the file CHANGED_FILES names
// (one path per line), both untrusted text, never run. Run: PR_BODY=... CHANGED_FILES=files.txt npx tsx scripts/pr-threat-model.ts
import { readFileSync } from "node:fs";
import process from "node:process";

/** Where a change can alter who may do what, what is trusted or what leaves the system: a threat model, never "None". */
export const SENSITIVE_PATHS: string[] = [
  "cloud/src/auth.ts", "cloud/src/adminKeys.ts", "cloud/src/stepUp.ts", "cloud/src/crypto.ts", "cloud/src/sealed.ts", "cloud/src/securityAudit.ts",
  "cloud/src/securityLog.ts", "cloud/src/baseHeaders.ts", "cloud/src/claude/", "cloud/src/tenant.ts", "cloud/src/sync.ts", "cloud/src/exports.ts",
  "cloud/migrations/", "cloud/wrangler", "worker/src/", "worker/wrangler", "src/policy/", "src/passkey/", "src/lib/securityEvents.ts", ".github/workflows/",
];

const sensitive = (f: string) => SENSITIVE_PATHS.some((p) => (p.endsWith("/") ? f.startsWith(p) : f === p || f.startsWith(p)));

/** What is wrong with a pull request's threat model; empty when it passes. */
export function threatModelProblems(body: string, files: string[]): string[] {
  const text = body.replace(/\r\n/g, "\n");
  const m = /^## Threat model[ \t]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text);
  if (!m) return ['the description has no "## Threat model" section (.github/pull_request_template.md)'];
  const said = m[1]!.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (said.length < 4) return ['the "## Threat model" section is empty: say what this change could let someone do, and what stops it, or "None: <why>"'];
  const touched = files.filter(sensitive);
  if (/^none\b/i.test(said) && touched.length) return [`this change touches security-sensitive code (${touched.slice(0, 5).join(", ")}), so its threat model cannot be "None"`];
  return [];
}

if (process.argv[1]?.endsWith("pr-threat-model.ts")) {
  const files = readFileSync(process.env.CHANGED_FILES ?? "/dev/null", "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  const problems = threatModelProblems(process.env.PR_BODY ?? "", files);
  for (const p of problems) console.log(`::error title=Threat model::${p}`);
  if (problems.length) process.exit(1);
  console.log("threat model: present");
}
