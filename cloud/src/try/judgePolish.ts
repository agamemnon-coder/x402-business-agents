/**
 * Purser /try: award demo visual layer.
 *
 * Presentation only; never changes a signed payment, state transition, network
 * request, policy, payment response or proof value. Applies after existing styles.
 * The exact one-cent check remains the existing real engine call.
 */
export const JUDGE_DEMO_CSS = `
/* Restraint: financial controls should read like enterprise software, not a chatbot. */
body:not(.present):has(.screen.start) {
  background:
    radial-gradient(ellipse 58% 62% at 90% 18%, rgba(97, 75, 189, .16), transparent 72%),
    radial-gradient(ellipse 38% 42% at 7% 86%, rgba(79, 64, 150, .08), transparent 83%),
    var(--bg);
}
body:not(.present):has(.screen.start)::before {
  background:radial-gradient(circle,rgba(159,145,231,.22) .75px,transparent 1.5px) 0 0/26px 26px;
  opacity:.42;
}
body:not(.present) .screen.start .flow {
  border-color:color-mix(in srgb,var(--accent) 21%,var(--border));
  box-shadow:0 22px 55px -39px rgba(33,21,83,.66);
}
body:not(.present) .screen.start .fs {
  border-color:color-mix(in srgb,var(--accent) 10%,var(--border));
}
body:not(.present) .screen.start .fs.fend {
  border-color:color-mix(in srgb,var(--bad) 40%,var(--border));
}
body:not(.present) .screen.start .cta {
  gap:8px 16px;
}
body:not(.present) .screen.start .cta .btn.big {
  background:linear-gradient(114deg,#bfb2ff,#9588fa);
  color:#141022;
  border:1px solid #a99bff;
  box-shadow:0 9px 32px -16px rgba(111,83,209,.39);
  animation:none;
}
body:not(.present) .screen.start .cta .btn.big:hover {
  box-shadow:0 13px 38px -16px rgba(111,83,209,.47);
  transform:translateY(-1px);
}
body:not(.present) .screen.start .guided {
  display:inline-flex;
  gap:6px;
  align-items:center;
  min-height:44px;
  color:var(--accent);
  font-size:14px;
  font-weight:680;
  text-decoration:underline;
  text-underline-offset:4px;
  text-decoration-color:color-mix(in srgb,var(--accent) 48%,transparent);
}
body:not(.present) .screen.start .guided:hover {
  text-decoration-color:var(--accent);
}
body:not(.present) .screen.start .guided:focus-visible {
  outline:2px solid var(--accent);
  outline-offset:3px;
  border-radius:4px;
}
body:not(.present) .screen.books .cheat {
  border-color:color-mix(in srgb,var(--accent) 56%,var(--border));
  box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 12%,transparent);
}
body:not(.present) .screen.pay .refusal {
  border-color:color-mix(in srgb,var(--bad) 52%,var(--border));
  box-shadow:inset 3px 0 0 var(--bad);
}
body:not(.present) .screen.pay .refusal .head {
  color:var(--bad);
}
body:not(.present) .guide {
  background:color-mix(in srgb,var(--surface) 96%,#231d42);
  color:var(--text);
  border:1px solid color-mix(in srgb,var(--accent) 43%,var(--border));
  box-shadow:0 22px 64px -20px rgba(0,0,0,.58);
}
body:not(.present) .guide .btn.gnext {
  background:var(--accent);
  color:var(--bg);
}
@media(max-width:760px){
  body:not(.present) .screen.start .cta .guided { justify-content:center; }
  body:not(.present) .screen.start .flow { box-shadow:none; }
}
@media(prefers-reduced-motion:reduce) {
  body:not(.present) .screen.start .cta .btn.big,
  body:not(.present) .screen.start .fs,
  body:not(.present) .screen.start .fs .fi,
  body:not(.present) .screen.start .fs.fend,
  body:not(.present) .tour-hl,
  body:not(.present) .guide { animation:none!important; }
  body:not(.present) .screen.start .cta .btn.big:hover {transform:none}
}
`;
