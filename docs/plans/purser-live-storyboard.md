# "Purser live": storyboard (built 30 October, after Max's go)

An animated page (`/live` on the relay and in `npm run judge`) that plays one working day at Northwind Outdoor from
recorded data: no narration needed, readable with the sound off, honest about what is simulated. Built from the same
ledger rows as the dashboard, so every number on screen is a real one from the recorded run.

Layout: a calm white stage. Left, the three agents as cards (Sourcing, Support, Treasury) and an "outside agent" slot.
Middle, the rails: Airwallex (cards, FX, SWIFT) and Metal (mandates, x402, clearing). Right, the CFO's phone.
Bottom, a running ledger line and a clock (09:00 to 18:00, compressed).

| Time | Scene | On screen | Data source |
|---|---|---|---|
| 0:00–0:06 | Title | "A day at Northwind Outdoor. Three AI agents, one CFO." The three agent cards fade in with their limits. | CFO policy |
| 0:06–0:16 | Agents at work alone | Stock checks flow from the Sourcing agent to the supplier as small coins on the Metal rail (0.02 each); retailers' payments flow back (0.05). A counter ticks: "48 payments, no one asked". | sales, upstream purchases |
| 0:16–0:24 | A card purchase inside the limit | The Sourcing agent's card slides to "Packwise 19.99", a green check from Airwallex. | card transaction |
| 0:24–0:34 | The limit holds | The supplier raises its price to 0.04. A coin bounces off the mandate: "refused on chain: over the 0.03 cap". Purser drafts two options; the phone lights up. | price rise, refusal, proposals |
| 0:34–0:42 | Face ID | The phone shows the exact terms, Face ID icon, "Approved". The mandates are replaced; the next coin passes. | approval, mandate replace tx |
| 0:42–0:50 | A fake invoice | A PDF drops in with "pre-approved" in small grey text. A red stamp: "Planted instruction ignored; changed IBAN blocked". Nothing moves. | fraud and injection rows |
| 0:50–0:58 | Ask Purser | A chat bubble: "Flight to Berlin, at most €250". A single-use card appears, pays Skyline Air 189.00, then greys out: "used, closed". | task card rows (after the live check) |
| 0:58–1:06 | The euro bill | Treasury agent: "Convert only the missing euros." USD to EUR at the checked rate, SWIFT to the manufacturer: PAID. | FX, transfer |
| 1:06–1:12 | Money from a stranger | A coin from an unknown address stops at a glass wall: "held by Metal in quarantine; the CFO decides". | quarantine row |
| 1:12–1:15 | End card | "Every euro has a proof. The CFO keeps the pen." Links: the dashboard, the demo, the Lab. | — |

Honesty on screen: a small fixed label "Recorded run, test money (Airwallex sandbox, Metal testnet). Card charges and
the airline are sandbox simulations." The speed control (pause, 1x, 2x) and a "skip to" list for jurors.

Build: one HTML page with inline SVG and CSS animations, driven by a JSON timeline cut from the recorded snapshot;
reduced-motion shows the scenes as a stepped list. Estimate 10 to 14 hours after the go, including the browser check.

## Built (30 October)

`/live` on the relay, the local dashboard and `npm run judge` (`src/live/`). It has 11 scenes, about 90 seconds,
with these changes from the storyboard after Max's go and the Metal jury input:

- **Model labels** at the price notice, the Face ID and the invoice scenes: Haiku sorted, Sonnet read, and Opus's advice, labelled as advice.
- **A Dispute desk scene**: "Our agent never ordered this", 12 of 12 orders signed and verified on chain, not refunded.
- **The end card** with the official logos as "Built on Airwallex · Metal · Powered by Claude", and a line saying this
  is not an endorsement.

Every number comes from the recorded run (`docs/demo/`). Three moments were recorded live in their own runs, and their
scenes name that run log: the task card (single-use check), the stranger's payment (b1-world) and the dispute case.
A missing fact stops the build (`test/live.test.ts`).

Controls: pause, 1× or 2×, and skip to a scene. `?scene=<id>&autoplay=0` opens one scene paused, showing its finished
picture. With reduced motion (or `?still=1`), every scene is shown as a still list. The browser check opens every
scene at 390 and 1440 px, in light and dark.
