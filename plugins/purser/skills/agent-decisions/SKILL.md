---
name: agent-decisions
description: Explain what the company's agents decided in Purser, and who decided what - an agent, the CFO, or Purser's code. Use when the user asks what the agents did, why something was paid or declined, or who approved a payment.
---

# What the agents decided

Purser keeps every decision in a hash-chained audit trail. `agent_decisions` gives the newest ones in words, newest
first. Each has `who` (an agent, the CFO, or Purser's code), `text`, `at` and `by` (`agent`, `cfo` or `code`).

## Steps

1. Call `agent_decisions`; raise `limit` (up to 100) when the user asks about a longer stretch.
2. Group what you tell the user by who decided:
   - **Agents** paid on their own cards within their limits, asked for higher limits, matched payments in, and
     proposed supplier payments.
   - **The CFO** approved payments by signing their exact terms with a passkey (Face ID). Only the CFO approves.
   - **Purser's code** read invoices, stopped duplicates and recorded what Airwallex declined.
3. For "why was this paid", find the proposal and the CFO's approval of it; for "why was this declined", quote the
   reason Purser recorded.

## Be exact about who

- When a line says it was decided by code's fallback (no model answered), say Purser's code decided it. Never call
  that Claude's decision.
- An invoice "read by Purser's code" was not read by Claude.
- Do not add decisions that are not in the trail.
