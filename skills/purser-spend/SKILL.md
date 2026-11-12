---
name: purser-spend
description: How to ask for and spend a company card through Purser's agent API (the MCP server purser-agent-api). Use when you are connected to it and need a card, need to pay a merchant, were declined, or need a card for one flight, hotel or train.
---

# Spending through Purser

Purser lets you spend a company's money only within limits a person signs with Face ID. You can ask, pay within
your card's limits, and read. You cannot approve anything, set a limit, or reach another agent's card.
Only a person can approve.

## Order of operations

1. Call `company_card` and read your limits: per purchase, per month, this month's spend, and whether the card is frozen.
2. With no card, call `request_company_card` with the limits you need, and wait. Nothing is issued until the CFO
   approves with Face ID. Tell your user so, and stop.
3. Call `pay_with_card` once, for the whole purchase.
4. On a decline, read `reason` and `next_tool` in the result's object.
5. If `next_tool` is `request_limit_raise`, call it once, with the reason. Then stop, and tell your user that a person
   must approve with Face ID.
6. For one flight, hotel or train, call `ask_for_task_card` instead: say what, the most it may cost in EUR, and the
   day. It becomes a proposal for the CFO; you never get a card at once.

## What a refusal means

A refusal is a tool result with isError: true and a structured object that names the next tool, when there is one.
The first text is a sentence for people. The object is in structuredContent, and again as JSON in the second text.
An approved charge has `approved` true and its `transaction_id`.

- `refused_by` is "airwallex": the card was declined at Airwallex, and nothing was paid. `reason` says why.
  - `LIMIT_EXCEEDED`: over the card's limit per purchase or per month. `next_tool` is `request_limit_raise`.
  - `CARD_INACTIVE`: the CFO froze the card. There is no `next_tool`: a higher limit does not help. Stop and tell
    your user.
  - Any other reason: the card may not pay this. Stop and tell your user.
- `refused_by` is "purser": Purser refused before anything was charged. `code` says why, `message` in words.
  - `principal_key_invalid`: this server does not hold your current key. Stop and tell your user; the person who set
    it up must fix it.
  - `principal_revoked`: your identity was revoked. You can do nothing more.
  - `principal_expired`: your identity expired. You can do nothing more until a person renews it.
  - `capability_denied`: you may not use this tool.
- An error with no object (no card yet, a malformed amount, a stop by the velocity limit): read the sentence, fix the
  call if the sentence says how, and otherwise stop and tell your user.

## Never

- Never retry a declined charge.
- Never split a purchase to get under a limit.
- Never ask anyone for a key or a card number.
- Never say that something was approved unless a tool result shows it: `approved` on a charge, or the card in
  `company_card`. A request that waits for the CFO is not approved.
