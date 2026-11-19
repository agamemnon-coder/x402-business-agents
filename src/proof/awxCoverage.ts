// The Airwallex API coverage table (`npm run airwallex:coverage`, src/cli/airwallexCoverage.ts): every distinct Airwallex
// endpoint (method + path template) the code calls, found by a static scan of the TypeScript, and for each one the
// strongest evidence the repository holds that it ran:
//   LIVE        a committed run record (docs/runs, docs/evidence, docs/demo) or the Airwallex API trail
//               (src/airwallex/apiTrail.ts) holds a call to it. All of them were calls to the Airwallex sandbox.
//   TESTED ONLY no run record holds it, but a test under test/ names this method and this path together.
//   CODE ONLY   neither: the code can make the call, nothing committed shows it made.
// Pure functions only (no file system): the command reads the files and hands their text here, so each rule is tested
// on small fixtures (test/airwallex-coverage.test.ts). Nothing here calls Airwallex.

import ts from "typescript";

export const VERBS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type Verb = (typeof VERBS)[number];
const isVerb = (s: string): s is Verb => (VERBS as readonly string[]).includes(s);

/**
 * The first path segments of Airwallex's API (under /api/v1, plus its OAuth endpoints) that this repository uses. A
 * method-and-path call whose path starts with none of these is another service's (Purser's own pages, Moneybird, T:0,
 * Claude) and is not counted.
 */
export const AWX_ROOTS = [
  "account", "accounts", "authentication", "balances", "batch_transfers", "beneficiaries", "connected_account_transfers", "deposits", "files",
  "financial_transactions", "fx", "global_accounts", "hosted_flows", "issuing", "oauth", "pa", "simulation", "spend", "transfers", "webhooks",
] as const;

/** One endpoint: a method and a path template under /api/v1, ids folded to {id}. */
export const endpointKey = (method: string, path: string) => `${method} ${path}`;

/**
 * A path as written in code or in a record, folded to a template: an Airwallex origin and /api/v1 dropped, the query
 * and a trailing slash dropped, every interpolated or id-shaped segment made {id}. Null when it is not an Airwallex path.
 */
export function normalizePath(raw: string): string | null {
  let p = raw.trim();
  p = p.replace(/^https?:\/\/(?:[a-z0-9-]+\.)*airwallex\.com(?=\/)/i, "");
  if (!p.startsWith("/")) return null;
  p = p.replace(/[?#].*$/, "").replace(/^\/api\/v1(?=\/)/, "");
  const segs = p.split("/").slice(1);
  if (segs.length === 0 || !segs[0]) return null;
  if (!(AWX_ROOTS as readonly string[]).includes(segs[0])) return null;
  const folded = segs.map((s) => (s === "{id}" || /^\{[^}]*\}$/.test(s) || /\{id\}/.test(s) || isIdShaped(s) ? "{id}" : s)).filter((s, i, a) => s !== "" || i < a.length - 1);
  if (folded.some((s) => s === "")) return null;
  return `/${folded.join("/")}`;
}
/** A segment that is an id, not a word: a UUID, an acct_ id, or a long run of hex or digits. */
const isIdShaped = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) || /^acct_[\w-]+$/.test(s) || /^[0-9a-f]{16,}$/i.test(s) || /^\d{4,}$/.test(s);

/** The text of a string or template literal, with every interpolation as {id}; null for any other expression. */
export function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    // `${base}/transfers/create`: an interpolation before the first slash is the base URL, not part of the path.
    const lead = node.head.text === "" && node.templateSpans[0]?.literal.text.startsWith("/");
    let s = lead ? "" : node.head.text;
    node.templateSpans.forEach((sp, i) => { s += (lead && i === 0 ? "" : "{id}") + sp.literal.text; });
    return s;
  }
  return null;
}

export interface Site { method: Verb; path: string; file: string; line: number; how: string }
export interface DynamicSite { file: string; line: number; method: string; expr: string }
export interface Scan { sites: Site[]; dynamic: DynamicSite[] }

const calleeName = (e: ts.Expression): string | null =>
  ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : null;
/** A helper whose name says the method: get, tryGet, post, apiPost (not getVia, getRate: the name must end in it). */
const methodFromName = (name: string | null): Verb | null => {
  if (!name) return null;
  if (/^get$|[a-z]Get$/.test(name)) return "GET";
  if (/^post$|[a-z]Post$/.test(name)) return "POST";
  return null;
};
/** The method literal of a request's options object ({ method: "POST", ... }), or null. */
const optionsMethod = (a: ts.Expression | undefined): Verb | null => {
  if (!a || !ts.isObjectLiteralExpression(a)) return null;
  const mp = a.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "method");
  const m = mp ? literalText(mp.initializer) : null;
  return m && isVerb(m) ? m : null;
};
const lineOf = (sf: ts.SourceFile, n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

/**
 * Call sites in one source file. A call counts when its first argument is a method literal ("GET", "POST", ...) and its
 * second an Airwallex path literal (`api.call("POST", "/transfers/create", ...)`, `this.raw("GET", `/issuing/cards/${id}`)`),
 * or when its first argument is the URL and its second the request's options with a method literal (`fetch(url, {
 * method: "POST" })`), or when the function's name is the method and its first argument is the path (`get("/deposits", q)`, `tryGet(...)`),
 * or when an argument is a function named get or post and another is the path (`listFind(get, "/fx/conversions", ...)`).
 * A method literal followed by a path that is not a literal (`api.call("GET", path)`) is a dynamic site: listed, never
 * guessed, and only listed in a file with at least one Airwallex call. Comments are never read: only call expressions.
 */
export function scanCode(text: string, file: string): Scan {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const sites: Site[] = [], dynamic: DynamicSite[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const args = n.arguments;
      // The method first, as every HTTP helper here takes it (`call(method, path, ...)`): a function that takes a method
      // later (apiTrail's call(at, method, path) builds a row of a record; plan.ts's add(step, proc, method, ...) a line
      // of a budget) is not a call to Airwallex.
      const vi = args[0] && isVerb(literalText(args[0]) ?? "") ? 0 : -1;
      if (vi >= 0 && args[vi + 1]) {
        const method = literalText(args[vi]!) as Verb, arg = args[vi + 1]!, raw = literalText(arg);
        const path = raw === null ? null : normalizePath(raw);
        if (path) sites.push({ method, path, file, line: lineOf(sf, n), how: "method and path literals" });
        else if (raw === null && (ts.isIdentifier(arg) || ts.isPropertyAccessExpression(arg) || ts.isElementAccessExpression(arg) || ts.isCallExpression(arg))) {
          dynamic.push({ file, line: lineOf(sf, n), method, expr: `${calleeName(n.expression) ?? "call"}("${method}", ${arg.getText(sf).slice(0, 60)})` });
        }
      } else if (optionsMethod(args[1]) && normalizePath(literalText(args[0]!) ?? "")) {
        // fetch(`${base}/authentication/login`, { method: "POST", ... }): the method in the request's options.
        sites.push({ method: optionsMethod(args[1])!, path: normalizePath(literalText(args[0]!)!)!, file, line: lineOf(sf, n), how: "a URL and a method in the request's options" });
      } else {
        const byName = methodFromName(calleeName(n.expression));
        const first = args[0] ? literalText(args[0]) : null;
        const p0 = first === null ? null : normalizePath(first);
        if (byName && p0) sites.push({ method: byName, path: p0, file, line: lineOf(sf, n), how: `called through ${calleeName(n.expression)}()` });
        else {
          const fnArg = args.map((a) => (ts.isIdentifier(a) ? methodFromName(a.text) : null)).find((m) => m);
          const pArg = args.map((a) => { const t = literalText(a); return t === null ? null : normalizePath(t); }).find((p) => p);
          if (fnArg && pArg) sites.push({ method: fnArg, path: pArg, file, line: lineOf(sf, n), how: "a get/post function and a path passed together" });
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  // A path held in a variable is only listed in a file that calls Airwallex somewhere with a literal path: elsewhere the
  // same shape is another service's client (Moneybird, a link checker).
  return { sites, dynamic: sites.length ? dynamic : [] };
}

export interface TestHit { method: Verb; path: string; file: string; line: number; how: string }

/**
 * Where a test names a method and a path together: a call with both (as scanCode reads it), a "METHOD /path" string
 * (a stand-in's call log, a budget's endpoint), or an object with a method and a path, endpoint or url property (a
 * stand-in's route or a recorded request). A path on its own, with no method beside it, does not count.
 */
export function scanTest(text: string, file: string): TestHit[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const hits: TestHit[] = scanCode(text, file).sites.map((s) => ({ ...s, how: "a call with the method and the path" }));
  const visit = (n: ts.Node): void => {
    const t = ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n) ? literalText(n) : null;
    if (t !== null) {
      const m = /^(GET|POST|PUT|PATCH|DELETE) (\S+)$/.exec(t);
      const path = m ? normalizePath(m[2]!) : null;
      if (m && path) hits.push({ method: m[1] as Verb, path, file, line: lineOf(sf, n), how: `the string "${m[1]} ${m[2]!.slice(0, 60)}"` });
    }
    if (ts.isObjectLiteralExpression(n)) {
      const prop = (name: string) => n.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === name);
      const mp = prop("method"), mt = mp ? literalText(mp.initializer) : null;
      const pp = prop("path") ?? prop("endpoint") ?? prop("url"), pt = pp ? literalText(pp.initializer) : null;
      const path = pt === null ? null : normalizePath(pt);
      if (mt && isVerb(mt) && path) hits.push({ method: mt, path, file, line: lineOf(sf, n), how: "an object with the method and the path" });
    }
    // A stand-in's route: `method === "POST" && path === "/issuing/cards/create"`, one && chain naming one method.
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      && !(ts.isBinaryExpression(n.parent) && n.parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)) {
      const lits: string[] = [];
      const collect = (x: ts.Node): void => { const v = literalText(x); if (v !== null) lits.push(v); else ts.forEachChild(x, collect); };
      collect(n);
      const verbs = [...new Set(lits.filter(isVerb))];
      if (verbs.length === 1) for (const l of lits) { const path = normalizePath(l); if (path) hits.push({ method: verbs[0] as Verb, path, file, line: lineOf(sf, n), how: "a stand-in's route (one method and the path in one condition)" }); }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

/** One call a record holds. `at` is the call's own ISO time where the record has one, else the record's date (YYYY-MM-DD). */
export interface LiveMention { method: Verb; path: string; record: string; at: string; how: string }

/** The first YYYY-MM-DD in a string, or null. */
export const dateIn = (s: unknown): string | null => (typeof s === "string" ? /\b(20\d\d-\d\d-\d\d)/.exec(s)?.[1] ?? null : null);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** A record's own date, for mentions without a time of their own: a top-level time field, else the file name's date. */
export function recordDate(json: unknown, record: string): string | null {
  if (isObj(json)) for (const k of ["at", "ran_at", "read_at", "recorded_at", "started_at", "run_at", "date", "made_at"]) { const d = dateIn(json[k]); if (d) return d; }
  return dateIn(record);
}

/**
 * The Airwallex calls a run record holds, read generically: an object with a method and an endpoint (or path), whose
 * service is Airwallex or unnamed (call logs list Claude's and T:0's calls beside Airwallex's), and any string that
 * starts with "METHOD /path". Dated by the object's own `at` where it has one, else by the record. A path that is not an
 * Airwallex path is skipped.
 */
export function recordMentions(json: unknown, record: string): LiveMention[] {
  const out: LiveMention[] = [];
  const fallback = recordDate(json, record);
  const walk = (v: unknown, at: string | null): void => {
    if (Array.isArray(v)) { v.forEach((x) => walk(x, at)); return; }
    if (typeof v === "string") {
      const m = /^(GET|POST|PUT|PATCH|DELETE) (\/\S+)/.exec(v);
      const path = m ? normalizePath(m[2]!.replace(/[,;.)]+$/, "")) : null;
      if (m && path && at) out.push({ method: m[1] as Verb, path, record, at, how: "a \"METHOD /path\" entry" });
      return;
    }
    if (!isObj(v)) return;
    const here = typeof v.at === "string" && dateIn(v.at) ? v.at : at;
    const service = v.service;
    if (service !== undefined && service !== "airwallex") return;
    const ep = typeof v.endpoint === "string" ? v.endpoint : typeof v.path === "string" ? v.path : null;
    if (typeof v.method === "string" && isVerb(v.method) && ep && ep.startsWith("/")) {
      const path = normalizePath(ep);
      if (path && here) out.push({ method: v.method, path, record, at: here, how: "a call-log line" });
    }
    for (const [k, x] of Object.entries(v)) if (!(k === "method" && typeof x === "string" && isVerb(x))) walk(x, here);
  };
  walk(json, fallback);
  return out;
}

/** A JSONL record: one JSON value per line (blank lines skipped, a line that is not JSON skipped). */
export function parseJsonl(text: string): unknown[] {
  return text.split("\n").filter((l) => l.trim()).flatMap((l) => { try { return [JSON.parse(l) as unknown]; } catch { return []; } });
}

export type Status = "LIVE" | "TESTED ONLY" | "CODE ONLY";
export interface EndpointRow {
  endpoint: string; method: Verb; path: string; status: Status;
  /** Where the code calls it (file:line), every site. */
  sites: string[];
  /** LIVE: the first date and its record, and every record that holds it. */
  firstLive: { date: string; at: string; record: string } | null; liveRecords: string[];
  /** The first test (file:line) that names it, and how many test files do. */
  firstTest: string | null; testFiles: number;
}
export interface Coverage {
  endpoints: EndpointRow[];
  totals: { endpoints: number; live: number; testedOnly: number; codeOnly: number; liveAndTested: number; callSites: number; dynamicSites: number };
  dynamic: DynamicSite[];
  /** Endpoints a record holds that the scan did not find in the code (reached through a dynamic path, or code since removed). */
  recordsOnly: { endpoint: string; firstLive: { date: string; at: string; record: string }; records: string[] }[];
  scanned: { sourceFiles: number; testFiles: number; records: number };
}

/** Earliest first: by time (a date-only mention sorts at the start of its day), then by record. */
const byDateThenRecord = (a: LiveMention, b: LiveMention) => a.at.localeCompare(b.at) || a.record.localeCompare(b.record);

/** Puts it together: one row per distinct endpoint the code calls, each counted once, LIVE before TESTED ONLY before CODE ONLY. */
export function classify(scan: Scan, tests: TestHit[], live: LiveMention[], counts: Coverage["scanned"]): Coverage {
  const sitesBy = new Map<string, Site[]>();
  for (const s of scan.sites) { const k = endpointKey(s.method, s.path); sitesBy.set(k, [...(sitesBy.get(k) ?? []), s]); }
  const liveBy = new Map<string, LiveMention[]>();
  for (const m of live) { const k = endpointKey(m.method, m.path); liveBy.set(k, [...(liveBy.get(k) ?? []), m]); }
  const testsBy = new Map<string, TestHit[]>();
  for (const t of tests) { const k = endpointKey(t.method, t.path); testsBy.set(k, [...(testsBy.get(k) ?? []), t]); }
  const at = (f: string, l: number) => `${f}:${l}`;
  const uniq = (xs: string[]) => [...new Set(xs)].sort();

  const endpoints: EndpointRow[] = [...sitesBy.keys()].sort(sortEndpoints).map((k) => {
    const ss = sitesBy.get(k)!, lm = [...(liveBy.get(k) ?? [])].sort(byDateThenRecord), th = [...(testsBy.get(k) ?? [])].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    const status: Status = lm.length ? "LIVE" : th.length ? "TESTED ONLY" : "CODE ONLY";
    return {
      endpoint: k, method: ss[0]!.method, path: ss[0]!.path, status,
      sites: uniq(ss.map((s) => at(s.file, s.line))),
      firstLive: lm[0] ? { date: lm[0].at.slice(0, 10), at: lm[0].at, record: lm[0].record } : null, liveRecords: uniq(lm.map((m) => m.record)),
      firstTest: th[0] ? at(th[0].file, th[0].line) : null, testFiles: new Set(th.map((t) => t.file)).size,
    };
  });
  const recordsOnly = [...liveBy.keys()].filter((k) => !sitesBy.has(k)).sort(sortEndpoints).map((k) => {
    const lm = [...liveBy.get(k)!].sort(byDateThenRecord);
    return { endpoint: k, firstLive: { date: lm[0]!.at.slice(0, 10), at: lm[0]!.at, record: lm[0]!.record }, records: uniq(lm.map((m) => m.record)) };
  });
  const n = (s: Status) => endpoints.filter((e) => e.status === s).length;
  return {
    endpoints,
    totals: { endpoints: endpoints.length, live: n("LIVE"), testedOnly: n("TESTED ONLY"), codeOnly: n("CODE ONLY"), liveAndTested: endpoints.filter((e) => e.status === "LIVE" && e.testFiles > 0).length, callSites: scan.sites.length, dynamicSites: scan.dynamic.length },
    dynamic: [...scan.dynamic].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
    recordsOnly,
    scanned: counts,
  };
}
/** By path, then method: an endpoint's GET and POST sit together. */
const sortEndpoints = (a: string, b: string) => { const [ma, pa] = a.split(" "), [mb, pb] = b.split(" "); return pa!.localeCompare(pb!) || ma!.localeCompare(mb!); };

/** One Markdown table cell: backslashes first, then pipes, so no value can end a cell early. */
export const cell = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");

/** The report, as Markdown. Everything in it is from the scan; nothing is typed by hand. */
export function coverageMarkdown(c: Coverage): string {
  const t = c.totals;
  const lines = [
    "# Airwallex API coverage",
    "",
    "Made by `npm run airwallex:coverage` (src/cli/airwallexCoverage.ts, rules in src/proof/awxCoverage.ts, tested in",
    "test/airwallex-coverage.test.ts). Offline: nothing here calls Airwallex. Every call it counts as live was a call to the",
    "**Airwallex sandbox**, with test money: the client refuses any other base URL (src/airwallex/client.ts).",
    "",
    "## How it is counted",
    "",
    `1. **The endpoints.** A static scan of the TypeScript in src/, cloud/src/, worker/src/ and scripts/ (tests excluded; ${c.scanned.sourceFiles} files),`,
    "   read with the TypeScript parser, call expressions only. A call counts when it passes a method literal (\"GET\",",
    "   \"POST\") followed by an Airwallex path literal, or when the function's name is the method (`get(\"/deposits\")`). A",
    "   path is folded to a template: the origin, `/api/v1`, the query and every id or interpolation (`{id}`) dropped. Its",
    "   first segment must be one of Airwallex's that the code uses (AWX_ROOTS), so Purser's own routes, Moneybird's, T:0's",
    "   and Claude's are not counted. One row per distinct method and path, however many places call it: nothing is counted twice.",
    "2. **LIVE (sandbox).** A committed run record holds a call to it: the Airwallex API trail (src/airwallex/apiTrail.ts,",
    "   the list /airwallex/calls shows) and every JSON or JSONL record in docs/runs, docs/evidence and docs/demo, read",
    "   generically (an object with a method and an endpoint whose service is Airwallex or unnamed, or a string starting",
    `   "METHOD /path"); ${c.scanned.records} records read. The first date is the earliest call's own time, or the record's date where`,
    "   it only counts calls. The Markdown run logs are not read: only machine-readable records count.",
    "3. **TESTED ONLY.** No record holds it, but a test under test/ names this method and this path together: a call",
    "   with both, a \"METHOD /path\" string (a stand-in's call log), or an object with a method and a path (a stand-in's",
    `   route). A path named without its method does not count. ${c.scanned.testFiles} test files read (not this report's own test, whose fixtures name endpoints on purpose).`,
    "4. **CODE ONLY.** Neither: the code can make the call; nothing committed shows it ran or a test that names it.",
    "",
    "What this does not show: that a LIVE call succeeded (some records hold refusals, which are the point of those runs),",
    "or that a test covers every branch around a call. A call whose path is built at run time (`api.call(\"GET\", path)`)",
    "cannot be read statically; those sites are listed at the end, not guessed.",
    "",
    "## Totals",
    "",
    "| | Endpoints |",
    "|---|---|",
    `| Distinct endpoints the code calls | ${t.endpoints} (from ${t.callSites} call sites) |`,
    `| LIVE (sandbox): in a committed run record | ${t.live} (${t.liveAndTested} of them also named by a test) |`,
    `| TESTED ONLY: named by a test, in no record | ${t.testedOnly} |`,
    `| CODE ONLY: neither | ${t.codeOnly} |`,
    `| Call sites with a path built at run time (not classified) | ${t.dynamicSites} |`,
    `| Endpoints in a record that the scan did not find in the code | ${c.recordsOnly.length} |`,
    "",
    "## Every endpoint",
    "",
    "| Endpoint | Status | First live call (record) | Records | First test that names it | Test files | Called at |",
    "|---|---|---|---|---|---|---|",
    ...c.endpoints.map((e) => `| \`${e.endpoint}\` | ${e.status === "LIVE" ? "**LIVE**" : e.status} | ${e.firstLive ? `${e.firstLive.date} (${cell(e.firstLive.record)})` : "–"} | ${e.liveRecords.length || "–"} | ${e.firstTest ? cell(e.firstTest) : "–"} | ${e.testFiles || "–"} | ${cell(e.sites.join(", "))} |`),
    "",
    "## In a record, not found by the scan",
    "",
    c.recordsOnly.length
      ? "These calls are in a committed run record, but no call site with a literal path was found for them: the code reaches them through a path or URL built at run time (for example the OAuth URLs in src/lib/oauth.ts), or the code that made them has changed since. They are not in the totals above."
      : "None.",
    "",
    ...(c.recordsOnly.length ? ["| Endpoint | First live call (record) | Records |", "|---|---|---|", ...c.recordsOnly.map((r) => `| \`${r.endpoint}\` | ${r.firstLive.date} (${cell(r.firstLive.record)}) | ${r.records.length} |`), ""] : []),
    "## Call sites with a path built at run time",
    "",
    c.dynamic.length ? "Listed so nothing is hidden; each passes a path held in a variable, so the scan cannot say which endpoint it is." : "None.",
    "",
    ...(c.dynamic.length ? ["| Where | Call |", "|---|---|", ...c.dynamic.map((d) => `| ${d.file}:${d.line} | \`${cell(d.expr)}\` |`), ""] : []),
  ];
  return lines.join("\n");
}
