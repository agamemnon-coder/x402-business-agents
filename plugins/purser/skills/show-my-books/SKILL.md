---
name: show-my-books
description: Show the company's books from Purser - cash, profit and loss, balance sheet, VAT, what is open and due. Use when the user asks how the company is doing, about cash, spend, VAT, payables or receivables.
---

# Showing the books from Purser

Every figure comes from the company's own records in Purser. Quote figures as Purser gives them, with their currency.
Never estimate, round into a different figure, or fill a gap with a guess. If Purser does not have it, say so.

## Which tool

| The user asks about | Call |
|---|---|
| How things stand, cash, spend by agent, approvals | `company_overview` |
| Profit and loss | `books_report` with `report: "pnl"` |
| Balance sheet | `books_report` with `report: "balance"` |
| VAT for a quarter | `books_report` with `report: "vat"` and `quarter`, like `2026Q4` |
| What we owe, what is owed to us | `books_report` with `payables` or `receivables` |
| What is due, overdue or waiting | `what_needs_attention` |
| A payment or a movement | `list_transactions` (filter by `rail`, `currency`, `from`, `to`) |

## How to answer

- Lead with the answer in one or two sentences, then the figures that support it.
- Say which period the figures cover and in which currency. `company_overview` gives `since` and `as_of`.
- If the server's instructions say this is the **demo company**, say the figures are made-up demo data from a simulated
  month, with no real money.
