# Drafts for Max to send (Claude never sends them)

Quotes only with permission, with name and role; never anything confidential from an employer. Nothing goes in the deck
until a real answer is in.

## 1. Slack to the Metal team (block 1: passkeys as on-chain signers)

> Hi Metal team! Quick one from the Purser team (Kit 11). We want the CFO's and the controller's Face ID to be the
> actual on-chain owners of the business MetalAccount: two ERC-7913 signers (WebAuthn verifier ‖ P-256 key), threshold 2,
> so a mandate replace can't happen without both passkeys and there's no owner key on our server. On testnet the
> RIP-7212 precompile at 0x…0100 verifies P-256 fine, and `predictAccount` accepts the signer bytes. Two questions:
> (1) does MetalAccount validate ERC-7913 signers via `IERC7913SignatureVerifier.verify(key, hash, signature)`?
> (2) is there a WebAuthn verifier you already deploy or recommend on 63825? Thanks a lot!

## 2. DM to two or three finance people in your network

> Hi [name], I'm building Purser for a hackathon: AI agents that pay suppliers and refund customers on their own,
> inside limits the CFO sets; anything bigger needs the CFO's Face ID (and a second person's above €1,000). You can try
> it here, nothing to install: [link to /try]. One question: **would you use something like this, and what's missing
> before you would?** Two lines is plenty. Thanks!

## 3. Thank-you, asking to quote

> Thank you, this is really useful. Would you mind if I quote this in my submission ("What finance people said"), with
> your name and role? Only these words: "[quote]". Happy to leave the company out, or not quote at all; just say.
