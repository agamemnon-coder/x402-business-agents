# Wording for when the demo is live

Not applied. Today no demo deployment exists, and the texts listed below say the hosted preview is private, which is true.
Apply these changes together, in one commit, only after both of these are done:

1. The demo is deployed by [cloud-demo.md](cloud-demo.md).
2. `npm run cloud:smoke-demo` passed against it, and its output is saved as a run record:
   `docs/runs/<date>-cloud-demo-smoke.md`, with the commit, the date and the full output (it holds no secret).

`<date>` below is the date of that run record, as in "13 November". The address is `ORIGIN` of `env.demo` in
`cloud/wrangler.jsonc`. Each change keeps the sentence about the private preview: the preview stays private, and the
demo is a separate deployment that holds test companies only.

## The sentences

**README.md, "Built after the kit".** After the sentence that starts "Details and screenshots:", add:

```md
A read-only demo of the console, with three test companies, opens without an account at
[purser-demo.max-31b.workers.dev](https://purser-demo.max-31b.workers.dev): test companies, stand-in payments, no
real money ([how it runs](docs/cloud-demo.md)).
```

**llms.txt, the "After the kit" line.** Before "a hosted preview exists but is private" insert:

```md
a read-only demo of the console with three test companies opens without an account at
https://purser-demo.max-31b.workers.dev (test companies, no real money);
```

(llms.txt is served by the site, whose pages never say "stand-in": keep this one without it.)

**docs/after-the-kit.md, "Where it stands".** After "([what is missing](go-live.md))." add:

```md
A read-only demo of the console, with three test companies, opens without an account at
[purser-demo.max-31b.workers.dev](https://purser-demo.max-31b.workers.dev): test companies, stand-in payments, no
real money ([how it runs](cloud-demo.md)).
```

In its table, the "Cloud console" row's last cell becomes:

```md
Built, tested locally on Cloudflare's local D1; a read-only demo with three test companies runs on its own
deployment ([cloud-demo.md](cloud-demo.md)); the hosted preview is private (behind an access key)
```

**docs/claims.md, "Built after the kit".** In the row "The payables inbox, scanned invoices, batch Face ID, payouts and
the cloud console are built and tested", after "and no customer uses it;" insert:

```md
a read-only demo of the console with three test companies (stand-in payments, no real money) runs at
https://purser-demo.max-31b.workers.dev, checked by its smoke check on `<date>`
(`docs/runs/<date>-cloud-demo-smoke.md`);
```

and add `docs/cloud-demo.md` to the row's evidence.

**docs/submission/README.md, the form.** "Payables: in repo, not live." becomes:

```md
Payables: in repo; read-only demo with test companies at purser-demo.max-31b.workers.dev.
```

The form must stay under 4,000 characters (`test/submission.test.ts`). In the note above the form, after "and nothing is
said to be live." add: "On `<date>` it gained the address of the read-only demo of test companies."

**docs/cloud.md.** Three places:

- The opening, after "test money only.**", add: "A read-only demo of three test companies runs as a deployment of its
  own ([cloud-demo.md](cloud-demo.md))."
- "Demo mode", the bold sentence "No deployment runs in this mode today (12 November): the mode is built and tested
  locally only." becomes: "**One deployment runs in this mode: https://purser-demo.max-31b.workers.dev, since
  `<date>`, checked by its smoke check ([record](runs/<date>-cloud-demo-smoke.md)).**"
- "Not done yet", the first bullet ends with: "The smoke check ran against the read-only demo on `<date>`; no automated
  test runs against it."

**docs/go-live.md.** After "and nothing here is in production." add:

```md
A read-only demo of three test companies runs on a deployment of its own, with its own database and bucket
([cloud-demo.md](cloud-demo.md)); it holds no customer data.
```

**docs/runbook.md, "Purser Cloud".** After "and no customer uses it." add:

```md
The read-only demo of test companies has its own runbook ([cloud-demo.md](cloud-demo.md)); its smoke check ran on
`<date>`.
```

**docs/README.md.** In the after-the-kit.md line, "the hosted preview is private, no customer uses it;" becomes "the
hosted preview is private, no customer uses it, and a read-only demo with three test companies runs at
https://purser-demo.max-31b.workers.dev;".

## Left as they are, on purpose

- **The site** (`src/redesign/home.ts`, "Next, not live yet: an invoice inbox for small companies, with the same Face
  ID control."). The product for real companies is still not live; the demo is a test world. Whether the site links
  the demo is a design decision of its own, outside this list.
- **docs/decisions.md, D29**, and the six design notes of 8 November in `docs/superpowers/specs/`. They are dated
  records of what was true then, and their tests pin them.

## Tests that change with the sentences

- `test/cloud-demo.test.ts`, "demo mode, in docs/cloud.md": the pinned bold sentence becomes the new one, and the
  section may then name the address.
- `test/platform-in-main.test.ts`: "announces no public demo of it" becomes a test that every text above names the
  demo's address together with "test companies" and "no real money", and still says the preview is private. Keep
  `has(/hosted preview exists but is private \(behind an access key\)/)` as it is: that sentence stays.
- `test/submission.test.ts`: the pinned form line becomes the new one.
- Run all checks, and run `npm run cloud:smoke-demo` once more against the live address.
