// ASVS 4.0.3 V1.1.2 and V1.1.3 (docs/security/asvs-l2.md): every pull request carries a threat model, and one that
// touches the security-sensitive code cannot say "none" (scripts/pr-threat-model.ts, run by
// .github/workflows/threat-model.yml); every feature request states its security constraints (a required field of the
// issue form .github/ISSUE_TEMPLATE/feature_request.yml; blank issues are off).
import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SENSITIVE_PATHS, threatModelProblems } from "../scripts/pr-threat-model.js";

const filled = "## What changed\n\nx\n\n## Threat model\n\nSpoofing: the new route takes a session only; Tampering: the body is checked by zod; nothing new is logged.\n\n## Why\n";

describe("the pull request threat-model gate (V1.1.2)", () => {
  it("passes a filled threat model, whatever the files", () => {
    expect(threatModelProblems(filled, ["cloud/src/auth.ts", "README.md"])).toEqual([]);
  });

  it("fails a body without the section, or with the template's prompt left as it is", () => {
    expect(threatModelProblems("## What changed\n\nx\n", ["README.md"])).toEqual([expect.stringMatching(/no "## Threat model" section/)]);
    const template = readFileSync(".github/pull_request_template.md", "utf8");
    expect(threatModelProblems(template, ["README.md"])).toEqual([expect.stringMatching(/empty/)]);
  });

  it("takes \"None\" only when no security-sensitive file changed", () => {
    const none = "## Threat model\n\nNone: documentation only.\n\n## Why\n";
    expect(threatModelProblems(none, ["docs/cloud.md"])).toEqual([]);
    for (const f of ["cloud/src/auth.ts", "worker/src/webauthn.ts", "src/policy/limits.ts", "cloud/src/stepUp.ts", "cloud/wrangler.jsonc"]) {
      expect(threatModelProblems(none, [f]), f).toEqual([expect.stringMatching(/security-sensitive/)]);
    }
  });

  it("names the paths CODEOWNERS guards", () => {
    expect(SENSITIVE_PATHS.length).toBeGreaterThan(5);
  });

  it("runs on every pull request, reading the body and the file list only through the environment and a file", () => {
    const wf = readFileSync(".github/workflows/threat-model.yml", "utf8");
    expect(wf).toMatch(/on:\n {2}pull_request:\n {4}types: \[opened, edited, synchronize, reopened\]/);
    expect(wf).toContain("PR_BODY: ${{ github.event.pull_request.body }}");
    expect(wf).toContain("tsx@4.23.15 scripts/pr-threat-model.ts");
    expect(wf).not.toMatch(/run: [^\n]*\$\{\{ github\.event/);
    expect(wf).toMatch(/permissions: \{\}/);
  });

  it("the pull request template asks for it", () => {
    expect(readFileSync(".github/pull_request_template.md", "utf8")).toMatch(/^## Threat model$/m);
  });
});

describe("security constraints in every feature (V1.1.3)", () => {
  it("the feature request form requires them, and blank issues are off", () => {
    expect(existsSync(".github/ISSUE_TEMPLATE/feature_request.md")).toBe(false);
    const form = readFileSync(".github/ISSUE_TEMPLATE/feature_request.yml", "utf8");
    expect(form).toMatch(/id: security_constraints\n\s+attributes:\n\s+label: Security constraints[^\n]*\n[\s\S]*?validations:\n\s+required: true/);
    expect(readFileSync(".github/ISSUE_TEMPLATE/config.yml", "utf8")).toMatch(/^blank_issues_enabled: false$/m);
  });
});
