// The 30-second tour for the jury (master list line 349): at most four short steps, skippable at any step, shown once
// (the dismissal is remembered in localStorage inside try/catch: a private window simply shows it again). The why, in
// one sentence: limits in a prompt can be talked out of; signatures can't. Behind the switch `tour` (off when missing).
// Plain HTML and a script string; the page (lane B) places them. Words only, no figures: the numbers live on the screens.

export const TOUR_KEY = "purser-try-tour-seen";
export const TOUR_STEPS: readonly { title: string; text: string }[] = [
  { title: "Why", text: "Limits in a prompt can be talked out of. Signatures can't." },
  { title: "Your company", text: "A test company of your own on Purser's engine, with test money. Deleted after 24 hours." },
  { title: "The agents", text: "AI reads and checks the invoice. Purser's code checks it again." },
  { title: "Your signature", text: "Nothing is paid until your passkey signs the exact terms. Change one cent and it is refused." },
];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The tour's markup, hidden until TOUR_JS shows it (so a page with scripts off never shows a tour it cannot close). */
export function tourHtml(): string {
  const steps = TOUR_STEPS.map((s, i) => `<li data-step="${i}"${i ? " hidden" : ""}><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></li>`).join("");
  return `<aside id="tour" class="tour" role="dialog" aria-label="A 30-second tour" hidden><ol>${steps}</ol><p class="tour-nav"><button type="button" id="tour-next">Next</button> <button type="button" id="tour-skip" class="link">Skip</button></p></aside>`;
}

/** Shows the tour once; Next walks the steps, Skip or the last Next closes it and remembers that (where storage works). */
export const TOUR_JS = `
(function () {
  var KEY = ${JSON.stringify(TOUR_KEY)}, el = document.getElementById("tour");
  if (!el) return;
  function seen() { try { return localStorage.getItem(KEY) === "1"; } catch (e) { return false; } }
  function remember() { try { localStorage.setItem(KEY, "1"); } catch (e) { /* shown again next time */ } }
  if (seen()) return;
  var steps = el.querySelectorAll("li"), at = 0;
  function close() { el.hidden = true; remember(); }
  el.hidden = false;
  document.getElementById("tour-skip").addEventListener("click", close);
  document.getElementById("tour-next").addEventListener("click", function () {
    steps[at].hidden = true; at += 1;
    if (at >= steps.length) { close(); return; }
    steps[at].hidden = false;
    if (at === steps.length - 1) this.textContent = "Start";
  });
})();
`;
