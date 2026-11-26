// The site's globe (26 Nov, Max: "make the globe a deliberate hero object"), one module the site (/business) and Purser
// Cloud's sign-in (cloud/src/signInLook.ts) both mount: an orthographic Earth on a 2D canvas, north up and tilted a
// little toward the viewer; a lit body, a fine graticule, the land as an even field of crisp dots shaded by the light
// and by depth (smaller and fainter toward the rim), an atmosphere and a lit rim; it turns slowly to and fro. The
// company's place pulses green; thin arcs rise from it to the other places, a light running along each; every place has
// a small label on a plate, placed clear of the words beside it and of the other labels, or not drawn. Under
// prefers-reduced-motion, or on a device too slow, it is drawn once and stands still; it pauses off screen and in a
// hidden tab. One canvas, no library, no image. 26 Nov, later (Max: "real time tracking of day and night"): the
// night side as it is now (subsolar, below), a soft warm twilight at the terminator, the land dimmer and cooler at
// night and the lights of large cities there; on the sign-in, stars behind it (dark only).
//
// globeScript(o) is the script for one canvas (put it in the page's own script, under its CSP hash or nonce):
//   selector  the canvas
//   avoid     the words in the canvas's parent the globe must stay clear of (a CSS selector): the globe is then the
//             largest circle beside or under them; without it, the largest circle in the canvas
//   maxR      the largest radius, in CSS pixels
//   places    [longitude, latitude, label, green]; the first green place is the origin of the arcs
// Only places the repository states (the callers say which).

/**
 * The land, roughly (longitude, latitude), for the dotted continents: hand-drawn outlines, coarse on purpose (a
 * picture, not a map); a dot on the sphere is land when it falls inside one of them.
 */
export const LAND: number[][][] = [
  // North America
  [[-168, 66], [-162, 70], [-156, 71], [-140, 70], [-128, 70], [-115, 68], [-100, 68], [-95, 72], [-85, 70], [-80, 66], [-75, 62], [-65, 60], [-60, 55], [-56, 52], [-60, 47], [-66, 44], [-70, 42], [-74, 40], [-76, 35], [-81, 31], [-80, 25], [-82, 27], [-84, 30], [-90, 29], [-97, 27], [-97, 22], [-95, 19], [-90, 21], [-87, 21], [-88, 16], [-84, 15], [-83, 10], [-79, 9], [-80, 7], [-85, 10], [-92, 14], [-100, 17], [-105, 20], [-110, 24], [-112, 29], [-115, 31], [-117, 32], [-120, 34], [-124, 40], [-124, 47], [-127, 51], [-133, 56], [-140, 60], [-150, 60], [-158, 57], [-165, 60]],
  // Arctic islands of Canada
  [[-120, 72], [-100, 74], [-85, 74], [-75, 78], [-90, 81], [-110, 78], [-122, 76]],
  // Greenland
  [[-73, 78], [-60, 82], [-35, 83], [-20, 80], [-20, 72], [-30, 68], [-42, 60], [-50, 62], [-55, 68], [-60, 75]],
  // South America
  [[-80, 9], [-75, 11], [-70, 12], [-62, 10], [-55, 6], [-50, 2], [-48, -1], [-40, -3], [-35, -6], [-35, -10], [-39, -15], [-40, -22], [-48, -26], [-53, -34], [-58, -38], [-62, -40], [-65, -45], [-68, -50], [-69, -55], [-73, -53], [-75, -46], [-73, -37], [-71, -30], [-71, -18], [-76, -14], [-81, -6], [-80, -2], [-78, 2], [-77, 7]],
  // Europe
  [[-10, 36], [-9, 43], [-2, 44], [-1, 46], [-5, 48], [2, 51], [5, 53], [8, 54], [8, 57], [10, 58], [5, 59], [5, 62], [12, 66], [18, 70], [26, 71], [31, 70], [40, 67], [44, 68], [50, 68], [60, 69], [60, 55], [50, 47], [40, 46], [37, 45], [30, 45], [28, 41], [26, 40], [23, 38], [20, 40], [19, 42], [13, 45], [16, 41], [16, 38], [12, 38], [10, 44], [7, 44], [3, 43], [0, 39], [-2, 37], [-6, 36]],
  // Great Britain, Ireland, Iceland
  [[-6, 50], [1, 51], [2, 53], [-1, 55], [-2, 58], [-5, 59], [-6, 56], [-5, 54], [-3, 52]],
  [[-10, 52], [-6, 52], [-6, 55], [-8, 55], [-10, 54]],
  [[-24, 64], [-14, 64], [-14, 66], [-22, 67]],
  // Africa, Madagascar
  [[-17, 21], [-16, 28], [-10, 30], [-6, 36], [0, 36], [10, 37], [11, 33], [20, 31], [25, 32], [32, 31], [34, 28], [38, 22], [43, 12], [51, 12], [50, 8], [45, 2], [40, -3], [40, -10], [35, -17], [35, -24], [32, -28], [27, -34], [20, -35], [18, -32], [15, -26], [12, -18], [13, -10], [12, -5], [9, -1], [9, 4], [5, 5], [0, 5], [-5, 5], [-8, 4], [-13, 8], [-17, 13]],
  [[44, -13], [50, -15], [50, -17], [47, -25], [44, -24], [43, -18]],
  // Asia, with Arabia and India
  [[26, 40], [28, 41], [30, 45], [37, 45], [40, 46], [50, 47], [60, 55], [60, 69], [70, 73], [80, 73], [90, 76], [100, 78], [110, 77], [120, 73], [130, 71], [140, 72], [150, 71], [160, 70], [170, 70], [180, 69], [180, 65], [175, 62], [165, 60], [160, 55], [157, 51], [155, 57], [150, 59], [142, 59], [136, 55], [140, 48], [135, 43], [130, 42], [128, 39], [126, 35], [126, 38], [122, 40], [121, 37], [119, 35], [122, 31], [120, 26], [117, 23], [110, 21], [108, 18], [106, 10], [104, 9], [101, 13], [100, 7], [104, 1], [101, 3], [98, 8], [98, 16], [94, 17], [92, 22], [88, 22], [85, 20], [80, 15], [80, 10], [77, 8], [73, 17], [72, 21], [67, 24], [62, 25], [57, 25], [56, 27], [52, 28], [48, 30], [50, 26], [52, 24], [56, 24], [59, 22], [55, 17], [52, 16], [45, 13], [43, 15], [40, 20], [36, 26], [34, 28], [35, 32], [36, 36], [30, 37]],
  // Japan, Sumatra, Borneo, Java, New Guinea, Sri Lanka, the Philippines
  [[130, 31], [132, 34], [135, 34], [140, 35], [141, 38], [142, 42], [145, 44], [141, 45], [140, 41], [136, 37], [133, 35], [130, 33]],
  [[95, 5], [98, 4], [104, -2], [106, -6], [102, -4], [96, 2]],
  [[109, 2], [111, -3], [116, -4], [118, 1], [117, 7], [113, 4]],
  [[105, -6], [114, -7], [114, -8], [106, -7]],
  [[131, -1], [138, -2], [146, -6], [150, -10], [142, -9], [138, -8], [132, -4]],
  [[80, 6], [82, 7], [81, 10], [79, 9]],
  [[120, 18], [122, 18], [124, 13], [126, 7], [122, 7], [121, 13]],
  // Australia, New Zealand
  [[114, -22], [114, -26], [115, -34], [118, -35], [124, -33], [129, -32], [134, -32], [138, -35], [140, -38], [146, -39], [150, -37], [153, -32], [153, -25], [150, -22], [146, -19], [143, -11], [141, -13], [141, -17], [137, -15], [136, -12], [132, -11], [129, -15], [125, -14], [122, -17], [118, -20]],
  [[172, -34], [178, -38], [175, -41], [172, -44], [167, -46], [170, -43], [174, -39]],
  // Antarctica's coast
  [[-180, -72], [-120, -73], [-60, -64], [-40, -78], [0, -70], [60, -67], [120, -66], [180, -72], [180, -90], [-180, -90]],
];

/**
 * The point on the Earth where the Sun stands overhead at a moment (ms since 1970, UTC): [longitude, latitude] in
 * degrees. The low-precision solar position (the Astronomical Almanac's, good to about 0.01 degrees of declination
 * and half a minute of time this century): the Sun's mean longitude and anomaly, its ecliptic longitude, the
 * obliquity; the declination is the latitude, and the longitude is where the apparent solar time is noon (UTC, less
 * the equation of time). SUBSOLAR_JS below is the same computation as plain JavaScript for the page's script; a test
 * holds the two equal (a function's own source text differs between compilers, which would change the page's bytes).
 */
export function subsolar(ms: number): [number, number] {
  const n = (ms - 946728000000) / 86400000, r = Math.PI / 180;
  const L = (280.46 + 0.9856474 * n) % 360, g = (357.528 + 0.9856003 * n) * r;
  const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * r, eps = (23.439 - 4e-7 * n) * r;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) / r;
  const eot = ((L - ra + 540) % 360) - 180;
  return [((720 - (((ms % 86400000) + 86400000) % 86400000) / 240000 - eot) % 360) - 180, Math.asin(Math.sin(eps) * Math.sin(lam)) / r];
}
/** subsolar() as plain JavaScript for the page's script, written out so the page is byte-identical whatever compiles this file. */
export const SUBSOLAR_JS = "function (ms) { var n = (ms - 946728000000) / 86400000, r = Math.PI / 180; var L = (280.46 + 0.9856474 * n) % 360, g = (357.528 + 0.9856003 * n) * r; var lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * r, eps = (23.439 - 4e-7 * n) * r; var ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) / r; var eot = ((L - ra + 540) % 360) - 180; return [((720 - (((ms % 86400000) + 86400000) % 86400000) / 240000 - eot) % 360) - 180, Math.asin(Math.sin(eps) * Math.sin(lam)) / r]; }";
/** The Sun's height above the horizon at a place and moment, in degrees (no refraction): above 0 is day. */
export function sunAltitude(lat: number, lon: number, ms: number): number {
  const [sl, sd] = subsolar(ms), r = Math.PI / 180;
  return Math.asin(Math.sin(lat * r) * Math.sin(sd * r) + Math.cos(lat * r) * Math.cos(sd * r) * Math.cos((lon - sl) * r)) / r;
}
/** Some of the world's large cities, for the lights on the night side: [longitude, latitude]. */
const CITIES = [[139.7, 35.7], [121.5, 31.2], [116.4, 39.9], [77.2, 28.6], [72.9, 19.1], [106.8, -6.2], [126.98, 37.57], [100.5, 13.8], [31.2, 30], [3.4, 6.5], [28, -26.2],
  [37.6, 55.8], [29, 41], [-0.1, 51.5], [2.35, 48.86], [13.4, 52.5], [4.9, 52.37], [-3.7, 40.4], [12.5, 41.9], [-74, 40.7], [-87.6, 41.9], [-118.2, 34.1], [-79.4, 43.7],
  [-99.1, 19.4], [-46.6, -23.5], [-58.4, -34.6], [-43.2, -22.9], [151.2, -33.9], [144.96, -37.8], [55.3, 25.2], [103.8, 1.35], [114.2, 22.3]];

export type GlobePlace = readonly [lon: number, lat: number, label: string, green: boolean];
export interface GlobeOptions {
  selector: string; avoid?: string; maxR?: number; places: readonly GlobePlace[];
  /** A small mono label at the top of the first arc (a route, as "AMS → SFO"). */ arcLabel?: string;
  /** The view: the longitude in the middle, the tilt (degrees, north toward the viewer when negative), the sway each way. */
  view?: readonly [lon: number, tilt: number, sway: number];
  /** A horizon, not a whole globe, the first entry whose minW the canvas's width reaches: the centre at x (a fraction of
   *  the width), the top of the disc at top (a fraction of the height), the radius r (a fraction of the width), at most
   *  rMax pixels, and the arcs' lift there if given. The canvas crops the disc. */
  horizon?: readonly (readonly [minW: number, x: number, top: number, r: number, rMax: number, lift?: number])[];
  /** Quieter: the land's dots at this share of their strength (1 is full). */ dim?: number;
  /** The arcs' lift above the sphere at their middle (a share of the radius; 0.5 by default). */ lift?: number;
  /** Draw the places' labels (by default, when the globe is large enough). */ labels?: boolean;
  /** Elements in the canvas's parent to draw a thin curve to from the first green place, each ending in its own colour
   *  (its computed background colour): a small "connected" picture. */ links?: string;
  /** Stars behind the Earth, in the dark only: their number on a large canvas, and the elements they keep clear of. */
  stars?: readonly [n: number, avoid: string];
}

export const globeScript = (o: GlobeOptions): string => `
(function () {
  var c = document.querySelector(${JSON.stringify(o.selector)}); if (!c || !c.getContext || !window.matchMedia) return;
  var g = c.getContext("2d"); if (!g) return;
  var LAND = ${JSON.stringify(LAND)}, PLACES = ${JSON.stringify(o.places)}, ARCL = ${JSON.stringify(o.arcLabel ?? "")}, AVOID = ${JSON.stringify(o.avoid ?? "")}, MAXR = ${o.maxR ?? 320};
  var VIEW = ${JSON.stringify(o.view ?? [-58, 20, 14])}, HOR = ${JSON.stringify(o.horizon ?? null)}, DIM = ${o.dim ?? 1}, LIFT = ${o.lift ?? 0.5}, LABELS = ${o.labels !== false}, LINKS = ${JSON.stringify(o.links ?? "")}, lk = [];
  // Day and night as they are now (subsolar, above): the Sun's direction, again each minute; the cities' lights at night.
  var SUN = ${SUBSOLAR_JS}, CITY = ${JSON.stringify(CITIES)}, STARS = ${JSON.stringify(o.stars ?? null)}, sunV = [1, 0, 0], sunAt = -1e9, sky = [], off = document.createElement("canvas"), og = off.getContext("2d"), oimg = null, OW = 0, OH = 0;
  var boxes = LAND.map(function (p) { var b = [999, 999, -999, -999]; p.forEach(function (q) { b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[0]); b[3] = Math.max(b[3], q[1]); }); return b; });
  function inside(p, x, y) { var o = false; for (var i = 0, j = p.length - 1; i < p.length; j = i++) { var a = p[i], b = p[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) o = !o; } return o; }
  function land(lon, lat) { for (var k = 0; k < LAND.length; k++) { var b = boxes[k]; if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue; if (inside(LAND[k], lon, lat)) return true; } return false; }
  // The view: by default centred on 58 degrees west (between the places), tilted 20 degrees, turning 14 degrees each way over 70 s.
  var D2R = Math.PI / 180, ROT = (VIEW[0] - 90) * D2R, SWAY = VIEW[2] * D2R, PERIOD = 70000, TILT = VIEW[1] * D2R, ct = Math.cos(TILT), st = Math.sin(TILT);
  var unit = function (lon, lat) { return [Math.cos(lon * D2R) * Math.cos(lat * D2R), Math.sin(lat * D2R), Math.sin(lon * D2R) * Math.cos(lat * D2R)]; };
  var GRID = [], gl, s3;
  for (var lo = -180; lo < 180; lo += 30) { gl = []; for (var la = -84; la <= 84; la += 3) { s3 = unit(lo, la); gl.push(s3[0], s3[1], s3[2]); } GRID.push(gl); }
  [-60, -30, 0, 30, 60].forEach(function (la) { gl = []; for (var lo2 = -180; lo2 <= 180; lo2 += 3) { s3 = unit(lo2, la); gl.push(s3[0], s3[1], s3[2]); } GRID.push(gl); });
  // The arcs: from the first green place to each other, a great circle lifted off the sphere in the middle.
  var ARCS = [], O = PLACES.filter(function (p) { return p[3]; })[0], lifted = -1;
  function arcs(lift) { if (lift === lifted) return; lifted = lift; ARCS = []; if (O) PLACES.forEach(function (p) { if (p === O) return; var a = unit(O[0], O[1]), b = unit(p[0], p[1]), d = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))), pts = [];
    for (var i = 0; i <= 48; i++) { var t = i / 48, sa = Math.sin((1 - t) * d) / Math.sin(d), sb = Math.sin(t * d) / Math.sin(d), h = 1 + lift * Math.sin(Math.PI * t); pts.push([(a[0] * sa + b[0] * sb) * h, (a[1] * sa + b[1] * sb) * h, (a[2] * sa + b[2] * sb) * h]); }
    ARCS.push(pts); }); }
  arcs(LIFT);
  CITY = CITY.map(function (q) { return unit(q[0], q[1]); });
  function night(d) { var x = d > 0.07 ? 0 : d < -0.15 ? 1 : (0.07 - d) / 0.22; return x * x * (3 - 2 * x); }
  var still = matchMedia("(prefers-reduced-motion: reduce)").matches, dark = matchMedia("(prefers-color-scheme: dark)");
  var pts = [], W = 0, H = 0, dpr = 1, raf = 0, seen = true, t0 = 0, lastF = 0, emaF = 0, nF = 0, txt = [], ink = [167, 139, 250], lite = false;
  var cx = 0, cy = 0, R = 0, at = null, body = null, rim = null, grid = null, col = "", sampled = 0, bk = []; for (var q0 = 0; q0 < 48; q0++) bk.push([]);
  var bg = null;
  function hex(v) { var m = /^#([0-9a-f]{6})$/i.exec((v || "").trim()); if (!m) return null; var n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function theme() { var cs = getComputedStyle(document.documentElement);
    ink = hex(cs.getPropertyValue("--accent")) || ink; bg = hex(cs.getPropertyValue("--bg"));
    var th = document.documentElement.getAttribute("data-theme"); lite = th === "light" || (th !== "dark" && !dark.matches); }
  function sample(n) {
    pts = []; sampled = n; var gold = Math.PI * (3 - Math.sqrt(5));
    for (var i = 0; i < n; i++) { var y = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(1 - y * y), th = i * gold, x = Math.cos(th) * r, z = Math.sin(th) * r;
      if (land(Math.atan2(z, x) / D2R, Math.asin(y) / D2R)) pts.push([x, y, z, (i * 9301 + 49297) % 233280 / 233280]); }
  }
  // Where the globe goes: with words to avoid, the larger of the free box right of them and the free box under them
  // (a little margin all round, room for the glow); else the canvas's own middle.
  function place() {
    var cr = c.getBoundingClientRect(), mg = W >= 700 ? 14 : 6; txt = [];
    if (AVOID && c.parentElement) c.parentElement.querySelectorAll(AVOID).forEach(function (e) { var r = e.getBoundingClientRect(); if (r.width && r.height) txt.push([r.left - cr.left - mg, r.top - cr.top - mg, r.right - cr.left + mg, r.bottom - cr.top + mg]); });
    var k = 1.16, pad = W >= 700 ? 20 : 8, best = null;
    function fit(x0, y0, x1, y1) { var w = x1 - x0, h = y1 - y0; if (w <= 0 || h <= 0) return; var r = Math.min(MAXR, Math.min(w, h) / 2 / k); if (!best || r > best[2]) best = [(x0 + x1) / 2, (y0 + y1) / 2, r]; }
    if (HOR) { var h0 = HOR.filter(function (x) { return W >= x[0]; })[0] || HOR[HOR.length - 1]; R = Math.min(h0[4], h0[3] * W); cx = h0[1] * W; cy = h0[2] * H + R; arcs(h0[5] != null ? h0[5] : LIFT); return; }
    if (txt.length) { var U = [1e9, 1e9, -1e9, -1e9]; txt.forEach(function (T) { U[0] = Math.min(U[0], T[0]); U[1] = Math.min(U[1], T[1]); U[2] = Math.max(U[2], T[2]); U[3] = Math.max(U[3], T[3]); });
      fit(U[2] + pad, pad, W - pad, H - pad); fit(pad, U[3] + pad, W - pad, H - pad); fit(pad, pad, U[0] - pad, H - pad); }
    else fit(pad, pad, W - pad, H - pad);
    if (!best) best = [W / 2, H / 2, 0];
    cx = best[0]; cy = best[1]; R = Math.max(0, best[2]);
  }
  function size() { var r = c.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1); W = Math.max(1, r.width); H = Math.max(1, r.height);
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); theme(); place(); lk = [];
    if (LINKS && c.parentElement) c.parentElement.querySelectorAll(LINKS).forEach(function (e) { var b = e.getBoundingClientRect(), m = /rgba?\\((\\d+), *(\\d+), *(\\d+)/.exec(getComputedStyle(e).backgroundColor);
      if (b.width) lk.push([b.left - r.left - 3, b.top - r.top + b.height / 2, m ? m[1] + "," + m[2] + "," + m[3] : ink.join(",")]); });
    var n = Math.max(2500, Math.min(HOR ? 60000 : 30000, Math.round(4 * Math.PI * R * R / 4.2))); if (Math.abs(n - sampled) > sampled * 0.15) sample(n);
    OW = Math.min(200, Math.ceil(W / 6)); OH = Math.max(1, Math.ceil(H * OW / W)); off.width = OW; off.height = OH; oimg = og && og.createImageData(OW, OH);
    // The stars: seeded, so the same sky each time; none on the Earth, near its limb, or on the elements named.
    sky = []; if (STARS && !lite) { var no = [], sd = 7; document.querySelectorAll(STARS[1]).forEach(function (e) { var b = e.getBoundingClientRect(); if (b.width) no.push([b.left - r.left - 24, b.top - r.top - 24, b.right - r.left + 24, b.bottom - r.top + 24]); });
      for (var k = 0, N = Math.min(STARS[0], Math.round(W * H / 2400)); k < N * 3 && sky.length < N; k++) { sd = (sd * 16807) % 2147483647; var sx = sd % 10007 / 10007 * W; sd = (sd * 16807) % 2147483647; var sy = sd % 10009 / 10009 * H, e2 = Math.hypot(sx - cx, sy - cy) - R, hid = e2 < 30;
        for (var b2 = 0; b2 < no.length && !hid; b2++) hid = sx > no[b2][0] && sx < no[b2][2] && sy > no[b2][1] && sy < no[b2][3];
        if (!hid) sky.push([sx, sy, 0.3 + (sd % 97) / 97 * (sd % 7 ? 0.45 : 0.9), (0.25 + (sd % 89) / 89 * 0.6) * Math.min(1, (e2 - 30) / (R * 0.12 + 60)), sd % 6 ? -1 : sd % 628 / 100]); } }
    col = "rgba(" + ink[0] + "," + ink[1] + "," + ink[2] + ",";
    at = g.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.2); at.addColorStop(0, col + (lite ? ".28)" : ".42)")); at.addColorStop(0.35, col + (lite ? ".1)" : ".16)")); at.addColorStop(1, col + "0)");
    if (HOR) { // a horizon: the body is the page's own ground, lit a little at the top, so the glow behind it reads as light from beyond the limb
      var b0 = bg || (lite ? [247, 246, 251] : [8, 10, 18]), mix = function (k) { return "rgba(" + [0, 1, 2].map(function (i) { return Math.round(b0[i] + (ink[i] - b0[i]) * k); }).join(",") + ",1)"; };
      body = g.createLinearGradient(0, cy - R, 0, cy - R + Math.min(H, R)); body.addColorStop(0, mix(lite ? 0.1 : 0.16)); body.addColorStop(0.3, mix(lite ? 0.03 : 0.05)); body.addColorStop(1, mix(0));
    } else { body = g.createRadialGradient(cx - R * 0.4, cy - R * 0.45, R * 0.05, cx, cy, R * 1.02); body.addColorStop(0, lite ? "rgba(255,255,255,1)" : "rgba(40,34,92,1)"); body.addColorStop(0.7, lite ? "rgba(241,238,253,1)" : "rgba(14,13,36,1)"); body.addColorStop(1, lite ? "rgba(226,220,250,1)" : "rgba(8,8,22,1)"); }
    grid = g.createRadialGradient(cx, cy, 0, cx, cy, R); grid.addColorStop(0, col + (lite ? ".26)" : ".22)")); grid.addColorStop(0.8, col + (lite ? ".14)" : ".12)")); grid.addColorStop(1, col + ".03)");
    if (HOR) { rim = g.createRadialGradient(cx, cy - R, 0, cx, cy - R, Math.max(W, H) * 0.7); rim.addColorStop(0, lite ? "rgba(255,255,255,.95)" : "rgba(236,230,255,.95)"); rim.addColorStop(0.25, col + (lite ? ".7)" : ".75)")); rim.addColorStop(1, col + "0)"); }
    else { rim = g.createLinearGradient(cx - R, cy - R, cx + R * 0.6, cy + R); rim.addColorStop(0, col + (lite ? ".7)" : ".95)")); rim.addColorStop(0.5, col + ".08)"); rim.addColorStop(1, col + ".3)"); }
  }
  // One point of the sphere (or above it) in the view: [x, y, z] with z toward the viewer.
  function view(p, cr, sr) { var x = p[0] * cr + p[2] * sr, z0 = -p[0] * sr + p[2] * cr; return [x, p[1] * ct - z0 * st, p[1] * st + z0 * ct]; }
  // Under the words: an arc passes behind them, never over them.
  function under(x, y) { for (var k = 0; k < txt.length; k++) { var T = txt[k]; if (x > T[0] && x < T[2] && y > T[1] && y < T[3]) return true; } return false; }
  function frame(now) {
    raf = 0;
    if (lastF && now - lastF < 400 && now > 2000) { var dtF = now - lastF; emaF = emaF ? emaF * 0.92 + dtF * 0.08 : dtF; if (++nF > 45 && emaF > 70) still = true; } lastF = now;
    if (!t0) t0 = now; var el = still ? 0 : now - t0;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    if (R < 16) return;
    var wide = R >= 90, rot = ROT + SWAY * Math.sin(el * 2 * Math.PI / PERIOD), cr = Math.cos(rot), sr = Math.sin(rot), i, v;
    for (i = 0; i < sky.length; i++) { var S = sky[i]; g.fillStyle = "rgba(226,222,255," + (S[3] * (S[4] < 0 ? 1 : 0.55 + 0.45 * Math.sin(el / 1400 + S[4]))).toFixed(3) + ")"; g.fillRect(S[0], S[1], S[2], S[2]); }
    g.fillStyle = at; g.beginPath(); g.arc(cx, cy, R * 1.2, 0, Math.PI * 2); g.fill();
    g.fillStyle = body; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    // The night side: the Sun's direction in the view, the shade drawn small and smoothly scaled (a soft twilight).
    if (now - sunAt > 60000) { sunAt = now; var s0 = SUN(Date.now()); sunV = unit(s0[0], s0[1]); }
    var sv = view(sunV, cr, sr);
    if (oimg) { var Dd = oimg.data, fx = W / OW, fy = H / OH, nc = lite ? [60, 44, 130, 72] : [2, 3, 12, 175], lc = lite ? [255, 255, 255, 150] : [ink[0], ink[1], ink[2], 78];
      for (var yy = 0; yy < OH; yy++) for (var xx = 0; xx < OW; xx++) { var dx = (cx - (xx + 0.5) * fx) / R, dy = (cy - (yy + 0.5) * fy) / R, r2 = dx * dx + dy * dy, dz = 0, o4 = (yy * OW + xx) * 4;
        if (r2 > 1) { r2 = Math.sqrt(r2); dx /= r2; dy /= r2; } else dz = Math.sqrt(1 - r2);
        var dd = dx * sv[0] + dy * sv[1] + dz * sv[2], nn = night(dd), tw = 4 * nn * (1 - nn) * 0.6, dc = nn > 0.02 ? nc : lc;
        Dd[o4] = dc[0] + (255 - dc[0]) * tw; Dd[o4 + 1] = dc[1] + (130 - dc[1]) * tw; Dd[o4 + 2] = dc[2] + (90 - dc[2]) * tw; Dd[o4 + 3] = nn > 0.02 ? Math.max(nc[3] * nn, 70 * tw) : lc[3] * Math.sqrt(Math.max(0, dd)); }
      og.putImageData(oimg, 0, 0); g.save(); g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip(); g.imageSmoothingEnabled = true; g.drawImage(off, 0, 0, W, H); g.restore(); }
    g.strokeStyle = grid; g.lineWidth = wide ? 0.7 : 0.5; g.beginPath();
    for (var L = 0; L < GRID.length; L++) { var line = GRID[L], pen = false;
      for (var m = 0; m < line.length; m += 3) { v = view([line[m], line[m + 1], line[m + 2]], cr, sr);
        if (v[2] <= 0) { pen = false; continue; } if (pen) g.lineTo(cx - v[0] * R, cy - v[1] * R); else { g.moveTo(cx - v[0] * R, cy - v[1] * R); pen = true; } } }
    g.stroke();
    // The land: lit from the upper left, smaller and fainter toward the rim, dimmer and cooler at night, in 3 x 16 buckets (one fill each).
    for (var q = 0; q < 48; q++) bk[q].length = 0;
    for (i = 0; i < pts.length; i++) {
      var p = pts[i]; v = view(p, cr, sr); var z = v[2];
      if (z <= 0.02 || (HOR && cy - v[1] * R > H + 2)) continue;
      var nt = night(p[0] * sunV[0] + p[1] * sunV[1] + p[2] * sunV[2]), lit = Math.max(0, 0.38 * v[0] + 0.42 * v[1] + 0.82 * z), a = ((lite ? 0.5 : 0.36) + 0.6 * lit) * (0.85 + 0.15 * p[3]) * Math.min(1, z * 3) * DIM * (1 - 0.55 * nt);
      var s = (wide ? 0.95 : 0.75) * (0.5 + 0.5 * z);
      bk[(nt > 0.5 ? 32 : !lite && lit > 0.8 ? 16 : 0) + (a >= 1 ? 15 : (a * 16) | 0)].push(cx - v[0] * R - s, cy - v[1] * R - s, s * 2);
    }
    for (q = 0; q < 48; q++) { var B = bk[q]; if (!B.length) continue; g.fillStyle = (q >= 32 ? (lite ? "rgba(70,62,150," : "rgba(118,126,226,") : q >= 16 ? "rgba(240,236,255," : (lite ? "rgba(" + Math.round(ink[0] * 0.62) + "," + Math.round(ink[1] * 0.5) + "," + Math.round(ink[2] * 0.85) + "," : col)) + (((q & 15) + 0.5) / 16).toFixed(3) + ")"; g.beginPath();
      for (var j = 0; j < B.length; j += 3) g.rect(B[j], B[j + 1], B[j + 2], B[j + 2]); g.fill(); }
    // The cities' lights on the night side: small and warm.
    for (i = 0; i < CITY.length; i++) { var C = CITY[i], cn = night(C[0] * sunV[0] + C[1] * sunV[1] + C[2] * sunV[2]); v = view(C, cr, sr); if (cn < 0.3 || v[2] < 0.08) continue;
      var lx2 = cx - v[0] * R, ly2 = cy - v[1] * R, f2 = cn * Math.min(1, v[2] * 3); if (ly2 > H + 4) continue;
      g.fillStyle = "rgba(255,170,90," + (0.16 * f2).toFixed(3) + ")"; g.beginPath(); g.arc(lx2, ly2, wide ? 4 : 2.6, 0, Math.PI * 2); g.fill();
      g.fillStyle = (lite ? "rgba(217,119,6," : "rgba(255,214,150,") + (0.9 * f2).toFixed(3) + ")"; g.beginPath(); g.arc(lx2, ly2, wide ? 1.3 : 0.9, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = rim; g.lineWidth = HOR ? 1.6 : wide ? 1.4 : 1; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    // The arcs: drawn where they are in front of the globe or off its disc, a light running along each.
    var green = lite ? "22,163,74" : "74,222,128", vio = lite ? "109,84,232" : "196,181,253";
    for (var A = 0; A < ARCS.length; A++) { var arc = ARCS[A], prev = null, run = still ? 0.6 : ((el / 4200) + A * 0.37) % 1;
      g.lineWidth = wide ? 1.5 : 1;
      for (i = 0; i < arc.length; i++) { v = view(arc[i], cr, sr); var ok = v[2] > 0 || Math.hypot(v[0], v[1]) > 1.0, X = cx - v[0] * R, Y = cy - v[1] * R;
        if (ok && under(X, Y)) ok = false;
        if (prev && ok && prev[2]) { var t = i / (arc.length - 1); g.strokeStyle = "rgba(" + (t < 0.5 ? green : vio) + "," + (0.55 + 0.4 * Math.sin(Math.PI * t)).toFixed(3) + ")"; g.beginPath(); g.moveTo(prev[0], prev[1]); g.lineTo(X, Y); g.stroke(); }
        prev = [X, Y, ok];
        if (ok && Math.abs(i / (arc.length - 1) - run) < 0.5 / (arc.length - 1)) { g.fillStyle = lite ? "rgba(109,84,232,.95)" : "rgba(255,255,255,.95)"; g.beginPath(); g.arc(X, Y, wide ? 2.2 : 1.6, 0, Math.PI * 2); g.fill(); }
      } }
    // The route's label at the top of the first arc, small and quiet, when it is in front and clear of the words.
    if (ARCL && ARCS.length && R >= 120) { v = view(ARCS[0][24], cr, sr); if (v[2] > 0 || Math.hypot(v[0], v[1]) > 1) { var ax = cx - v[0] * R, ay = cy - v[1] * R - 12, aw = 0, clear = true;
      g.font = "600 11px ui-monospace, SFMono-Regular, Menlo, monospace"; aw = g.measureText(ARCL).width;
      for (var t2 = 0; t2 < txt.length; t2++) { var T2 = txt[t2]; if (ax - aw / 2 < T2[2] && ax + aw / 2 > T2[0] && ay - 8 < T2[3] && ay + 8 > T2[1]) clear = false; }
      if (clear) { g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = lite ? "rgba(60,48,120,.75)" : "rgba(220,214,255,.72)"; g.fillText(ARCL, ax, ay); g.textAlign = "start"; } } }
    // The links: a thin curve from the first green place to each element named, a light running along each.
    if (O && lk.length) { v = view(unit(O[0], O[1]), cr, sr); if (v[2] > 0.06) { var ox = cx - v[0] * R, oy = cy - v[1] * R;
      for (var n2 = 0; n2 < lk.length; n2++) { var Q = lk[n2], mx = (ox + Q[0]) / 2, my = (oy + Q[1]) / 2 - Math.abs(Q[0] - ox) * 0.22 - (Q[1] - oy) * 0.15, lg = g.createLinearGradient(ox, oy, Q[0], Q[1]);
        lg.addColorStop(0, "rgba(" + green + ",.75)"); lg.addColorStop(1, "rgba(" + Q[2] + ",.7)"); g.strokeStyle = lg; g.lineWidth = 1.1; g.beginPath(); g.moveTo(ox, oy); g.quadraticCurveTo(mx, my, Q[0], Q[1]); g.stroke();
        var u2 = still ? 0.55 : ((el / 2800) + n2 * 0.27) % 1, w1 = 1 - u2; g.fillStyle = lite ? "rgba(" + Q[2] + ",1)" : "rgba(255,255,255,.95)"; g.beginPath();
        g.arc(w1 * w1 * ox + 2 * w1 * u2 * mx + u2 * u2 * Q[0], w1 * w1 * oy + 2 * w1 * u2 * my + u2 * u2 * Q[1], 1.6, 0, Math.PI * 2); g.fill(); } } }
    // The places: the green one pulses (still under reduced motion), each with a label on a plate, clear of the words.
    var pulse = still ? 0.45 : (el % 2400) / 2400, placed = [];
    g.font = "600 " + (R >= 140 ? 12 : 11) + "px Inter, system-ui, sans-serif"; g.textBaseline = "middle";
    for (var k2 = 0; k2 < PLACES.length; k2++) {
      var P = PLACES[k2]; v = view(unit(P[0], P[1]), cr, sr);
      if (v[2] <= 0.06) continue;
      var vx = cx - v[0] * R, vy = cy - v[1] * R, fade = Math.min(1, (v[2] - 0.06) / 0.2), rgb = P[3] ? green : vio;
      if (P[3]) { g.globalAlpha = fade * (1 - pulse); g.strokeStyle = "rgb(" + rgb + ")"; g.lineWidth = 1.5; g.beginPath(); g.arc(vx, vy, 4 + pulse * Math.min(16, R * 0.18), 0, Math.PI * 2); g.stroke();
        g.globalAlpha = fade; g.fillStyle = "rgba(" + rgb + ",.25)"; g.beginPath(); g.arc(vx, vy, 8, 0, Math.PI * 2); g.fill(); }
      g.globalAlpha = fade; g.fillStyle = lite ? "#fff" : "rgba(12,10,32,.95)"; g.beginPath(); g.arc(vx, vy, P[3] ? 5 : 4, 0, Math.PI * 2); g.fill();
      g.fillStyle = "rgb(" + rgb + ")"; g.beginPath(); g.arc(vx, vy, P[3] ? 3.5 : 2.8, 0, Math.PI * 2); g.fill();
      if (LABELS && R >= 80 && P[2]) {
        // Outward from the globe's middle first, then the other side, below, above; never on words or another label.
        var w = g.measureText(P[2]).width + 16, out = vx >= cx, tries = [[out ? vx + 12 : vx - 12 - w, vy], [out ? vx - 12 - w : vx + 12, vy], [vx - w / 2, vy + 22], [vx - w / 2, vy - 22]], lx = 0, ly = 0, fit = false;
        for (var u = 0; u < tries.length && !fit; u++) { lx = Math.max(12, Math.min(W - w - 12, tries[u][0])); ly = Math.max(14, Math.min(H - 14, tries[u][1])); var hit = false;
          for (var v1 = 0; v1 < placed.length; v1++) { var o2 = placed[v1]; if (lx < o2[0] + o2[2] + 4 && lx + w + 4 > o2[0] && Math.abs(ly - o2[1]) < 24) hit = true; }
          for (var v2 = 0; v2 < txt.length && !hit; v2++) { var T = txt[v2]; if (lx < T[2] && lx + w > T[0] && ly - 11 < T[3] && ly + 11 > T[1]) hit = true; }
          fit = !hit; }
        if (fit) { placed.push([lx, ly, w]);
          g.fillStyle = lite ? "rgba(255,255,255,.92)" : "rgba(14,12,34,.82)"; g.strokeStyle = "rgba(" + rgb + ",.45)"; g.lineWidth = 1; g.beginPath();
          if (g.roundRect) g.roundRect(lx + 0.5, ly - 10.5, w - 1, 21, 10.5); else g.rect(lx + 0.5, ly - 10.5, w - 1, 21); g.fill(); g.stroke();
          g.fillStyle = lite ? "#231d47" : "rgba(242,239,255,.96)"; g.fillText(P[2], lx + 8, ly + 0.5); }
      }
      g.globalAlpha = 1;
    }
    if (!still) go();
  }
  function go() { if (!raf && seen && !document.hidden && c.getClientRects().length) raf = requestAnimationFrame(frame); }
  size();
  if (still) { frame(performance.now()); if ("ResizeObserver" in window) new ResizeObserver(function () { size(); frame(performance.now()); }).observe(c); return; }
  go();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { size(); go(); });
  if ("ResizeObserver" in window) new ResizeObserver(function () { size(); go(); }).observe(c); else addEventListener("resize", function () { size(); go(); });
  if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { seen = es[0].isIntersecting; lastF = 0; if (seen) go(); }).observe(c);
  document.addEventListener("visibilitychange", function () { lastF = 0; go(); });
  dark.addEventListener && dark.addEventListener("change", function () { size(); go(); });
})();`;
