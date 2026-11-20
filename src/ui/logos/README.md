# Sponsor logos (official assets)

Downloaded on 2026-10-28 from the hackathon microsite (https://airwallex.hackerearth.com/, sponsor and partner
section) and the sponsors' own sites. They are used only as a plain "Built on" mark, unchanged (no recolouring,
no stretching), on a white ground in both themes, and never in a way that suggests the sponsor endorses Purser.

| File | What |
|---|---|
| airwallex.png | Airwallex wordmark |
| metal.svg | Metal wordmark (Metal is now Alta: no longer shown, see below) |
| claude.png | Claude (Anthropic) logo, scaled to 72 px high, colours unchanged; white letters, so it sits on a dark ground |
| visa.png | Visa brandmark, blue, unmodified |
| cloudflare.png | Cloudflare logo, unmodified |

## Added on 12 November 2026 (owner's statement of permission)

The owner states he has permission to use the Visa and Cloudflare logos (12 Nov 2026, relayed by the orchestrator in
his words: "yes i have permission"); no document is attached. Recorded in docs/evidence/logo-permissions.md. Each file
is kept byte for byte as downloaded. Neither is "certified", "endorsed", "approved by" or "partner of" anything.

| File | Source | Downloaded | SHA-256 | The source's own words on use |
|---|---|---|---|---|
| visa.png | Visa media kits, https://corporate.visa.com/en/about-visa/mediakits.html, "Download Visa brandmark" (https://corporate.visa.com/content/dam/VCOM/corporate/about-visa/images/visa-brandmark-blue-1960x622.png) | 2026-11-12 | `7b0b7f701755a409ee169f77ee3116c9d669ec6dfc82135fe2e3b48ecc51b788` | "The Visa brand logo and symbol are available for media usage only." Use beyond that rests on the owner's stated permission. |
| cloudflare.png | Cloudflare press kit, https://www.cloudflare.com/press-kit/, "Logos.zip", file "CF-Logo 1.png" | 2026-11-12 | `400b70b8bb7db80da137ef8e8fcb835a692410a3083598964da08ed1756df145` | Trademark guidelines (https://www.cloudflare.com/trademark/): use of the logos other than web badges "requires our written permission"; no implied affiliation, endorsement or sponsorship. Use rests on the owner's stated permission. |

Both are dark marks on a transparent ground (no light version in either kit), so they need a light tile in dark mode.

## Alta (formerly Metal), 14 November 2026

Metal renamed itself Alta (its team, in the hackathon's Slack, 14 Nov). `metal.svg` is kept byte for byte but no longer
shown.

| File | Source | Fetched | SHA-256 | Use |
|---|---|---|---|---|
| alta.svg | The header wordmark on https://alta.finance/ (the first inline `<svg viewBox="0 0 475 250">`), byte for byte as served, with an XML header line | 2026-11-14 | `d42b4102ccf305dd72483d5f2ca8bf5e7e64a21540dc23e72488e8e5420acf9e` | Shown with the Alta team's OK in the Airwallex hackathon Slack, 14 Nov 2026 (confirmed by the project owner; screenshot kept by the owner). For the hackathon. No endorsement implied. |

No fill in the file (the site colours it with CSS): it draws black, on the neutral light tile. Details:
docs/evidence/logo-permissions.md.

## Airwallex, scaled copy, 20 November 2026

The site audit of 19 Nov (docs/evidence/site-quality.md, finding 4) found the 2435 × 334 wordmark (36,172 bytes) shown
at 102 × 14 px. The pages are now served a copy of the same artwork scaled to 3× that size; `airwallex.png` itself stays
here byte for byte. Resized only: not redrawn, not recoloured, not cropped, proportions kept.

| File | Made from | How | SHA-256 |
|---|---|---|---|
| airwallex-306x42.png | airwallex.png (`58f3984f…cd390e`) | ImageMagick 6.9.12: `convert airwallex.png -filter Lanczos -resize 306x42 -strip airwallex-306x42.png` (8,956 bytes, RGBA) | `8ff76b83dde9eeb49ef9e1602fa1547f21775233eccceda43541562355432817` |

Served as `/assets/logo-airwallex.png` (src/servers/dashboard.ts LOGOS) and, as a data URL, in Purser Cloud
(`npm run cloud:logos` writes cloud/src/awxLogo.gen.ts from it).

## Connections, 20 November 2026 (owner's statement of permission)

The owner asked for the real brand logos on Purser Cloud's Connections page and states he has permission (20 Nov 2026,
relayed by the orchestrator); no document is attached. Each file in `brands/` is kept byte for byte as fetched. Simple
Icons files (`si-*.svg`) are one-colour drawings released as CC0-1.0; `npm run cloud:logos` adds the brand's colour (from
Simple Icons' own data) as a `fill` on the `<svg>` element, the path unchanged, when it writes
`cloud/src/brandLogos.gen.ts`. Shown at mark size on a white tile beside the product's name, as a plain mark only, never as a
claim about the product's maker. A connection with no logo here (T:0, Peppol, ISO 20022, Purser's own API
pieces) keeps its letters or an icon.

| File | Source | Fetched | SHA-256 |
|---|---|---|---|
| chatgpt.svg | Wikimedia Commons, File:ChatGPT_logo.svg | 2026-11-20 | `5a8dad2864cc1c8109ebae74bea447df2f30b978bdad56749247c406e1cb2227` |
| exact.svg | exact.com, /media/templates/site/exact/images/favicon/favicon.svg (its own mark) | 2026-11-20 | `01429de2c8ef2d7372d547283983d93a6eccd839085a28895ee4533a0cde19df` |
| gmail.svg | Wikimedia Commons, File:Gmail_icon_(2020).svg | 2026-11-20 | `de129dff939c341be6bb561765719c95362f021db936e88a7455762e6887fb05` |
| google.svg | Wikimedia Commons, File:Google_"G"_logo.svg | 2026-11-20 | `ed9087d76cdc6d1c53698f6068f79872e77e87c8d012c0cfdad13b05b6ccb37c` |
| microsoft-teams.svg | Wikimedia Commons, File:Microsoft_Office_Teams_(2018–present).svg | 2026-11-20 | `b14fc21bf2ef061dd7960f7d40324319a204fbfa9ce3bbc46b114eb04691c51a` |
| microsoft.svg | Wikimedia Commons, File:Microsoft_logo.svg (the Microsoft four-square logo) | 2026-11-20 | `3d41251f93127b4b42c2f69fa423d204946cf9c307d786ea36b8d9bef4179282` |
| moneybird.svg | moneybird.nl, /assets/images/moneybird-logo-mark-blue.svg (the mark in its site header) | 2026-11-20 | `953f5de5795816f163c0e530abc596b5f05f825ec492b61fb7e32ac7a7cf6987` |
| si-apple.svg | Simple Icons 16.37.0 (npm simple-icons@16.37.0, icons/apple.svg), CC0-1.0 | 2026-11-20 | `2a1509dccd25e6d2bc7a11a8e52941077e1a48555e192ce638699b9f083c2a7c` |
| si-claude.svg | Simple Icons 16.37.0 (npm simple-icons@16.37.0, icons/claude.svg), CC0-1.0 | 2026-11-20 | `2d6fda79eb18ddccca35b799eeb3cece0dfabc22520ce3b10abd25668df9fa93` |
| si-cursor.svg | Simple Icons 16.37.0 (npm simple-icons@16.37.0, icons/cursor.svg), CC0-1.0 | 2026-11-20 | `71572a9be192cc069ec22b48d785e61d754eeed7edb7d082d615f6d5620f70ec` |
| si-googlegemini.svg | Simple Icons 16.37.0 (npm simple-icons@16.37.0, icons/googlegemini.svg), CC0-1.0 | 2026-11-20 | `a6228d8846040401e941a39ed17459785e8324dbb7b870ce84233c9b3e9863a0` |
| si-make.svg | Simple Icons 16.37.0 (npm simple-icons@16.37.0, icons/make.svg), CC0-1.0 | 2026-11-20 | `3985e5ed42709d253a772f99e56c5436af98c35d45bebc36b0aef29a9c9e7828` |
| si-modelcontextprotocol.svg | Simple Icons 16.37.0 (npm simple-icons@16.37.0, icons/modelcontextprotocol.svg), CC0-1.0 | 2026-11-20 | `4796bc576053cf2ae4724ea1813d9f4ec05bc671154abdd80a18b790613c7d81` |
| si-n8n.svg | Simple Icons 16.37.0 (npm simple-icons@16.37.0, icons/n8n.svg), CC0-1.0 | 2026-11-20 | `e4623cc1a840972dfb46ea368ceeb23e489111f64fba7312448cf7088cf9605e` |
| si-odoo.svg | Simple Icons 16.37.0 (npm simple-icons@16.37.0, icons/odoo.svg), CC0-1.0 | 2026-11-20 | `2690d23a9f3c287faa2fb08a7bd11002e309820e5a8c3ff53c0a77ab1081b50c` |
| si-python.svg | Simple Icons 16.37.0 (npm simple-icons@16.37.0, icons/python.svg), CC0-1.0 | 2026-11-20 | `a90c00fd441482b4867ad5d7fa68db56aab4891f1b1e6879fe1ea3b355cf378f` |
| si-quickbooks.svg | Simple Icons 16.37.0 (npm simple-icons@16.37.0, icons/quickbooks.svg), CC0-1.0 | 2026-11-20 | `e7500327cb68a95c2314cd3556cbd74ed011e8a00049c20da6110fd383271ab4` |
| si-typescript.svg | Simple Icons 16.37.0 (npm simple-icons@16.37.0, icons/typescript.svg), CC0-1.0 | 2026-11-20 | `7f023e8d1e767370306ec9437d2de5d5af97491d6208dd7799a3808a7c10a36a` |
| si-visa.svg | Simple Icons 16.37.0 (npm simple-icons@16.37.0, icons/visa.svg), CC0-1.0 | 2026-11-20 | `7cce4eea7b16b6eddf60d7d78b7b814d13ab3001bfa5e184480a7ff4a895e4ad` |
| si-whatsapp.svg | Simple Icons 16.37.0 (npm simple-icons@16.37.0, icons/whatsapp.svg), CC0-1.0 | 2026-11-20 | `8fb209a53a61618c3483594b3e070481a35575d6aaecbe00a6fe386670c8fb1c` |
| si-windsurf.svg | Simple Icons 16.37.0 (npm simple-icons@16.37.0, icons/windsurf.svg), CC0-1.0 | 2026-11-20 | `6a084cb5c1a82bbf3eeda54e3bf450bf8d4a9368d80b815db22116b6b00a2aae` |
| si-xero.svg | Simple Icons 16.37.0 (npm simple-icons@16.37.0, icons/xero.svg), CC0-1.0 | 2026-11-20 | `dd5e32b56b284d6cb642d0de47247793bd0714f095bbbd5a21491c0c578fbac8` |
| si-zapier.svg | Simple Icons 16.37.0 (npm simple-icons@16.37.0, icons/zapier.svg), CC0-1.0 | 2026-11-20 | `51fa9cca6198c74f924600e6972520541261e2f74ff80b6bec5bbd60a4bdcc73` |
| slack.svg | Wikimedia Commons, File:Slack_icon_2019.svg (Slack's 2019 mark) | 2026-11-20 | `17160477a475166ad0556e0028e3b0bd0634d70c02e7b920c04a4429ea184ab3` |
| vscode.svg | Wikimedia Commons, File:Visual_Studio_Code_1.35_icon.svg (Microsoft's VS Code icon) | 2026-11-20 | `4c4dd46cc5892a947901fbcdc96ee4caf4c9eb341779b2b0589d8a2bbff436ba` |
