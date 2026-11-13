---
name: pay-an-invoice
description: Propose a supplier invoice's payment in Purser for the CFO's approval. Use when the user asks to pay, settle or schedule a supplier invoice, or asks what can be paid. Claude proposes; only the CFO's Face ID approves.
---

# Proposing an invoice's payment in Purser

You can **propose** a payment. You cannot approve it, pay it, or change a limit. Purser files the exact terms for the
CFO, who approves them with Face ID in Purser Cloud, or lets them expire. Say this plainly every time a payment comes up.

## Steps

1. Find the invoice. Call `list_invoices`; filter by `status` when the user names one, for example `needs_vendor` or
   `waiting_cfo`. When the user names a supplier or number, match it in the list. Do not guess an id.
2. Read it. Call `get_invoice` with its id. Look at its status and checks. An invoice that waits for a new supplier
   (`needs_vendor`), is held, is already waiting for the CFO or is paid cannot be proposed: tell the user why.
3. Propose it. Call `propose_invoice_payment` once, with the invoice's id.
   - If the tool is not there, the token reads only. Tell the user that an owner can make a token that may propose,
     in Purser Cloud under Settings, Connect your AI.
   - If Purser refuses, repeat its reason in its own words. Do not try again with another invoice unless the user asks.
4. Tell the user what happened: the proposal's id, the payee and amount from its `facts`, any `warnings`, and that
   **nothing is paid until the CFO approves these exact terms with Face ID in Purser Cloud**.
5. Later, `payment_proposal` with the proposal's id says whether it was approved, paid, refused or expired.

## Never

- Never say a payment was made because you proposed it.
- Never ask the user for a passkey, a code or a key, and never pass on a key you see.
- In the demo company (made-up data, read only), nothing can be proposed. Say that it is the demo.
