# Purser — Judge-first demo upgrade
_21 November 2026 · supplementary public demo, NOT a replacement for the submitted HackerEarth entry_

## Principle
**Show a financial control, not an AI light show.** The memorable moment is not "an agent can pay": it is **"the CFO signed EUR 1,850.00, and Purser refused EUR 1,850.01."**

The existing `/try` is a real, stateful test-money experience: it creates a temporary demo company, processes an invoice, checks policy, asks for a WebAuthn passkey when required, executes on a sandbox/simulated rail, and submits the changed payment through the existing engine for refusal. Preserve all of that. Visual motion must **never** substitute for the real engine response.

## One judge path — under two minutes when dependencies respond

1. **0–10 s — problem and promise.** Home: "AI agents spend. You sign off." Tap **Try it**. One small line: _Sandbox · test money · no real settlement._
2. **10–25 s — agent receives invoice.** Start a test company; choose the above-limit EUR 1,850.00 example. Show the actual invoice and supplier name.
3. **25–40 s — policy holds the line.** Purser validates supplier, limits, duplicates and the proposed payment. Be explicit when Claude read it versus when deterministic code handled it; do not stage fake "AI working" activity.
4. **40–60 s — approve exact terms.** The CFO's device passkey signs the canonical payment fields. The device may call this Face ID, Touch ID, Windows Hello or a security key: don't universally label it Face ID.
5. **60–75 s — test payment.** Show the sandbox/simulated result as it actually comes back, not an animation claiming a live production settlement.
6. **75–90 s — the punchline.** Tap **Now try to change it**. The amount is prefilled as EUR 1,850.01, while the retained signature covers EUR 1,850.00. Submit to the actual pay engine. Show the **refusal**, the changed field and fingerprints, and that the additional transfer count is zero.
7. **90–105 s — independently verify.** Open Proof/Verify and show the exact dated run and canonical terms proof. Label separately any client-side visual explanation versus an independent verification result.
8. **105–115 s — conclusion.** "Autonomous payments within CFO policy; exact-term authorization above it; verifiable evidence afterwards." One link to **Start a pilot**.

If the live service is unavailable, reveal that and switch to a clearly labelled **recorded run**—never pretend a recording is happening live.

## Product and visual design

- Use the same dark enterprise surface, sharp typography and calm violet highlights as the redesigned Home and Cloud. Don't insert gratuitous laptops, phones, lasers or robot avatars.
- The initial CTA stays a real button; **Guided tour** is an optional subtle link, not an autoplay.
- The progress rail exposes the next meaningful action, not a dense architecture lesson.
- During a real refusal, increase visual contrast **only after** the server answers `refused`.
- Keep the critical money figures and their sign/changed distinction legible on a 390 px phone and a 1440 px laptop.
- Animation should be decorative, low motion, pointer-events:none when in the background, and disabled by `prefers-reduced-motion`.
- Preserve authentication and passkey errors, the browser Back button, disabled states and retry behavior.

## Recorded video — supplementary 75–100 second film

### Opening (0–8 s)
Clean Purser wordmark, calm particle wave. Voiceover: "Your AI agents can handle supplier payments. But who controls the money?"

### Invoice and policy (8–30 s)
Use **real screen recordings** of the try company and the invoice. Minimal on-screen labels: **Invoice received**, **Policy verified**. Do not claim every invoice uses Claude if the code fallback processed it.

### Passkey (30–50 s)
Show the actual WebAuthn approval screen or a clearly labelled reenactment of a test passkey, with sensitive details redacted. Caption: **Exact terms, not a vague spending permission**.

### One-cent change (50–75 s)
Real screen capture: signed EUR 1,850.00 → attacker submits EUR 1,850.01 → Purser's engine says **Blocked · no additional payment**. This is the most important scene: leave room for viewers to read the refusal.

### Proof (75–90 s)
Show the published audit and verification records. Caption: **Every decision, traceable**. Finish: **Try the real sandbox · Purser Cloud · Built on Airwallex APIs (no endorsement implied)**.

Do not digitally fabricate passkey outcomes, provider API calls, audit results, or test counts. Use subtitles, smooth cuts and understated sound design, not over-edited "AI magic".

## P0 validation and production-quality checks

- [ ] `/try`, `/try?tour=1` return HTTP 200 and load matching current visual identity.
- [ ] Guided tour does nothing unless visitor clicks; auto-presses neither passkey nor payment.
- [ ] Customer can complete the complete above-limit scenario on Chrome + Safari/WebKit + Firefox where WebAuthn is supported; unsupported devices get clear fallback.
- [ ] Test genuine signature refusal, modified beneficiary/account, duplicate payment and retry/idempotency.
- [ ] Confirm no *additional* transfer after changed amount; the original legitimate test transfer may already be settled.
- [ ] Check desktop/phone, keyboard, light/dark, screen reader, and reduced motion.
- [ ] Compare logs, proof and captured film to exact build SHA.
- [ ] Keep locked HackerEarth submission unchanged. New YouTube or website media is supplementary.
- [ ] Obtain owner approval before merging or deploying.

## Owner and team responsibilities

**Claude:** integrate in the current frontend, test browser behavior, produce a staging URL and an actual screencast, resolve review findings.

**ChatGPT:** own the isolated demo presentation PR; review broken copy, architecture, policy/approval boundary and regression tests; write storyboards and concise captions.

**Owner:** confirm art direction, judge path, final video and release. No production funds without separate production gate.
