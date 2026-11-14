// What the live Airwallex tab checks its live reads against (cloud/src/awxLive.ts): the fields it needs from two records,
// copied here so the Worker's bundle carries a few hundred bytes, not the records (test/awx-live.test.ts holds this file
// equal to them):
//   docs/demo/airwallex-run.json                       the awx-1 run's invoices: Purser's ledger and each approval hash
//   docs/runs/2026-11-12-airwallex-payee-check.json    the payee checks (Airwallex account verification), recorded

export const AWX_RUN_RECORDED = {
  "run": "awx-1",
  "invoices": [
    {
      "invoice_no": "SLL-2026-11",
      "amount": "240.00",
      "transfer_id": "738a4263-6d6c-4de8-94a3-93da1c175fb4",
      "status": "PAID",
      "fee": "EUR 13.50",
      "conversion_id": null,
      "approval_sha256": "b0f075d94da077084d7fc6745f99e2c2253548d967e9c0413bffa9748dbbf7bb",
      "quote": null
    },
    {
      "invoice_no": "BTX-2026-11",
      "amount": "1850.00",
      "transfer_id": "4140dee2-6373-4eb4-a71f-bf69130f96a7",
      "status": "PAID",
      "fee": "EUR 13.50",
      "conversion_id": "fafcc208-bd1e-43d9-bd09-69191a8aa81f",
      "approval_sha256": "68f85b999c30fbf0ed2a79d574cafc447dfb92db77e707a2a208feb62823e38a",
      "quote": {
        "buy_eur": "623.50",
        "sell_usd": "704.45"
      }
    }
  ]
} as const;

export const PAYEE_CHECKS_RECORDED = [
  {
    "name": "Stockline Data GmbH",
    "match": "NOT_MATCHED",
    "label": "the payee's bank holds this account, not as \"Stockline Data GmbH\" (NOT_MATCHED); confirm with the supplier on a known contact before it is proposed",
    "at": "2026-11-12T13:49:44.781Z"
  },
  {
    "name": "Northbridge Trading Ltd",
    "match": "NOT_MATCHED",
    "label": "the payee's bank holds this account, not as \"Northbridge Trading Ltd\" (NOT_MATCHED); confirm with the supplier on a known contact before it is proposed",
    "at": "2026-11-12T13:49:50.502Z"
  },
  {
    "name": "Betty Morras",
    "match": "PARTIAL_MATCH",
    "label": "the payee's bank holds this account as \"Betty Morris\", not as \"Betty Morras\" (PARTIAL_MATCH); confirm with the supplier on a known contact before it is proposed",
    "at": "2026-11-12T13:50:54.507Z"
  },
  {
    "name": "Betty Morris",
    "match": "FULL_MATCH",
    "label": "the payee's bank confirmed the account and the name",
    "at": "2026-11-12T13:51:43.723Z"
  }
] as const;
