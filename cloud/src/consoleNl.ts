// What Purser's own code writes in English and the console shows, in Dutch (27 Nov, the owner: English first, Dutch
// second; with Nederlands chosen the console shows no English). The console's own words live in the catalogue
// (src/ui/i18n.ts) and the per-file word tables; this file holds the rest: the sentences the API returns (the activity
// feed, the agents' records and roster, the connections catalogue, the partner rails, the authority map, the recorded
// negotiation, the tokenisation records, a gateway's reason) and the demo company's own lines.
//
// Two kinds, both sent to the page in the Dutch catalogue only (cloud/src/console.ts):
//   NL_EXACT     a whole English string and its Dutch; built from the sources' own constants where it can be, so a
//                changed English sentence is a missing Dutch one (test/cloud-console-nl.test.ts), never a wrong one
//   NL_PATTERNS  a template's pattern and its Dutch, first match wins; ⟦$1⟧ in the Dutch puts that part through the
//                same translation again (a proposal's kind, a reason, a detail)
// The page translates what it reads from a few read-only GETs (NL_DATA_PATHS) as it arrives, and an error's words
// always. A name, a code, an id or an amount is never in here, so it stays as it is. The API stays English.

import { AGENT_DISPLAY, AP_AGENT_DISPLAY } from "../../src/config/brand.js";
import { MCC_WORDS } from "../../src/config/policy.js";
import { RAIL_LABELS } from "../../src/money/registerShape.js";
import { MESSAGES } from "../../src/ui/i18n.js";
import { CATEGORY_WORDS, OUTCOME_WORDS, type Category, type Outcome } from "../../src/learning/precedent.js";
import { RULES, type RuleId } from "../../src/negotiate/rails.js";
import RUN from "../../docs/runs/2026-11-20-partner-rails.json" with { type: "json" };
import VIC from "../../docs/runs/2026-11-14-vic-5.json" with { type: "json" };
import { ROSTER } from "./agentRoster.js";
import { connectionsCatalogue } from "./connections.js";
import { AGENT_CAN, AGENT_ROLE } from "./consoleData.js";

// ---- The agents: their names, roles and jobs ----------------------------------------------------------------------

/** Each agent's name in Dutch, by its id (the roster's, the records' and the brand's names are the same English). */
export const AGENT_NAMES_NL: Readonly<Record<string, string>> = {
  sourcing: "Inkoopagent", support: "Supportagent", treasury: "Treasury-agent", checker: "Controleagent", payer: "Betaalagent",
  dispute_desk: "Geschillendesk", x402_desk: "Datadesk via x402", controller: "Controller-agent", books: "Boekhoudagent",
};
/** In a sentence ("the sourcing agent's token"): the same names, lower case. */
const agentNl = (id: string) => (AGENT_NAMES_NL[id] ?? id).toLowerCase();

/** The roster's words in Dutch (cloud/src/agentRoster.ts), by id. */
export const ROSTER_NL: Readonly<Record<string, { role: string; job: string; model_note: string; limit: string; see?: string }>> = {
  sourcing: {
    role: "Inkoop en onderhandeling",
    job: "Koopt per vraag actuele voorraadchecks bij Stockline via x402, kiest voor elke aankoop de rail en vangt een prijsverhoging van een leverancier op. Onderhandelt ook over korting voor vroeg betalen met de agent van een leverancier.",
    model_note: "Haiku stelt voor; de code controleert elke voorwaarde, rail en elk bedrag voordat er iets betaald wordt",
    limit: "Zijn mandaat op Alta begrenst elke aankoop en zijn budget; zijn Airwallex-kaart draagt de limieten van de CFO",
    see: "Bekijk een onderhandeling",
  },
  checker: {
    role: "Crediteuren: de controle",
    job: "Beslist wat er met elke leveranciersfactuur gebeurt: betalen, de CFO vragen, vasthouden of afwijzen. De eigen controles van de code kunnen dat alleen strenger maken.",
    model_note: "Haiku beslist met zijn tools; een bevinding van de controles van de code houdt de factuur vast, wat hij ook zegt",
    limit: "Betaalt niets; boven de limieten van de CFO wacht een factuur op Face ID",
  },
  payer: {
    role: "Crediteuren: het betaalplan",
    job: "Stelt voor hoe en wanneer een gecontroleerde factuur betaald wordt: de rail, de dag en de valuta waaruit betaald wordt.",
    model_note: "Haiku stelt voor op het eigen plan van de engine; de code houdt tegen wat een ondergrens van de treasury doorbreekt",
    limit: "Betaalt nooit alleen: de CFO tekent de exacte voorwaarden met Face ID",
  },
  treasury: {
    role: "Treasury",
    job: "Houdt de uitgaven bij, verdeelt de mandaten van de agents opnieuw na een prijsverhoging, boekt definitieve opbrengsten over naar Airwallex en betaalt de licentie in EUR, met advies over wanneer te betalen.",
    model_note: "Opus maakt het plan en kiest het moment; de code controleert het, en bij een weigering neemt het vaste plan van de code het over",
    limit: "Er verandert niets op de chain of bij Airwallex tot de CFO het goedkeurt met Face ID",
  },
  support: {
    role: "Geschillen met klanten",
    job: "Handelt het geschil van een klant af: controleert elke bestelling op de chain en elke geleverde voorraadcheck tegen de correctie van de leverancier, betaalt de verkeerde terug en stuurt de rest met zijn advies naar de CFO.",
    model_note: "Sonnet leest en adviseert; de code bewaakt elke terugbetaling en betaalt alleen naar de eigen rekening van de klant",
    limit: "Betaalt terug binnen de automatische limieten van de CFO; daarboven wacht de terugbetaling op Face ID",
  },
  dispute_desk: {
    role: "Geschillendesk van de verkoper",
    job: "Als een klant een aankoop van een agent betwist, beslist hij op wat Northwind kan bewijzen: de getekende bestelling, de betaling op de chain gecontroleerd tegen het mandaat, de afwikkeling en de geleverde data.",
    model_note: "De code beslist; Opus legt het besluit uit aan de hand van het bewijs",
    limit: "Een terugbetaling boven de limieten van de CFO wacht op Face ID, net als elke andere",
  },
  x402_desk: {
    role: "Verkoper en koper van data",
    job: "Verkoopt per x402-betaling één actuele voorraadcheck aan de agents van andere bedrijven, elk met een getekende bestelling, en koopt dezelfde check in bij Stockline via het mandaat van de inkoopagent. Wordt de inkoop geweigerd, dan betaalt de klant niets.",
    model_note: "Alleen code: geen model beslist over een verkoop",
    limit: "Een verkoop telt pas als de betaling is afgewikkeld; de inkoop blijft binnen het inkoopmandaat",
  },
  controller: {
    role: "Maandafsluiting",
    job: "Beoordeelt de leveranciersfacturen van de maand in het opgeslagen grootboek en stelt tegenboekingen of btw-correcties voor, elk berekend door de code.",
    model_note: "Sonnet stelt voor met tools die alleen lezen; alleen de goedkeuring van een mens boekt iets",
    limit: "USD 0.40 en drie minuten per run; boekt zelf niets",
  },
  books: {
    role: "Vragen over de boeken",
    job: "Beantwoordt de vragen van de CFO over de boeken in woorden, met cijfers die de code controleert tegen de grootboekregels die hij aanhaalt.",
    model_note: "Sonnet zoekt met tools die alleen lezen; de code controleert elk cijfer dat hij aanhaalt",
    limit: "USD 0.25 en twee minuten per vraag; boekt, betaalt en stelt niets voor",
  },
};

/** What each agent does, as the company's records say it (src/config/brand.ts), by id. */
const JOB_NL: Readonly<Record<string, string>> = {
  sourcing: "koopt per vraag data in (actuele voorraadchecks bij de magazijn-API) en betaalt de magazijnsoftware",
  support: "betaalt klanten terug als een geschil terecht is en betaalt de helpdesksoftware",
  treasury: "houdt de uitgaven bij, boekt definitieve opbrengsten over naar Airwallex en betaalt de maandelijkse licentie in EUR (Airwallex FX en SWIFT, na de Face ID van de CFO)",
  checker: "beslist wat er met elke leveranciersfactuur gebeurt: betalen, de CFO vragen, vasthouden of afwijzen; de eigen controles van de code kunnen dat alleen strenger maken",
  payer: "stelt voor hoe en wanneer een gecontroleerde factuur betaald wordt: de rail, de dag en de valuta; de code houdt tegen wat een ondergrens doorbreekt, en de CFO tekent de exacte voorwaarden",
};

/** What each agent may and may not do (cloud/src/consoleData.ts AGENT_CAN), in the same order. */
const CAN_NL: Readonly<Record<string, { may: string[]; may_not: string[] }>> = {
  sourcing: { may: ["Data en de magazijnsoftware kopen met de eigen kaart, binnen de limieten", "De CFO om een hogere limiet vragen"], may_not: ["Zijn eigen limiet verhogen", "Een leveranciersfactuur betalen", "Een winkel buiten de categorieën van zijn kaart betalen"] },
  support: { may: ["Klanten terugbetalen als een geschil terecht is", "De helpdesksoftware betalen met de eigen kaart, binnen de limieten"], may_not: ["Zijn eigen limiet verhogen", "Een leveranciersfactuur betalen", "Een winkel buiten de categorieën van zijn kaart betalen"] },
  treasury: { may: ["De uitgaven bijhouden en definitieve opbrengsten overboeken naar Airwallex", "De betaling van een leveranciersfactuur voorstellen aan de CFO", "Kleine softwarekosten betalen met de eigen kaart, binnen de limieten"], may_not: ["Een leveranciersfactuur betalen zonder de Face ID van de CFO op de exacte voorwaarden", "Een limiet of het beleid wijzigen", "Een leverancier toevoegen"] },
  checker: { may: ["Beslissen wat er met elke leveranciersfactuur gebeurt: betalen, de CFO vragen, vasthouden of afwijzen"], may_not: ["De eigen controles van de code versoepelen (hij kan ze alleen strenger maken)", "Iets betalen"] },
  payer: { may: ["Voorstellen hoe en wanneer een gecontroleerde factuur betaald wordt: rail, dag en valuta"], may_not: ["Betalen zonder de Face ID van de CFO op de exacte voorwaarden", "Een ondergrens van de treasury doorbreken"] },
};
const ROLE_NL: Readonly<Record<string, string>> = { sourcing: "Inkoop", support: "Support", treasury: "Treasury", checker: "Crediteuren (controle)", payer: "Crediteuren (betaling)" };

// ---- The connections catalogue (cloud/src/connections.ts), by id ---------------------------------------------------

/** Each connection's name (where it is more than a product's own name), what it does and what a company needs, in Dutch. */
export const CONNECTIONS_NL: Readonly<Record<string, { name?: string; what: string; needs: string }>> = {
  airwallex: { what: "Kaarten voor de agents met de limieten van de CFO, valutakoersen binnen de getekende voorwaarden, overboekingen met de hash die de CFO tekende, de naamcontrole van de begunstigde, en de goedkeuring van Airwallex als tweede slot.", needs: "Vandaag draaien de sandboxruns van Purser. De eigen Airwallex-rekening van een bedrijf koppel je hier met OAuth zodra het platform zijn Airwallex-app registreert." },
  alta: { name: "Alta (voorheen Metal)", what: "Een mandaat per agent op de chain, x402-betalingen, limieten die alleen met twee passkeys veranderen, en de kop van het auditlog verankerd op de chain.", needs: "De runner met een Alta-testnet-RPC (METAL_RPC_URL) en een wallet per agent; alleen testgeld." },
  "visa-airi": { what: "Visa Intelligent Commerce via Airi van Airwallex: een credential die Purser aan één aankoop bindt, met een testkaart; boven de limiet pas na de Face ID van de CFO.", needs: "De runner met KIT11_AIRI_RAIL=on, de sandboxsleutels van Airwallex en de testkaart van Airi." },
  "agent-api": { name: "Agent-API op de runner (lokale MCP)", what: "Een agent van buiten vraagt een bedrijfskaart aan, betaalt ermee en vraagt om een hogere limiet, onder het beleid van de CFO; elke kaart en elke verhoging goedgekeurd met Face ID. Gedraaid in de Airwallex-sandbox op 29 okt.", needs: "De runner: npm run -s mcp met KIT11_AGENT als naam van de agent van buiten; elke kaart en verhoging wacht op de Face ID van de CFO." },
  t0: { name: "T:0 (extern grootboek)", what: "De journaalposten van Purser geboekt in de gedeelde sandboxentiteit van T:0 en teruggelezen, rekening voor rekening. Een grootboek: het verplaatst geen geld.", needs: "Een T:0-API-sleutel op de runner (T0_API_KEY); npm run t0 boekt het journaal en leest het terug." },
  mcp: { name: "MCP-server (koppel elke AI)", what: "Claude, ChatGPT, Cursor, VS Code, Gemini CLI, Windsurf en elke MCP-client lezen de boeken: 14 leestools, resources en prompts. OAuth 2.1 of een connectortoken.", needs: "Een connectortoken (Koppel je AI, voor eigenaren) of het inloggen met OAuth van de client." },
  claude: { what: "claude.ai, de Claude-apps en Claude Code, als aangepaste connector. Door de eigenaar toegevoegd in de iOS-app van Claude op 13 nov.", needs: "claude.ai: Instellingen, Connectors, Aangepaste connector toevoegen, plak het /mcp-adres en daarna je connectortoken." },
  chatgpt: { what: "Een aangepaste MCP-server met OAuth (Client ID Metadata Document). Ingericht volgens de documentatie van OpenAI; nog niet live geprobeerd.", needs: "Het /mcp-adres en een connectortoken; de precieze stappen staan op Instellen per AI." },
  cursor: { what: "mcp.json of de link Add to Cursor op /connect-ai. Volgens de documentatie van Cursor; nog niet live geprobeerd.", needs: "De link Add to Cursor op Instellen per AI en een connectortoken." },
  vscode: { what: "Agentmodus van GitHub Copilot: de link Add to VS Code op /connect-ai of MCP: Add Server. Volgens de documentatie van VS Code; nog niet live geprobeerd.", needs: "De link Add to VS Code op Instellen per AI en een connectortoken." },
  gemini: { what: "gemini mcp add --transport http. Volgens de documentatie van Gemini CLI; nog niet live geprobeerd.", needs: "gemini mcp add met het /mcp-adres en een connectortoken." },
  windsurf: { what: "serverUrl en headers in de MCP-configuratie. Volgens de documentatie van Devin; nog niet live geprobeerd.", needs: "Het /mcp-adres en een connectortoken in de MCP-configuratie." },
  "awx-codemode": { name: "Airwallex-sandbox, alleen lezen (Code Mode MCP)", what: "Een tweede MCP-server met twee tools, zoeken en uitvoeren: een AI leest de Airwallex-sandbox (saldi, overboekingen, valuta, kaarten) met alleen GET-aanroepen, elk gecontroleerd voordat hij verstuurd wordt. Getest tegen een nagebootste gateway; er is nog geen live lezing vastgelegd.", needs: "Hetzelfde connectortoken, op /mcp/airwallex in plaats van /mcp." },
  rest: { name: "Lees-API (REST) en de OpenAPI", what: "Facturen, documenten, leveranciers, betalingen, het transactieregister, het grootboek en de rapporten, voor een sleutel met leesrechten.", needs: "Een API-sleutel met leesrechten (Instellingen, API-sleutels)." },
  webhook: { what: "Getekende POST's (x-purser-signature: t=<seconden>,v1=<HMAC-SHA256 van t.body>) voor drie zakelijke gebeurtenissen (payment.paid, approval.needed, books.closed), de meldingen van de runner en beveiligingsgebeurtenissen.", needs: "Een https-adres van jezelf; Purser toont het ondertekeningsgeheim één keer." },
  sdks: { name: "TypeScript- en Python-SDK's", what: "Clients voor de API zonder methode om goed te keuren, getest tegen Purser Cloud in hetzelfde proces.", needs: "Een API-sleutel (lezen, of lezen en voorstellen) en de SDK uit sdk/typescript of sdk/python." },
  a2a: { what: "De vaardigheden van Purser in het kaartformaat van Agent2Agent, om gevonden te worden; elke vaardigheid leest of stelt voor.", needs: "Niets: de kaart staat openbaar op /.well-known/agent.json." },
  "zapier-make": { name: "Zapier en Make (HTTP-modules)", what: "Recepten met de gewone HTTP-modules en de getekende webhook, geschreven vanuit het OpenAPI-document; de verzoeken zijn getest in hetzelfde proces, niet gedraaid in Zapier of Make.", needs: "Een sleutel om te lezen en voor te stellen en de getekende webhook; de recepten staan in de handleiding." },
  n8n: { name: "n8n-node", what: "Een communitynode zonder handeling om goed te keuren; nog niet gebouwd of gepubliceerd op npm.", needs: "Bouw de node uit integrations/n8n, koppel hem aan je n8n en geef hem een sleutel om te lezen en voor te stellen." },
  "xero-csv": { what: "Inkoopfacturen en memoriaalboekingen als CSV in de importkolommen van Xero.", needs: "Niets te koppelen: download de CSV en importeer hem in Xero." },
  "xero-runner": { what: "Contacten en memoriaalboekingen via de API van Xero, getest tegen een nabootsing; vraagt de OAuth-app van de eigenaar.", needs: "De Xero-OAuth-app van de eigenaar op de runner." },
  "quickbooks-csv": { what: "Inkoopfacturen als CSV met de verplichte importkolommen van QuickBooks.", needs: "Niets te koppelen: download de CSV en importeer hem in QuickBooks Online." },
  "exact-csv": { what: "Inkoopboekingen en memoriaalboekingen als CSV in de kolommen van het importsjabloon van Exact.", needs: "Niets te koppelen: download de CSV en importeer hem met het importsjabloon van Exact." },
  exact: { what: "De eigenaar van elk bedrijf koppelt de eigen Exact Online-administratie in Purser Cloud (Koppelingen, \"Exact Online koppelen\"; tokens per bedrijf verzegeld); de connector van de runner (ERP_EXACT_OAUTH=on) boekt daarna inkoopfacturen en memoriaalposten via de REST-API van Exact met het token van dat bedrijf. Nog niet gedraaid tegen een live Exact-administratie.", needs: "Het platform registreert de Exact-app van Purser Cloud; daarna koppel je Exact Online hier, en zet de runner ERP_EXACT_OAUTH=on." },
  xero: { name: "Xero-facturen (gekoppeld in Purser Cloud)", what: "De eigenaar van elk bedrijf koppelt de eigen Xero-organisatie in Purser Cloud (Koppelingen, \"Xero koppelen\"; OAuth2 met PKCE, tokens per bedrijf verzegeld, ververst, altijd te ontkoppelen) en stuurt de leveranciersfacturen daarheen als concept (DRAFT). Purser keurt in Xero nooit een factuur goed en betaalt er nooit een. Getest met een nabootsing volgens de documentatie van Xero; nog niet gedraaid tegen een Xero-demobedrijf.", needs: "Het platform registreert de Xero-app van Purser Cloud; daarna koppel je Xero hier en kies je de organisatie." },
  quickbooks: { what: "Alleen het koppelen: de eigenaar van elk bedrijf koppelt het eigen QuickBooks Online-bedrijf (OAuth2, tokens per bedrijf verzegeld, ververst, te ontkoppelen). Facturen versturen staat gepland; tot dan de CSV-export voor QuickBooks. Nog niet gedraaid tegen een sandboxbedrijf van Intuit.", needs: "Het platform registreert de Intuit-app van Purser Cloud; daarna koppel je QuickBooks hier. Facturen versturen staat gepland." },
  moneybird: { what: "De connector van de runner boekt inkoopfacturen en memoriaalposten via de API van Moneybird; één keer live gedraaid in een sandboxadministratie. Moneybird heeft hiervoor geen CSV-import, dus er is geen Moneybird-CSV.", needs: "Een Moneybird-API-token met de scope documents op de runner; hier koppelen kan ook zodra het platform zijn Moneybird-app registreert." },
  "bc-odoo": { name: "Business Central en Odoo (API)", what: "De connectors van de runner voor Microsoft Dynamics 365 Business Central en Odoo 17 en 18; nog niet gedraaid tegen een live systeem.", needs: "De inloggegevens van het bedrijf voor Business Central of Odoo op de runner; eerst npm run erp -- sync --dry-run." },
  "peppol-ubl": { name: "Peppol-facturen (UBL, BIS Billing 3.0)", what: "Een Peppol-factuur of -creditnota gelezen uit de UBL en gecontroleerd als een pdf; getest op zelfgemaakte bestanden en de officiële voorbeelden, nooit ontvangen via het Peppol-netwerk.", needs: "Niets te koppelen: een UBL-bestand gaat net als een pdf de crediteureninbox in." },
  iso20022: { what: "Eén betaalde factuur als pacs.008.001.08-bericht, gecontroleerd tegen het officiële schema; in de vorm van pacs.008, geen bericht dat een bank verstuurde.", needs: "Niets te koppelen: npm run iso20022 schrijft het bericht voor een betaalde factuur." },
  "slack-teams": { name: "Berichten in Slack en Microsoft Teams", what: "De eigenaar van elk bedrijf plakt de eigen inkomende webhook van Slack of de webhook-URL van een Teams Workflow (Koppelingen, Slack en Teams); Purser plaatst daar zijn drie zakelijke gebeurtenissen (payment.paid, approval.needed, books.closed) als Slack Block Kit of een Teams Adaptive Card, opnieuw geprobeerd, per uur begrensd en uitgezet na 20 mislukkingen op rij. \"Stuur een test\" plaatst één bericht. Een bericht linkt naar Purser Cloud en keurt nooit iets goed. Getest met nabootsingen; nog geen echt kanaal heeft een bericht ontvangen.", needs: "Je eigen inkomende webhook van Slack of URL van een Teams Workflow (Slack en Teams, hieronder)." },
  inbox: { name: "Facturen per e-mail (doorgestuurd uit Gmail of Outlook)", what: "Elk bedrijf stuurt zijn leveranciersfacturen uit Gmail, Google Workspace, Outlook of Microsoft 365 door naar het eigen Purser-adres; de bevestigingscode voor doorsturen van Gmail staat in Instellingen. Er wordt nog geen maildomein doorgestuurd, en er wordt geen uitkomst van SPF, DKIM of DMARC gelezen.", needs: "Een maildomein dat naar deze cloud doorstuurt (de stap van het platform), en daarna een doorstuurregel in Gmail of Outlook." },
  "sign-in": { name: "Inloggen met Google, Microsoft en Apple", what: "Iedereen koppelt het eigen Google-, Microsoft- of Apple-account terwijl hij met zijn passkey is ingelogd, en logt daarna daarmee in om alleen te lezen. Instellingen en goedkeuren vragen nog steeds de passkey. Getest tegen een nagebootste provider.", needs: "De OAuth-apps van het platform; daarna koppelt iedereen het eigen account met zijn passkey (Instellingen)." },
  alerts: { name: "Goedkeuringsmeldingen (e-mail, WhatsApp, Slack, Teams)", what: "Als een betaling wacht op de Face ID van de CFO: het bedrag, de begunstigde, waarom, en een link naar Purser Cloud, per e-mail (Resend), WhatsApp (Twilio) of een inkomende webhook van Slack of Teams die een eigenaar instelt. Niets in een melding keurt iets goed. Getest met nabootsingen; nog niet live verstuurd.", needs: "Een e-mailadres, een WhatsApp-nummer of een webhook van Slack of Teams (Meldingen, hieronder); e-mail en WhatsApp vragen de providersleutels van het platform." },
  workplace: { name: "Google Workspace en Microsoft 365", what: "Facturen binnen uit Gmail, Drive, Outlook en OneDrive, een export naar Sheets en inloggen met Google als meelezer; getest tegen nabootsingen, vraagt de OAuth-apps van de eigenaar.", needs: "De Google- of Microsoft-OAuth-apps van de eigenaar op de runner." },
  export: { name: "Volledige export", what: "Elk record van het bedrijf als JSON in delen, met getekende links, voor een eigenaar.", needs: "Niets: een eigenaar downloadt hem in Instellingen, Je gegevens." },
  "peppol-network": { name: "Peppol-netwerk (een Access Point)", what: "Facturen ontvangen via het Peppol-netwerk zelf, niet alleen als UBL-bestanden.", needs: "Een gecertificeerd Peppol Access Point, gekozen en geregistreerd door de eigenaar; er is nog niets aangesloten." },
};
const CX_RULE_NL = "Elke koppeling leest, meldt of exporteert. Geen enkele verplaatst geld, keurt een betaling goed, wijzigt een limiet of schrijft in de boeken van Purser; een boekhoudpakket krijgt concepten of boekingen die iemand daar controleert. Elke betaling vraagt de Face ID van de CFO in Purser Cloud.";
const CX_MONEY_RULE_NL = "Geld gaat alleen hierover, en alleen binnen de limieten die de CFO tekende of na de Face ID van de CFO op de exacte voorwaarden. Alleen testgeld: sandboxes en een testnet.";

// ---- Words of the learning (src/learning/precedent.ts), the negotiation's rails and the merchant categories ------------

const CATEGORY_NL: Readonly<Record<Category, string>> = { supplier_payment: "leveranciersbetaling", card_raise: "verhoging van de kaartlimiet", card_purchase: "kaartaankoop", invoice_check: "factuurcontrole", other: "ander voorstel" };
const OUTCOME_NL: Readonly<Record<Outcome, string>> = {
  signed: "de CFO tekende het", rejected: "de CFO wees het af", expired: "niemand tekende het voordat het verliep",
  overridden: "de controles van Purser maakten het besluit strenger", refused: "het slot van de kaart weigerde het", waiting: "wacht nog",
};
const RULES_NL: Readonly<Record<RuleId, string>> = {
  max_amount: "Het beleid van de CFO: de inkoopagent betaalt hoogstens het totaal van de factuur.",
  pay_by_window: "Het beleid van de CFO: niet eerder betalen dan vandaag en niet later dan de vervaldatum van de factuur.",
  invoice_only: "Het beleid van de CFO: niets buiten de factuur (dezelfde factuur, dezelfde valuta, geen extra regels of kosten).",
  payee_unchanged: "Het beleid van de CFO: de bankgegevens van de begunstigde blijven die in de administratie. In een onderhandeling wordt nooit een nieuwe rekening afgesproken.",
};
const MCC_NL: Readonly<Record<string, string>> = { "5734": "Software", "7372": "Softwarediensten", "7311": "Advertenties", "5192": "Boeken en rapporten", "4511": "Luchtvaart", "7011": "Hotels", "4112": "Treinen", "8931": "Boekhouding" };

// ---- The partner rails' recorded run (docs/runs/2026-11-20-partner-rails.json), by its keys --------------------------

const RUN_WHAT_NL: Readonly<Record<string, string>> = {
  a: "het token van de inkoopagent betaalt Packwise EUR 1.00 (magazijnsoftware, MCC 5734)",
  b: "het token van de supportagent betaalt Replyhub EUR 1.25 (helpdesksoftware, MCC 7372)",
  c: "de betaalagent betaalt Stockline Data GmbH EUR 1.00 met een Airwallex-overboeking, binnen de limiet van de CFO om alleen te betalen",
  d: "de inkoopagent betaalt Stockline 0.05 test-USD op het Alta-testnet onder zijn eigen mandaat",
  e: "het token van de supportagent, EUR 60.01: boven zijn EUR 60.00 per aankoop",
  f: "het token van de supportagent bij een winkel in magazijnsoftware (MCC 5734): niet zijn categorie",
  g: "het token van de supportagent nadat de agent was ingetrokken, EUR 1.25 binnen het oude mandaat",
  h: "het kaartnummer van de supportagent rechtstreeks belast, zonder het token (EUR 1.25): de kaart is bevroren bij Airwallex",
};

// ---- Everything else Purser's code writes whole ---------------------------------------------------------------------

const SENTENCES: Readonly<Record<string, string>> = {
  // The activity feed's who (cloud/src/dashboard.ts) and the spend's labels.
  "The CFO": "De CFO", "Purser's code": "De code van Purser", "Other": "Overig",
  "Supplier invoices, CFO-approved": "Leveranciersfacturen, goedgekeurd door de CFO",
  // Why a card declined (dashboard.ts reasonWords).
  "over the card's limit": "boven de limiet van de kaart", "a merchant category this card may not pay": "een winkelcategorie die deze kaart niet mag betalen",
  // A proposal's kind, as the feed says it.
  "invoice payment": "factuurbetaling", "supplier payment": "leveranciersbetaling", "policy change": "beleidswijziging", "payee change": "wijziging van een begunstigde",
  "payee add": "nieuwe begunstigde", "task card": "taakkaart", "mandate replace": "nieuw mandaat", "quarantine release": "vrijgave uit quarantaine",
  "convert shortfall": "omwisseling voor een tekort", "pay from eur": "betaling uit EUR", "pay alone": "zelf betalen", "agent purchase": "aankoop door een agent",
  // The agents' records (cloud/src/consoleData.ts).
  "Purser's code (fallback: no model answered)": "De code van Purser (terugval: geen model antwoordde)",
  "Pausing or revoking an agent is the CFO's decision, signed with Face ID on the company's runner; this view shows the state its records report.": "Een agent pauzeren of intrekken is de beslissing van de CFO, getekend met Face ID op de runner van het bedrijf. Deze weergave toont de stand die de administratie meldt.",
  // Tokenisation (cloud/src/consoleData.ts tokenisation, the records' own labels).
  "prototype": "prototype", "test money": "testgeld", "financier simulated": "financier nagebootst", "Alta testnet": "Alta-testnet",
  "Minted": "Gemunt", "Offered": "Aangeboden", "Financed": "Gefinancierd", "Debtor approved": "Debiteur akkoord", "Settled and burned": "Voldaan en verbrand",
  "Minted to the creditor": "Gemunt voor de crediteur", "Financed: offered, approved and accepted by the financier": "Gefinancierd: aangeboden, goedgekeurd en aanvaard door de financier",
  "Settled by the debtor: face value to the holder, token burned": "Voldaan door de debiteur: nominale waarde naar de houder, token verbrand",
  "Fund the issuer's key": "De sleutel van de uitgever van geld voorzien", "Fund the creditor's key": "De sleutel van de crediteur van geld voorzien",
  "Fund the financier's key": "De sleutel van de financier van geld voorzien", "Fund the payer's key": "De sleutel van de betaler van geld voorzien",
  "Deploy PurserInvoiceToken": "PurserInvoiceToken uitrollen", "Mint to the creditor": "Munten voor de crediteur", "Offer to the financier": "Aanbieden aan de financier",
  "Financier approves the price": "De financier keurt de prijs goed", "Financier accepts: advance to the creditor": "De financier aanvaardt: voorschot naar de crediteur",
  "Debtor approves the face value": "De debiteur keurt de nominale waarde goed", "Debtor settles: face value to the holder, token burned": "De debiteur voldoet: nominale waarde naar de houder, token verbrand",
  "Airwallex sandbox · test money": "Airwallex-sandbox · testgeld", "Airwallex sandbox": "Airwallex-sandbox",
  "sourcing agent: warehouse and data software": "inkoopagent: magazijn- en datasoftware", "support agent: helpdesk software": "supportagent: helpdesksoftware",
  "treasury agent: bookkeeping": "treasury-agent: boekhouding", "warehouse and data software": "magazijn- en datasoftware", "helpdesk software": "helpdesksoftware", "bookkeeping": "boekhouding",
  [VIC.label]: "live: airi-cli en de Airwallex-sandbox (testgeld, de testkaart van Airi); afrekenen: de Hosted Payment Page in de Airwallex-sandbox, ingevuld door de agent zoals een klant dat doet (onze eigen testwinkel; testgeld)",
  "Alta testnet, test money; the financier is simulated": "Alta-testnet, testgeld; de financier is nagebootst",
  "Northwind Outdoor test shop (Airwallex sandbox)": "testwinkel van Northwind Outdoor (Airwallex-sandbox)",
  // The partner rails (cloud/src/partnerRails.ts).
  "This company's own records": "De eigen gegevens van dit bedrijf",
  // The recorded negotiation (cloud/src/agentPhoneCard.ts negotiationPreview).
  "Recorded negotiation: written in advance, not a live model call; the rails' answers are computed": "Opgenomen onderhandeling: vooraf geschreven, geen live modelaanroep; de antwoorden van de rails worden berekend",
  // A gateway this deployment does not have (cloud/src/awxLive.ts, the engine's Airwallex guard).
  "this deployment has no Airwallex gateway": "deze omgeving heeft geen Airwallex-gateway",
  "this deployment has no link to the site's Airwallex webhook": "deze omgeving heeft geen koppeling met de Airwallex-webhook van de site",
  "this deployment has no card gateway": "deze omgeving heeft geen kaartgateway",
  // The authority map's rows (src/policy/authorityMap.ts), word for word where they have no figure in them.
  "Live stock checks from the warehouse API, per query (x402)": "Actuele voorraadchecks bij de magazijn-API, per vraag (x402)",
  "metal (on chain, test USD)": "Metal (op de chain, test-USD)", "no mandate bound on chain": "geen mandaat op de chain gebonden",
  "its own mandate on Metal (Alta)": "zijn eigen mandaat op Metal (Alta)", "the warehouse (its supplier)": "het magazijn (zijn leverancier)",
  "any time while it is working": "altijd, zolang hij aan het werk is", "cap.sourcing; its on-chain mandate": "cap.sourcing; zijn mandaat op de chain",
  "a supplier price above its limit (it stops, proposes options and waits)": "een leveranciersprijs boven zijn limiet (hij stopt, stelt opties voor en wacht)",
  "Purchases on its own company card": "Aankopen met de eigen bedrijfskaart", "card (Airwallex Issuing, Visa)": "kaart (Airwallex Issuing, Visa)",
  "its own company card at Airwallex (frozen outside a purchase window Purser opens)": "de eigen bedrijfskaart bij Airwallex (bevroren buiten een aankoopvenster dat Purser opent)",
  "its card's merchant categories": "de winkelcategorieën van zijn kaart",
  "Refunds when a dispute holds": "Terugbetalingen als een geschil terecht is", "the customer of the disputed sale": "de klant van de betwiste verkoop",
  "approval.refund_each, approval.refund_per_dispute; its on-chain mandate": "approval.refund_each, approval.refund_per_dispute; zijn mandaat op de chain",
  "Sweeps of final earnings to Airwallex": "Overboekingen van definitieve opbrengsten naar Airwallex", "metal, then Airwallex": "Metal, daarna Airwallex",
  "the company's own Airwallex account": "de eigen Airwallex-rekening van het bedrijf", "cap.treasury; its on-chain mandate": "cap.treasury; zijn mandaat op de chain",
  "nothing else: a sweep only ever goes to the company's own account": "niets anders: een overboeking gaat altijd naar de eigen rekening van het bedrijf",
  "Supplier invoices, alone (invoice payment, supplier payment)": "Leveranciersfacturen, zelf (factuurbetaling, leveranciersbetaling)",
  "Airwallex payout (LOCAL or SWIFT)": "Airwallex-uitbetaling (LOCAL of SWIFT)",
  "none: no limit to pay alone is in force, so the CFO signs every invoice": "geen: er geldt geen limiet om zelf te betalen, dus de CFO tekent elke factuur",
  "no total beyond the limit per payment": "geen totaal boven de limiet per betaling", "only inside a task mandate in force (rows below)": "alleen binnen een geldend taakmandaat (regels hieronder)",
  "suppliers on file, verified and approved with Face ID": "bekende leveranciers, gecontroleerd en goedgekeurd met Face ID", "only a task mandate's payees": "alleen de begunstigden van een taakmandaat",
  "Single-use task cards you ask for at the runner (Ask Purser)": "Taakkaarten voor één gebruik die je op de runner aanvraagt (Vraag Purser)",
  "card (Airwallex Issuing, single use)": "kaart (Airwallex Issuing, één gebruik)", "a new single-use card at Airwallex": "een nieuwe kaart voor één gebruik bij Airwallex",
  "the task's merchant categories": "de winkelcategorieën van de taak", "a new payee or changed bank details": "een nieuwe begunstigde of gewijzigde bankgegevens",
  "any merchant": "elke winkel", "paused by the CFO": "gepauzeerd door de CFO", "the emergency stop is on": "de noodstop staat aan",
};

/** Whole strings, English to Dutch. */
export const NL_EXACT: Readonly<Record<string, string>> = (() => {
  const out: Record<string, string> = { ...SENTENCES };
  const add = (en: string | undefined, nl: string | undefined) => { if (en && nl && en !== nl) out[en] = nl; };
  for (const r of ROSTER) {
    const nl = ROSTER_NL[r.id];
    add(r.name, AGENT_NAMES_NL[r.id]);
    if (!nl) continue;
    add(r.role, nl.role); add(r.job, nl.job); add(r.model_note, nl.model_note); add(r.limit, nl.limit); add(r.see?.label, nl.see);
  }
  for (const [id, d] of Object.entries({ ...AGENT_DISPLAY, ...AP_AGENT_DISPLAY })) { add(d.name, AGENT_NAMES_NL[id]); add(d.job, JOB_NL[id]); }
  for (const [id, c] of Object.entries(AGENT_CAN)) { c.may.forEach((s, i) => add(s, CAN_NL[id]?.may[i])); c.may_not.forEach((s, i) => add(s, CAN_NL[id]?.may_not[i])); }
  for (const [id, r] of Object.entries(AGENT_ROLE)) add(r, ROLE_NL[id]);
  const cat = connectionsCatalogue("");
  add(cat.rule, CX_RULE_NL); add(cat.money_rule, CX_MONEY_RULE_NL);
  for (const c of [...cat.money, ...cat.connections, ...cat.planned]) { const nl = CONNECTIONS_NL[c.id]; add(c.name, nl?.name); add(c.what, nl?.what); add(c.needs, nl?.needs); }
  for (const [k, v] of Object.entries(CATEGORY_WORDS)) add(v, CATEGORY_NL[k as Category]);
  for (const [k, v] of Object.entries(OUTCOME_WORDS)) add(v, OUTCOME_NL[k as Outcome]);
  for (const [k, v] of Object.entries(RULES)) add(v, RULES_NL[k as RuleId]);
  for (const [k, v] of Object.entries(MCC_WORDS)) add(v, MCC_NL[k]);
  for (const [k, v] of Object.entries(RAIL_LABELS)) add(v, MESSAGES.nl[`rail.${k}` as keyof typeof MESSAGES.nl]);
  for (const p of [...(RUN as { payments: { key: string; what: string }[] }).payments, ...(RUN as { refusals: { key: string; what: string }[] }).refusals]) add(p.what, RUN_WHAT_NL[p.key]);
  return out;
})();

/** Each agent as a sentence names it ("the sourcing agent's"), with its Dutch name in lower case. */
const IN_SENTENCE = Object.keys(AGENT_NAMES_NL).map((id) => [id.replace(/_/g, " "), agentNl(id)] as const);

/** Templates, first match wins. The receivables', feed's and learning's sentences, the authority map's figures. */
export const NL_PATTERNS: readonly (readonly [string, string])[] = [
  // The activity feed (cloud/src/dashboard.ts feedLine); a fallback's note stays as written: the page takes it off and says it.
  ["^Paid (\\S+) (\\S+) at (.+) on its own card, within its limit$", "$1 $2 betaald bij $3 met de eigen kaart, binnen de limiet"],
  ["^Airwallex declined (\\S+) (\\S+) at (.+?): (.+)$", "Airwallex weigerde $1 $2 bij $3: ⟦$4⟧"],
  ["^Read the decline and asked the CFO for a higher limit \\((\\S+)\\)( \\(code's fallback, no model\\))?$", "Las de weigering en vroeg de CFO om een hogere limiet ($1)$2"],
  ["^Read the decline and asked for nothing: a higher limit would not help( \\(code's fallback, no model\\))?$", "Las de weigering en vroeg niets: een hogere limiet zou niet helpen$1"],
  ["^Matched a payment in: (.+)$", "Binnengekomen betaling gekoppeld: ⟦$1⟧"],
  ["^Proposed (.+) (\\S+) for the CFO$", "Voorstel voor de CFO: ⟦$1⟧ $2"],
  ["^Approved (\\S+) by signing its exact terms with a passkey$", "$1 goedgekeurd door de exacte voorwaarden met een passkey te tekenen"],
  ["^A proposal carried out: (.+)$", "Een voorstel uitgevoerd: ⟦$1⟧"], ["^A proposal carried out$", "Een voorstel uitgevoerd"],
  ["^(\\S+) carried out: paid$", "$1 uitgevoerd: betaald"], ["^(\\S+) carried out: failed$", "$1 uitgevoerd: mislukt"], ["^(\\S+) carried out: converted$", "$1 uitgevoerd: omgewisseld"],
  ["^(\\S+) carried out: (.+)$", "$1 uitgevoerd: ⟦$2⟧"], ["^(\\S+) carried out$", "$1 uitgevoerd"],
  ["^A proposal expired without a decision; nothing moved$", "Een voorstel verliep zonder besluit; er is niets bewogen"],
  ["^(\\S+) expired without a decision; nothing moved$", "$1 verliep zonder besluit; er is niets bewogen"],
  ["^Invoice (.+) received and read by Claude$", "Factuur $1 ontvangen en gelezen door Claude"],
  ["^Invoice (.+) received and read by Purser's code$", "Factuur $1 ontvangen en gelezen door de code van Purser"],
  ["^(\\S+) filed for the CFO's Face ID$", "$1 klaargezet voor de Face ID van de CFO"],
  ["^(\\S+) waits: its supplier is new$", "$1 wacht: de leverancier is nieuw"],
  ["^A second copy of an invoice \\((.+)\\) was stopped as a duplicate$", "Een tweede exemplaar van een factuur ($1) is als dubbel tegengehouden"],
  ["^Asked to add a new supplier, (.+) \\((.+)\\)$", "Vroeg om een nieuwe leverancier toe te voegen: $1 ($2)"],
  ["^Verified (.+)'s account out of band: (.+)$", "Rekening van $1 buiten Purser om gecontroleerd: $2"],
  ["^Added (.+) as a payee after the CFO's approval$", "$1 toegevoegd als begunstigde na goedkeuring van de CFO"],
  ["^([A-Z]+-\\d+) paid$", "$1 betaald"],
  // A payment in, matched (src/agents/receivables.ts).
  ["^(\\S+) from (.+) paid in full, (.+)$", "$1 van $2 volledig betaald, $3"],
  ["^(\\S+) from (.+): paid (.+), short by (.+); the rest stays open and the customer is asked$", "$1 van $2: $3 betaald, $4 te weinig; de rest blijft open en de klant krijgt de vraag"],
  ["^(\\S+) from (.+): paid (.+), over by (.+); the excess waits in suspense and a refund is the CFO's decision$", "$1 van $2: $3 betaald, $4 te veel; het teveel wacht op de tussenrekening en terugbetalen beslist de CFO"],
  // Each detail src/agents/receivables.ts audits (receivable.matched, receivable.escalated, money.in): without the
  // customer's name, as the runner now writes it (no name reaches Purser Cloud).
  ["^(\\S+) paid in full, (.+)$", "$1 volledig betaald, $2"],
  ["^(\\S+): paid (.+), short by (.+); the rest stays open and the customer is asked$", "$1: $2 betaald, $3 te weinig; de rest blijft open en de klant krijgt de vraag"],
  ["^(\\S+): paid (.+), over by (.+); the excess waits in suspense and a refund is the CFO's decision$", "$1: $2 betaald, $3 te veel; het teveel wacht op de tussenrekening en terugbetalen beslist de CFO"],
  ["^(\\S+ \\S+) names no open invoice: held in suspense until the CFO identifies it$", "$1 noemt geen openstaande factuur: wacht op de tussenrekening tot de CFO de betaling herkent"],
  ["^(\\S+ \\S+) for (\\S+), invoiced in (\\S+): held in suspense; the CFO decides whether to accept or return it$", "$1 voor $2, gefactureerd in $3: wacht op de tussenrekening; de CFO beslist of het wordt aangenomen of teruggestuurd"],
  // The demo company's name, and a supplier the negotiation simulates.
  ["^(.+) \\(demo company\\)$", "$1 (demobedrijf)"],
  ["^(.+) \\(simulated supplier\\)$", "$1 (nagebootste leverancier)"],
  ["^(.+) \\(test payee\\)$", "$1 (testbegunstigde)"],
  // The agents' learning (src/learning/precedent.ts).
  ["^same supplier$", "dezelfde leverancier"],
  ["^same kind \\((.+)\\)$", "hetzelfde soort (⟦$1⟧)"],
  ["^same amount band \\((\\S+) (\\S+) to (\\S+)\\)$", "dezelfde bedragklasse ($1 $2 tot $3)"],
  ["^same amount band \\((\\S+) (\\S+) and more\\)$", "dezelfde bedragklasse ($1 $2 en meer)"],
  ["^a nearby amount band$", "een naburige bedragklasse"],
  ["^(.+)'s card: most per purchase$", "Kaart van ⟦$1⟧: hoogstens per aankoop"],
  ["^The CFO signed all (\\d+) of (.+?)'s (.+)s for (.+?)( up to \\S+ \\S+)?, and rejected none\\. No setting lets an agent do this alone, so nothing is proposed: each one still waits for the CFO's Face ID\\.$",
    "De CFO tekende alle $1 ⟦$3⟧en van de ⟦$2⟧ voor $4⟦$5⟧, en wees er geen af. Geen instelling laat een agent dit zelf doen, dus er wordt niets voorgesteld: elke betaling wacht nog op de Face ID van de CFO."],
  ["^The CFO signed all (\\d+) of (.+?)'s (.+)s for (.+?)( up to \\S+ \\S+)?, and rejected none\\. Raise \"(.+)\" from EUR (\\S+) to EUR (\\S+)\\? It changes only when the CFO signs it with Face ID\\.$",
    "De CFO tekende alle $1 ⟦$3⟧en van de ⟦$2⟧ voor $4⟦$5⟧, en wees er geen af. \"⟦$6⟧\" verhogen van EUR $7 naar EUR $8? Het verandert pas als de CFO het tekent met Face ID."],
  ["^ up to (\\S+) (\\S+)$", " tot $1 $2"],
  // The authority map's rows with a figure (src/policy/authorityMap.ts).
  ["^(\\S+) (\\S+) a month$", "$1 $2 per maand"],
  ["^(\\S+) (\\S+) a purchase$", "$1 $2 per aankoop"],
  ["^(\\S+) (\\S+) monthly$", "$1 $2 per maand"],
  ["^a purchase above EUR (\\S+) or past EUR (\\S+) in the month; a higher card limit$", "een aankoop boven EUR $1 of voorbij EUR $2 in de maand; een hogere kaartlimiet"],
  ["^(\\S+) test USD$", "$1 test-USD"],
  ["^(\\S+) test USD per dispute; (.+)$", "$1 test-USD per geschil; ⟦$2⟧"],
  ["^(\\S+) test USD on chain \\((\\S+) spent, (\\S+) left\\)$", "$1 test-USD op de chain ($2 uitgegeven, $3 over)"],
  ["^(\\S+) test USD \\(the on-chain mandate's cap\\)$", "$1 test-USD (de grens van het mandaat op de chain)"],
  ["^a refund above (\\S+) each or (\\S+) per dispute$", "een terugbetaling boven $1 per stuk of $2 per geschil"],
  ["^EUR (\\S+) per card, 3 a day$", "EUR $1 per kaart, 3 per dag"],
  ["^a task card above EUR (\\S+), or asked from the phone or by an agent$", "een taakkaart boven EUR $1, of aangevraagd vanaf de telefoon of door een agent"],
  ["^anything above the limit; (.+)$", "alles boven de limiet; ⟦$1⟧"],
  ["^more than (\\S+)x the payee's median of its last (\\d+) paid invoices; (.+)$", "meer dan $1x de mediaan van de laatste $2 betaalde facturen van de begunstigde; ⟦$3⟧"],
  ["^more than (\\S+)x the payee's median of its last (\\d+) paid invoices$", "meer dan $1x de mediaan van de laatste $2 betaalde facturen van de begunstigde"],
  ["^any time until (.+)$", "altijd, tot $1"],
  ["^(.+) \\(MCC (\\d+)\\)$", "⟦$1⟧ (MCC $2)"],
  ["^(.+) \\(outside agent\\)$", "$1 (agent van buiten)"],
  // The partner rails: a token's refusal ("CODE: what") and the recorded run's label.
  ["^([A-Z_]+): (.+)$", "$1: ⟦$2⟧"],
  ["^Recorded live sandbox run of (\\S+) \\(Purser's own test world, test money\\): not this company's figures$", "Vastgelegde live sandboxrun van $1 (de eigen testwereld van Purser, testgeld): niet de cijfers van dit bedrijf"],
  ["^declined (.+)$", "geweigerd $1"],
  // A label of parts ("prototype · Alta testnet · test money"): each part on its own.
  ["^(.+?) · (.+)$", "⟦$1⟧ · ⟦$2⟧"],
  // Tokenisation's facts.
  ["^(\\S+) (\\S+) \\(the invoice's amount scaled down by (\\d+)\\)$", "$1 $2 (het factuurbedrag gedeeld door $3)"],
  ["^(\\S+)% \\(price (\\S+)\\)$", "$1% (prijs $2)"],
  // A card's nickname ("sourcing agent: warehouse and data software"), an agent's own words in a sentence.
  ...IN_SENTENCE.flatMap(([en, nl]) => [
    [`^the ${en} agent's token(.*)$`, `het token van de ${nl}$1`] as const,
    [`^${en} agent: (.+)$`, `${nl}: ⟦$1⟧`] as const,
  ]),
];

/** The read-only GETs whose English the Dutch page translates as it reads them. */
export const NL_DATA_PATHS = /^\/v1\/(dashboard|agents|authority-map|connections(\/mine)?|tokenisation|partner-rails|negotiation\/recorded|airwallex-live\/[a-z_-]+|cards)(\?|$)/;

/**
 * Which strings of each of those answers are Purser's own sentences, by path in the answer ([] for each item of a list).
 * Only these are translated: a name, a merchant, a vendor, a payee, an id or anyone's free text stays as it was synced,
 * even when it reads like a word of the catalogue ("Other", "Metal"). A path with "@name" holds a name with one of
 * Purser's labels after it ("Stockline (test payee)"): only that label is translated, never the name.
 * Tokenisation's answer is Purser's own record (no company's data), its test shop's name included.
 */
export const NL_DATA_FIELDS: Readonly<Record<string, readonly string[]>> = {
  dashboard: ["spend[].label", "feed[].who", "feed[].text"],
  agents: ["controls", ...["name", "role", "job", "may[]", "may_not[]", "card.pays_for", "rails[]", "decisions[].text", "decisions[].decided_by", "decisions[].precedent.cases[].kind",
    "decisions[].precedent.cases[].outcome_words", "decisions[].precedent.cases[].why[]", "learning.calibration[].kind", "learning.suggestions[].text"].map((f) => `agents[].${f}`)],
  "authority-map": ["name", ...["what", "rail", "per_payment", "in_all", "from", "to", "when", "under", "needs_cfo"].map((f) => `rows[].${f}`)].map((f) => `authority_map.agents[].${f}`),
  connections: ["rule", "money_rule", ...["connections", "money", "planned"].flatMap((g) => ["name", "what", "needs"].map((f) => `${g}[].${f}`))],
  "connections/mine": ["rule", "items[].name", "items[].detail"],
  tokenisation: ["token_life.vic.label", "token_life.vic.purchase.merchant", "token_life.vic.misuse[].merchant", "token_life.agent_tokens.label", "invoice_token.label", "invoice_token.face_value",
    "invoice_token.discount", "invoice_token.stages[].label", "invoice_token.stages[].txs[].what", "invoice_token.steps[].label", "invoice_token.steps[].txs[].what", "agent_cards.label",
    "agent_cards.cards[].holder", "agent_cards.cards[].limits[]", "visa_credential.label"],
  "partner-rails": ["label", "t0.bookings[].what", "t0.bookings[].counterparty@name", "tokens[].events[].outcome", "refusals[].what"],
  "negotiation/recorded": ["label", "supplier@name", "turns[].refused"],
  cards: ["label", "why", "agents[].name", "agents[].reason"],
  "airwallex-live": ["reason"],
};

/**
 * The page's half: nx(text) for one string, nxAll(value, fields) for an answer's sentence fields (nlFields(path) names
 * them), nxOwn(value) for Purser's own constants (every string). Put after I18N_JS; L.x and L.p are the Dutch
 * catalogue's (an English page has neither, and translates nothing).
 * A ⟦ or ⟧ in the text itself is set aside before any pattern runs and put back after, so synced text can never open a
 * translation of its own: only the markers Purser's patterns write are followed. A name's labels (NLN) are the patterns
 * that put a label after the name as it is ("$1 (testbegunstigde)"), never through the catalogue.
 */
export const NL_JS = String.raw`
const NLX=L.x||{},NLP=(L.p||[]).map(([re,to])=>[new RegExp(re),to]),NLN=NLP.filter(([r,to])=>/^\^\(\.\+\) \\\(/.test(r.source)&&/^\$1 \([^$⟦]*\)$/.test(to));
const NL_DATA_FIELDS=` + JSON.stringify(NL_DATA_FIELDS) + String.raw`;
function nxIn(s,depth){if(Object.prototype.hasOwnProperty.call(NLX,s))return NLX[s];
  for(const [r,to] of NLP)if(r.test(s)){const out=s.replace(r,to);return depth>6?out.replace(/[⟦⟧]/g,''):out.replace(/⟦([^⟦⟧]*)⟧/g,(m,x)=>nxIn(x,depth+1))}return s}
function nx(s){if(!NL||typeof s!=='string'||!s)return s;return nxIn(s.replace(/⟦/g,'').replace(/⟧/g,''),0).replace(//g,'⟦').replace(//g,'⟧')}
function nxName(s){if(!NL||typeof s!=='string'||!s)return s;for(const [r,to] of NLN)if(r.test(s))return s.replace(r,to);return s}
function nxAt(v,p,i,f){if(i===p.length)return typeof v==='string'?f(v):v;if(p[i]==='[]')return Array.isArray(v)?v.map((x)=>nxAt(x,p,i+1,f)):v;
  if(!v||typeof v!=='object'||Array.isArray(v)||!Object.prototype.hasOwnProperty.call(v,p[i]))return v;const o=Object.assign({},v);o[p[i]]=nxAt(v[p[i]],p,i+1,f);return o}
function nxAll(v,fields){if(!NL||!fields)return v;for(const k of fields){const name=k.endsWith('@name');v=nxAt(v,k.replace(/@name$/,'').replace(/\[\]/g,'.[]').split('.').filter(Boolean),0,name?nxName:nx)}return v}
function nlFields(path){const k=String(path).replace(/^\/v1\//,'').replace(/\?.*$/,'').replace(/^airwallex-live\/.*$/,'airwallex-live');return Object.prototype.hasOwnProperty.call(NL_DATA_FIELDS,k)?NL_DATA_FIELDS[k]:null}
function nxOwn(v){if(!NL)return v;if(typeof v==='string')return nx(v);if(Array.isArray(v))return v.map(nxOwn);if(v&&typeof v==='object'){const o={};for(const k of Object.keys(v))o[k]=nxOwn(v[k]);return o}return v}
`;
