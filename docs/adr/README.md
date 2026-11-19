<a href="../../README.md"><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/brand/purser-mark-dark.svg"><img src="../assets/brand/purser-mark.svg" alt="Purser" width="36" height="36"></picture></a>

# Architecture decision records

An index of the decisions in [decisions.md](../decisions.md), D1 to D30, with each one's date and status.

| At a glance | Record |
|---|---|
| **30 decisions**, 29 October to 12 November 2026: 25 accepted, 5 superseded | [decisions.md](../decisions.md) |
| New decisions use the MADR template | [0000-template.md](0000-template.md) |

The decisions themselves stay in [decisions.md](../decisions.md), as written at the time: this page only indexes them,
so nothing in the record changes. The status is read from the record: a decision is superseded where its entry says
so (in bold, at its top), and accepted otherwise. A decision taken from now on gets its own file here,
`NNNN-short-title.md`, from [the template](0000-template.md) (MADR 4), and a row below; the numbering goes on from D30
(the first is `0031-…`).

| ADR | Decision | Date | Status |
|---|---|---|---|
| <a id="d1"></a>D1 | [Product name Purser; example company Northwind Outdoor](../decisions.md#d1-product-name-purser-example-company-northwind-outdoor) | 29 October 2026 | Accepted |
| <a id="d2"></a>D2 | [Internal agent ids stay; people see role names](../decisions.md#d2-internal-agent-ids-stay-people-see-role-names) | 29 October 2026 | Superseded by [D14](#d14) |
| <a id="d3"></a>D3 | [The parties in scenario A](../decisions.md#d3-the-parties-in-scenario-a) | 29 October 2026 | Accepted |
| <a id="d4"></a>D4 | [The recorded demo stays rehearsal 3 until Friday's runs](../decisions.md#d4-the-recorded-demo-stays-rehearsal-3-until-fridays-runs) | 29 October 2026 | Accepted; done 30 October |
| <a id="d5"></a>D5 | [The Friday runs replace the Saturday runs](../decisions.md#d5-the-friday-runs-replace-the-saturday-runs) | 29 October 2026 | Accepted |
| <a id="d6"></a>D6 | [The red team runs as code; the model declined to play the attacker](../decisions.md#d6-the-red-team-runs-as-code-the-model-declined-to-play-the-attacker) | 30 October 2026 | Accepted |
| <a id="d7"></a>D7 | [Velocity limits are code constants; the stop is a policy switch](../decisions.md#d7-velocity-limits-are-code-constants-the-stop-is-a-policy-switch) | 30 October 2026 | Accepted |
| <a id="d8"></a>D8 | [The Friday worlds are bootstrapped the night before](../decisions.md#d8-the-friday-worlds-are-bootstrapped-the-night-before) | 30 October 2026 | Accepted |
| <a id="d9"></a>D9 | [The `support` agent is shown as the Sales agent](../decisions.md#d9-the-support-agent-is-shown-as-the-sales-agent) | 30 October 2026 | Superseded by [D14](#d14) |
| <a id="d10"></a>D10 | [Double-entry bookkeeping waits until after the freeze](../decisions.md#d10-double-entry-bookkeeping-waits-until-after-the-freeze) | 30 October 2026 | Superseded (31 October): the double-entry books were built |
| <a id="d11"></a>D11 | [A company-sized euro reserve, and guests see only Northwind](../decisions.md#d11-a-company-sized-euro-reserve-and-guests-see-only-northwind) | 30 October 2026 | Accepted |
| <a id="d12"></a>D12 | [The Dispute desk rules live in one shared example](../decisions.md#d12-the-dispute-desk-rules-live-in-one-shared-example-31-october) | 31 October 2026 | Accepted |
| <a id="d13"></a>D13 | [minimatch pinned to 11.0.3 by override](../decisions.md#d13-minimatch-pinned-to-1103-by-override-31-october) | 31 October 2026 | Accepted |
| <a id="d14"></a>D14 | [The agents carry Kit 11's names, word for word](../decisions.md#d14-the-agents-carry-kit-11s-names-word-for-word-31-october) | 31 October 2026 | Accepted |
| <a id="d15"></a>D15 | [From good to winner: estimates and risk, before any code](../decisions.md#d15-from-good-to-winner-estimates-and-risk-before-any-code-31-october-evening) | 31 October 2026 | Accepted |
| <a id="d16"></a>D16 | [Face ID signs on chain: research](../decisions.md#d16-face-id-signs-on-chain-research-31-october-late-evening) | 31 October 2026 | Accepted |
| <a id="d17"></a>D17 | [The rail choice uses the agent's own card for Packwise](../decisions.md#d17-the-rail-choice-uses-the-agents-own-card-for-packwise-1-november) | 1 November 2026 | Accepted |
| <a id="d18"></a>D18 | [Four eyes on the real business account: not before Thursday](../decisions.md#d18-four-eyes-on-the-real-business-account-not-before-thursday-1-november) | 1 November 2026 | Accepted |
| <a id="d19"></a>D19 | [Real agents, not a script: plan, estimate, risk](../decisions.md#d19-real-agents-not-a-script-plan-estimate-risk-1-november-morning) | 1 November 2026 | Accepted |
| <a id="d20"></a>D20 | [Phishing-resistant MFA for the dashboard: passkey sessions, a read-only viewer link that expires](../decisions.md#d20-phishing-resistant-mfa-for-the-dashboard-passkey-sessions-a-read-only-viewer-link-that-expires-1-november) | 1 November 2026 | Accepted |
| <a id="d21"></a>D21 | [/try: the jury changes the world and the Sourcing agent decides](../decisions.md#d21-try-the-jury-changes-the-world-and-the-sourcing-agent-decides-1-november) | 1 November 2026 | Accepted |
| <a id="d22"></a>D22 | [The autonomous world gets Airwallex's own events](../decisions.md#d22-the-autonomous-world-gets-airwallexs-own-events-1-november-afternoon) | 1 November 2026 | Accepted |
| <a id="d23"></a>D23 | [The money flow, animated, in the control tower](../decisions.md#d23-the-money-flow-animated-in-the-control-tower-design-41-1-november-evening) | 1 November 2026 | Accepted |
| <a id="d24"></a>D24 | [Who decided, recorded at the source](../decisions.md#d24-who-decided-recorded-at-the-source-max-2-november) | 2 November 2026 | Accepted |
| <a id="d25"></a>D25 | [The Visa Award: TAP claimed, and in the rail choice](../decisions.md#d25-the-visa-award-tap-claimed-and-in-the-rail-choice-max-1-november-evening) | 1 November 2026 | Superseded by [D27](#d27) and [D28](#d28) |
| <a id="d26"></a>D26 | [Proof with the API budget: variation, holdouts, red team](../decisions.md#d26-proof-with-the-api-budget-variation-holdouts-red-team-max-2-november-starts-after-the-reserve-run) | 2 November 2026 | Accepted |
| <a id="d27"></a>D27 | [Visa: TAP is not eligible; the entry is Metal only](../decisions.md#d27-visa-tap-is-not-eligible-the-entry-is-metal-only-max-5-november) | 5 November 2026 | Superseded by [D28](#d28) |
| <a id="d28"></a>D28 | [Visa: the VIC run counts; entered for the Metal Award and the Visa Award](../decisions.md#d28-visa-the-vic-run-counts-entered-for-the-metal-award-and-the-visa-award-the-owner-7-november) | 7 November 2026 | Accepted |
| <a id="d29"></a>D29 | [The product for small companies is merged into `main` now](../decisions.md#d29-the-product-for-small-companies-is-merged-into-main-now-the-owner-12-november) | 12 November 2026 | Accepted |
| <a id="d30"></a>D30 | [The worst case counts the task cards](../decisions.md#d30-the-worst-case-counts-the-task-cards-12-november) | 12 November 2026 | Accepted; replaces the rule of 6 November on the worst case |
