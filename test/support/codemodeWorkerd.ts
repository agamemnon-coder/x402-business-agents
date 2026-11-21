// A loader Worker for test/cloud-codemode-workerd.test.ts: Code Mode's real host code (cloud/src/claude/codemode.ts:
// runCode, the host's call function and workerLoaderExecutor) in local workerd with a real Worker Loader binding, over
// two made-up companies' books. POST { tenant, code } runs the code as that company and answers the run's result.
// SECRET_SENTINEL is a made-up value in this Worker's own env: the tests prove it never reaches the isolate or an answer.
// Test data only; nothing here is real money.
import { z } from "zod";
import { runCode, workerLoaderExecutor, type CodeLoader, type CodeTool } from "../../cloud/src/claude/codemode.js";

interface Ctx { tenant: "A" | "B" }
type Inv = { id: string; vendor: string; total: string; status: string };
const BOOKS: Record<Ctx["tenant"], Inv[]> = {
  A: [{ id: "A-0001", vendor: "Bergtex", total: "1850.00", status: "waiting_cfo" }, { id: "A-0002", vendor: "Lumen", total: "120.00", status: "paid" }],
  B: [{ id: "B-0001", vendor: "Other Co", total: "999.00", status: "waiting_cfo" }],
};
const answer = (data: Record<string, unknown>) => ({ content: [{ type: "text", text: "ok" }], structuredContent: data });
const refuse = (code: string, sentence: string) => ({ content: [{ type: "text", text: sentence }, { type: "text", text: JSON.stringify({ error: { code, message: sentence } }) }], isError: true });

const TOOLS: CodeTool<Ctx>[] = [
  { name: "list_invoices", title: "Invoices", description: "The company's invoices.", readOnly: true,
    inputSchema: { type: "object", properties: { status: { type: "string" }, limit: { type: "integer" } }, additionalProperties: false },
    outputSchema: { type: "object", properties: { items: { type: "array", items: { type: "object" } } }, required: ["items"] },
    args: z.object({ status: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }).strict(),
    run: async (c, a) => answer({ items: BOOKS[c.tenant].filter((i) => !a.status || i.status === a.status).slice(0, (a.limit as number | undefined) ?? 100) }) },
  { name: "get_invoice", title: "One invoice", description: "One invoice by id.", readOnly: true,
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
    outputSchema: { type: "object", properties: { invoice: { type: "object" } }, required: ["invoice"] },
    args: z.object({ id: z.string().max(40) }).strict(),
    run: async (c, a) => { const i = BOOKS[c.tenant].find((x) => x.id === a.id); return i ? answer({ invoice: i }) : refuse("not_found", `no invoice ${String(a.id)}`); } },
  { name: "big_report", title: "A large report", description: "Far more data than one answer may carry.", readOnly: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false }, outputSchema: { type: "object" },
    args: z.object({}).strict(), run: async () => answer({ rows: "x".repeat(400_000) }) },
  // Not read-only: Code Mode must never offer it, even when a tool list hands it over.
  { name: "propose_invoice_payment", title: "Propose", description: "Files a payment for the CFO.", readOnly: false,
    inputSchema: { type: "object", properties: { invoice_id: { type: "string" } }, additionalProperties: false }, outputSchema: { type: "object" },
    args: z.object({ invoice_id: z.string() }).strict(), run: async () => { throw new Error("must never run"); } },
];

interface Env { LOADER: CodeLoader; SECRET_SENTINEL: string }
const logs: unknown[] = [];

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/logs") return Response.json(logs.splice(0));
    const b = (await req.json()) as { tenant: "A" | "B"; code: string; wallMs?: number };
    const run = await runCode({ tools: TOOLS, ctx: { tenant: b.tenant }, code: b.code, executor: workerLoaderExecutor(env.LOADER), who: { tenant: `t_${b.tenant}`, principal: "k_test" },
      ...(b.wallMs ? { wallMs: b.wallMs } : {}), log: (level, event, fields) => { logs.push({ level, event, ...fields }); } });
    return Response.json(run);
  },
};
