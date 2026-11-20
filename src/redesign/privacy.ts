// /privacy, "Privacy" (20 Nov; outside audit, finding 3.4): what Purser keeps, for how long, who processes it, and whom
// to ask. Four short cards in the product pages' layout (./productPage.ts), the detail folded, every rule linked to
// the repository's engineering inventory (docs/privacy/data-inventory.md) and retention rules (docs/privacy/retention.md).
// No founder bio. The contact address is the one the owner asked to publish. No script.

import { foldHtml, outLink, productPage, repoHref, repoText } from "./productPage.js";
import { esc, icon } from "./ui.js";

export const INVENTORY_DOC = "docs/privacy/data-inventory.md";
export const RETENTION_DOC = "docs/privacy/retention.md";
/** The inventory's section listing the services the code calls. */
export const SUBPROCESSORS_ANCHOR = "#subprocessors-the-code-calls";
/** The privacy contact, published at the owner's request. */
export const PRIVACY_CONTACT = "max.geurtsen@outlook.com";
/** Said on the page and at the top of both docs. */
export const NOT_LEGAL_ADVICE = "An engineering inventory, not legal advice";

/** The services that receive company data, as the inventory names them (each checked against it where the page is built). */
export const SUBPROCESSORS: readonly { name: string; what: string }[] = [
  { name: "Cloudflare", what: "hosts Purser Cloud; documents in the EU" },
  { name: "Anthropic", what: "Claude reads invoices, when switched on" },
  { name: "Airwallex", what: "payments and suppliers' bank details" },
  { name: "Alta (formerly Metal)", what: "payments between agents, on a public testnet" },
  { name: "Resend", what: "e-mail alerts, when a company chooses them" },
  { name: "Twilio", what: "WhatsApp alerts, when a company chooses them" },
];

const head = (ic: string, title: string) => `<h2><span class="ic">${icon(ic, 22)}</span>${esc(title)}</h2>`;

export function privacyPage(): string {
  const inventory = repoText(INVENTORY_DOC), retention = repoText(RETENTION_DOC);
  for (const [doc, text] of [[INVENTORY_DOC, inventory], [RETENTION_DOC, retention]] as const) {
    if (!text.includes(NOT_LEGAL_ADVICE)) throw new Error(`${doc} no longer says it is ${NOT_LEGAL_ADVICE.toLowerCase()}`);
  }
  if (!inventory.includes("## Subprocessors the code calls")) throw new Error(`${INVENTORY_DOC} no longer lists the subprocessors`);
  for (const s of SUBPROCESSORS) if (!inventory.includes(`**${s.name}`)) throw new Error(`${INVENTORY_DOC} does not list ${s.name}`);
  if (!repoText("cloud/src/app.ts").includes('path: "/v1/offboarding"')) throw new Error("cloud/src/app.ts no longer serves /v1/offboarding");
  const body = `<div class="cols c2">
  <article class="pc card" id="kept">${head("database", "What is kept")}
    <p>A company's books and documents, and the names and e-mail addresses of the people it adds.</p>
    ${foldHtml("Every table and file", [`Each place personal or financial data is stored, why, and how it is deleted. ${outLink(repoHref(INVENTORY_DOC), "The data inventory")}`])}</article>
  <article class="pc card" id="how-long">${head("clock", "For how long")}
    <p>Books: seven years, as Dutch law asks. The personal data around them goes when a person is erased or the company leaves.</p>
    ${foldHtml("The rules", [
      "A company that leaves first downloads its export. Names become pseudonyms; e-mails, passkeys and sessions are deleted at once.",
      "The books and the audit chain stay unchanged, then are deleted whole after seven years.",
      outLink(repoHref(RETENTION_DOC), "Retention and deletion"),
    ])}</article>
  <article class="pc card" id="processors">${head("users", "Who processes it")}
    <p>Cloudflare hosts Purser Cloud. Other services only when they are used.</p>
    ${foldHtml("The services", [...SUBPROCESSORS.map((s) => `<b>${esc(s.name)}</b>: ${esc(s.what)}`), outLink(repoHref(INVENTORY_DOC, SUBPROCESSORS_ANCHOR), "The full list")])}</article>
  <article class="pc card" id="contact">${head("mail", "Contact")}
    <p>A question, or a request about your data:</p>
    <div class="links"><a class="pf" href="mailto:${esc(PRIVACY_CONTACT)}">${esc(PRIVACY_CONTACT)}</a></div></article>
</div>`;
  return productPage({
    key: "privacy", title: "Privacy", h1: "Privacy", label: "Test money only",
    lead: `What Purser keeps, for how long, and who processes it. ${NOT_LEGAL_ADVICE}.`,
    description: "Purser's privacy: what is kept, for how long, how it is deleted, and the services that process it. An engineering inventory, not legal advice. Test money only.",
    body,
    source: `Source: ${INVENTORY_DOC} and ${RETENTION_DOC}.`,
    real: [
      "Test money only: no real company's data is held yet.",
      `${NOT_LEGAL_ADVICE}: the retention periods are to be confirmed with an adviser.`,
    ],
  });
}
