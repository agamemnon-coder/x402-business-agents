Niet zelf plaatsen; Max plaatst dit.

---

Hi Metal and Airwallex teams! Thank you for the testnet and the sandbox. While building Purser (company cards and on-chain mandates for AI agents), we wrote down what we ran into. Each item has a short repro and where it is recorded in our repo:
`docs/feedback-for-metal-and-airwallex.md`

What mattered most:

• **Metal finality certificates:** testnet's validator BLS keys are not published, so we cannot verify the signature, and nodes keep certificates for only about 2 hours.
• **Metal clearing:** a lost answer holds the wallet until the same request is sent again, and `between_epochs` pauses make up most of our p95 (8.1 s over 2,000 payments).
• **Metal:** no send-policy contract is shipped, so we wrote one (MIT, happy to share).
• **Airwallex webhooks:** you can't add events to a subscription, so a new event means a new secret. `conversion.overdue` answered 401 for our scoped key.
• **Airwallex sandbox:** a single-use card closes a moment after the charge and refuses a status update in between. The SWIFT fee was 13.40 to 13.47, not the 12.85 in the kit.

Happy to go into detail!
