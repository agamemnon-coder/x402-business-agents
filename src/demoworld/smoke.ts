// The smoke check for a demo deployment of Purser Cloud (docs/cloud-demo.md), run after a deploy and after a re-seed:
// `npm run cloud:smoke-demo -- --base https://<the demo's host>`. It makes GET requests only, never more than
// `smokeBudget(companies)`, and checks that the deployment answers as the runbook says: in demo mode, with the seeded
// companies, their reads answering 200 with labelled test data, the documents being what their hashes say, every GET
// that is off answering 403 `demo_read_only`, and no answer carrying a key or a session. It sends no key and reads none.
// Write attempts are not made here; the runbook lists them for a person to try by hand.

import { createHash } from "node:crypto";

export type SmokeFetch = (url: string, init: RequestInit) => Promise<Response>;
export interface SmokeCheck { name: string; ok: boolean; detail: string }
export interface SmokeReport { ok: boolean; base: string; requests: number; budget: number; checks: SmokeCheck[] }

/** Each demo company's reads (under /v1/demo/{company}/), each of which must answer 200. */
export const SMOKE_COMPANY_READS = ["me", "invoices", "vendors", "payments", "transactions", "transactions/summary", "ledger/entries", "reports/trial", "insights", "vault"] as const;
/** Read from what those answered: one invoice, its document, and one vault file by its SHA-256. */
export const SMOKE_COMPANY_DERIVED = ["invoices/{id}", "invoices/{id}/document", "documents/{sha256}"] as const;
/** GETs that exist outside demo mode and must answer 403 `demo_read_only` in it ({company}: the first demo company). */
export const SMOKE_REFUSED = ["/v1/me", "/v1/invoices", "/v1/keys", "/v1/users", "/v1/export", "/v1/mail", "/v1/sync/state", "/v1/admin/companies", "/v1/demo/{company}/keys", "/v1/demo/{company}/export"] as const;
/** The deployment's own: the health check, the API description, the companies list and the console page. */
export const SMOKE_GLOBAL = ["/v1/health", "/v1/openapi.json", "/v1/demo/companies", "/"] as const;
/** A company address no demo has: it must answer 404 like any other unknown address. */
export const SMOKE_UNKNOWN = "/v1/demo/no-such-company/invoices";

/** The most requests one run makes for `companies` demo companies. */
export const smokeBudget = (companies: number) => SMOKE_GLOBAL.length + SMOKE_REFUSED.length + 1 + companies * (SMOKE_COMPANY_READS.length + SMOKE_COMPANY_DERIVED.length);

/** What a key, a session or a stored secret looks like in an answer (test/cloud-demo.test.ts holds the same). */
const SECRET = /pck_k?[A-Za-z0-9]{8,}_|pcs\.[A-Za-z0-9_-]{20,}\.|whsec_[A-Za-z0-9_-]{8,}|secret_sha256|token_sha256/;
const SLUG = /^[a-z0-9][a-z0-9-]{1,40}$/;

interface Answer { status: number; headers: Headers; bytes: Uint8Array; text: string; json: Record<string, unknown> | null; error?: string }
type Json = Record<string, unknown>;
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);

/** The address to check: https (http only on this machine), no path, no query. Throws otherwise. */
export function smokeBase(base: string): string {
  let u: URL;
  try { u = new URL(base); } catch { throw new Error(`not an address: ${base}`); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (!(u.protocol === "https:" || (u.protocol === "http:" && local))) throw new Error("the address must start with https:// (http:// only for localhost)");
  if (u.pathname !== "/" || u.search || u.hash || u.username || u.password) throw new Error("give the deployment's address only, with no path or query");
  return u.origin;
}

export async function smokeDemo(base: string, o: { slugs: readonly string[]; fetch?: SmokeFetch; timeoutMs?: number }): Promise<SmokeReport> {
  const origin = smokeBase(base);
  const slugs = [...o.slugs];
  if (slugs.length < 1 || slugs.length > 12 || slugs.some((s) => !SLUG.test(s))) throw new Error("the demo's companies: 1 to 12 addresses such as northwind-outdoor");
  const f: SmokeFetch = o.fetch ?? ((url, init) => fetch(url, init));
  const budget = smokeBudget(slugs.length);
  const checks: SmokeCheck[] = [];
  const answers: string[] = [];
  let requests = 0;
  const check = (name: string, ok: boolean, detail: string) => { checks.push({ name, ok, detail }); };

  /** One GET, counted against the budget; a network failure is an answer with status 0. */
  const get = async (path: string): Promise<Answer> => {
    if (requests >= budget) throw new Error(`smoke check over its budget of ${budget} requests`);
    requests++;
    try {
      const r = await f(`${origin}${path}`, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(o.timeoutMs ?? 20_000) });
      const bytes = new Uint8Array(await r.arrayBuffer());
      const text = new TextDecoder().decode(bytes);
      let json: Json | null = null;
      if ((r.headers.get("content-type") ?? "").includes("json")) { try { const v = JSON.parse(text) as unknown; json = v && typeof v === "object" ? (v as Json) : null; } catch { json = null; } }
      if (!(r.headers.get("content-type") ?? "").startsWith("application/pdf")) answers.push(text);
      return { status: r.status, headers: r.headers, bytes, text, json };
    } catch (e) {
      return { status: 0, headers: new Headers(), bytes: new Uint8Array(), text: "", json: null, error: (e as Error).name === "TimeoutError" ? "timed out" : "no answer" };
    }
  };
  const said = (a: Answer) => a.error ?? `${a.status}${a.json && typeof a.json.code === "string" ? ` ${a.json.code}` : ""}`;

  // The deployment: in demo mode, with exactly these companies.
  const health = await get("/v1/health");
  const h = health.json ?? {};
  check("health", health.status === 200 && h.ok === true && h.demo_companies === slugs.length && !("mail_queued" in h),
    health.status === 200 ? `ok ${String(h.ok)}, demo_companies ${String(h.demo_companies)} of ${slugs.length}${"mail_queued" in h ? ", not in demo mode" : ""}` : said(health));

  const api = await get("/v1/openapi.json");
  const paths = Object.keys((api.json?.paths as Json | undefined) ?? {});
  const notDemo = paths.filter((p) => !p.startsWith("/v1/demo/") && p !== "/v1/health" && p !== "/v1/openapi.json");
  check("openapi", api.status === 200 && paths.length > 0 && notDemo.length === 0, api.status === 200 ? `${paths.length} routes, ${notDemo.length} outside the demo` : said(api));

  const list = await get("/v1/demo/companies");
  const cos = arr(list.json?.companies);
  const listed = cos.map((c) => String(c.slug));
  const empty = cos.filter((c) => { const n = (c.counts ?? {}) as Json; return !(Number(n.invoices) > 0 && Number(n.documents) > 0 && Number(n.ledger_entries) > 0); }).map((c) => String(c.slug));
  const unlabelled = cos.filter((c) => !/test/i.test(String(c.name))).map((c) => String(c.slug));
  check("companies", list.status === 200 && list.json?.read_only === true && list.json?.test_world === true && listed.join(",") === slugs.join(",") && empty.length === 0 && unlabelled.length === 0,
    list.status === 200 ? `listed ${listed.join(",") || "none"}${empty.length ? `; empty: ${empty.join(",")}` : ""}${unlabelled.length ? `; not named a test company: ${unlabelled.join(",")}` : ""}` : said(list));

  // The console: the demo's page, built for this very address (RP_ID and ORIGIN set to it).
  const page = await get("/");
  const meta = /<meta name="purser-cloud" content="([^"]*)">/.exec(page.text)?.[1];
  const cfg = ((): Json => {
    try { return meta ? (JSON.parse(meta.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")) as Json) : {}; } catch { return {}; }
  })();
  const demoSlugs = arr((cfg.demo as Json | null | undefined)?.slugs as unknown).map(String);
  check("console", page.status === 200 && (page.headers.get("content-type") ?? "").startsWith("text/html") && !!page.headers.get("content-security-policy") && cfg.origin === origin && demoSlugs.join(",") === slugs.join(","),
    page.status === 200 ? `page for ${String(cfg.origin ?? "no address")}, demo companies ${demoSlugs.join(",") || "none"}` : said(page));

  // Each company: its reads, one invoice and its document, one vault file checked against its hash.
  for (const slug of slugs) {
    const at = (p: string) => `/v1/demo/${slug}/${p}`;
    const got: Partial<Record<(typeof SMOKE_COMPANY_READS)[number], Answer>> = {};
    for (const read of SMOKE_COMPANY_READS) {
      const a = await get(at(read));
      got[read] = a;
      let extra = "";
      let ok = a.status === 200 && a.json !== null && a.headers.get("x-purser-demo") !== null;
      if (ok && read === "me") { ok = a.json!.kind === "demo" && JSON.stringify(a.json!.scopes) === '["read"]'; extra = ` kind ${String(a.json!.kind)}`; }
      if (ok && read === "invoices") {
        const items = arr(a.json!.items);
        const bare = items.filter((i) => i.provenance !== "stand-in" && i.provenance !== "sandbox").length;
        ok = items.length > 0 && bare === 0;
        extra = ` ${items.length} invoices${bare ? `, ${bare} without a stand-in or sandbox label` : ", each labelled"}`;
      }
      if (ok && read === "vault") { const files = arr(a.json!.files); ok = files.some((x) => x.stored === true); extra = ` ${files.length} files`; }
      check(`${slug} ${read}`, ok, `${said(a)}${extra}`);
    }
    const invoice = arr(got.invoices?.json?.items).find((i) => typeof i.id === "string" && typeof i.doc_sha256 === "string");
    if (invoice) {
      const id = encodeURIComponent(String(invoice.id));
      const one = await get(at(`invoices/${id}`));
      check(`${slug} invoice`, one.status === 200 && one.json?.id === invoice.id, `${said(one)} ${String(invoice.id)}`);
      const doc = await get(at(`invoices/${id}/document`));
      check(`${slug} invoice document`, doc.status === 200 && doc.bytes.length > 0 && doc.headers.get("x-content-type-options") === "nosniff", `${said(doc)}, ${doc.bytes.length} bytes`);
    } else {
      check(`${slug} invoice`, false, "no invoice with a document in the list");
      check(`${slug} invoice document`, false, "no invoice with a document in the list");
    }
    const file = arr(got.vault?.json?.files).find((x) => x.stored === true && typeof x.sha256 === "string" && /^[a-f0-9]{64}$/.test(x.sha256));
    if (file) {
      const doc = await get(at(`documents/${String(file.sha256)}`));
      const sha = createHash("sha256").update(doc.bytes).digest("hex");
      check(`${slug} vault document`, doc.status === 200 && sha === file.sha256, `${said(doc)}, ${sha === file.sha256 ? "its SHA-256 matches" : "its SHA-256 does not match"}`);
    } else check(`${slug} vault document`, false, "no stored file in the vault's index");
  }

  // What is off stays off, for GETs too.
  for (const p of SMOKE_REFUSED) {
    const path = p.replace("{company}", slugs[0]!);
    const a = await get(path);
    check(`refused GET ${path}`, a.status === 403 && a.json?.code === "demo_read_only", said(a));
  }
  const unknown = await get(SMOKE_UNKNOWN);
  check("unknown company", unknown.status === 404 && unknown.json?.code === "not_found", said(unknown));

  const leaked = answers.filter((t) => SECRET.test(t)).length;
  check("no secret in any answer", answers.length > 0 && leaked === 0, answers.length ? `${answers.length} answers read, ${leaked} with something like a key or a session` : "no answer to read");

  return { ok: checks.every((c) => c.ok), base: origin, requests, budget, checks };
}

/** The report as lines for a terminal: one per check, then the total. Holds addresses and statuses only. */
export function smokeLines(r: SmokeReport): string[] {
  const w = Math.max(...r.checks.map((c) => c.name.length));
  return [
    `Smoke check of ${r.base}: ${r.requests} GET requests (at most ${r.budget})`,
    ...r.checks.map((c) => `${c.ok ? "ok  " : "FAIL"}  ${c.name.padEnd(w)}  ${c.detail}`),
    r.ok ? `All ${r.checks.length} checks passed.` : `${r.checks.filter((c) => !c.ok).length} of ${r.checks.length} checks failed.`,
  ];
}
