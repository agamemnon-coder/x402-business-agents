// Purser Cloud's signed-out screens (sign-in, first run, a passkey's enrolment), 21 Nov (the new direction: "premium
// enterprise layout, better balance and legibility, the passkey as the prominent primary action, minimal motion"). Only
// the look: the panel on the left gets an eyebrow, icon tiles for its three lines and a small picture of how a payment is
// approved (an agent proposes; within its limit it pays alone; above it the CFO approves with Face ID); the card gets
// more air, a larger passkey button and one line on what a passkey is. Scoped to .signed-out and written in the theme's
// own variables (var(--accent), var(--surface), …), so a new palette applies as it is. Nothing here moves but one slow
// glow, and not at all under prefers-reduced-motion. Authentication is unchanged: cloud/src/console.ts signInView.

export const SIGNIN_CSS = `
.signed-out .hero { position: relative; overflow: hidden; isolation: isolate; background:
  radial-gradient(70% 55% at 0% 0%, color-mix(in srgb, var(--accent) 15%, transparent), transparent 70%),
  radial-gradient(55% 45% at 100% 100%, color-mix(in srgb, var(--accent) 9%, transparent), transparent 70%),
  var(--sunken); }
.signed-out .hero::before { content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none;
  background-image: linear-gradient(color-mix(in srgb, var(--text) 5%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--text) 5%, transparent) 1px, transparent 1px);
  background-size: 32px 32px; -webkit-mask-image: radial-gradient(75% 65% at 35% 45%, #000, transparent); mask-image: radial-gradient(75% 65% at 35% 45%, #000, transparent); }
.signed-out .side { max-width: 460px; }
.signed-out .side .side-eb { display: inline-flex; align-items: center; gap: 8px; margin: 0 0 14px; padding: 5px 12px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border)); background: color-mix(in srgb, var(--accent) 9%, var(--surface)); color: var(--accent); font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
.signed-out .side h2 { font-size: clamp(30px, 2.5vw, 46px); line-height: 1.08; letter-spacing: -.03em; font-weight: 750; text-wrap: balance; }
.signed-out .side > p:not(.side-eb) { font-size: 17px; margin: 10px 0 26px; }
.signed-out .side ul { gap: 14px; }
.signed-out .side li { align-items: center; gap: 12px; font-size: 15.5px; }
.signed-out .side .si { flex: none; display: inline-grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; border: 1px solid color-mix(in srgb, var(--accent) 25%, var(--border)); background: color-mix(in srgb, var(--accent) 10%, var(--surface)); color: var(--accent); }
.signed-out .side .si .i { margin: 0; color: inherit; }
/* How a payment is approved: the agent's proposal, then its two ways, joined by a hairline. */
.signed-out .side-flow { margin: 30px 0 0; padding: 16px 16px 14px; border: 1px solid var(--border); border-radius: 16px; background: color-mix(in srgb, var(--surface) 78%, transparent); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); box-shadow: var(--shadow); }
.signed-out .side-flow figcaption { color: var(--faint); font-size: 11.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.signed-out .side-flow ol { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 8px; }
.signed-out .side-flow li { --lc: var(--muted); position: relative; display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 11px; border: 1px solid color-mix(in srgb, var(--lc) 28%, var(--border)); background: var(--surface); font-size: 14px; line-height: 1.35; color: var(--text); }
.signed-out .side-flow .si { width: 28px; height: 28px; border-radius: 8px; border-color: color-mix(in srgb, var(--lc) 30%, var(--border)); background: color-mix(in srgb, var(--lc) 12%, var(--surface)); color: var(--lc); }
.signed-out .side-flow .sf-alone { --lc: var(--ok); margin-left: 26px; } .signed-out .side-flow .sf-face { --lc: var(--accent); margin-left: 26px; }
.signed-out .side-flow .sf-alone::before, .signed-out .side-flow .sf-face::before { content: ""; position: absolute; left: -15px; top: -9px; width: 14px; height: calc(50% + 9px); border: solid var(--border); border-width: 0 0 1px 1px; border-bottom-left-radius: 8px; }
.signed-out .side-flow .sf-face::before { top: -60%; height: calc(110% + 0px); }
.signed-out .side-flow .sf-face { animation: sf-glow 6s ease-in-out infinite; }
@keyframes sf-glow { 0%, 60%, 100% { box-shadow: none; } 75% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 14%, transparent); } }
/* The card: more air, the passkey first and large, the guest way quiet below it. */
.signed-out .auth { border-radius: 20px; padding: 38px 38px 30px; box-shadow: 0 1px 2px rgba(16, 24, 40, .05), 0 28px 64px -28px rgba(16, 24, 40, .32); }
.signed-out .auth h1 { font-size: 30px; letter-spacing: -.025em; }
.signed-out .auth p.what { color: var(--muted); font-size: 15px; line-height: 1.55; }
.signed-out .auth .btn.primary.big { width: 100%; min-height: 54px; margin-top: 18px; border-radius: 12px; font-size: 16px; font-weight: 650; box-shadow: 0 12px 28px -12px color-mix(in srgb, var(--accent) 75%, transparent); transition: transform .15s ease, box-shadow .15s ease; }
.signed-out .auth .btn.primary.big:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 16px 32px -12px color-mix(in srgb, var(--accent) 85%, transparent); }
.signed-out .auth .btn.primary.big:focus-visible { outline: 3px solid color-mix(in srgb, var(--accent) 55%, transparent); outline-offset: 3px; }
.signed-out .auth .pk-note { display: flex; align-items: center; gap: 7px; margin: 10px 2px 0; font-size: 12.5px; line-height: 1.4; color: var(--muted); }
.signed-out .auth .pk-note .ic { flex: none; display: inline-flex; color: var(--ok); }
.signed-out .auth .pk-note .ic svg { width: 14px; height: 14px; }
.signed-out .auth .guest .btn.ghost { min-height: 46px; border-radius: 12px; }
.signed-out .trust { font-size: 12px; }
@media (max-width: 1023px) { .signed-out .side-flow, .signed-out .side .side-eb { display: none; } .signed-out .side h2 { font-size: 24px; } .signed-out .side > p:not(.side-eb) { margin: 4px 0 0; font-size: 15px; } }
@media (max-width: 640px) { .signed-out .auth { padding: 18px 18px 14px; border-radius: 16px; } .signed-out .auth h1 { font-size: 24px; } .signed-out .auth label { margin-top: 12px; } .signed-out .auth .btn.primary.big { min-height: 50px; margin-top: 12px; } .signed-out .auth .pk-note { margin-top: 6px; font-size: 12px; } .signed-out .auth .alt { margin-top: 10px; } .signed-out .auth .guest { margin-top: 8px; gap: 6px; } .signed-out .auth .guest .btn.ghost { min-height: 44px; } }
/* 4K (Max, 21 Nov: "razor-sharp at 4K"): a larger measure on very wide screens, never a narrow column. */
@media (min-width: 1920px) { .signed-out .side { max-width: 560px; } .signed-out .side li { font-size: 17px; } .signed-out .side-flow li { font-size: 15px; } .signed-out .auth { max-width: 520px; padding: 44px 44px 36px; } .signed-out .auth h1 { font-size: 34px; } }
@media (min-width: 2400px) { .signed-out .side, .signed-out .auth, .signed-out .trust { zoom: 1.3; } }
@media (min-width: 3200px) { .signed-out .side, .signed-out .auth, .signed-out .trust { zoom: 1.65; } }
@media (prefers-reduced-motion: reduce) { .signed-out .side-flow .sf-face, .signed-out .auth .btn.primary.big { animation: none; transition: none; } }
`;
