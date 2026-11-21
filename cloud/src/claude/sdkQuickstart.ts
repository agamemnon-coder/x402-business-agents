// The SDK quickstart, one source for /connect-ai, the README and docs/integrations/README.md (test/sdk-quickstart.test.ts
// checks the two documents carry it word for word and runs both snippets against Purser Cloud in-process). One question:
// which invoices wait for the CFO. The clients (sdk/typescript, sdk/python) are not published to npm or PyPI: they run
// from a clone of the repository.
//
// The demo token (purser-demo-read-only) works at /mcp only (cloud/src/app.ts: a connector token is refused on the API),
// so the snippets take an API key with the read scope, a placeholder here, never a real one.

export const REPO_URL = "https://github.com/agamemnon-coder/x402-business-agents";

export interface SdkQuickstart { shell: string; ts: string; py: string }

export function sdkQuickstart(origin = "https://purser.example.com"): SdkQuickstart {
  return {
    shell: [
      `git clone ${REPO_URL} purser && cd purser`,
      `export PURSER_URL=${origin}`,
      "export PURSER_API_KEY=pck_...   # a key with the read scope; never in code",
    ].join("\n"),
    ts: [
      "// quickstart.ts, in the clone: npx tsx quickstart.ts",
      'import { Purser } from "./sdk/typescript/src/index.js";',
      "const purser = Purser.fromEnv();",
      "for (const i of await purser.listPayableInvoices())",
      '  if (i.proposal?.status === "PENDING_APPROVAL") console.log(i.id, i.vendor, i.currency, i.total, "waits for the CFO");',
    ].join("\n"),
    py: [
      "# quickstart.py, in the clone: python3 quickstart.py",
      'import sys; sys.path.insert(0, "sdk/python")',
      "from purser import Purser",
      "purser = Purser.from_env()",
      "for i in purser.list_payable_invoices():",
      '    if (i.get("proposal") or {}).get("status") == "PENDING_APPROVAL":',
      '        print(i["id"], i["vendor"], i["currency"], i["total"], "waits for the CFO")',
    ].join("\n"),
  };
}

/** The snippets as a Markdown block for the README and docs/integrations/README.md. */
export function sdkQuickstartMarkdown(): string {
  const q = sdkQuickstart();
  return ["```sh", q.shell, "```", "", "```ts", q.ts, "```", "", "```python", q.py, "```"].join("\n");
}
