// The Obsidian card art's builder (27 Nov, Max chose "Obsidian": near-black on black). It draws, once, every shape the
// agents' cards share, as one SVG <defs>: the ground, each agent's relief (Sourcing's leaves, Treasury's sea, Support's
// night sky, an engraved line field for any other agent), the diagonal band of light, the champagne medallion with its
// engraved quill, the chip, the wordmark, VISA, the frame and the sheen. Each card then is a few <use> of these plus its
// own words (cloud/src/agentCardArt.ts). Procedural, with fixed seeds: the same output every run, no randomness at run
// time. Not imported by the Worker: `npm run cloud:card-art` (cloud/scripts/cardArt.ts) writes its output to
// cloud/src/agentCardArt.gen.ts, and test/cloud-card-art.test.ts holds that file to this code.

const W = 428, H = 270;
const f1 = (n: number) => String(+n.toFixed(1));
const rnd = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const poly = (pts: [number, number][], close = false) => pts.map(([x, y], i) => `${i ? "L" : "M"}${f1(x)} ${f1(y)}`).join("") + (close ? "Z" : "");

/** Champagne and pewter metals, the chip's metal, VISA's silver. */
function metals(): string {
  const lin = (id: string, stops: [number, string][], x2 = 1, y2 = 0.35) =>
    `<linearGradient id="pc-${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join("")}</linearGradient>`;
  return lin("ch", [[0, "#9b8f78"], [0.22, "#e6dcc6"], [0.4, "#fbf6ea"], [0.55, "#c9bda4"], [0.75, "#efe6d2"], [1, "#a79a80"]])
    + lin("pw", [[0, "#8d9096"], [0.3, "#d9dbe0"], [0.5, "#f4f5f7"], [0.7, "#b4b7be"], [1, "#9ea1a8"]])
    + lin("cg", [[0, "#b9ae97"], [0.35, "#e2d8c3"], [0.55, "#f1ebde"], [0.8, "#c8bda6"], [1, "#a99d85"]], 1, 0.9)
    + lin("vs", [[0, "#fbfbfc"], [0.55, "#d5d7dc"], [1, "#9da1a9"]], 0, 1);
}

/** The ground (near-black, a soft light from the upper left), the band of light, the fade toward the upper left with a
 *  calm pool round VISA, the sheen. */
function grounds(): string {
  return `<radialGradient id="pc-gr" cx=".3" cy=".1" r="1.1"><stop offset="0" stop-color="#151517"/><stop offset=".6" stop-color="#09090a"/><stop offset="1" stop-color="#040404"/></radialGradient>`
    + `<linearGradient id="pc-bd" x1="0" y1="0" x2="1" y2="1"><stop offset=".38" stop-color="#000"/><stop offset=".52" stop-color="#fff"/><stop offset=".66" stop-color="#000"/></linearGradient>`
    + `<linearGradient id="pc-fd" x1=".05" y1=".05" x2=".85" y2=".9"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".45" stop-color="#fff" stop-opacity=".15"/><stop offset=".75" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff"/></linearGradient>`
    + `<radialGradient id="pc-cz" cx=".5" cy=".5" r=".5"><stop offset=".35" stop-color="#000"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>`
    + `<mask id="pc-band" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="url(#pc-bd)"/></mask>`
    + `<mask id="pc-fade" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="url(#pc-fd)"/><ellipse cx="${W - 64}" cy="${H - 40}" rx="76" ry="40" fill="url(#pc-cz)"/></mask>`
    + `<linearGradient id="pc-swg" x1="0" y1="0" x2="1" y2=".62"><stop offset=".32" stop-color="#fff" stop-opacity="0"/><stop offset=".46" stop-color="#fff" stop-opacity=".055"/><stop offset=".56" stop-color="#fff" stop-opacity="0"/></linearGradient>`
    + `<g id="pc-ground"><rect width="${W}" height="${H}" fill="url(#pc-gr)"/></g><g id="pc-sheen"><rect width="${W}" height="${H}" fill="url(#pc-swg)"/></g>`
    + `<g id="pc-frame"><rect x="8.5" y="8.5" width="${W - 17}" height="${H - 17}" rx="10" fill="none" stroke="url(#pc-ch)" stroke-width=".5" stroke-opacity=".28"/></g>`;
}

// ---- The reliefs: drawn in greys, so the card stays black on black; each card shows its relief twice, faintly and
// again where the band of light crosses it. ----

/** Sourcing: leaves of three shapes, a midrib and veins, growing in from the right and the bottom; the back ones softer. */
function leaves(): string {
  const r = rnd(5);
  let s = `<linearGradient id="pc-lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8a8f8a"/><stop offset=".45" stop-color="#4a4f4b"/><stop offset="1" stop-color="#1c1e1d"/></linearGradient>`;
  s += [11, 18, 7].map((w, i) => `<g id="pc-l${i}"><path d="M0 0C14 -${w} 44 -${w + 2} 64 0C44 ${w - 1} 14 ${w} 0 0Z" fill="url(#pc-lg)"/>`
    + `<path d="M0 0Q32 -2 64 0M14 -1L20 -${f1(w * .55)}M26 -1.4L33 -${f1(w * .6)}M38 -1.4L45 -${f1(w * .55)}M14 0L20 ${f1(w * .5)}M26 .2L33 ${f1(w * .55)}M38 .2L45 ${f1(w * .5)}" fill="none" stroke="#b9bdb8" stroke-opacity=".45" stroke-width=".4"/></g>`).join("");
  const leaf = (back: boolean) => {
    const fromRight = r() < 0.55;
    const x = fromRight ? W + 8 - r() * 64 : W * (0.3 + r() * 0.42), y = fromRight ? H * (0.08 + r() * 0.62) : H + 6 - r() * 34;
    const ang = fromRight ? 190 + r() * 60 : 215 + r() * 75, sc = 0.55 + r() * 0.75, k = (r() * 3) | 0, sy = sc * (0.8 + r() * 0.4);
    return `<use href="#pc-l${k}" transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(ang)}) scale(${f1(sc)} ${f1(sy)})"${back ? ` opacity="${f1(0.4 + r() * 0.3)}"` : ""}/>`;
  };
  return s + `<g id="pc-rel-leaves">${Array.from({ length: 24 }, () => leaf(true)).join("")}${Array.from({ length: 14 }, () => leaf(false)).join("")}</g>`;
}

/** Treasury: a sea of trochoid swells from the bottom right, each crest cut in a fine line with engraved lines beneath. */
function sea(): string {
  const r = rnd(3);
  let s = `<linearGradient id="pc-sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6d7372"/><stop offset=".35" stop-color="#383d3c"/><stop offset="1" stop-color="#111313"/></linearGradient><g id="pc-rel-sea">`;
  for (let b = 0; b < 7; b++) {
    const base = H * 0.44 + b * 21, amp = 6 + r() * 3.5, lam = W / (2.3 + r() * 1.3), ph = r() * Math.PI * 2;
    const pts: [number, number][] = [];
    for (let u = -Math.PI * 2; u <= (W / lam + 1) * Math.PI * 2; u += 0.3) {
      const x = (lam / (2 * Math.PI)) * (u - 0.62 * Math.sin(u + ph)) - lam * 0.3 * b / 7, y = base + amp * Math.cos(u + ph);
      if (x > -14 && x < W + 14) pts.push([x, y]);
    }
    const crest = poly(pts);
    s += `<path d="${crest}L${W + 14} ${H + 10}L-14 ${H + 10}Z" fill="url(#pc-sg)" opacity="${f1(0.55 + b * 0.06)}"/>`
      + `<defs><path id="pc-c${b}" d="${crest}"/></defs><g fill="none" stroke="#cfc6b2"><use href="#pc-c${b}" stroke-width=".8" stroke-opacity=".7"/>`
      + [2.4, 4.8, 7.4, 10.2, 13.2].map((o, i) => `<use href="#pc-c${b}" y="${o}" stroke-width=".4" stroke-opacity="${f1(0.4 - i * 0.07)}"/>`).join("") + `</g>`;
  }
  return s + `</g>`;
}

/** Support: a night sky: a soft glow, stars in three sizes (round dots of one path each), a few with a halo, a
 *  constellation in hairlines and an engraved crescent. */
function night(): string {
  const r = rnd(11);
  const dots = (n: number, x0: number, w: number) => Array.from({ length: n }, () => `M${f1(x0 + r() * w)} ${f1(r() * H)}h0`).join("");
  const C: [number, number][] = [[300, 70], [334, 92], [362, 84], [384, 112], [356, 140], [322, 128], [392, 160], [340, 190]];
  const glint = `<path id="pc-gl" d="M0 -4.5L.45 -.45L4.5 0L.45 .45L0 4.5L-.45 .45L-4.5 0L-.45 -.45Z" fill="#eef0f4"/>`;
  return `<radialGradient id="pc-ng" cx=".82" cy=".62" r=".7"><stop offset="0" stop-color="#5b6070" stop-opacity=".7"/><stop offset=".5" stop-color="#2a2d36" stop-opacity=".5"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>`
    + `<pattern id="pc-mh" width="1.4" height="1.4" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)"><path d="M0 .7H1.4" stroke="#dfe2e8" stroke-width=".45"/></pattern>`
    + `<mask id="pc-cm"><circle cx="372" cy="48" r="17" fill="#fff"/><circle cx="380" cy="42" r="15" fill="#000"/></mask>`
    + `<g id="pc-rel-night"><rect width="${W}" height="${H}" fill="url(#pc-ng)"/>`
    + `<path d="${dots(130, 0, W)}" stroke="#e6e8ee" stroke-width=".6" stroke-linecap="round" stroke-opacity=".7"/>`
    + `<path d="${dots(28, W * 0.45, W * 0.55)}" stroke="#f1f2f5" stroke-width="1.3" stroke-linecap="round"/>`
    + `<path d="${poly(C.slice(0, 6))}L${C[1]}M${C[4]}L${C[6]}L${C[7]}" fill="none" stroke="#d3d6de" stroke-width=".4" stroke-opacity=".6"/>`
    + `<defs>${glint}</defs>` + C.map(([x, y], i) => `<use href="#pc-gl" transform="translate(${x} ${y}) scale(${f1(0.6 + (i % 3) * 0.25)})"/>`).join("")
    + `<g mask="url(#pc-cm)"><circle cx="372" cy="48" r="17" fill="url(#pc-mh)"/><circle cx="372" cy="48" r="17" fill="none" stroke="#dfe2e8" stroke-width=".6"/></g></g>`;
}

/** Any other agent: a field of engraved waves, banknote style, swelling at the lower right. */
function lines(): string {
  // One wave of unit height (swelling toward the right), drawn 30 times: each a line down, its swell scaled by how near
  // it runs to the lower right; the stroke keeps its width under the scale.
  const g = (z: number) => Math.exp(-(z * z) / (2 * 0.34 * 0.34));
  const pts: [number, number][] = Array.from({ length: 61 }, (_, k) => { const x = (k / 60) * W; return [x, g(x / W - 0.78) * Math.sin(2.4 * 2 * Math.PI * (x / W))]; });
  const one = `<path id="pc-wv" d="${pts.map(([x, y], i) => `${i ? "L" : "M"}${f1(x)} ${y.toFixed(3)}`).join("")}" vector-effect="non-scaling-stroke"/>`;
  const uses = Array.from({ length: 30 }, (_, i) => { const y0 = (i + 0.5) * H / 30; return `<use href="#pc-wv" transform="translate(0 ${f1(y0)}) scale(1 ${f1(7 * g(y0 / H - 0.7))})"/>`; }).join("");
  return `<defs>${one}</defs><g id="pc-rel-lines" fill="none" stroke="#c9c2b2" stroke-width=".5">${uses}</g>`;
}

// ---- The medallion and its quill ----

/** The engraved quill: a curved tapering rachis with a bare calamus, asymmetric vanes of fine barbs angled toward the
 *  tip (the barbs are the hatching), one split in each vane, a lit edge and a highlight down the shaft. */
export function quill(o: { x: number; y: number; L: number; rot: number; n: number; w: number }): string {
  const { L, n, w } = o, b = L * 0.14, t0 = 0.2, ink = "url(#pc-ch)", edge = "#fffaf0";
  const S = (t: number): [number, number] => [b * t * t, -L * t];
  const T = (t: number): [number, number] => { const dx = 2 * b * t, dy = -L, m = Math.hypot(dx, dy); return [dx / m, dy / m]; };
  const vw = (u: number, wd: number) => wd * Math.min(1, Math.pow(u / 0.16, 0.6)) * (u > 0.62 ? Math.sqrt(Math.max(0, 1 - ((u - 0.62) / 0.38) ** 2)) : 1) * (1 - 0.12 * u);
  const side = (left: boolean) => {
    const wd = L * (left ? 0.17 : 0.11), split = left ? 0.44 : 0.62;
    let d = "";
    const ends: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n, t = t0 + u * (1 - t0), [px, py] = S(t), [tx, ty] = T(t);
      const nx = left ? ty : -ty, ny = left ? -tx : tx;
      let a = (36 + 12 * u) * Math.PI / 180;
      if (u > split && u < split + 0.09) a += (5 * (1 - (u - split) / 0.09)) * Math.PI / 180;
      const dx = nx * Math.cos(a) + tx * Math.sin(a), dy = ny * Math.cos(a) + ty * Math.sin(a), len = vw(u, wd) / Math.cos(a);
      const ex = px + dx * len, ey = py + dy * len;
      ends.push([ex, ey]);
      if (Math.abs(u - split) < 0.6 / n || len < 0.6) continue;
      d += `M${f1(px)} ${f1(py)}Q${f1(px + dx * len * 0.5 + tx * len * 0.09)} ${f1(py + dy * len * 0.5 + ty * len * 0.09)} ${f1(ex)} ${f1(ey)}`;
    }
    return { d, ends };
  };
  const lf = side(true), rt = side(false), tip = S(1), base = S(t0);
  const sil = poly([base, ...lf.ends, tip, ...rt.ends.slice().reverse()], true);
  const hw = (t: number) => (t < t0 ? 1.55 - 0.25 * (t / t0) : 1.3 * (1 - (t - t0) / (1 - t0)) + 0.18) * L / 100;
  const lft: [number, number][] = [], rgt: [number, number][] = [], hl: [number, number][] = [];
  for (let k = 0; k <= 22; k++) { const t = k / 22, [px, py] = S(t), [tx, ty] = T(t), h = hw(t); lft.push([px + ty * h, py - tx * h]); rgt.push([px - ty * h, py + tx * h]); }
  for (let k = 0; k <= 20; k++) { const t = 0.02 + k * 0.88 / 20, [px, py] = S(t), [tx, ty] = T(t), h = hw(t) * 0.35; hl.push([px + ty * h, py - tx * h]); }
  const all = [base, ...lf.ends, tip, ...rt.ends], m = [all.reduce((q, v) => q + v[0], 0) / all.length, (base[1] + tip[1]) / 2];
  const r = o.rot * Math.PI / 180, mx = m[0]! * Math.cos(r) - m[1]! * Math.sin(r), my = m[0]! * Math.sin(r) + m[1]! * Math.cos(r);
  return `<g transform="translate(${f1(o.x - mx)} ${f1(o.y - my)}) rotate(${o.rot})" fill="none" stroke-linecap="round">`
    + `<path d="${sil}" fill="#0b0b0d" stroke="none"/><path d="${lf.d}" stroke="${ink}" stroke-width="${w}"/><path d="${rt.d}" stroke="${ink}" stroke-width="${f1(w * 0.85)}" stroke-opacity=".7"/>`
    + `<path d="${poly(lf.ends.filter((_, i) => i % 2 === 0))}" stroke="${edge}" stroke-width=".35" stroke-opacity=".45"/>`
    + `<path d="${poly([...lft, ...rgt.reverse()], true)}" fill="${ink}" stroke="none"/><path d="${poly(hl)}" stroke="${edge}" stroke-width=".3" stroke-opacity=".7"/></g>`;
}

/** The medallion (an oval at the card's centre): a dark halo, the oval, a faint tint (the agent's accent, from the page's
 *  style: .pc-tint), a fine vignette of ovals, a pearled double rim in champagne; the quill on its own (pc-quill), so a
 *  company's own mark can take its place. */
const MX = 214, MY = 128, RX = 46, RY = 56;
function medallion(): string {
  const vign = Array.from({ length: 30 }, (_, i) => `<ellipse cx="${MX}" cy="${MY}" rx="${f1(RX - 5 - i * 1.35)}" ry="${f1(RY - 5 - i * 1.65)}"/>`).join("");
  return `<radialGradient id="pc-ha" cx=".5" cy=".5" r=".5"><stop offset=".72" stop-color="#000" stop-opacity=".7"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>`
    + `<radialGradient id="pc-vg" cx=".5" cy=".45" r=".6"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".75"/></radialGradient>`
    + `<clipPath id="pc-mo"><ellipse cx="${MX}" cy="${MY}" rx="${RX - 5}" ry="${RY - 5}"/></clipPath>`
    + `<g id="pc-medal"><ellipse cx="${MX}" cy="${MY}" rx="${RX + 22}" ry="${RY + 22}" fill="url(#pc-ha)"/><ellipse cx="${MX}" cy="${MY}" rx="${RX}" ry="${RY}" fill="#0b0b0d"/>`
    + `<ellipse class="pc-tint" cx="${MX}" cy="${MY}" rx="${RX}" ry="${RY}"/>`
    + `<g clip-path="url(#pc-mo)"><g fill="none" stroke="#a99f8a" stroke-width=".2" stroke-opacity=".3">${vign}</g><ellipse cx="${MX}" cy="${MY}" rx="${RX}" ry="${RY}" fill="url(#pc-vg)"/></g>`
    + `<g fill="none" stroke="url(#pc-ch)"><ellipse cx="${MX}" cy="${MY}" rx="${RX}" ry="${RY}" stroke-width="1.2"/><ellipse cx="${MX}" cy="${MY}" rx="${RX - 5}" ry="${RY - 5}" stroke-width=".5"/>`
    + `<ellipse cx="${MX}" cy="${MY}" rx="${RX - 2.5}" ry="${RY - 2.5}" stroke-width="1.2" stroke-dasharray=".01 2.35" stroke-linecap="round"/></g></g>`
    + `<g id="pc-quill">${quill({ x: MX, y: MY + 2 * RY / 66, L: RY * 1.52, rot: 30, n: 44, w: 0.52 })}</g>`;
}

/** The chip: small, flat champagne metal, a subtle gradient, thin contact lines; the wordmark; VISA as text. */
function chipAndWords(): string {
  const w = 36, h = 27, cx = w / 2, cy = h / 2, c = "rgba(70,58,38,.5)";
  return `<g id="pc-chip"><rect width="${w}" height="${h}" rx="5" fill="url(#pc-cg)"/><rect x=".3" y=".3" width="${w - .6}" height="${h - .6}" rx="4.8" fill="none" stroke="rgba(255,252,240,.55)" stroke-width=".4"/>`
    + `<g fill="none" stroke="${c}" stroke-width=".45"><rect x="${cx - 6}" y="${cy - 5}" width="12" height="10" rx="2.2"/>`
    + `<path d="M0 ${f1(h * .34)}H${cx - 6}M0 ${f1(h * .66)}H${cx - 6}M${cx + 6} ${f1(h * .34)}H${w}M${cx + 6} ${f1(h * .66)}H${w}M${cx} 0V${cy - 5}M${cx} ${cy + 5}V${h}"/>`
    + `<path d="M${cx - 6} ${cy}C${cx - 10} ${cy} ${cx - 11} ${f1(h * .34)} ${cx - 13} ${f1(h * .34)}M${cx + 6} ${cy}C${cx + 10} ${cy} ${cx + 11} ${f1(h * .66)} ${cx + 13} ${f1(h * .66)}" stroke-opacity=".7"/></g></g>`
    + `<g id="pc-word"><text x="${W / 2}" y="34" text-anchor="middle" font-family="Inter,Helvetica Neue,Arial,sans-serif" font-weight="600" font-size="10.5" letter-spacing="5.8" fill="url(#pc-ch)">PURSER</text></g>`;
}

/** Every shape the cards share, as one hidden SVG of <defs>: put on a page once, used by every card on it. */
export function cardArtDefs(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" id="pc-defs" class="pc-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>`
    + metals() + grounds() + leaves() + sea() + night() + lines() + medallion() + chipAndWords() + `</defs></svg>`;
}

/** The generated module's text (cloud/src/agentCardArt.gen.ts). */
export function cardArtGenSource(): string {
  return `// Generated by npm run cloud:card-art (cloud/scripts/cardArt.ts) from cloud/src/cardArtBuild.ts. Do not edit.
// The Obsidian card art's shared shapes (one hidden SVG of <defs>, fixed seeds): the ground, each agent's relief, the
// band of light, the medallion and its engraved quill, the chip, the wordmark, the frame and the sheen. A card is a few
// <use> of these and its own words (cloud/src/agentCardArt.ts).
export const CARD_ART_DEFS = ${JSON.stringify(cardArtDefs())};
`;
}
