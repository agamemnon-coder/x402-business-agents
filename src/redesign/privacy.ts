// /privacy, "Privacy" (20 Nov; outside audit, finding 3.4). Redesigned 21 Nov (the owner: "it must be better and prettier.
// Make clear, with GDPR etc., that we are EU compliant"): who we are, where the data lives, the data-subject rights as the
// product implements them, how long things are kept, who processes what, and whom to ask.
// Every fact is read from where it is true, where the page is built; a source that no longer says it is an error:
//   - where data lives: the Workers' own configs (cloud/wrangler.jsonc, cloud/wrangler.try.jsonc), nothing more is claimed;
//   - the rights: the routes in cloud/src/app.ts (access and export, erasure, leaving);
//   - retention: docs/privacy/retention.md; the services: docs/privacy/data-inventory.md, their location column verbatim.
// "Compliant" is not said: nobody has audited it, and the inventory records no data processing agreement yet (the footer
// says so). The company line is the one the owner confirmed (21 Nov): registered in the Netherlands (KvK).
// No founder bio. The contact address is the one the owner asked to publish. No script.

import { foldHtml, outLink, productPage, repoHref, repoText } from "./productPage.js";
import { esc, icon } from "./ui.js";

export const INVENTORY_DOC = "docs/privacy/data-inventory.md";
export const RETENTION_DOC = "docs/privacy/retention.md";
/** The inventory's section listing the services the code calls. */
export const SUBPROCESSORS_ANCHOR = "#subprocessors-the-code-calls";
/** The inventory's section with each table's legal basis ("## Legal bases (GDPR Article 6(1))"). */
export const LEGAL_BASES_ANCHOR = "#legal-bases-gdpr-article-61";
/** The privacy contact, published at the owner's request. */
export const PRIVACY_CONTACT = "max.geurtsen@outlook.com";
/** Said on the page and at the top of both docs. */
export const NOT_LEGAL_ADVICE = "An engineering inventory, not legal advice";
/**
 * Who runs Purser, as the owner confirmed it (21 Nov): registered with the Dutch Chamber of Commerce (KvK).
 * TODO(owner): add the legal entity's name and its KvK number here (e.g. "Purser B.V., KvK 12345678"); neither is in
 * the repository, so the page names neither until they are filled in.
 */
export const COMPANY_LINE = "A company registered in the Netherlands (KvK), EU";
export const COMPANY_LEGAL: { name: string; kvk: string } | null = null;

/** The services that receive company data, as the inventory names them (each checked against it where the page is built). */
export const SUBPROCESSORS: readonly { name: string; what: string }[] = [
  { name: "Cloudflare", what: "hosts Purser Cloud and stores its data" },
  { name: "Anthropic", what: "Claude reads invoices, when switched on" },
  { name: "Airwallex", what: "payments and suppliers' bank details" },
  { name: "Alta (formerly Metal)", what: "payments between agents, on a public testnet" },
  { name: "Resend", what: "e-mail alerts, when a company chooses them" },
  { name: "Twilio", what: "WhatsApp alerts, when a company chooses them" },
];

/** A service's location, the inventory's own cell (its last column), marks out. */
export function locationOf(inventory: string, name: string): string {
  const row = inventory.split("\n").find((l) => l.startsWith(`| **${name}**`));
  const cells = row?.split("|").map((c) => c.trim()).filter(Boolean);
  if (!cells || cells.length < 5) throw new Error(`${INVENTORY_DOC} has no row for ${name}`);
  return cells.at(-1)!.replace(/`/g, "").replace(/\*\*/g, "");
}

/** Where Purser Cloud's data lives, as its configs set it; a config that no longer says so is an error. */
export interface Residency { id: string; icon: string; what: string; where: string; zone: "eu" | "open" | "out"; src: string }
export function residency(cloud = repoText("cloud/wrangler.jsonc"), demo = repoText("cloud/wrangler.try.jsonc")): Residency[] {
  const must = (ok: boolean, what: string) => { if (!ok) throw new Error(`/privacy: ${what}`); };
  must(/"jurisdiction":\s*"eu"/.test(cloud), "cloud/wrangler.jsonc no longer puts the documents bucket in the EU jurisdiction");
  must(cloud.includes("--location weur") && demo.includes("--location weur"), "the D1 databases are no longer created in western Europe (--location weur)");
  must(/"region":\s*"aws:eu-central-1"/.test(demo), "cloud/wrangler.try.jsonc no longer places the demo's Worker in eu-central-1");
  return [
    { id: "db", icon: "database", what: "Database", where: "Western Europe", zone: "eu", src: "cloud/wrangler.jsonc" },
    { id: "docs", icon: "folder", what: "Documents", where: "EU jurisdiction", zone: "eu", src: "cloud/wrangler.jsonc" },
    { id: "run", icon: "zap", what: "Demo's code runs", where: "Next to its database (eu-central-1)", zone: "eu", src: "cloud/wrangler.try.jsonc" },
    { id: "engine", icon: "settings-2", what: "Each company's engine, logs", where: "Not pinned to a region yet", zone: "open", src: "cloud/wrangler.jsonc" },
    { id: "ai", icon: "sparkles", what: "Claude, e-mail and WhatsApp alerts", where: "United States, only when switched on", zone: "out", src: INVENTORY_DOC },
  ];
}

/** The data-subject rights as Purser Cloud implements them: the route that does it (checked against cloud/src/app.ts). */
export const RIGHTS: readonly { id: string; icon: string; right: string; art: string; line: string; route: string }[] = [
  { id: "access", icon: "download", right: "Access and portability", art: "GDPR Art. 15, 20", line: "An owner exports everything held for the company, documents included, as one download.", route: "GET /v1/export" },
  { id: "erase", icon: "trash-2", right: "Erasure", art: "GDPR Art. 17", line: "A person's name becomes a pseudonym; e-mail, passkeys and sessions are deleted at once.", route: "POST /v1/users/{id}/erase" },
  { id: "leave", icon: "log-out", right: "Leaving", art: "Offboarding", line: "After the export, the owner's passkey ends it; the books are deleted whole after seven years.", route: "POST /v1/offboarding" },
];

export const PRIVACY_CSS = `.pv-trust { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.pv-trust li { display: flex; gap: 12px; align-items: center; padding: 14px 16px; border-radius: 16px; background: var(--surface); border: 1px solid var(--border); font-size: 15px; line-height: 1.35; }
.pv-trust li b { display: block; font-size: 15.5px; } .pv-trust li span.t { color: var(--muted); font-size: 14px; }
.pv-trust .ic, .pv-sec .ic { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); flex: none; }
.pv-sec { padding: 20px; display: grid; gap: 14px; min-width: 0; }
.pv-sec h2 { margin: 0; display: flex; align-items: center; gap: 10px; font-size: 20px; letter-spacing: -.01em; }
.pv-sec .sub { margin: 0; color: var(--muted); font-size: 15px; line-height: 1.45; }
/* Where data lives: three zones. */
.pv-map { display: grid; gap: 10px; grid-template-columns: 1.6fr 1fr 1fr; }
.pv-zone { border-radius: 16px; padding: 14px; display: grid; gap: 8px; align-content: start; border: 1.5px dashed var(--border); }
.pv-zone.eu { border-style: solid; border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); background: color-mix(in srgb, var(--accent) 6%, var(--surface)); }
.pv-zone h3 { margin: 0; font-size: 13px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.pv-zone.eu h3 { color: var(--accent); }
.pv-zone ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.pv-zone li { display: flex; gap: 10px; align-items: center; padding: 10px 12px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border); font-size: 14.5px; line-height: 1.3; }
.pv-zone li .i { flex: none; color: var(--accent); } .pv-zone.open li .i, .pv-zone.out li .i { color: var(--muted); }
.pv-zone li small { display: block; color: var(--muted); font-size: 13.5px; }
@media (max-width: 800px) { .pv-map { grid-template-columns: minmax(0, 1fr); } }
/* Rights. */
.pv-rights { display: grid; gap: 10px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.pv-rights article { display: grid; gap: 8px; align-content: start; padding: 16px; border-radius: 16px; background: var(--sunken); }
.pv-rights h3 { margin: 0; display: flex; align-items: center; gap: 10px; font-size: 16.5px; }
.pv-rights h3 .i { color: var(--accent); }
.pv-rights small.art { color: var(--muted); font-size: 13px; font-weight: 650; letter-spacing: .02em; margin-top: -4px; }
.pv-rights p { margin: 0; font-size: 15px; line-height: 1.45; }
.pv-rights code { justify-self: start; font: 600 13px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; padding: 4px 8px; border-radius: 8px; background: var(--surface); border: 1px solid var(--border); overflow-wrap: anywhere; }
@media (max-width: 800px) { .pv-rights { grid-template-columns: minmax(0, 1fr); } }
/* Retention: three lanes on one time axis. */
.pv-time { display: grid; gap: 10px; }
.pv-lane { display: grid; grid-template-columns: minmax(150px, 34%) minmax(0, 1fr); gap: 12px; align-items: center; font-size: 14.5px; }
.pv-lane b { display: block; font-size: 15px; } .pv-lane small { color: var(--muted); font-size: 13.5px; }
.pv-bar { position: relative; height: 14px; border-radius: 7px; background: var(--sunken); overflow: hidden; }
.pv-bar i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 7px; background: var(--accent); transform-origin: left; }
.pv-bar i.now { width: 3%; background: var(--ok); } .pv-bar i.short { width: 8%; background: color-mix(in srgb, var(--accent) 55%, var(--surface)); } .pv-bar i.seven { width: 100%; }
@media (prefers-reduced-motion: no-preference) { .pv-bar i { animation: pv-grow 1.1s .2s cubic-bezier(.2,.7,.2,1) both; } }
@keyframes pv-grow { from { transform: scaleX(0); } to { transform: none; } }
.pv-axis { display: grid; grid-template-columns: minmax(150px, 34%) minmax(0, 1fr); gap: 12px; font-size: 13px; color: var(--muted); }
.pv-axis span:last-child { display: flex; justify-content: space-between; }
@media (max-width: 560px) { .pv-lane, .pv-axis { grid-template-columns: minmax(0, 1fr); gap: 4px; } .pv-axis span:first-child { display: none; } }
/* Services. */
table.pv-sp { width: 100%; border-collapse: collapse; font-size: 14.5px; }
table.pv-sp th, table.pv-sp td { text-align: left; padding: 9px 10px 9px 0; border-top: 1px solid var(--border); vertical-align: top; }
table.pv-sp thead th { font-size: 13px; color: var(--muted); font-weight: 600; border-top: 0; }
table.pv-sp td.w { color: var(--muted); }
@media (max-width: 640px) { table.pv-sp thead { display: none; } table.pv-sp tr { display: grid; padding: 8px 0; border-top: 1px solid var(--border); } table.pv-sp th, table.pv-sp td { border: 0; padding: 2px 0; } }
.pv-contact { display: flex; flex-wrap: wrap; gap: 10px 20px; align-items: center; justify-content: space-between; }
.pv-contact p { margin: 0; font-size: 15.5px; }`;

const sec = (id: string, ic: string, title: string, inner: string) => `<section class="card pv-sec" id="${id}" aria-labelledby="${id}-h"><h2 id="${id}-h"><span class="ic">${icon(ic, 20)}</span>${esc(title)}</h2>${inner}</section>`;

export function privacyPage(): string {
  const inventory = repoText(INVENTORY_DOC), retention = repoText(RETENTION_DOC), app = repoText("cloud/src/app.ts");
  for (const [doc, text] of [[INVENTORY_DOC, inventory], [RETENTION_DOC, retention]] as const) {
    if (!text.includes(NOT_LEGAL_ADVICE)) throw new Error(`${doc} no longer says it is ${NOT_LEGAL_ADVICE.toLowerCase()}`);
  }
  if (!inventory.includes("## Subprocessors the code calls")) throw new Error(`${INVENTORY_DOC} no longer lists the subprocessors`);
  for (const s of SUBPROCESSORS) if (!inventory.includes(`**${s.name}`)) throw new Error(`${INVENTORY_DOC} does not list ${s.name}`);
  for (const r of RIGHTS) {
    const [method, path] = r.route.split(" ");
    if (!app.includes(`{ method: "${method}", path: "${path}"`)) throw new Error(`cloud/src/app.ts no longer serves ${r.route}`);
  }
  if (!/seven years \(Article 2:10 BW, Article 52 AWR\)/.test(retention.replace(/\s+/g, " "))) throw new Error(`${RETENTION_DOC} no longer keeps the books seven years under Article 2:10 BW and Article 52 AWR`);
  const company = COMPANY_LEGAL ? `${COMPANY_LEGAL.name}, KvK ${COMPANY_LEGAL.kvk}` : "Registered with the KvK, the Dutch Chamber of Commerce";
  const trust = `<ul class="pv-trust">
  <li><span class="ic">${icon("globe", 20)}</span><span><b>${esc("Built in the Netherlands (EU)")}</b><span class="t">${esc(company)}</span></span></li>
  <li><span class="ic">${icon("shield-check", 20)}</span><span><b>${esc("GDPR rights in the product")}</b><span class="t">${esc("Access, export and erasure, each a route")}</span></span></li>
  <li><span class="ic">${icon("database", 20)}</span><span><b>${esc("Data placed in the EU")}</b><span class="t">${esc("Database and documents")}</span></span></li>
</ul>`;
  const zones = residency();
  const zone = (z: Residency["zone"], title: string) => `<div class="pv-zone ${z}"><h3>${esc(title)}</h3><ul>${zones.filter((x) => x.zone === z).map((x) => `<li>${icon(x.icon, 18)}<span>${esc(x.what)}<small>${esc(x.where)}</small></span></li>`).join("")}</ul></div>`;
  const where = sec("where", "globe", "Where the data lives", `<div class="pv-map">${zone("eu", "European Union")}${zone("open", "Not pinned yet")}${zone("out", "Outside the EU, opt-in")}</div>
    ${foldHtml("Where this is set", [`${esc("Database and documents:")} ${outLink(repoHref("cloud/wrangler.jsonc"), "cloud/wrangler.jsonc")}`, `${esc("The demo's placement:")} ${outLink(repoHref("cloud/wrangler.try.jsonc"), "cloud/wrangler.try.jsonc")}`, `${esc("Every service and its location:")} ${outLink(repoHref(INVENTORY_DOC, SUBPROCESSORS_ANCHOR), "the data inventory")}`])}`);
  const rights = sec("rights", "users", "Your rights, built in", `<div class="pv-rights">${RIGHTS.map((r) => `<article id="r-${r.id}"><h3>${icon(r.icon, 20)}${esc(r.right)}</h3><small class="art">${esc(r.art)}</small><p>${esc(r.line)}</p><code>${esc(r.route)}</code></article>`).join("")}</div>
    ${foldHtml("The legal basis of every table (GDPR Art. 6(1))", [outLink(repoHref(INVENTORY_DOC, LEGAL_BASES_ANCHOR), "Legal bases, in the data inventory")])}`);
  const lane = (cls: string, title: string, sub: string) => `<div class="pv-lane"><span><b>${esc(title)}</b><small>${esc(sub)}</small></span><span class="pv-bar"><i class="${cls}"></i></span></div>`;
  const howLong = sec("how-long", "clock", "For how long", `<div class="pv-time" role="img" aria-label="${esc("Personal data goes at once on erasure or leaving; sessions and links expire within days; the books are kept seven years, as Dutch law asks")}">
    ${lane("now", "Personal data", "gone at once on erasure or leaving")}
    ${lane("short", "Sessions, links, exports", "expire on their own")}
    ${lane("seven", "Books and audit chain", "seven years, as Dutch law asks")}
    <div class="pv-axis" aria-hidden="true"><span></span><span><span>${esc("today")}</span><span>${esc("7 years")}</span></span></div></div>
    ${foldHtml("The rules", ["The books and the audit chain stay unchanged, then are deleted whole: hash chains are never edited.", "Every deletion touches one company only.", outLink(repoHref(RETENTION_DOC), "Retention and deletion")])}`);
  const services = sec("processors", "building-2", "Who processes it", `<table class="pv-sp"><thead><tr><th scope="col">${esc("Service")}</th><th scope="col">${esc("For")}</th><th scope="col">${esc("Where")}</th></tr></thead><tbody>${SUBPROCESSORS.map((s) => `<tr><th scope="row"><b>${esc(s.name)}</b></th><td>${esc(s.what)}</td><td class="w">${esc(locationOf(inventory, s.name))}</td></tr>`).join("")}</tbody></table>
    <div class="links">${outLink(repoHref(INVENTORY_DOC, SUBPROCESSORS_ANCHOR), "The full list")}${outLink(repoHref(INVENTORY_DOC), "Every table and file")}</div>`);
  const contact = `<section class="card pv-sec" id="contact" aria-labelledby="contact-h"><h2 id="contact-h"><span class="ic">${icon("mail", 20)}</span>${esc("Contact")}</h2><div class="pv-contact"><p>${esc(`Purser: ${COMPANY_LEGAL ? `${COMPANY_LEGAL.name}, KvK ${COMPANY_LEGAL.kvk}, the Netherlands (EU)` : COMPANY_LINE}.`)}<br>${esc("A question, or a request about your data:")}</p><a class="btn primary" href="mailto:${esc(PRIVACY_CONTACT)}">${icon("mail", 18)}${esc(PRIVACY_CONTACT)}</a></div></section>`;
  return productPage({
    key: "privacy", title: "Privacy", h1: "Privacy", label: "Test money only",
    lead: `Built for the GDPR: what Purser keeps, where, for how long, and your rights as the product implements them. ${NOT_LEGAL_ADVICE}.`,
    description: "Purser's privacy: built in the Netherlands (EU) for the GDPR. Where data lives, the rights the product implements (access, export, erasure), retention and the services that process it. An engineering inventory, not legal advice.",
    css: PRIVACY_CSS,
    body: `${trust}\n${where}\n${rights}\n${howLong}\n${services}\n${contact}`,
    source: `Source: ${INVENTORY_DOC}, ${RETENTION_DOC}, cloud/wrangler.jsonc, cloud/wrangler.try.jsonc and cloud/src/app.ts.`,
    real: [
      "Test money only: no real company's data is held yet.",
      `${NOT_LEGAL_ADVICE}: the retention periods are to be confirmed with an adviser, and no data processing agreement with the services above is recorded yet.`,
      "Purser Cloud's production deployment is configured, not live; the hands-on demo runs on its own deployment with test data.",
    ],
  });
}
