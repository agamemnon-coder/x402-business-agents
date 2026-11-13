// The owner's read-only page during judging (master list line 342), on purser-try: GET /v1/try/ops is the page itself,
// with no figure in it; it asks for the platform admin token, keeps it in the tab only (sessionStorage), and fetches
// POST /v1/try/ops with it. That route needs the token (the router's "platform" check, ./routes.ts): without it, 401
// and no figure. Everything shown is an aggregate: starts and finishes, errors by kind, latency, Claude spend against
// its caps, who read the invoices, the switches, and the feedback box. No address, no company id, no visitor.
// It changes nothing: the switches are still set with POST /v1/try/admin.
import { ICON_LINKS } from "../brand.js";
import type { Sql } from "../store.js";
import { tallySince } from "./counter.js";
import { feedbackSummary } from "./feedback.js";
import { readerStatus, windowSince } from "./metrics.js";
import { num, readSwitches, tokensOf, type Switches } from "./switches.js";

const POOLS = ["public", "event", "jury", "smoke"] as const;

/** A number from a table that may not exist yet (lane A's spend ledger): null when it does not. */
async function maybe(sql: Sql, query: string, params: (string | number)[]): Promise<number | null> {
  try { return Number((await sql.first<{ v: number | null }>(query, params))?.v ?? 0); } catch { return null; }
}

/** The switches as the page shows them: the tokens as a count only. */
function switchesShown(s: Switches): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(s)) out[k] = k === "tokens" ? `${tokensOf(s).length} tokens` : v;
  return out;
}

export async function adminStats(sql: Sql, now: Date): Promise<Record<string, unknown>> {
  const hourAgo = new Date(now.getTime() - 3_600_000), dayAgo = new Date(now.getTime() - 86_400_000);
  const started = async (since: Date) => Number((await sql.first<{ n: number }>("SELECT COUNT(*) AS n FROM try_companies WHERE created_at >= ?", [since.toISOString()]))?.n ?? 0);
  const [th, td] = [await tallySince(sql, hourAgo), await tallySince(sql, dayAgo)];
  const s = await readSwitches(sql);
  const d = now.toISOString().slice(0, 10);
  const spent: Record<string, { micros: number | null; cap_micros: number }> = {};
  for (const p of POOLS) spent[p] = { micros: await maybe(sql, "SELECT micros AS v FROM try_spend WHERE scope = ?", [`day:${p}:${d}`]), cap_micros: num(s, `cap_day_micros_${p}`) };
  return {
    at: now.toISOString(),
    visitors: {
      last_hour: { started: await started(hourAgo), finished_paid: th.signed + th.unsigned, invoices_played: th.played },
      last_day: { started: await started(dayAgo), finished_paid: td.signed + td.unsigned, invoices_played: td.played },
      open_companies: Number((await sql.first<{ n: number }>("SELECT COUNT(*) AS n FROM try_companies WHERE wiped_at IS NULL AND expires_at > ?", [now.toISOString()]))?.n ?? 0),
    },
    requests: { last_hour: await windowSince(sql, hourAgo), last_day: await windowSince(sql, dayAgo), note: "p50 and p95 are bucket upper bounds" },
    claude: {
      spent_today_by_pool: spent,
      all_time: { micros: await maybe(sql, "SELECT micros AS v FROM try_spend WHERE scope = 'all'", []), cap_micros: num(s, "cap_all_micros") },
      switch: s.claude === "on" ? "on" : "off",
      readers: await readerStatus(sql),
    },
    switches: switchesShown(s),
    feedback: await feedbackSummary(sql),
  };
}

/** The page: no figure, no token; a script (with this response's nonce) asks for the token and draws the answer as text. */
export function adminPageHtml(nonce: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Purser try: owner's view</title>${ICON_LINKS}
<style nonce="${nonce}">
:root{color-scheme:light dark;--bg:#fbfaf7;--fg:#1d1c1a;--muted:#6b675f;--line:#e4e0d8;--bad:#a8321e}
@media (prefers-color-scheme:dark){:root{--bg:#161513;--fg:#ece9e2;--muted:#a19c92;--line:#34312c;--bad:#f08a76}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif}
main{max-width:880px;margin:0 auto;padding:16px}
h1{font-size:20px;margin:8px 0 4px}h2{font-size:15px;margin:20px 0 6px}
p.m{color:var(--muted);margin:0 0 12px}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid var(--line);padding:4px 6px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
th{color:var(--muted);font-weight:500;width:45%}
form{display:flex;gap:8px;flex-wrap:wrap}input{flex:1;min-width:0;font:inherit;padding:8px;border:1px solid var(--line);background:transparent;color:inherit;border-radius:6px}
button{font:inherit;padding:8px 14px;border-radius:6px;border:1px solid var(--fg);background:var(--fg);color:var(--bg)}
.bad{color:var(--bad)}
</style></head>
<body><main>
<h1>Owner's view</h1>
<p class="m">Read only. Aggregates of the hands-on deployment; no addresses, no ids. Switches change through the admin API.</p>
<form id="f"><input id="t" type="password" autocomplete="off" placeholder="Admin token" aria-label="Admin token"><button>Show</button></form>
<p id="s" class="m" role="status"></p>
<div id="out"></div>
</main>
<script nonce="${nonce}">
(function () {
  var KEY = "purser-try-ops";
  function get() { try { return sessionStorage.getItem(KEY) || ""; } catch (e) { return ""; } }
  function put(v) { try { sessionStorage.setItem(KEY, v); } catch (e) { /* the tab forgets it */ } }
  function el(tag, text, cls) { var e = document.createElement(tag); if (text !== undefined) e.textContent = String(text); if (cls) e.className = cls; return e; }
  function flat(o, pre, rows) { Object.keys(o).forEach(function (k) { var v = o[k], n = pre ? pre + " · " + k : k; if (v && typeof v === "object" && !Array.isArray(v)) flat(v, n, rows); else rows.push([n, Array.isArray(v) ? v.map(function (x) { return typeof x === "object" ? JSON.stringify(x) : String(x); }).join("\\n") : v === null ? "not recorded" : String(v)]); }); return rows; }
  function draw(j) {
    var out = document.getElementById("out"); out.textContent = "";
    ["visitors", "requests", "claude", "switches", "feedback"].forEach(function (sec) {
      if (!j[sec]) return;
      out.appendChild(el("h2", sec));
      var t = el("table");
      flat(j[sec], "", []).forEach(function (r) { var tr = el("tr"); tr.appendChild(el("th", r[0])); var td = el("td", r[1], /5xx/.test(r[0]) && r[1] !== "0" ? "bad" : ""); tr.appendChild(td); t.appendChild(tr); });
      out.appendChild(t);
    });
    document.getElementById("s").textContent = "As of " + j.at + ".";
  }
  function load() {
    var tok = get(); if (!tok) return;
    document.getElementById("s").textContent = "Loading…";
    fetch("/v1/try/ops", { method: "POST", headers: { authorization: "Bearer " + tok, "content-type": "application/json" }, body: "{}" })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) { if (!x.ok) { document.getElementById("s").textContent = x.j && x.j.error ? String(x.j.error) : "Refused."; return; } draw(x.j); })
      .catch(function () { document.getElementById("s").textContent = "No answer. Try again."; });
  }
  document.getElementById("f").addEventListener("submit", function (e) { e.preventDefault(); var v = document.getElementById("t").value.trim(); if (v) { put(v); document.getElementById("t").value = ""; load(); } });
  load();
})();
</script>
</body></html>`;
}

/** The page's headers: nothing loads from elsewhere, nothing frames it, nothing is cached. */
export function adminPageHeaders(nonce: string): Record<string, string> {
  return {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "x-robots-tag": "noindex",
  };
}
