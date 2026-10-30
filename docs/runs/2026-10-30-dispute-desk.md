# Dispute desk, live on Metal testnet (2026-10-30, after the Friday runs)

On a full backup of the `friday-1` ledger (Friday run 1 itself unchanged), with the build/next code and Metal
testnet. The customer, Summit Outfitters, writes: "Our agent never placed orders 5 to 16. Please refund all of them."

```bash
npm run dispute -- never_ordered 5-16 "Our agent never placed orders 5 to 16. Please refund all of them."
```

- **Evidence, per payment (12):**
  - The order Summit's agent signed. It is Metal's signed offer, which carries the x402 checkout: 0.05 to Northwind for `GET /v1/stock`.
  - `verifyMandatePayment` against the chain. Step 4 checks the payment is the agent's per-payment mandate, inside the mandate bound on Summit's account `0xB6C2…eB25` (bound in [`0x6a4622a9…`](https://testnet.metalntwx.com/tx/0x6a4622a9ed5a1880b9e56f89adb59f003c9793a78c080db7ec2ae2f4f2ba59a6)).
  - The payment tx.
  - The delivered data's SHA-256, recomputed from the stored body.
- **Result:**
  - 12 of 12 orders were signed and verified inside the mandate, and every delivery hash matched.
  - Decision by code: **not refunded** (0.00).
  - Sales 7, 10 and 13 were already refunded in S2 for wrong data; the report says so.
- **Explanation:** written by Claude Opus 5.5 from the evidence, marked as advice.
- **Report for the customer:** [`docs/disputes/DD-a88e8959.html`](../disputes/DD-a88e8959.html). It is one page with no script, and every payment links to the explorer.
- The recorded dashboard (`/?recorded&disputes`) shows the case.

The other five rules are covered in the Scenario Lab (stand-ins for the chain check and the refund) and in
`test/dispute-desk.test.ts`:

- wrong price;
- not authorised, with the customer owner's passkey confirmation;
- wrong data;
- forged or reused order;
- double charge.

A refund above the CFO's automatic limits becomes a `refund_batch` proposal for Face ID (`test/dispute-case.test.ts`).
