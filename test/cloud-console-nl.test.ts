// Purser Cloud's console in Dutch (27 Nov, the owner: English first, Dutch second; with Nederlands chosen the console
// shows no English). What Purser's own code writes in English and the console shows has its Dutch in
// cloud/src/consoleNl.ts; the page translates it as it reads it. These tests hold every source sentence to a Dutch one,
// run the page's own translator (NL_JS) on the activity feed's and the records' templates, and check the chart's account
// names, the payment's rationale and Ask Purser's panel in Dutch. The browser walk (test/browser/console.check.ts,
// dutchPass) checks the pages themselves.
import { describe, expect, it } from "vitest";
import { ROSTER } from "../cloud/src/agentRoster.js";
import { ASK_PAGE_COPY, ASK_SKILLS, askPage } from "../cloud/src/ask/page.js";
import { ASK_PAGE_COPY_NL, ASK_SKILLS_NL } from "../cloud/src/ask/pageNl.js";
import { connectionsCatalogue } from "../cloud/src/connections.js";
import { consolePage } from "../cloud/src/console.js";
import { AGENT_CAN, AGENT_ROLE } from "../cloud/src/consoleData.js";
import { AGENT_NAMES_NL, CONNECTIONS_NL, NL_DATA_FIELDS, NL_DATA_PATHS, NL_EXACT, NL_JS, NL_PATTERNS, ROSTER_NL } from "../cloud/src/consoleNl.js";
import { feedLine } from "../cloud/src/dashboard.js";
import { CATEGORY_WORDS, OUTCOME_WORDS } from "../src/learning/precedent.js";
import { ACCOUNT_NAMES_NL, LEDGER_ACCOUNTS } from "../src/ledger/accounts.js";
import { RULES } from "../src/negotiate/rails.js";
import { RATIONALE_WORDS_JS } from "../src/servers/rationaleWords.js";

/** The page's own translator, on the Dutch catalogue's tables. */
const page = new Function("L", "NL", `${NL_JS}; return { nx, nxAll, nlFields };`)({ x: NL_EXACT, p: NL_PATTERNS }, true) as { nx: (s: string) => string; nxAll: <T>(v: T, fields?: readonly string[] | null) => T; nlFields: (path: string) => readonly string[] | undefined };
const english = page.nx;
/** English words a Dutch sentence never holds (the browser check's list, short). */
const EN = /\b(the|and|for|with|to|not|from|its|it|by|at|on|or|you|your|has|have|will|when|paid|invoice|payment|supplier|card|limit|own|only|each|every|after|new|policy|purchase|customer|refund|received|filed|proposed|declined|matched|stopped|duplicate)\b/i;
/** A text with its names, codes, ids and amounts taken out, as the browser check does. */
const bare = (s: string) => s.replace(/Add to (?:Cursor|VS Code)|MCP: Add Server|Teams Adaptive Card|A2A Agent Card|Hosted Payment Page|\b\w+=\w+\b|\b[A-Z][A-Z0-9_]{2,}\b|\b[a-z][\w-]*(?:\.[\w-]+)+\b|\S*\/\S*|\b[\w-]*(?:\d|_)[\w-]*\b/g, " ");

describe("every sentence Purser's code writes for the console has its Dutch", () => {
  it("the roster: each agent's name, role, job, model note, limit and link", () => {
    for (const r of ROSTER) {
      expect(AGENT_NAMES_NL[r.id], r.id).toBeTruthy();
      expect(ROSTER_NL[r.id], r.id).toBeTruthy();
      for (const s of [r.name, r.role, r.job, r.model_note, r.limit, r.see?.label].filter((x): x is string => !!x)) {
        if (s === "Treasury") continue;
        expect(NL_EXACT[s], s).toBeTruthy();
        expect(bare(NL_EXACT[s]!), s).not.toMatch(EN);
      }
    }
  });

  it("the agents' records: what each may and may not do, and its role", () => {
    for (const [id, c] of Object.entries(AGENT_CAN)) for (const s of [...c.may, ...c.may_not]) expect(NL_EXACT[s], `${id}: ${s}`).toBeTruthy();
    for (const r of Object.values(AGENT_ROLE)) if (!["Support", "Treasury"].includes(r)) expect(NL_EXACT[r], r).toBeTruthy();
  });

  it("the connections catalogue: every name that is more than a product's, what it does and what it needs", () => {
    const cat = connectionsCatalogue("https://cloud.example");
    for (const c of [...cat.money, ...cat.connections, ...cat.planned]) {
      expect(CONNECTIONS_NL[c.id], c.id).toBeTruthy();
      for (const s of [c.what, c.needs]) { expect(english(s), `${c.id}: ${s}`).not.toBe(s); expect(bare(english(s)), c.id).not.toMatch(EN); }
      expect(bare(english(c.name)), c.id).not.toMatch(EN);
    }
    for (const s of [cat.rule, cat.money_rule]) expect(english(s)).not.toBe(s);
  });

  it("the learning's kinds and outcomes, the negotiation's rules", () => {
    for (const s of [...Object.values(CATEGORY_WORDS), ...Object.values(OUTCOME_WORDS), ...Object.values(RULES)]) expect(NL_EXACT[s], s).toBeTruthy();
  });

  it("the chart's account names: every account of the ledger", () => {
    for (const k of Object.keys(LEDGER_ACCOUNTS)) expect(ACCOUNT_NAMES_NL[k], k).toBeTruthy();
  });
});

describe("the page's translator on the records' templates", () => {
  const row = (event: string, payload: Record<string, unknown>, subject: string | null = null, actor = "treasury") => feedLine({ seq: 1, ts: "2026-11-10T09:00:00Z", actor, event, subject, payload_json: JSON.stringify(payload) })!;
  it("the activity feed: each kind of line in Dutch, its ids and amounts as they are", () => {
    const lines = [
      row("card.charge_approved", { amount: "19.99", currency: "EUR", merchant: "Packwise" }),
      row("card.charge_declined", { amount: "45.00", currency: "EUR", merchant: "Packwise", reason: "LIMIT_EXCEEDED" }),
      row("card.decline_met", { proposal_id: "P-0001" }),
      row("card.decline_met", {}),
      row("receivable.matched", { detail: "NW-2026-119 from Summit Outfitters paid in full, 1987.50 EUR" }),
      row("receivable.matched", { detail: "NW-2026-119 paid in full, 1987.50 EUR" }),
      row("receivable.matched", { detail: "NW-2026-120: paid 100.00 EUR, short by 20.00 EUR; the rest stays open and the customer is asked" }),
      row("receivable.matched", { detail: "NW-2026-121: paid 130.00 EUR, over by 10.00 EUR; the excess waits in suspense and a refund is the CFO's decision" }),
      row("proposal.created", { kind: "invoice_payment" }, "P-0009"),
      row("proposal.approved", {}, "P-0009", "human"),
      row("proposal.executed", { status: "paid" }, "P-0009"),
      row("proposal.expired", {}, "P-0010"),
      row("ap.received", { invoice_no: "ZV-4471", read_by: "code" }),
      row("ap.status", { to: "waiting_cfo" }, "AP-0005"),
      row("ap.status", { to: "paid" }, "AP-0005"),
      row("ap.status", { to: "needs_vendor" }, "AP-0006"),
      row("ap.duplicate_document", { filename: "bergtex-20-again.pdf" }),
      row("payee.add_requested", { vendor: "Zeeland Verpakkingen B.V.", account: "NL…4300" }),
      row("payee.added", { vendor: "Zeeland Verpakkingen B.V." }),
    ];
    for (const f of lines) {
      const nl = english(f.text);
      expect(nl, f.text).not.toBe(f.text);
      expect(bare(nl), f.text).not.toMatch(EN);
      for (const id of f.text.match(/\b[A-Z]+-[\d-]+\b|\d+\.\d{2}/g) ?? []) expect(nl).toContain(id);
    }
    expect(english(row("card.decline_met", { proposal_id: "P-0001", source: "fallback" }).text)).toMatch(/ \(code's fallback, no model\)$/);
    // Each detail src/agents/receivables.ts audits now, without the customer's name.
    for (const d of ["NW-2026-119 paid in full, 1987.50 EUR", "NW-2026-120: paid 100.00 EUR, short by 20.00 EUR; the rest stays open and the customer is asked",
      "NW-2026-121: paid 130.00 EUR, over by 10.00 EUR; the excess waits in suspense and a refund is the CFO's decision", "12.50 EUR names no open invoice: held in suspense until the CFO identifies it",
      "12.50 USD for NW-2026-122, invoiced in EUR: held in suspense; the CFO decides whether to accept or return it"]) {
      const nl = english(d);
      expect(nl, d).not.toBe(d);
      expect(bare(nl), d).not.toMatch(EN);
      for (const id of d.match(/\b[A-Z]+-[\d-]+\b|\d+\.\d{2}/g) ?? []) expect(nl).toContain(id);
    }
    expect(english("The CFO")).toBe("De CFO");
    expect(english("Purser's code")).toBe("De code van Purser");
  });

  it("a whole answer: the strings change, the keys, codes and numbers do not", () => {
    const v = page.nxAll({ status: "active", kind: "sandbox", amount: "19.99", name: "Sourcing agent", label: "prototype · Alta testnet · test money · financier simulated", rows: [{ what: "Purchases on its own company card", in_all: "EUR 100.00 a month" }] }, ["name", "label", "rows[].what", "rows[].in_all"]);
    expect(v).toEqual({ status: "active", kind: "sandbox", amount: "19.99", name: "Inkoopagent", label: "prototype · Alta-testnet · testgeld · financier nagebootst", rows: [{ what: "Aankopen met de eigen bedrijfskaart", in_all: "EUR 100.00 per maand" }] });
    expect(english("Northwind Outdoor (demo company)")).toBe("Northwind Outdoor (demobedrijf)");
    expect(english("this deployment has no Airwallex gateway")).toBe("deze omgeving heeft geen Airwallex-gateway");
  });

  it("an English page translates nothing, and only the read-only GETs are translated", () => {
    const en = new Function("L", "NL", `${NL_JS}; return { nx, nxAll };`)({}, false) as typeof page;
    expect(en.nx("The CFO")).toBe("The CFO");
    for (const p of ["/v1/dashboard", "/v1/agents", "/v1/connections", "/v1/connections/mine", "/v1/tokenisation", "/v1/partner-rails", "/v1/negotiation/recorded", "/v1/authority-map"]) expect(NL_DATA_PATHS.test(p), p).toBe(true);
    for (const p of ["/v1/me", "/v1/invoices", "/v1/proposals/P-1", "/v1/card-design", "/v1/company", "/v1/keys"]) expect(NL_DATA_PATHS.test(p), p).toBe(false);
    // Each translated answer has its list of sentence fields, and each list its answer.
    for (const p of ["/v1/dashboard", "/v1/agents", "/v1/connections", "/v1/connections/mine", "/v1/tokenisation", "/v1/partner-rails", "/v1/negotiation/recorded", "/v1/authority-map", "/v1/cards", "/v1/airwallex-live/balances", "/v1/airwallex-live/events?x=1"]) expect(page.nlFields(p), p).toBeTruthy();
    for (const k of Object.keys(NL_DATA_FIELDS)) expect(NL_DATA_PATHS.test(`/v1/${k === "airwallex-live" ? "airwallex-live/balances" : k}`), k).toBe(true);
  });
});

// Round 2 of the v1.5.3 red team: synced text (a merchant, a payee, a supplier, a reason from the rail) is data, never
// the catalogue's. A ⟦…⟧ in it is shown as written and opens no translation, and a name that reads like a catalogue word
// ("Other", "Metal") stays as synced. Only each answer's own sentence fields are translated (NL_DATA_FIELDS).
describe("the page's translator leaves synced text as it is", () => {
  const row = (event: string, payload: Record<string, unknown>, subject: string | null = null, actor = "sourcing") => feedLine({ seq: 1, ts: "2026-11-27T10:00:00Z", actor, event, subject, payload_json: JSON.stringify(payload) })!.text;
  it("a marker in a merchant's, a payee's or a reason's text is shown as written and translates nothing", () => {
    expect(english(row("card.charge_approved", { amount: "249.00", currency: "EUR", merchant: "⟦The CFO⟧" }))).toBe("249.00 EUR betaald bij ⟦The CFO⟧ met de eigen kaart, binnen de limiet");
    expect(english(row("card.charge_approved", { amount: "249.00", currency: "EUR", merchant: "⟦Purser's code⟧" }))).toBe("249.00 EUR betaald bij ⟦Purser's code⟧ met de eigen kaart, binnen de limiet");
    expect(english(row("payee.added", { vendor: "⟦Treasury agent⟧ Ltd" }, null, "awx-executor"))).toBe("⟦Treasury agent⟧ Ltd toegevoegd als begunstigde na goedkeuring van de CFO");
    expect(english(row("card.charge_declined", { amount: "9.99", currency: "EUR", merchant: "Shop", reason: "LIMIT_EXCEEDED: ⟦still waiting⟧ 1000.00" }))).toBe("Airwallex weigerde 9.99 EUR bij Shop: LIMIT_EXCEEDED: ⟦still waiting⟧ 1000.00");
    expect(english("⟦⟦The CFO⟧⟧")).toBe("⟦⟦The CFO⟧⟧");
    expect(english("⟦1850.00⟧")).toBe("⟦1850.00⟧");
    // Purser's own markers still work: a proposal's kind and a reason in its sentence.
    expect(english(row("card.charge_declined", { amount: "9.99", currency: "EUR", merchant: "Shop", reason: "LIMIT_EXCEEDED" }))).toBe("Airwallex weigerde 9.99 EUR bij Shop: boven de limiet van de kaart");
  });

  it("only an answer's sentence fields: a merchant named Other or Metal stays Other and Metal", () => {
    const dash = { feed: [{ who: "Sourcing agent", text: row("card.charge_approved", { amount: "1.00", currency: "EUR", merchant: "Other" }) }, { who: "The CFO", text: row("card.charge_approved", { amount: "2.00", currency: "EUR", merchant: "Metal" }) }], spend: [{ key: "x", label: "Other" }], merchant: "Other", vendor: "Metal" };
    const nl = page.nxAll(dash, page.nlFields("/v1/dashboard"));
    expect(nl.feed.map((f) => f.text)).toEqual(["1.00 EUR betaald bij Other met de eigen kaart, binnen de limiet", "2.00 EUR betaald bij Metal met de eigen kaart, binnen de limiet"]);
    expect(nl.feed.map((f) => f.who)).toEqual(["Inkoopagent", "De CFO"]);
    expect({ merchant: nl.merchant, vendor: nl.vendor }).toEqual({ merchant: "Other", vendor: "Metal" });
    const rails = { label: "Airwallex sandbox · test money", t0: { bookings: [{ counterparty: "Other", what: "x" }, { counterparty: "Stockline (test payee)" }, { counterparty: "⟦The CFO⟧ (test payee)" }] }, tokens: [{ events: [{ merchant: "Metal", outcome: "approved" }] }], refusals: [{ code: "Other", detail: "Metal" }] };
    const nr = page.nxAll(rails, page.nlFields("/v1/partner-rails"));
    expect(nr.label).toBe("Airwallex-sandbox · testgeld");
    expect(nr.t0.bookings.map((b) => b.counterparty)).toEqual(["Other", "Stockline (testbegunstigde)", "⟦The CFO⟧ (testbegunstigde)"]);
    expect(nr.tokens[0]!.events[0]!.merchant).toBe("Metal");
    expect(nr.refusals[0]).toEqual({ code: "Other", detail: "Metal" });
    const agents = { agents: [{ id: "sourcing", name: "Sourcing agent", decisions: [{ text: row("card.charge_approved", { amount: "1.00", currency: "EUR", merchant: "Other" }), precedent: { cases: [{ counterparty: "Other", kind: "card purchase" }] } }] }] };
    const na = page.nxAll(agents, page.nlFields("/v1/agents"));
    expect(na.agents[0]!.name).toBe("Inkoopagent");
    expect(na.agents[0]!.decisions[0]!.text).toBe("1.00 EUR betaald bij Other met de eigen kaart, binnen de limiet");
    expect(na.agents[0]!.decisions[0]!.precedent.cases[0]!.counterparty).toBe("Other");
    expect(page.nxAll({ supplier: "Other (simulated supplier)" }, page.nlFields("/v1/negotiation/recorded")).supplier).toBe("Other (nagebootste leverancier)");
  });

  // v1.5.4: on the Agents page, a task mandate with one payee shows that payee alone as the authority map's "to", and a
  // payee named Metal or Other was shown as the catalogue's word. A task mandate's payees are names; other rows' "to" stay sentences.
  it("a task mandate's payee on the authority map stays as synced, and only a label after it is translated", () => {
    const task = (to: string) => ({ what: "Task: restock (supplier payment)", rail: "Airwallex", per_payment: "x", in_all: "x", from: "x", to, when: "x", under: "task_mandate.m1, granted by cfo (passkey)", needs_cfo: "x" });
    const map = { authority_map: { agents: [{ agent: "treasury", name: "Treasury agent", rows: [
      { ...task("x"), what: "Supplier payments alone", to: "only a task mandate's payees", under: "ap.alone_eur" }, task("Metal"), task("Other"), task("Stockline (test payee)"),
    ] }] } };
    const nm = page.nxAll(map, page.nlFields("/v1/authority-map"));
    expect(nm.authority_map.agents[0]!.rows.map((r) => r.to)).toEqual(["alleen de begunstigden van een taakmandaat", "Metal", "Other", "Stockline (testbegunstigde)"]);
    expect(nm.authority_map.agents[0]!.name).not.toBe("Treasury agent");
  });

  it("an answer with no list of sentence fields is not translated at all", () => {
    const synced = { ids: ["P-0001", "a".repeat(64)], synced: ["Metal", "Other", "Sourcing", "Airlines", "⟦1850.00⟧"], feed: ["Paid 1.00 EUR at Other on its own card, within its limit"] };
    expect(page.nxAll(synced)).toEqual(synced);
    expect(page.nxAll(synced, page.nlFields("/v1/dashboard"))).toEqual(synced);
  });
});

describe("the console carries the Dutch to a Dutch page only", () => {
  const html = consolePage("n", { origin: "https://cloud.example", rpId: "cloud.example", mailDomain: "in.example" });
  const cat = JSON.parse(/const LS=(\{.*?\});\n/s.exec(html)![1]!.replace(/\\u003c/g, "<")) as Record<"en" | "nl", { x?: unknown; p?: unknown }>;
  it("the Dutch catalogue holds the sentences and the patterns; the English one neither", () => {
    expect(cat.nl.x).toEqual(NL_EXACT);
    expect(cat.nl.p).toEqual(NL_PATTERNS);
    expect(cat.en.x).toBeUndefined();
    expect(cat.en.p).toBeUndefined();
  });
  it("the account names in both languages: 6200 Goods from the manufacturer, Goederen van de fabrikant", () => {
    const acc = JSON.parse(/const ACCOUNTS=(\{.*?\});\n/s.exec(html)![1]!.replace(/\\u003c/g, "<")) as Record<"en" | "nl", Record<string, string>>;
    expect(acc.en["6200"]).toBe("Goods from the manufacturer");
    expect(acc.nl["6200"]).toBe("Goederen van de fabrikant");
    expect(acc.nl["6800"]).toBe("Bank- en overboekingskosten");
  });
});

describe("the payment's rationale in the page's language", () => {
  const words = new Function(`${RATIONALE_WORDS_JS}; return rationaleWords;`)() as (r: unknown, nl?: boolean) => Record<string, string>;
  const r = { kind: "invoice_payment", currency: "EUR", amount: "618.80", funding: { account: null, balance: "48175.62", floor: "25000.00", conversion: null },
    rail: { method: "LOCAL", clearing: null, to: "IBAN DE75…6199", fee_held: "EUR 0.00", fee_charged: "EUR 0.00" }, rule: { by_code: false, key: "ap.alone_eur", value: null },
    approval: { decision: "APPROVED", by: "Fleur", method: "passkey", terms_sha256: "64d09794aa" }, replacement: null, transfer: null, refused: null };
  it("English without NL, Dutch with it, the record's values the same", () => {
    expect(words(r).funding).toBe("Paid EUR from the EUR balance, no conversion: it held EUR 48175.62, enough for EUR 618.80 and its fee above the floor of EUR 25000.00");
    const nl = words(r, true);
    expect(nl.funding).toBe("Betaald in EUR uit het EUR-saldo, zonder omwisseling: het had EUR 48175.62, genoeg voor EUR 618.80 en de kosten boven de ondergrens van EUR 25000.00");
    expect(nl.approval).toBe("Fleur keurde de exacte voorwaarden goed (hash 64d09794) met een passkey (Face ID)");
    for (const v of Object.values(nl)) expect(bare(v)).not.toMatch(EN);
  });
});

describe("Ask Purser's panel in Dutch", () => {
  it("every word of the panel and every skill has its Dutch", () => {
    expect(Object.keys(ASK_PAGE_COPY_NL).sort()).toEqual(Object.keys(ASK_PAGE_COPY).sort());
    for (const s of ASK_SKILLS) expect(ASK_SKILLS_NL[s.tool], s.tool).toBeTruthy();
  });
  it("the panel opened with ?lang=nl says lang=nl and shows its Dutch words; the questions it sends stay the English ones", () => {
    const html = askPage("n", { embed: true, lang: "nl", context: { kind: "overview", demo: true } });
    expect(html).toContain('<html lang="nl">');
    for (const k of ["juryHead", "juryLine", "placeholder", "privacy", "forPage", "newChat", "close"] as const) { expect(html).toContain(ASK_PAGE_COPY_NL[k]); expect(html).not.toContain(`>${ASK_PAGE_COPY[k]}<`); }
    expect(html).toContain('data-q="Which invoices wait for the CFO&#39;s Face ID?"');
    expect(askPage("n", { embed: true })).toContain('<html lang="en">');
  });
});
