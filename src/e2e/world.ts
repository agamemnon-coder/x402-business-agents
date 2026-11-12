// The platform end-to-end's test world (Max, 10 November): three fictional small companies, each its own Purser
// company (its own ledger) on its own Airwallex connected account, each with one or two supplier invoices that come in
// the way a real one does (a PDF upload or an e-mail with the PDF attached). Every name, IBAN and amount is invented;
// the IBANs only pass their checksum. Amounts are small: the run moves sandbox test money only.

export interface WorldInvoice {
  /** The invoice's text layer, as the PDF is rendered from it. */
  text: string;
  filename: string;
  /** How it reaches the inbox: an upload, or an e-mail with the PDF attached. */
  via: "upload" | "email";
}

export interface WorldCompany {
  /** Short key: part of every PUR id and every T:0 memo, so one shared T:0 entity keeps the companies apart. */
  key: string;
  name: string;
  /** The company's Purser tenant id (what its account binding names). */
  tenant: string;
  /** The ACTIVE connected account it already has, or null: opened in the run. */
  accountId: string | null;
  /**
   * A clearly fake TEST registration number, sent as the payer's on every payout (transfers/create payer.additional_info):
   * Airwallex refused payouts from accounts opened as non-registered sole traders without one (10 November).
   */
  testRegistrationNumber?: string;
  invoices: WorldInvoice[];
}

const nlInvoice = (o: { vendor: string; vat: string; no: string; date: string; due: string; net: string; vatAmt: string; total: string; iban: string; bic: string }) => `${o.vendor}
BTW-nummer: ${o.vat}
Factuur
Factuurnummer: ${o.no}
Factuurdatum: ${o.date}
Vervaldatum: ${o.due}
Subtotaal € ${o.net}
BTW 21% € ${o.vatAmt}
Totaal te betalen € ${o.total}
IBAN: ${o.iban}
BIC: ${o.bic}
Betalingskenmerk: ${o.no}`;

/** The three companies. The first already has the ACTIVE sandbox account opened on 10 November. */
export const WORLD: WorldCompany[] = [
  {
    key: "SANDBOXTEST", name: "Purser Sandbox Test (fake sole trader)", tenant: "t_e2e_sandboxtest", accountId: "acct_SC-QD89fOneAeqaRFgOymw",
    invoices: [
      { via: "upload", filename: "ZV-5001.pdf", text: nlInvoice({ vendor: "Zeeland Verpakkingen B.V. (test)", vat: "NL123456789B01", no: "ZV-5001", date: "05-11-2026", due: "19-11-2026", net: "4,00", vatAmt: "0,84", total: "4,84", iban: "NL91 ABNA 0417 1643 00", bic: "ABNANL2A" }) },
    ],
  },
  {
    key: "BAKKERIJ", name: "Bakkerij De Test (fake)", tenant: "t_e2e_bakkerij", accountId: null, testRegistrationNumber: "TEST-00000001",
    invoices: [
      { via: "email", filename: "MM-2026-114.pdf", text: nlInvoice({ vendor: "Meelhandel Molenaar B.V. (test)", vat: "NL987654321B01", no: "MM-2026-114", date: "04-11-2026", due: "18-11-2026", net: "3,00", vatAmt: "0,63", total: "3,63", iban: "NL02 ABNA 0123 4567 89", bic: "ABNANL2A" }) },
      { via: "upload", filename: "VE-889.pdf", text: nlInvoice({ vendor: "Verpakking Express B.V. (test)", vat: "NL112233445B01", no: "VE-889", date: "06-11-2026", due: "20-11-2026", net: "2,00", vatAmt: "0,42", total: "2,42", iban: "NL20 INGB 0001 2345 67", bic: "INGBNL2A" }) },
    ],
  },
  {
    key: "FIETSLAB", name: "Fietslab Test (fake)", tenant: "t_e2e_fietslab", accountId: null, testRegistrationNumber: "TEST-00000002",
    invoices: [
      { via: "email", filename: "OD-77.pdf", text: nlInvoice({ vendor: "Onderdelen Direct B.V. (test)", vat: "NL556677889B01", no: "OD-77", date: "07-11-2026", due: "21-11-2026", net: "5,00", vatAmt: "1,05", total: "6,05", iban: "NL44 RABO 0123 4567 89", bic: "RABONL2U" }) },
    ],
  },
];
