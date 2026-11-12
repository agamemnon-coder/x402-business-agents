// "As reported by the Airwallex sandbox" on /visa (12 Nov): what Airwallex's own record says about the Airi run's two
// payments, as one folded row under the two Airi runs. Read from the newest record
// docs/runs/airwallex-vic-payment-intents-<date>.json (npm run vic-readback: one GET per PaymentIntent, redacted where
// needed, otherwise unedited; src/airwallex/intentReadback.ts).
//
// Honesty: each value stands under Airwallex's own field name (the tail of its path in the answer; the whole path is
// the name's tooltip), exactly as returned; a field Airwallex did not return is not shown; nothing here is called a
// cryptogram, a token or a Visa transaction id, and the block says which of those did not come back, counted from the
// record's own field names. The two long ids Airwallex returns stay in the record (linked): no long number is printed
// on the page. The record must be the Airi run's (same PaymentIntents, amounts, currency and outcome), or the page
// does not build. test/vic-network.test.ts holds every value to the record.

import { readFileSync } from "node:fs";
import { REDACTED, VIC_INTENTS_PREFIX, type IntentsRecord } from "../airwallex/intentReadback.js";
import { type AiriRunRecord } from "./airiRun.js";
import { latestRecordFile } from "./airwallexProof.js";
import { REPO_BLOB } from "./metalStory.js";
import { esc } from "./ui.js";

export const VIC_NETWORK_ID = "vic-network";
/** The block's label, as the plan asks for it: who says so. */
export const VIC_NETWORK_LABEL = "As reported by the Airwallex sandbox";

/** The fields /visa shows, by their path in Airwallex's answer, in this order. One Airwallex did not return is left out. */
export const VIC_NETWORK_FIELDS: readonly string[] = [
  "status",
  "latest_payment_attempt.status",
  "latest_payment_attempt.payment_method.card.brand",
  "latest_payment_attempt.payment_method.card.card_type",
  "latest_payment_attempt.payment_method.card.number_type",
  "latest_payment_attempt.payment_method.card.last4",
  "latest_payment_attempt.authorization_code",
  "latest_payment_attempt.provider_original_response_code",
  "latest_payment_attempt.provider_original_response_description",
  "latest_payment_attempt.authentication_data.cvc_result",
  "latest_payment_attempt.authentication_data.ds_data.sca_exemption",
  "latest_payment_attempt.authentication_data.fraud_data.action",
];
/** The two card-number words in plain language (the industry's own terms); any other value is shown without a gloss. */
const GLOSS: Record<string, string> = { PAN: "the card number itself", DPAN: "a token that stands in for the card number" };
/** The name shown: the tail of Airwallex's own path (the attempt's status keeps its whole path, beside the intent's). */
const nameOf = (path: string) => (path === "latest_payment_attempt.status" ? path : path.replace(/^latest_payment_attempt\.(payment_method\.|authentication_data\.)?/, ""));

export interface VicNetwork {
  purchases: { step: string; id: string; amount: string; currency: string }[];
  rows: { path: string; name: string; values: string[] }[];
  summary: string;
  /** What did not come back, and Airi's word for the credential beside Airwallex's. */
  notes: string[];
  readAt: string; calls: number; file: string;
}

/** The newest record, or null when there is none. */
export function vicNetworkRecord(): { file: string; rec: IntentsRecord } | null {
  const file = latestRecordFile(VIC_INTENTS_PREFIX);
  return file ? { file, rec: JSON.parse(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")) as IntentsRecord } : null;
}

const at = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), o);
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
const plain = (v: unknown): string | null => (typeof v === "string" && !v.includes(REDACTED) ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : null);

/** The block's facts from the record; throws when the record is not this Airi run's (the page does not build). */
export function vicNetwork(src: { file: string; rec: IntentsRecord }, run: AiriRunRecord): VicNetwork {
  const { rec, file } = src;
  const fail = (why: string): never => { throw new Error(`"${VIC_NETWORK_LABEL}" on /visa: ${file} is not the Airi run's record: ${why}`); };
  if (rec.test_money !== true || !/^GET only/.test(rec.method)) fail("it is not a GET-only read with test money");
  const purchases = rec.payment_intents.map((p) => {
    const mine = run.purchases.find((x) => x.step === p.purchase && x.payment_intent_id === p.id) ?? fail(`${p.id} is not purchase ${p.purchase}'s PaymentIntent`);
    if (p.intent.id !== p.id) fail(`the answer under ${p.id} is another PaymentIntent's`);
    if (Number(p.intent.amount) !== Number(mine.amount) || p.intent.currency !== mine.currency) fail(`${p.id}: the amount is not the run's ${mine.currency} ${mine.amount}`);
    if (p.intent.status !== mine.outcome) fail(`${p.id}: the status is not the run's ${mine.outcome ?? "outcome"}`);
    return { step: p.purchase, id: p.id, amount: mine.amount, currency: mine.currency };
  });
  if (purchases.length === 0) fail("it holds no PaymentIntent");
  const rows = VIC_NETWORK_FIELDS.flatMap((path) => {
    const values = rec.payment_intents.map((p) => plain(at(p.intent, path)));
    return values.every((v): v is string => v !== null) ? [{ path, name: nameOf(path), values }] : [];
  });
  // Field names of the answers, to say what did not come back: counted from the record, never assumed.
  const keys = new Set<string>();
  const walk = (v: unknown): void => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); } };
  for (const p of rec.payment_intents) walk(p.intent);
  const none = ([[/cryptogram|cavv/i, "a cryptogram"], [/token/i, "a token"], [/three_?ds|3ds|eci/i, "a 3-D Secure result"]] as const).filter(([re]) => ![...keys].some((k) => re.test(k))).map(([, what]) => what);
  const types = [...new Set(rec.payment_intents.map((p) => plain(at(p.intent, "latest_payment_attempt.payment_method.card.number_type"))))].filter((t): t is string => !!t);
  const airiTypes = [...new Set(run.purchases.flatMap((p) => (p.credential_type && rec.payment_intents.some((x) => x.purchase === p.step) ? [p.credential_type] : [])))];
  const statuses = [...new Set(rec.payment_intents.map((p) => String(p.intent.status)))];
  const said = (ts: string[]) => ts.map((t) => (GLOSS[t] ? `${t} (${GLOSS[t]})` : t)).join(", ");
  return {
    purchases, rows,
    summary: `${VIC_NETWORK_LABEL}: ${rec.payment_intents.length} payments ${statuses.join(", ")}`,
    notes: [
      ...(none.length ? [`Airwallex returned no field for ${none.length > 1 ? `${none.slice(0, -1).join(", ")} or ${none.at(-1)}` : none[0]}.`] : []),
      ...(types.length && airiTypes.length ? [`Airi's receipt named the credential's type ${said(airiTypes)}; Airwallex's record says number_type ${said(types)}.`] : []),
    ],
    readAt: rec.read_at, calls: rec.calls.length, file,
  };
}

/** The folded row: the label and the count in its summary; inside, each field for each payment, the notes and the source. */
export function vicNetworkHtml(n: VicNetwork | null): string {
  if (!n || n.rows.length === 0) return "";
  const head = `<div class="awhead"><span>${esc("Airwallex's field")}</span>${n.purchases.map((p) => `<span>${esc(`Purchase ${p.step} · ${p.currency} ${p.amount}`)}</span>`).join("")}</div>`;
  const row = (r: VicNetwork["rows"][number]) => `<div class="awrow"><span class="k"><code title="${esc(r.path)}">${esc(r.name)}</code></span>${r.values.map((v, i) => `<span><b class="lbl">${esc(`Purchase ${n.purchases[i]!.step}`)}</b>${esc(v)}</span>`).join("")}</div>`;
  return `<details class="fold" id="${VIC_NETWORK_ID}"><summary>${esc(n.summary)}</summary>
<p>${esc("Airwallex's own record of the Airi run's payments. Each value stands under Airwallex's field name, as it came back.")}</p>
<div class="awcard vn">${head}
${n.rows.map(row).join("\n")}</div>
${n.notes.length ? `<p>${esc(n.notes.join(" "))}</p>` : ""}
<p class="src">${esc(`GET /pa/payment_intents/{id}, read ${day(n.readAt)}, sandbox, test money · ${n.calls} calls · `)}<a class="pf" href="${esc(`${REPO_BLOB}${n.file}`)}" target="_blank" rel="noopener">${esc(n.file)} ↗</a></p></details>`;
}

/** The row from the committed record: "" when there is none; throws when the record is not the Airi run's. */
export function vicNetworkBlock(run: AiriRunRecord | null): string {
  const src = vicNetworkRecord();
  return run && src ? vicNetworkHtml(vicNetwork(src, run)) : "";
}

/** The table's own columns from 701 px (the field names are long); below, the shared rows stack with their labels. */
export const VIC_NETWORK_CSS = `@media (min-width: 701px) { .vn .awrow, .vn .awhead { grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr) minmax(0, 1fr); } }
.vn .awrow code { font: 600 14px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; color: var(--text); }`;
