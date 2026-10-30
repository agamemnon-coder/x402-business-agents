# Visa Trusted Agent Protocol and Visa Intelligent Commerce: can Purser use them? (research, 30 October 2026)

Research only: no code, no accounts, no credentials. Sources read on 30 October 2026.

**Verdicts.**
- **Trusted Agent Protocol (TAP): partly.** The spec and sample code are public: our agents can sign their HTTP requests
  per RFC 9421 with TAP's parameters and a demo merchant can verify them. They cannot become "Visa-trusted": that needs
  onboarding with Visa (the Visa Agent Registry Service); there is no public test key directory or TAP sandbox.
- **Visa Intelligent Commerce (VIC): not without a partnership.** Visa's docs say even sandbox access needs Visa's
  approval, Visa-provisioned credentials and about ten business days; nothing shows Airwallex Issuing cards are
  enrolled for it.

**TAP in short.** Launched 14 October 2025 with Cloudflare, built on HTTP Message Signatures (RFC 9421) and aligned with
Web Bot Auth ([press release](https://www.businesswire.com/news/home/20251014974512/en/Visa-Introduces-Trusted-Agent-Protocol-An-Ecosystem-Led-Framework-for-AI-Commerce),
[spec](https://developer.visa.com/docs/trusted-agent-protocol/trusted-agent-protocol-specifications.md)). The agent
signs `("@authority" "@path")` with `created`, `expires` (window at most 8 minutes), `keyid`, `alg` (Ed25519 in the
examples), `nonce` and `tag` (`agent-browser-auth` or `agent-payer-auth`); the merchant checks the fields, the window,
the nonce against replay, fetches the key by `keyid` and verifies. The signature does not cover the method, the body or
an amount. The reference code ([visa/trusted-agent-protocol](https://github.com/visa/trusted-agent-protocol), last
commit 28 October 2025) trusts only keys in its own local registry. Its licence is the Visa Developer Center terms plus
the [TAP product terms](https://developer.visa.com/docs/trusted-agent-protocol/product-terms.md) (revocable, strict
conformance, no Visa branding), not open source. Cloudflare's `web-bot-auth` (Apache-2.0) implements the same RFC.

**VIC in short.** Agentic tokens, purchase instructions with mandates, Visa payment passkeys, cryptograms and signals
([docs](https://developer.visa.com/docs/visa-intelligent-commerce.md)). Sandbox, certification and production each need
Visa's approval; the sample code ([visa/ai](https://github.com/visa/ai)) needs keys from VIC onboarding.

**The smallest honest build (only after Max's go).** TAP-spec signing, about 10 to 16 hours: an Ed25519 key per agent;
requests signed per RFC 9421 with TAP's parameters; our own key directory at
`/.well-known/http-message-signatures-directory`; a demo merchant that verifies (and refuses unsigned, expired,
replayed and tampered requests). Written ourselves or on `web-bot-auth`, not copied from Visa's sample. VIC: nothing
real can be integrated in time.

**Never claim:** "Visa-trusted", "registered with Visa", "TAP-certified", "verified against Visa's key directory",
"integrated with Visa Intelligent Commerce", Visa tokens, mandates or passkeys, Airwallex cards enrolled in VIC, or any
Visa logo. Safe wording: "Agents sign HTTP requests per RFC 9421 using the parameters from Visa's published Trusted
Agent Protocol spec; our demo merchant verifies them against our own key directory."

**Not verified:** Visa's production agent key directory URL; what `sandbox.api.visa.com/v1/trustedAgentProtocol`
does; whether Airwallex Issuing takes part in VIC; whether the Visa Developer Center sandbox is self-serve today.
