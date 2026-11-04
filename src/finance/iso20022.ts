// An ISO 20022 pacs.008 (FI-to-FI customer credit transfer, version 08) export of one paid invoice (enterprise item 4),
// so a bank's or an ERP's tooling can read what Purser did: the Airwallex SWIFT transfer that paid the invoice, and the
// Metal transaction whose earnings were booked into the Airwallex account before it, linked by one Purser reference.
//
// It validates against the official pacs.008.001.08 schema (test/fixtures/iso20022/; test/iso20022.test.ts). It is
// pacs.008-SHAPED, not a message a bank sent or received:
// - UETR carries Airwallex's transfer id (a UUID v4). The UETR SWIFT assigned is not exposed by the sandbox.
// - The creditor's IBAN is not stored by Purser (only its last four digits and a hash), so the account is given masked.
// - The Metal leg is test USD on testnet: currency XTS, ISO 4217's code reserved for testing. Its accounts are chain
//   addresses (proxies), its agents named, not BICs.
// - The link (the Metal transaction, its finality block, the Airwallex deposit that booked it, the conversion, the
//   approval's terms hash) is in SplmtryData, which the schema leaves open for such data.

import type { DB } from "../db/open.js";
import { finalityOf } from "../metal/finality.js";
import { CHAIN_ID } from "../metal/network.js";
import { COMPANY } from "../config/brand.js";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** ISO Max35Text and friends: cut, never invalid. */
const max = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const el = (name: string, body: string, attrs = "") => `<${name}${attrs}>${body}</${name}>`;
const txt = (name: string, value: string, attrs = "") => el(name, esc(value), attrs);
const amount = (name: string, ccy: string, value: string) => txt(name, value, ` Ccy="${ccy}"`);
const UUID4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export interface Pacs008 { xml: string; reference: string; legs: { metal: string | null; airwallex: string } }

/** USDZ base units (18 decimals) to a decimal string with at most 5 fraction digits (ISO's limit). */
function usdz(baseUnits: string): string {
  const v = BigInt(baseUnits);
  const whole = v / 10n ** 18n;
  const frac = (v % 10n ** 18n).toString().padStart(18, "0").slice(0, 5).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}.00`;
}

export function pacs008ForInvoice(db: DB, invoiceNo: string, now = new Date()): Pacs008 {
  const t = db.prepare("SELECT transfer_id, request_id, invoice_no, amount, currency, method, fee_actual, status, approval_sha256, updated_at FROM transfers WHERE invoice_no = ? AND status = 'PAID' ORDER BY updated_at DESC LIMIT 1").get(invoiceNo) as
    { transfer_id: string; request_id: string; invoice_no: string; amount: string; currency: string; method: string; fee_actual: string | null; status: string; approval_sha256: string; updated_at: string } | undefined;
  if (!t) throw new Error(`no paid transfer for invoice ${invoiceNo}`);
  const inv = db.prepare("SELECT vendor, due_date, bic, beneficiary_id FROM invoices WHERE invoice_no = ?").get(invoiceNo) as { vendor: string; due_date: string; bic: string; beneficiary_id: string | null };
  const ben = inv.beneficiary_id ? (db.prepare("SELECT name, iban_last4, bic FROM beneficiaries WHERE beneficiary_id = ?").get(inv.beneficiary_id) as { name: string; iban_last4: string; bic: string } | undefined) : undefined;
  const proposal = db.prepare("SELECT proposal_id FROM proposals WHERE terms_sha256 = ?").get(t.approval_sha256) as { proposal_id: string } | undefined;
  const conv = db.prepare("SELECT conversion_id, sell_amount, buy_amount FROM fx_conversions WHERE approval_sha256 = ?").get(t.approval_sha256) as { conversion_id: string; sell_amount: string | null; buy_amount: string } | undefined;
  // The Metal earnings booked into Airwallex before the payout: the latest credit up to the transfer.
  const credit = db.prepare("SELECT c.tx_hash, c.from_address, c.to_address, c.amount_base_units, c.block, c.finalized_block, c.awx_deposit_id, c.created_at, s.payment_id FROM chain_credits c LEFT JOIN sweeps s ON s.event_key = c.event_key WHERE c.awx_deposit_id IS NOT NULL AND c.created_at <= ? ORDER BY c.created_at DESC LIMIT 1").get(t.updated_at) as
    { tx_hash: string; from_address: string; to_address: string; amount_base_units: string; block: number; finalized_block: number; awx_deposit_id: string; created_at: string; payment_id: string | null } | undefined;

  const reference = max(`PURSER-${proposal?.proposal_id ?? t.request_id.slice(0, 8)}-${invoiceNo}`, 35);
  const fee = t.fee_actual?.match(/^([A-Z]{3})\s+([0-9.]+)$/);
  const day = (iso: string) => iso.slice(0, 10);
  const link = (who: string) => el("SplmtryData", el("PlcAndNm", `PurserLink/${who}`) + el("Envlp", el("prs:Link",
    txt("prs:Reference", reference)
    + (credit ? txt("prs:MetalTx", credit.tx_hash) + txt("prs:MetalChainId", String(CHAIN_ID)) + txt("prs:MetalBlock", String(credit.block)) + txt("prs:MetalFinalizedBlock", String(credit.finalized_block))
      + (finalityOf(db, credit.tx_hash)?.status === "REPORTED" ? txt("prs:FinalityCertificate", "reported by Metal's RPC; BLS signature not verified") : "")
      + txt("prs:AirwallexDeposit", credit.awx_deposit_id) : "")
    + (conv ? txt("prs:AirwallexConversion", conv.conversion_id) + txt("prs:ConversionSold", conv.sell_amount ?? "") + txt("prs:ConversionBought", conv.buy_amount) : "")
    + txt("prs:AirwallexTransfer", t.transfer_id) + txt("prs:ApprovalTermsSha256", t.approval_sha256) + (proposal ? txt("prs:Proposal", proposal.proposal_id) : ""),
  ' xmlns:prs="urn:purser:link:1"')));
  const agentName = (name: string) => el("FinInstnId", txt("Nm", name));
  // A chain address is longer than an account Id may be (34): the Id names the scheme, the proxy carries the address.
  const proxy = (address: string) => el("Id", el("Othr", txt("Id", "chain address in Prxy") + el("SchmeNm", txt("Prtry", "METAL-ADDRESS")))) + el("Prxy", txt("Id", address));

  const txs: string[] = [];
  if (credit) {
    // Leg 1: the Metal transfer whose earnings were booked into the Airwallex balance before the payout (test USD, XTS).
    // It did not pay the invoice by itself: the link says what came before it, not what funded it.
    txs.push(el("CdtTrfTxInf",
      el("PmtId", txt("InstrId", max(credit.payment_id ?? "metal-credit", 35)) + txt("EndToEndId", max(`${reference}-M`, 35)))
      + amount("IntrBkSttlmAmt", "XTS", usdz(credit.amount_base_units)) + txt("IntrBkSttlmDt", day(credit.created_at)) + txt("ChrgBr", "DEBT")
      + el("Dbtr", txt("Nm", `${COMPANY} (Metal business account)`)) + el("DbtrAcct", proxy(credit.from_address)) + el("DbtrAgt", agentName(`Metal testnet (chain ${CHAIN_ID})`))
      + el("CdtrAgt", agentName(`Metal testnet (chain ${CHAIN_ID})`)) + el("Cdtr", txt("Nm", `${COMPANY} (sweep wallet)`)) + el("CdtrAcct", proxy(credit.to_address))
      + el("RmtInf", txt("Ustrd", max(`Earnings swept to the bank; booked at Airwallex as deposit ${credit.awx_deposit_id}`, 140)))
      + link("metal")));
  }
  // Leg 2: the Airwallex SWIFT transfer that paid the invoice.
  const uetr = UUID4.test(t.transfer_id) ? txt("UETR", t.transfer_id) : "";
  txs.push(el("CdtTrfTxInf",
    el("PmtId", txt("InstrId", max(t.request_id.replace(/-/g, ""), 35)) + txt("EndToEndId", max(invoiceNo, 35)) + uetr)
    + amount("IntrBkSttlmAmt", t.currency, t.amount) + txt("IntrBkSttlmDt", day(t.updated_at)) + txt("ChrgBr", "DEBT")
    + (fee ? el("ChrgsInf", amount("Amt", fee[1]!, fee[2]!) + el("Agt", agentName("Airwallex (sandbox)"))) : "")
    + el("Dbtr", txt("Nm", COMPANY)) + el("DbtrAgt", agentName("Airwallex (sandbox)"))
    + el("CdtrAgt", el("FinInstnId", txt("BICFI", ben?.bic ?? inv.bic))) + el("Cdtr", txt("Nm", ben?.name ?? inv.vendor))
    + el("CdtrAcct", el("Id", el("Othr", txt("Id", `****${ben?.iban_last4 ?? "????"}`) + el("SchmeNm", txt("Prtry", "MASKED-IBAN")))))
    + el("RmtInf", txt("Ustrd", max(`Invoice ${invoiceNo} ${inv.vendor}`, 140)) + el("Strd", el("RfrdDocInf", el("Tp", el("CdOrPrtry", txt("Cd", "CINV"))) + txt("Nb", invoiceNo) + txt("RltdDt", inv.due_date))))
    + link("airwallex")));

  const msgId = max(`PURSER-${now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${invoiceNo}`, 35);
  const header = el("GrpHdr", txt("MsgId", msgId) + txt("CreDtTm", now.toISOString().replace(/\.\d{3}Z$/, "Z")) + txt("NbOfTxs", String(txs.length)) + el("SttlmInf", txt("SttlmMtd", "INDA")));
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08">${el("FIToFICstmrCdtTrf", header + txs.join(""))}</Document>\n`;
  return { xml, reference, legs: { metal: credit?.tx_hash ?? null, airwallex: t.transfer_id } };
}
