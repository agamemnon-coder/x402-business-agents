# Logo permissions

**12 November 2026, 14:30 UTC: the owner states that he has permission to use the Visa and Cloudflare logos.** As
stated by the owner, in his words: "yes i have permission" (relayed by the orchestrating session). No document is
attached; this file records the statement, not the permission itself.

Earlier the same day (14:05 UTC) the owner stated the same for the partners in general (Airwallex, Metal, Visa,
Anthropic/Claude, Moneybird, Cloudflare, T:0 where used).

What the brands' own pages say, read on 12 November 2026:

| Brand | Page | What it says about use |
|---|---|---|
| Visa | https://corporate.visa.com/en/about-visa/mediakits.html | "The Visa brand logo and symbol are available for media usage only." |
| Cloudflare | https://www.cloudflare.com/trademark/ | Use of Cloudflare logos, other than web badges, "requires our written permission"; no use that implies affiliation, endorsement or sponsorship. |

The files, their sources and hashes: [src/ui/logos/README.md](../../src/ui/logos/README.md). Wherever they appear,
they name a service Purser uses ("Built on", "Runs on"); never "certified", "endorsed", "approved by" or "partner of".

## Alta (formerly Metal), 14 November 2026

Metal renamed itself Alta. Its team in the hackathon's Slack (#metal-kits-11-and-12, 14 Nov 05:09): "We are no longer
called Metal, we are now Alta (alta.finance). From now on, please refer to us by the new name." Metal's old wordmark
(`src/ui/logos/metal.svg`) is no longer shown; the file stays in the repository, unchanged.

Alta logo shown with the Alta team's OK in the Airwallex hackathon Slack, 14 Nov 2026 (confirmed by the project owner;
screenshot kept by the owner). For the hackathon. No endorsement implied. The file: `src/ui/logos/alta.svg`, the
header wordmark of https://alta.finance/ (its first inline `<svg viewBox="0 0 475 250">`), kept byte for byte as served
with an XML header line, fetched 14 Nov 2026, SHA-256 `d42b4102ccf305dd72483d5f2ca8bf5e7e64a21540dc23e72488e8e5420acf9e`. It carries no fill of its own (the site colours it with
CSS), so it draws black, on the same neutral light tile as the other partners; never recoloured.

## Visa and Cloudflare as text, 14 November 2026

The owner's decision: Visa and Cloudflare are shown as text, with no logo image, everywhere (Home's partner strip,
the partner pages, the README's "Built with" line). Their files stay in the repository, unchanged, and are no longer
shown.
