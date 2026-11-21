# Purser's CFO policy as Rego (docs/policy-opa.md), for teams that standardise on Open Policy Agent.
#
# This file restates three of Purser's deterministic payment decisions, rule for rule and in the same order, so OPA
# decides exactly as Purser does on the same facts. test/policy-rego.test.ts runs Purser's own code and `opa eval` on
# every case of the policy fixtures, the eval and adversarial corpora and generated edge cases, and requires the same
# outcome and the same reason code on each. Purser does not read this file: it enforces in its own code and at the
# rails. Changing a rule here changes nothing Purser does; the equivalence test fails instead.
#
#   input.kind = "supplier_payment"  the Payer's boundary on a supplier invoice (src/ap/payerCore.ts enforceProposal):
#                                    pay alone, ask the CFO to sign the exact terms, or hold.
#   input.kind = "agent_purchase"    an agent's card purchase on the Airi rail (src/airi/purchase.ts decideAiriPurchase):
#                                    pay alone, ask the CFO, or refuse.
#   input.kind = "pay_alone"         whether a payment's amount is within the CFO's limit to pay alone
#                                    (src/policy/withinLimit.ts aloneDecision, proven in formal/dafny/Limit.dfy).
#
# The decision is data.purser.policy.decision: {"outcome": "pay" | "ask_cfo" | "hold" | "refuse", "reason": <code> | null}.
# The policy is input.policy when the input carries one (src/policy/rego.ts exportRegoInput does), else the company's
# policy as data (data.purser.cfo, the data.json `npm run policy:rego` writes).
#
# Every amount is a string with two decimals and every sum is in integer cents, as in Purser: no floats.

package purser.policy

import rego.v1

# ── The policy in force ──

policy := input.policy if {
	"policy" in object.keys(input)
} else := data.purser.cfo

# ── The decision ──

default decision := {"outcome": "hold", "reason": "unknown_kind"}

decision := supplier_payment if input.kind == "supplier_payment"

decision := agent_purchase if input.kind == "agent_purchase"

decision := pay_alone if input.kind == "pay_alone"

# ── Money: two-decimal strings to integer cents ──

# The largest integer JavaScript counts exactly (Number.MAX_SAFE_INTEGER): Purser treats an amount past it as unreadable.
max_safe := 9007199254740991

# The value of a string of ASCII digits, leading zeros allowed.
digits(s) := 0 if trim_left(s, "0") == ""

digits(s) := to_number(trim_left(s, "0")) if trim_left(s, "0") != ""

# src/lib/money.ts toCents behind src/ap/checkerCore.ts plainCents: no leading zero, two decimals, a safe integer.
cents(s) := c if {
	is_string(s)
	regex.match(`^(0|[1-9][0-9]*)\.[0-9]{2}$`, s)
	parts := split(s, ".")
	c := (digits(parts[0]) * 100) + digits(parts[1])
	c <= max_safe
}

# src/airi/purchase.ts AMOUNT: at most nine digits before the dot, no leading zero.
airi_cents(s) := c if {
	is_string(s)
	regex.match(`^(0|[1-9][0-9]{0,8})\.[0-9]{2}$`, s)
	parts := split(s, ".")
	c := (digits(parts[0]) * 100) + digits(parts[1])
}

# src/policy/withinLimit.ts PLAIN: one to nine digits (leading zeros allowed), a dot, two digits.
plain_cents(s) := c if {
	is_string(s)
	regex.match(`^[0-9]{1,9}\.[0-9]{2}$`, s)
	parts := split(s, ".")
	c := (digits(parts[0]) * 100) + digits(parts[1])
}

safe(n) if {
	n <= max_safe
	n >= 0 - max_safe
}

# A note on `not`: OPA evaluates a value a negated call or comparison reads before the negation, so `not f(x)` and
# `not x > 0` fail, rather than hold, when x is undefined. Every such test below is a named rule, negated by name.

# A key present in an object, whatever its value (null included).
has(o, k) if {
	is_object(o)
	k in object.keys(o)
}

# JavaScript's truthiness, for the values a JSON field can hold.
truthy(v) if {
	v != null
	v != false
	v != ""
	v != 0
}

# ── Days: YYYY-MM-DD, calendar arithmetic in whole days (no time zones, no nanoseconds) ──

# Integer division of non-negative integers.
idiv(a, b) := (a - (a % b)) / b

leap(y) if {
	y % 4 == 0
	y % 100 != 0
}

leap(y) if y % 400 == 0

month_days(y, 2) := 29 if leap(y)

month_days(y, 2) := 28 if not leap(y)

month_days(_, m) := 30 if m in {4, 6, 9, 11}

month_days(_, m) := 31 if m in {1, 3, 5, 7, 8, 10, 12}

# A real calendar day ("2026-02-30" is none): src/ap/payerCore.ts isDay.
is_day(s) if {
	is_string(s)
	regex.match(`^[0-9]{4}-[0-9]{2}-[0-9]{2}$`, s)
	m := digits(substring(s, 5, 2))
	d := digits(substring(s, 8, 2))
	m >= 1
	m <= 12
	d >= 1
	d <= month_days(digits(substring(s, 0, 4)), m)
}

# Days since 1970-01-01 of a real day (Howard Hinnant's days_from_civil, shifted by one 400-year era so every
# division is of non-negative numbers).
day_number(s) := n if {
	y := digits(substring(s, 0, 4))
	m := digits(substring(s, 5, 2))
	d := digits(substring(s, 8, 2))
	y2 := (y + 400) - to_number(m <= 2)
	era := idiv(y2, 400)
	yoe := y2 - (era * 400)
	mp := (m + 9) % 12
	doy := (idiv((153 * mp) + 2, 5) + d) - 1
	doe := (((yoe * 365) + idiv(yoe, 4)) - idiv(yoe, 100)) + doy
	n := (((era * 146097) + doe) - 719468) - 146097
}

# The day n days after 1970-01-01 as JavaScript's toISOString writes it (a year past 9999 as +0YYYYY).
day_string(n) := s if {
	z := (n + 719468) + 146097
	era := idiv(z, 146097)
	doe := z - (era * 146097)
	yoe := idiv(((doe - idiv(doe, 1460)) + idiv(doe, 36524)) - idiv(doe, 146096), 365)
	doy := doe - (((365 * yoe) + idiv(yoe, 4)) - idiv(yoe, 100))
	mp := idiv((5 * doy) + 2, 153)
	d := (doy - idiv((153 * mp) + 2, 5)) + 1
	m := month_of(mp)
	y := ((yoe + (era * 400)) - 400) + to_number(m <= 2)
	s := sprintf("%s-%02d-%02d", [year_string(y), m, d])
}

month_of(mp) := mp + 3 if mp < 10

month_of(mp) := mp - 9 if mp >= 10

year_string(y) := sprintf("%04d", [y]) if y <= 9999

year_string(y) := sprintf("+%06d", [y]) if y > 9999

# src/agents/timingCore.ts addDays.
add_days(s, n) := day_string(day_number(s) + n)

# ══ supplier_payment: the Payer's boundary (src/ap/payerCore.ts enforceProposal) ══

inv := input.payment.invoice

prop := input.payment.proposal

rails := input.payment.rails

today := input.context.today

# What the case holds in each currency, what is already spoken for, and the floors (a missing map is an empty one).
balances := object.get(input.context, "balances", {})

spoken_for := object.get(input.context, "spokenFor", {}) if {
	object.get(input.context, "spokenFor", null) != null
} else := {}

floors := object.get(policy, "cashFloors", {})

# The proposal is a rail, a day, a currency and a reason, each a string.
is_proposal if {
	is_object(prop)
	every k in ["rail", "pay_on", "pay_currency", "reason"] {
		is_string(prop[k])
	}
}

amount := cents(inv.amount)

amount_readable if amount > 0

payee_text if is_string(inv.payee)

iban_text if is_string(inv.iban)

today_is_day if is_day(today)

need_safe if safe(need)

# The rails the supplier accepts that the proposal names, and the first of them for the invoice's currency.
offered := [r | some r in rails; r.rail == prop.rail]

rail := [r | some r in offered; r.currency == inv.currency][0]

# A limit on one payout by the rail: unreadable, or the amount outside it.
rail_bound := "position_unreadable" if {
	has(rail, "maxPerPayout")
	not cents(rail.maxPerPayout)
} else := "rail_limit" if {
	has(rail, "maxPerPayout")
	amount > cents(rail.maxPerPayout)
} else := "position_unreadable" if {
	has(rail, "minPerPayout")
	not cents(rail.minPerPayout)
} else := "rail_limit" if {
	has(rail, "minPerPayout")
	amount < cents(rail.minPerPayout)
}

# The timing: the due date when it is a real day; the deadline is the due date, or today once it has passed or when
# the invoice names none; the policy may allow some days after it (1 to 3650; anything else allows none).
due := inv.dueDate if is_day(inv.dueDate)

overdue if due < today

deadline := due if {
	due
	not overdue
} else := today

late_days := n if {
	n := policy.payLate.maxDays
	is_number(n)
	n == round(n)
	n > 0
	n <= 3650
}

latest := add_days(deadline, late_days) if late_days

else := deadline

# Section 2 of payerCore.ts: the reason says the payment is late. ASCII letters in either case, as JavaScript's /i
# matches them without the u flag.
says_late(r) if regex.match(
	`\b(?:[Ll][Aa][Tt][Ee]|[Oo][Vv][Ee][Rr][Dd][Uu][Ee]|(?:[Aa][Ff][Tt][Ee][Rr]|[Pp][Aa][Ss][Tt]) (?:[Tt][Hh][Ee] |[Ii][Tt][Ss] )?[Dd][Uu][Ee](?: [Dd][Aa][Tt][Ee])?)\b`,
	r,
)

too_late if {
	prop.pay_on > deadline
	not late_days
}

too_late if {
	prop.pay_on > deadline
	prop.pay_on > latest
}

too_late if {
	prop.pay_on > deadline
	not says_late(prop.reason)
}

# The currency it is paid from: the invoice's own, or the one a locked quote sells for the invoice's currency.
fx := input.payment.fx

pays_from_quote if not prop.pay_currency == inv.currency

quote_matches if {
	truthy(fx)
	fx.sellCurrency == prop.pay_currency
	fx.buyCurrency == inv.currency
}

quote_readable if {
	cents(fx.sellAmount) > 0
	cents(fx.buyAmount) > 0
	is_string(fx.validTo)
	is_day(substring(fx.validTo, 0, 10))
}

quote_ends := substring(fx.validTo, 0, 10)

sell := cents(fx.sellAmount) if pays_from_quote

else := 0

buy := cents(fx.buyAmount) if pays_from_quote

else := 0

# The currencies the payment touches: the one sold first, then the invoice's.
touched := [fx.sellCurrency, inv.currency] if pays_from_quote

else := [inv.currency]

# A balance, an amount spoken for or a floor: a currency not named holds 0; one named must be a plain amount.
read(map, t) := 0 if not has(map, t)

read(map, t) := cents(map[t]) if has(map, t)

reserve := cents(rail.feeReserve)

need := amount + reserve

position[t] := {"there": there, "after": after, "floor": floor} if {
	some t in touched
	there := read(balances, t) - read(spoken_for, t)
	floor := read(floors, t)
	after := there + change(t)
}

change(t) := buy - need if t == inv.currency

change(t) := 0 - sell if t != inv.currency

position_unreadable if not reserve

# A map that is there but null cannot be read (Purser's lookup throws on it).
position_unreadable if input.context.balances == null

position_unreadable if policy.cashFloors == null

position_unreadable if {
	some t in touched
	not position[t]
}

position_unreadable if not need_safe

position_unreadable if {
	some t in touched
	some v in [position[t].there, position[t].after]
	not safe(v)
}

# Not enough money, or a balance below its floor: the currency sold first, then the invoice's.
money_stop := "not_enough_money" if {
	pays_from_quote
	position[fx.sellCurrency].after < 0
} else := "below_floor" if {
	pays_from_quote
	position[fx.sellCurrency].after < position[fx.sellCurrency].floor
} else := "not_enough_money" if {
	position[inv.currency].after < 0
} else := "below_floor" if {
	position[inv.currency].after < position[inv.currency].floor
}

# The first thing that holds the proposal (payerCore.ts judge), in its order; position_unreadable when code cannot
# work the case out.
hold_rule := "invalid_proposal" if {
	not is_proposal
} else := "amount_unreadable" if {
	not amount_readable
} else := "position_unreadable" if {
	# The sentences that say the supplier is not paid by the rail name it: they need its name as text.
	not payee_text
	count(offered) == 0
} else := "rail_not_accepted" if {
	count(rails) == 0
} else := "rail_not_accepted" if {
	count(offered) == 0
} else := "rail_not_accepted" if {
	not rail
} else := rail_bound if {
	rail_bound
} else := "position_unreadable" if {
	not today_is_day
} else := "pay_date_invalid" if {
	not is_day(prop.pay_on)
} else := "pay_date_past" if {
	prop.pay_on < today
} else := "after_due_date" if {
	too_late
} else := "pay_currency_not_available" if {
	pays_from_quote
	not quote_matches
} else := "position_unreadable" if {
	pays_from_quote
	not quote_readable
} else := "fx_quote_ended" if {
	pays_from_quote
	quote_ends < today
} else := "fx_quote_ended" if {
	pays_from_quote
	prop.pay_on > quote_ends
} else := "position_unreadable" if {
	position_unreadable
} else := money_stop if {
	money_stop
} else := "position_unreadable" if {
	# The terms show the account by its last characters: it must be text.
	not iban_text
}

# The limit to pay alone (src/ap/checkerCore.ts limitRule): only a limit that is a plain amount, in the invoice's own
# currency, with the amount at or below it, lets the payment run without the CFO.
limit_most := cents(policy.aloneLimit.amount) if truthy(policy.aloneLimit)

currency_truthy if truthy(inv.currency)

alone_rule := "no_alone_limit" if {
	not limit_most
} else := "alone_limit_other_currency" if {
	not currency_truthy
} else := "alone_limit_other_currency" if {
	not inv.currency == policy.aloneLimit.currency
} else := "above_alone_limit" if {
	amount > limit_most
}

supplier_payment := {"outcome": "hold", "reason": hold_rule} if hold_rule

else := {"outcome": "ask_cfo", "reason": alone_rule} if alone_rule

else := {"outcome": "pay", "reason": null}

# ══ agent_purchase: the Airi rail (src/airi/purchase.ts decideAiriPurchase) ══

req := input.payment.request

rail_policy := policy.agentPurchase

total := airi_cents(req.amount)

total_readable if total > 0

currency_allowed if req.currency in rail_policy.currencies

origin_text if is_string(origin)

merchant_allowed if origin in rail_policy.merchants

item_ok(i) if {
	airi_cents(i.unitPrice)
	is_string(i.quantity)
	regex.match(`^[1-9][0-9]{0,3}$`, i.quantity)
}

items_sum := sum([c | some i in req.items; c := airi_cents(i.unitPrice) * to_number(i.quantity)])

# Done by the exporter with the same WHATWG URL parser Purser uses (src/policy/rego.ts merchantOrigin): the merchant
# URL's https origin, or null when it is no plain https URL. Rego has no URL parser to match it.
origin := input.payment.merchant_origin

already_alone := object.get(input.context, "aloneToday", 0)

agent_purchase := {"outcome": "refuse", "reason": "PURSER_AMOUNT_INVALID"} if {
	not total_readable
} else := {"outcome": "refuse", "reason": "PURSER_AMOUNT_INVALID"} if {
	some i in req.items
	not item_ok(i)
} else := {"outcome": "refuse", "reason": "PURSER_ITEMS_TOTAL_MISMATCH"} if {
	count(req.items) == 0
} else := {"outcome": "refuse", "reason": "PURSER_ITEMS_TOTAL_MISMATCH"} if {
	items_sum != total
} else := {"outcome": "refuse", "reason": "PURSER_CURRENCY_NOT_ALLOWED"} if {
	not currency_allowed
} else := {"outcome": "refuse", "reason": "PURSER_MERCHANT_URL_INVALID"} if {
	not origin_text
} else := {"outcome": "refuse", "reason": "PURSER_MERCHANT_NOT_ALLOWED"} if {
	not merchant_allowed
} else := {"outcome": "refuse", "reason": "PURSER_ABOVE_HARD_CAP"} if {
	total > rail_policy.hardCapCents
} else := {"outcome": "ask_cfo", "reason": "above_alone_limit"} if {
	total > rail_policy.aloneMaxCents
} else := {"outcome": "ask_cfo", "reason": "alone_per_day_used"} if {
	already_alone >= rail_policy.alonePerDay
} else := {"outcome": "pay", "reason": null}

# ══ pay_alone: within the limit to pay alone (src/policy/withinLimit.ts aloneDecision) ══

alone_top := plain_cents(policy.aloneLimit.amount)

alone_cents := plain_cents(input.payment.amount)

alone_limit_set if alone_top > 0

pay_alone := {"outcome": "ask_cfo", "reason": "no_limit"} if {
	not alone_limit_set
} else := {"outcome": "ask_cfo", "reason": "not_within"} if {
	not alone_cents
} else := {"outcome": "ask_cfo", "reason": "not_within"} if {
	not input.payment.currency == policy.aloneLimit.currency
} else := {"outcome": "ask_cfo", "reason": "not_within"} if {
	alone_cents > alone_top
} else := {"outcome": "pay", "reason": null}
