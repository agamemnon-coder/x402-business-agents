# Unit economics per agent (4.3): does each agent pay for itself?

Only measured numbers, from the four agents-on dry runs dry-19 to dry-22 (31 October; fresh worlds, `KIT11_AGENTS=on`,
the whole draaiboek, 50 customer queries each). Money in the worlds is test USD (*USDZ on Metal testnet) at the brief's
prices; Claude costs are real USD from the API's reported usage (`cost_usd_micros` in the audit log). Script:
read-only queries on `data/dry-1{9}…22.sqlite` (`sales`, `upstream_purchases`, `refunds`, `agent.run`, `claude.read`).

## Per run (average of dry-19 to dry-22)

| | Sourcing (Haiku) | Support (Sonnet) | Treasury (Opus) | Opus reviews of proposals (advisory) | Whole business |
|---|---|---|---|---|---|
| Money in | 2.55 test USD (50 queries at 0.05, 0.07 after option B in one run) | | | | 2.55 |
| Money out | 1.20 upstream (40 × 0.02 + 10 × 0.04) | 0.15 refunds (#7, #10, #13) | 0 (the sweep moves money, it is not a cost) | | 1.35 |
| Claude: the agent's own decision | $0.0007 (1 run) | $0.046 (1 run) | $0.026 (1 run) | | $0.073 |
| Claude: readings and reviews | | $0.012 (3 documents) | $0.011 (4 documents) | $0.148 (6 reviews) | $0.171 |
| Margin before Claude | | | | | 1.20 test USD = **2.4¢ a query** |
| Margin after Claude | | | | | **1.9¢ a query** |

**One sentence:** with the brief's prices, the business pays for its agents: **margin after Claude costs = about 1.9¢ per
query** (2.4¢ before; Claude about 0.5¢ a query over 50 queries), measured in four dry runs.

## Where it does not add up yet (said plainly)

- **Support costs more than it refunds, per dispute.** One Sonnet run is about $0.046 (plus $0.012 to read the
  documents) to decide refunds of 0.15: about 40%. It is a fixed cost per dispute, not per refund, so it falls with
  larger disputes; at the demo's size it does not pay for itself on the dispute alone.
- **The Opus reviews are the biggest Claude cost** ($0.148 a run, six advisory reviews of proposals the CFO signs). They
  inform the CFO; they decide nothing. Turning them off for small, routine proposals would halve the Claude cost.
- **Per query the agents cost almost nothing** (Sourcing decides once per price rise, $0.0007). The cost is per
  *exception*, not per transaction: more queries make it smaller.
- Test USD and real USD are compared at par; that is the brief's assumption, not a market price.
