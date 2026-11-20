// ASVS 4.0.3 V1.8.2 (docs/security/asvs-l2.md): the data classification (docs/security/data-classification.md) gives each
// protection level its requirements (encryption, integrity, retention, access, logging, export) and classifies every
// table the code creates: the D1 migrations, the runner's schema and each CREATE TABLE in the Workers' and the runner's
// code. A table's columns that hold personal or financial data, or a credential, are named in its row, and such a table
// is never below Restricted. A new table or a new such column without a row fails here.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { schemaTables } from "./support/schemaTables.js";

const DOC = readFileSync("docs/security/data-classification.md", "utf8");
const LEVELS = ["Secret", "Restricted", "Internal", "Public"] as const;
/** Columns that hold personal or financial data by their name. */
export const PERSONAL_OR_FINANCIAL = /^(email|display_name|name|business_name|resolved_name|nickname|customer|payer|person|approver|iban|new_iban|iban_last4|iban_sha256|bic|new_bic|account|account_ref|account_id|global_account_id|address|from_address|to_address|to_addr|from_addr|addr|ip|user_agent|vendor|party|beneficiary_id|cardholder_id|card_id|last4|merchant|[a-z_]*amount[a-z_]*|[a-z_]*_cents|cents|total|subtotal|tax|balance|body|body_json|payload_json|entry_json|terms_json|text|transcription|memo|description|filename|subject|target|target_mask|url|redirect_uri|data|raw|note|message|endpoint)$/;
/** Columns that hold a credential, a secret or its hash. */
export const CREDENTIAL = /^(secret|salt|auth|p256dh|[a-z_]*_sealed|secret_sha256|token_sha256|code_sha256|key_sha256|token_hash|verifier_sealed|visitor_sha256)$/;

/** Each row of the inventory: its tables, level and named columns. */
const rows = [...DOC.matchAll(/^\| ((?:`[a-z_0-9]+`(?:, )?)+) \| (Secret|Restricted|Internal|Public) \| ([^|]*) \| ([^|]+) \|$/gm)].map((m) => ({
  tables: [...m[1]!.matchAll(/`([a-z_0-9]+)`/g)].map((x) => x[1]!), level: m[2]!, columns: new Set([...m[3]!.matchAll(/`([a-z_0-9]+)`/g)].map((x) => x[1]!)),
}));
const rowOf = new Map(rows.flatMap((r) => r.tables.map((t) => [t, r] as const)));

describe("the data classification (V1.8.2)", () => {
  it("gives each level its protection requirements", () => {
    for (const l of LEVELS) expect(DOC, l).toMatch(new RegExp(`^### ${l}\\b`, "m"));
    for (const req of ["Encryption", "Integrity", "Retention", "Access", "Logging", "Export"]) expect(DOC, req).toMatch(new RegExp(`\\*\\*${req}\\*\\*`));
  });

  it("classifies every table the code creates, once", () => {
    const all = [...schemaTables().keys()];
    expect(all.length).toBeGreaterThan(150);
    expect(all.filter((t) => !rowOf.has(t))).toEqual([]);
    const seen = rows.flatMap((r) => r.tables);
    expect(seen.length).toBe(new Set(seen).size);
    expect(seen.filter((t) => !all.includes(t))).toEqual([]);
  });

  it("names each column that holds personal or financial data or a credential, and never rates such a table below Restricted", () => {
    const problems: string[] = [];
    for (const [t, { columns }] of schemaTables()) {
      const r = rowOf.get(t);
      if (!r) continue;
      for (const c of columns) {
        const pf = PERSONAL_OR_FINANCIAL.test(c), cred = CREDENTIAL.test(c);
        if ((pf || cred) && !r.columns.has(c)) problems.push(`${t}.${c} not named`);
        if (cred && r.level !== "Secret") problems.push(`${t}.${c} holds a credential: ${t} must be Secret, not ${r.level}`);
        if (pf && (r.level === "Internal" || r.level === "Public") && !/^(name|data|note|target|url|amount|cents|[a-z_]*_cents|total|balance|description|message|body|text|endpoint)$/.test(c)) problems.push(`${t}.${c} is personal or financial: ${t} must be Restricted or Secret, not ${r.level}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
