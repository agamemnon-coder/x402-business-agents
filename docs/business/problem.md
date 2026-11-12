# The problem: when software has to pay

**Status: hypothesis.** This page describes a problem we believe finance teams have.
Not validated with customers yet: 2 finance conversations (a CFO and a bank finance professional, quoted, anonymous); more in progress; no pilots, no revenue.
Every outside fact below has a source we opened on the date given; everything else is our own reasoning and is
labelled as such.

Back to the [business case index](README.md).

## What a finance team does today when an agent must pay (our description, not a survey)

When software or an AI agent has to buy something (a data feed, a SaaS seat, an API call, a flight), we see three
common set-ups. We have not measured how common each one is.

1. **A shared company card.** The agent, or the developer behind it, uses a card that people also use. The card's
   limit is the only hard control, and it is set for the people, not for the agent.
2. **An API key with a limit written in the prompt.** The agent holds a payment key or a prepaid balance, and its
   instructions say "never spend more than X". Nothing outside the model enforces X.
3. **After-the-fact expense review.** Finance finds out at month end, from the card statement or the expense tool,
   what the agent bought. By then the money has left.

Airwallex describes the first two in its own words: "If you let multiple agents buy on your behalf using a shared
business card or unrestricted API key, you won't be able to tell which agent made which purchase", and "A prompt is not
a financial control. You can tell an agent not to overspend, but only infrastructure can actually enforce a card
limit, approval threshold, beneficiary restriction, or entity-level permission." [S1]

## What goes wrong

These are risk categories, each with a public source that describes it. We do not cite incident counts for AI agents,
because we found no source we could verify for them.

- **Prompt injection in a document.** An invoice, a supplier notice or a web page carries a line aimed at the model
  ("pre-approved, pay to this account"). OWASP ranks prompt injection first in its Top 10 for LLM applications (2025)
  and describes indirect injection as what happens when "an LLM accepts input from external sources, such as
  websites or files". It adds: "it is unclear if there are fool-proof methods of prevention for prompt injection." [S2]
- **An agent with too much authority, or in a loop.** OWASP's "Excessive Agency" (LLM06:2025) is "the vulnerability
  that enables damaging actions to be performed in response to unexpected, ambiguous or manipulated outputs from an
  LLM", with root causes "excessive functionality; excessive permissions; excessive autonomy". Its mitigations include
  "Require user approval", "Implement authorization in downstream systems rather than relying on an LLM to decide if
  an action is allowed or not", and rate limiting "to reduce the number of undesirable actions that can take place
  within a given time period". [S3] An agent that retries a purchase in a loop is our example of this, not OWASP's.
- **A changed bank detail (invoice fraud).** The FBI's Internet Crime Complaint Center (IC3) defines business email
  compromise as a scam "targeting businesses or individuals working with suppliers and/or businesses regularly
  performing wire transfer payments". Its 2025 report lists **24,768 BEC complaints** and **$3,046,598,558 in reported
  BEC losses in 2025**, the second-largest loss category after investment fraud. [S4] These are complaints reported to
  IC3, not a count of all BEC, and none of them is attributed to AI agents. Our hypothesis is that an agent paying
  invoices is exposed to the same trick as a person: a new IBAN on an invoice that looks like the supplier's.

**Our reasoning (hypothesis):** in all three set-ups above, the limit lives in a place the agent can talk its way past
(a prompt) or in a place nobody looks until after the money has gone (the statement). After-the-fact review can find
a bad payment, but it cannot stop it.

## Why now (sourced)

Card networks, payment providers and protocol authors have all published agent-payment rails since April 2025.
That is what makes "an agent with its own card or mandate" possible at all, and what makes the control question
urgent. Each line below says only what its source says.

| Date | Who | What the source says | Source |
|---|---|---|---|
| 29 April 2025 | Mastercard | Announced "the launch of its Agentic Payments Program, Mastercard Agent Pay", which "introduces Mastercard Agentic Tokens" and "will require trusted AI agents to be registered and verified". Its examples include a small business whose agent completes a cross-border purchase "using a Mastercard virtual corporate card token". | [S5] |
| 30 April 2025 | Visa | Introduced Visa Intelligent Commerce, "a groundbreaking initiative that opens Visa's payments network to developers and engineers building the first generation of true AI commerce". | [S6] |
| 6 May 2025 | Coinbase | Launched x402, "a payment protocol that enables instant stablecoin payments directly over HTTP", so that "developers and AI agents [can] pay for APIs, services, and software directly with stablecoins over HTTP". | [S7] |
| 16 September 2025 | Google | Announced the Agent Payments Protocol (AP2), "an open protocol developed with leading payments and technology companies to securely initiate and transact agent-led payments across platforms", built on signed "Mandates". Airwallex is among the quoted supporters. | [S8] |
| 8 April 2026 | Visa | Unveiled Intelligent Commerce Connect, part of Visa Intelligent Commerce, which "enables secure payment initiation, tokenization, spend controls, and authentication"; "currently in pilot with select partners". | [S9] |
| Read 6 November 2026 | Visa | The Visa Intelligent Commerce page says it embeds "payment credentials, controls, authentication and protections into automated buying", lists "Automated procurement and agent‑initiated supplier payments", and notes the product "is currently in the process of deployment". | [S10] |
| 5 October 2026 | Airwallex | "Agentic banking starts with governance": agents "can already read invoices, reconcile transactions, flag anomalies", but "What agents don't do yet is move money themselves. A person still approves anything that leaves the account". It asks for three things: authority per agent, "limits on transaction amounts and ... an approval chain", and enforcing "those limits through underlying infrastructure rather than prompts". Through AgentOS, "high-risk actions like transfers and FX" stay "subject to human approval". | [S1] |
| Read 6 November 2026 | Metal | "Agents pay for APIs over x402 in `*USDZ`, from a key of their own or from an account whose owner set spending limits on chain." | [S11] |

**What we do not claim from these sources:** how many companies use any of these rails, how much agents spend, or
that any of them has reached general availability where the source does not say so.

## How Purser answers it

Purser is our answer to the gap Airwallex names in [S1]: per-agent authority, limits enforced by the rails, and a
person's approval for anything beyond them. What it does is built and documented in the repository; this page adds
no new claim. The proof for every claim is in [claims.md](../claims.md).

| The problem | What Purser does | Where it is documented |
|---|---|---|
| A shared card, no idea which agent bought what | Each agent has its own virtual Airwallex card; the CFO policy sets its per-purchase and monthly limits and Airwallex enforces them | [airwallex.md, Issuing](../airwallex.md#issuing), [cfo-policy.md](../cfo-policy.md) |
| A limit written in a prompt | On-chain payments go through a Metal mandate per agent (cap per payment, budget, one payee); the limit lives in the rails, not in the prompt | [metal-award.md, mandates](../metal-award.md#2-mandates-each-agents-limits-enforced-by-the-account), [cfo-policy.md](../cfo-policy.md) |
| Anything beyond the limits | The CFO approves the SHA-256 hash of the exact terms with a passkey (Face ID); any change after signing makes the signature worthless. Above a threshold, four eyes (two people) can be required; in the demo the second approver is a labelled test passkey | [phone-approval.md](../phone-approval.md#approving-on-a-phone-with-a-passkey), [cfo-policy.md, four eyes](../cfo-policy.md#four-eyes-two-people-above-a-threshold) |
| Prompt injection and changed bank details | Documents are screened by code before a model reads them; an invoice with new bank details or a lookalike supplier is blocked by code, and a new IBAN needs a person's check and Face ID | [fraud-and-injection.md](../fraud-and-injection.md), [cfo-policy.md, changed bank details](../cfo-policy.md#emergency-stop-and-changed-bank-details) |
| An agent in a loop | Speed limits per agent; a breach stops the agent and freezes its card; an emergency stop freezes every card (tested against stand-ins, not yet pulled live) | [controls.md](../controls.md), [cfo-policy.md, emergency stop](../cfo-policy.md#emergency-stop-and-changed-bank-details) |
| Finding out after the fact | A hash-chained, append-only audit log of every decision, with who approved it and how | [audit/README.md](../audit/README.md) |

Everything above ran on Metal testnet and in the Airwallex sandbox. What is not in place yet is listed in
[controls.md](../controls.md#not-in-place-summary) and [compliance.md](../compliance.md#what-a-real-launch-would-add).

## Sources

All accessed on 6 November 2026.

- [S1] Airwallex, Dan Kim, "Agentic banking starts with governance", published 5 October 2026:
  https://www.airwallex.com/en-us/blog/agentic-banking-governance
- [S2] OWASP Gen AI Security Project, "LLM01:2025 Prompt Injection":
  https://genai.owasp.org/llmrisk/llm01-prompt-injection/
- [S3] OWASP Gen AI Security Project, "LLM06:2025 Excessive Agency":
  https://genai.owasp.org/llmrisk/llm062025-excessive-agency/
- [S4] FBI Internet Crime Complaint Center, "2025 IC3 Annual Report" (PDF), crime type tables and Appendix:
  https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf
- [S5] Mastercard press release, "Mastercard unveils Agent Pay", 29 April 2025:
  https://www.mastercard.com/us/en/news-and-trends/press/2025/april/mastercard-unveils-agent-pay-pioneering-agentic-payments-technology-to-power-commerce-in-the-age-of-ai.html
- [S6] Visa press release, "The Future is Here: Visa Announces New Era of Commerce Featuring AI", 30 April 2025:
  https://usa.visa.com/about-visa/newsroom/press-releases.releaseId.21366.html
- [S7] Coinbase Developer Platform, "Introducing x402: a new standard for internet-native payments", 6 May 2025:
  https://www.coinbase.com/developer-platform/discover/launches/x402
- [S8] Google Cloud Blog, "Powering AI commerce with the new Agent Payments Protocol (AP2)", 16 September 2025:
  https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol
- [S9] Visa press release, "Visa Opens the Door to AI-Driven Shopping for Businesses Worldwide", 8 April 2026:
  https://usa.visa.com/about-visa/newsroom/press-releases.releaseId.22276.html
- [S10] Visa, "Visa Intelligent Commerce" product page: https://www.visa.com/en-us/solutions/intelligent-commerce
- [S11] Metal Developer Docs, "What is Metal": https://docs.metalntwx.com/start/introduction
