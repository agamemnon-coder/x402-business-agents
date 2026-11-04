// The ISO 20022 export (enterprise item 4): a paid invoice as pacs.008.001.08, valid against the official schema
// (test/fixtures/iso20022/, checked with xmllint), linking the Airwallex SWIFT transfer and the Metal transaction booked
// before it. The ledger here holds the recorded run's own ids (docs/iso20022/pacs008-BTX-2026-11.xml is that run's export).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { pacs008ForInvoice } from "../src/finance/iso20022.js";

const XSD = new URL("./fixtures/iso20022/pacs.008.001.08.xsd", import.meta.url).pathname;
const TX = "0x808f913345b176d20a1a319c1fd29965c283980c7616a9c838ccc522341fa94f";

function ledger() {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES ('ben-1', 'Bergtex Textil GmbH', '3000', 'h', 'COBADEFFXXX', 'EUR', 'SWIFT')").run();
  db.prepare("INSERT INTO invoices (invoice_no, vendor, amount, currency, due_date, iban_sha256, bic, beneficiary_id, doc_sha256, status) VALUES ('BTX-2026-11', 'Bergtex Textil GmbH', '1850.00', 'EUR', '2026-11-16', 'h', 'COBADEFFXXX', 'ben-1', 'd', 'RECEIVED')").run();
  db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES ('P-0004', 'invoice_payment', '{}', 'b6a6c04e4d8b45066c114ba3decaf17a80ee95a20e0a1eccb71f389c45560059', 'treasury', 'EXECUTED', '2026-10-30T08:00:00Z', '2026-10-30T07:30:00Z')").run();
  db.prepare("INSERT INTO transfers (transfer_id, request_id, invoice_no, amount, currency, method, fee_estimate, fee_actual, status, approval_sha256, updated_at) VALUES ('4d508b0b-ef38-41d3-b96e-f6cc3f5cfeb4', 'a98847d1-22df-4cb5-9012-9b9324fd9b4b', 'BTX-2026-11', '1850.00', 'EUR', 'SWIFT', '20.00', 'EUR 13.41', 'PAID', 'b6a6c04e4d8b45066c114ba3decaf17a80ee95a20e0a1eccb71f389c45560059', '2026-10-30T07:32:05.824Z')").run();
  db.prepare("INSERT INTO fx_quotes (quote_id, pair, buy_amount, client_rate, valid_from, valid_to) VALUES ('q', 'USDEUR', '370.00', '0.884', 'x', 'y')").run();
  db.prepare("INSERT INTO fx_conversions (conversion_id, quote_id, request_id, buy_amount, sell_amount, status, approval_sha256) VALUES ('08736b6e-0f62-41f8-9e4c-6f5a8cbff3c7', 'q', 'r', '370.00', '418.40', 'SETTLED', 'b6a6c04e4d8b45066c114ba3decaf17a80ee95a20e0a1eccb71f389c45560059')").run();
  db.prepare("INSERT INTO chain_credits (event_key, tx_hash, from_address, to_address, amount_base_units, block, finalized_block, awx_deposit_id, awx_reference, created_at) VALUES ('63825:k', ?, '0x828c7DE12cab8149AA516958433F6EEe23aEC875', '0x1fB9a22f89D6Df92abF20efDe0E7d4cC5f0455A5', '1350000000000000000', 9401051, 9401068, '56366c9d-e537-428f-8681-9c1a8c43c838', ?, '2026-10-30T07:22:20.106Z')").run(TX, TX);
  db.prepare("INSERT INTO sweeps (payment_id, amount_cents, tx_hash, outcome, event_key, created_at) VALUES ('sweep-20261030-1', 135, ?, 'PAID', '63825:k', '2026-10-30T07:22:13.665Z')").run(TX);
  return db;
}
const xmllint = (xml: string) => {
  const dir = mkdtempSync(join(tmpdir(), "pacs008-"));
  writeFileSync(join(dir, "m.xml"), xml);
  return spawnSync("xmllint", ["--noout", "--schema", XSD, join(dir, "m.xml")], { encoding: "utf8" });
};

describe("the pacs.008 export of a paid invoice", () => {
  const p = pacs008ForInvoice(ledger(), "BTX-2026-11", new Date("2026-10-30T08:00:00Z"));

  it("is valid against the official pacs.008.001.08 schema", () => {
    const r = xmllint(p.xml);
    expect(r.error, "xmllint is needed: apt-get install libxml2-utils").toBeUndefined();
    expect(`${r.stdout}${r.stderr}`).toMatch(/validates/);
    expect(r.status).toBe(0);
  });

  it("carries the SWIFT transfer: amount, invoice as end-to-end id, Airwallex's transfer id as UETR, fee, creditor's BIC", () => {
    expect(p.xml).toContain('<IntrBkSttlmAmt Ccy="EUR">1850.00</IntrBkSttlmAmt>');
    expect(p.xml).toContain("<EndToEndId>BTX-2026-11</EndToEndId><UETR>4d508b0b-ef38-41d3-b96e-f6cc3f5cfeb4</UETR>");
    expect(p.xml).toContain('<ChrgsInf><Amt Ccy="EUR">13.41</Amt>');
    expect(p.xml).toContain("<BICFI>COBADEFFXXX</BICFI>");
    expect(p.xml).toContain("<Nb>BTX-2026-11</Nb>");
  });

  it("carries the Metal leg in test currency XTS, and links both legs under one Purser reference", () => {
    expect(p.xml).toContain('<IntrBkSttlmAmt Ccy="XTS">1.35</IntrBkSttlmAmt>');
    expect(p.reference).toBe("PURSER-P-0004-BTX-2026-11");
    expect(p.xml.match(/<prs:Reference>PURSER-P-0004-BTX-2026-11<\/prs:Reference>/g)).toHaveLength(2);
    for (const id of [TX, "56366c9d-e537-428f-8681-9c1a8c43c838", "08736b6e-0f62-41f8-9e4c-6f5a8cbff3c7", "4d508b0b-ef38-41d3-b96e-f6cc3f5cfeb4", "b6a6c04e"]) expect(p.xml).toContain(id);
  });

  it("never prints a full IBAN: Purser does not hold one", () => {
    expect(p.xml).toContain("<Id>****3000</Id><SchmeNm><Prtry>MASKED-IBAN</Prtry>");
    expect(p.xml).not.toMatch(/<IBAN>/);
  });

  it("is the same as the committed example from the recorded run", () => {
    const committed = readFileSync(new URL("../docs/iso20022/pacs008-BTX-2026-11.xml", import.meta.url), "utf8");
    // Only the creation time and message id differ (the example was made when it was exported).
    const strip = (x: string) => x.replace(/<MsgId>[^<]*<\/MsgId><CreDtTm>[^<]*<\/CreDtTm>/, "");
    expect(strip(p.xml)).toBe(strip(committed));
  });

  it("refuses an invoice that was not paid", () => {
    expect(() => pacs008ForInvoice(ledger(), "BTX-2027-03")).toThrow(/no paid transfer/);
  });
});
