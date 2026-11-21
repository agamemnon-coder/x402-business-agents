// The site's wave (Max, 21 Nov: "take over those flows"), one module any page mounts: three silk ribbons of points in
// WebGL, perspective-projected (near points bigger and brighter, far ones fine and dim), each ribbon's rows fine lines
// of light, a bright crest and a soft glow under it, loose bokeh at the edges; a 2D canvas draws a simpler wave where
// WebGL is missing. The pointer and a dragging finger bulge it, a tap ripples it, the layers drift in parallax; it pauses
// off screen and in a hidden tab, and draws one still frame under prefers-reduced-motion. The canvas never takes a click.
//
// waveScript(o) is the script for one canvas (put it in the page's own script, under its CSP hash or nonce):
//   selector   the canvas
//   density    points, as a share of the default (about 40,000 on a laptop, 11,000 on a phone); default 1
//   intensity  brightness, as a share of the default; default 1
//   placement  "hero": calm behind a headline at the upper left; "page": strongest at the top, faint lower down
// WAVE_CANVAS_CSS gives a page-wide canvas (class "pw-wave") fixed behind the page's content.

export interface WaveOptions { selector: string; density?: number; intensity?: number; placement?: "hero" | "page" }

export const waveScript = (o: WaveOptions): string => `
(function () {
// The wave in WebGL (Max, 21 Nov: "take over those flows"): three silk ribbons of points, each a strip whose width
// turns as it runs, perspective-projected (near points bigger and brighter, far ones fine and dim), its rows fine lines
// of light; a bright crest where a ribbon turns edge-on, a soft glow under it, loose bokeh at the edges. Additive on a
// dark page, plain on a light one. Without WebGL, the 2D canvas below draws it.
(function () {
  var c = document.querySelector(${JSON.stringify(o.selector)}), mm = window.matchMedia;
  if (!c || !mm) return;
  var still = mm("(prefers-reduced-motion: reduce)").matches;
  var gl = null;
  try { gl = c.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: "high-performance" }); } catch (e) { gl = null; }
  if (!gl) { wave2d(); return; }
  var VS = [
    "precision highp float;",
    "attribute vec3 a;",
    "uniform float t, asp, dpr, glow, lite, sy, inten, place;",
    "uniform vec2 m, par;",
    "uniform vec4 r0, r1, r2;",
    "varying float vA; varying vec3 vC;",
    "float rip(vec4 r, vec2 p) { if (r.w < 0.5) return 0.0; float d = length((p - r.xy) * vec2(asp, 1.0)); float rad = r.z * 0.9; return exp(-(d - rad) * (d - rad) / 0.004) * (1.0 - r.z / 2.2); }",
    "void main() {",
    "  float id = floor(a.z), sd = fract(a.z), u = a.x, w = a.y;",
    "  vec3 P; float edge, fold, near = 0.0;",
    "  if (id < 2.5) {",
    "    float X = (u - 0.5) * 5.0, ph = id * 2.17;",
    "    float base = id < 0.5 ? -1.05 + 0.75 * u - 0.35 * sin(u * 3.1) : id < 1.5 ? -1.45 + 2.3 * u * u : 0.85 - 0.45 * u;",
    "    float Y = base + 0.2 * sin(X * 1.25 + t * 0.33 + ph) + 0.07 * sin(X * 3.1 - t * 0.47 + ph * 1.7);",
    "    float Z = 1.7 + 1.0 * sin(X * 0.75 + t * 0.21 + ph) + (id > 1.5 ? 1.4 : 0.0) - (id < 0.5 ? 0.9 * (1.0 - u) * (1.0 - u) : id < 1.5 ? 0.8 * u * u : 0.0);",
    "    float th = X * 1.05 + t * 0.38 + ph + 0.7 * sin(X * 0.6 + t * 0.17 + ph);",
    "    float wd = (id > 1.5 ? 0.55 : 1.5) * (0.7 + 0.3 * sin(X * 0.9 + ph + t * 0.1));",
    "    P = vec3(X, Y + w * wd * sin(th), Z + w * wd * cos(th));",
    "    edge = pow(abs(w), 10.0) * (w > 0.0 ? 1.0 : 0.45);",
    "    fold = 0.25 / (0.25 + abs(sin(th)));",
    "  } else {",
    "    P = vec3((u - 0.5) * 5.4 + 0.25 * sin(t * 0.05 + sd * 40.0), (w * 1.6) + 0.15 * sin(t * 0.07 + sd * 20.0), 0.6 + sd * 2.4);",
    "    edge = 0.0; fold = 0.0; near = 1.0;",
    "  }",
    "  float zz = P.z + 1.6;",
    "  vec2 q = vec2(P.x * 1.9 / zz + par.x * (2.0 / zz), (P.y * 1.9 / zz) * sy + par.y * (2.0 / zz));",
    "  vec2 dm = q - m; float dl = length(dm * vec2(asp, 1.0));",
    "  float bulge = exp(-dl * dl / 0.018);",
    "  q += normalize(dm + 0.0001) * bulge * 0.05;",
    "  float rr = rip(r0, q) + rip(r1, q) + rip(r2, q);",
    "  q += normalize(q - m + 0.0001) * rr * 0.03;",
    "  gl_Position = vec4(q, 0.0, 1.0);",
    "  float dep = clamp((zz - 2.2) / 3.2, 0.0, 1.0);",
    "  float hot = clamp(edge * fold * 1.3, 0.0, 1.0);",
    "  float a0 = near > 0.5 ? 0.05 + 0.12 * fract(sd * 7.0) : (1.7 + 1.2 * edge + 1.3 * hot + 0.4 * fold) * (0.45 + 0.55 * (0.55 + 0.45 * sin(a.x * 9.0 + id + t * 0.4))) * (1.0 - 0.65 * dep) * (id > 1.5 ? 0.5 : 1.0);",
    "  a0 *= 1.0 + bulge * 1.2 + rr * 2.0;",
    "  // Calm behind the headline (the upper left), the wave fully alive at the bottom and on the right.",
    "  float calm = smoothstep(-0.95, -0.55, q.x) * (1.0 - smoothstep(-0.2, 0.1, q.x)) * smoothstep(-0.25, 0.1, q.y);",
    "  a0 *= place < 0.5 ? 1.0 - 0.72 * calm : 0.25 + 0.75 * smoothstep(-0.2, 0.75, q.y);",
    "  a0 *= inten;",
    "  float sz = near > 0.5 ? (8.0 + 22.0 * fract(sd * 13.0)) : (2.1 + 1.8 * edge + 2.6 * hot) * (2.8 / zz);",
    "  if (glow > 0.5) { bool crestG = hot > 0.25; if (near > 0.5 || (!crestG && fract(sd * 31.0) > 0.12)) { gl_PointSize = 0.0; vA = 0.0; vC = vec3(0.0); return; } sz *= crestG ? 11.0 : 9.0; a0 *= crestG ? 0.022 : 0.045; }",
    "  gl_PointSize = sz * dpr;",
    "  vec3 vio = vec3(0.47, 0.30, 1.0), ind = vec3(0.28, 0.22, 0.92), mag = vec3(0.92, 0.30, 1.0), wht = vec3(1.0, 0.98, 1.0);",
    "  vec3 col = mix(vio, ind, dep);",
    "  col = mix(col, mag, smoothstep(0.45, 0.95, abs(q.x)) * 0.85 + (near > 0.5 ? 0.3 : 0.0));",
    "  col = mix(col, wht, clamp(hot * 1.4, 0.0, 1.0));",
    "  if (lite > 0.5) { col = mix(col * 0.75, vec3(0.42, 0.16, 0.85), 0.35); a0 *= 0.75; }",
    "  vA = a0; vC = col;",
    "}"].join("\\n");
  var FS = [
    "precision mediump float;",
    "varying float vA; varying vec3 vC;",
    "void main() { vec2 p = gl_PointCoord - 0.5; float d = length(p) * 2.0; if (d > 1.0) discard; float k = pow(1.0 - d, 1.6); float al = min(1.0, vA * k); gl_FragColor = vec4(vC * al, al); }"].join("\\n");
  function sh(type, src) { var x = gl.createShader(type); gl.shaderSource(x, src); gl.compileShader(x); return gl.getShaderParameter(x, gl.COMPILE_STATUS) ? x : null; }
  var vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) { wave2d(); return; }
  var pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { wave2d(); return; }
  gl.useProgram(pr);
  var U = {}; ["t", "asp", "dpr", "glow", "lite", "sy", "inten", "place", "m", "par", "r0", "r1", "r2"].forEach(function (n) { U[n] = gl.getUniformLocation(pr, n); });
  var buf = gl.createBuffer(), N = 0, W = 0, H = 0, dpr = 1, raf = 0, seen = true, t0 = performance.now() - 30000;
  var darkQ = mm("(prefers-color-scheme: dark)");
  function dark() { var at = document.documentElement.getAttribute("data-theme"); return at ? at === "dark" : darkQ.matches; }
  function rnd(i) { var v = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return v - Math.floor(v); }
  function scale() { var r = c.getBoundingClientRect(); return c.clientWidth ? r.width / c.clientWidth : 1; }
  // The points: per ribbon, rows across its width and columns along it; then the loose bokeh. As many as the screen
  // holds: about 40,000 on a laptop, about 11,000 on a phone.
  function build() {
    W = c.clientWidth; H = c.clientHeight;
    var phone = W < 700, z = scale() || 1;
    dpr = Math.min((window.devicePixelRatio || 1) * z, (phone ? 1.75 : 2) * Math.max(1, z));
    c.width = Math.max(1, Math.round(W * dpr)); c.height = Math.max(1, Math.round(H * dpr));
    var k = Math.max(0.35, Math.min(1.2, (W * H) / (1440 * 860))) * ${o.density ?? 1};
    var rows = [Math.round((phone ? 34 : 66) * Math.sqrt(k)), Math.round((phone ? 32 : 60) * Math.sqrt(k)), Math.round((phone ? 12 : 20) * Math.sqrt(k))];
    var cols = [Math.round((phone ? 220 : 540) * Math.sqrt(k)), Math.round((phone ? 200 : 500) * Math.sqrt(k)), Math.round((phone ? 120 : 300) * Math.sqrt(k))];
    var bokeh = phone ? 40 : 110, out = [], n = 0;
    for (var r = 0; r < 3; r++) for (var j = 0; j < rows[r]; j++) for (var i = 0; i < cols[r]; i++) { out.push(i / (cols[r] - 1) + (rnd(n) - 0.5) * 0.002, j / (rows[r] - 1) * 2 - 1, r + rnd(n * 3.1) * 0.999); n++; }
    for (var b = 0; b < bokeh; b++) { out.push(rnd(b * 5.7), rnd(b * 9.1) * 2 - 1, 3 + rnd(b * 2.3) * 0.999); n++; }
    N = n;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(out), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(pr, "a"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    gl.viewport(0, 0, c.width, c.height);
  }
  var mx = 9, my = 9, px = 9, py = 9, ripples = [], box = null;
  function frame(now) {
    raf = 0;
    var t = (now - t0) / 1000, D = dark();
    px += (mx - px) * 0.08; py += (my - py) * 0.08;
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, D ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1f(U.t, t); gl.uniform1f(U.asp, W / Math.max(1, H)); gl.uniform1f(U.dpr, dpr); gl.uniform1f(U.lite, D ? 0 : 1); gl.uniform1f(U.inten, ${o.intensity ?? 1}); gl.uniform1f(U.place, ${o.placement === "page" ? 1 : 0});
    gl.uniform1f(U.sy, Math.max(0.55, Math.min(1.4, (W / Math.max(1, H)) * 0.85)));
    var inside = px < 2;
    gl.uniform2f(U.m, inside ? px : 9, inside ? py : 9);
    gl.uniform2f(U.par, inside ? -px * 0.03 : 0, inside ? -py * 0.02 : 0);
    ripples = ripples.filter(function (r) { return t - r.t < 2.2; });
    [U.r0, U.r1, U.r2].forEach(function (u, k) { var r = ripples[k]; gl.uniform4f(u, r ? r.x : 0, r ? r.y : 0, r ? t - r.t : 0, r ? 1 : 0); });
    gl.uniform1f(U.glow, 1); gl.drawArrays(gl.POINTS, 0, N);
    gl.uniform1f(U.glow, 0); gl.drawArrays(gl.POINTS, 0, N);
    if (!still) go();
  }
  function go() { if (!raf && seen && !document.hidden) raf = requestAnimationFrame(frame); }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
  build();
  c.addEventListener("webglcontextlost", function (e) { e.preventDefault(); stop(); });
  c.addEventListener("webglcontextrestored", function () { build(); go(); });
  if ("ResizeObserver" in window) new ResizeObserver(function () { build(); if (still) frame(performance.now()); }).observe(c); else addEventListener("resize", build);
  if (still) { frame(performance.now()); return; }
  go();
  if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { seen = es[0].isIntersecting; if (seen) go(); else stop(); }).observe(c);
  document.addEventListener("visibilitychange", function () { if (document.hidden) stop(); else go(); });
  // The pointer or a finger, in the canvas's clip space; nothing here takes a click, a tap or a scroll.
  function at(x, y) { if (!box) box = c.getBoundingClientRect(); return [((x - box.left) / box.width) * 2 - 1, 1 - ((y - box.top) / box.height) * 2]; }
  function move(x, y) { var p = at(x, y); if (p[1] < -1 || p[1] > 1) { mx = my = 9; return; } mx = p[0]; my = p[1]; if (px > 2) { px = mx; py = my; } }
  addEventListener("pointermove", function (e) { if (e.pointerType === "mouse" || e.pointerType === "pen") move(e.clientX, e.clientY); }, { passive: true });
  addEventListener("pointerdown", function (e) { var p = at(e.clientX, e.clientY); if (p[1] >= -1 && p[1] <= 1) { ripples.push({ x: p[0], y: p[1], t: (performance.now() - t0) / 1000 }); if (ripples.length > 3) ripples.shift(); } }, { passive: true });
  var host = c.parentElement;
  if (host) {
    host.addEventListener("touchmove", function (e) { var p = e.touches[0]; if (p) move(p.clientX, p.clientY); }, { passive: true });
    host.addEventListener("touchend", function () { mx = my = 9; px = py = 9; }, { passive: true });
    host.addEventListener("mouseleave", function () { mx = my = 9; px = py = 9; });
  }
  addEventListener("scroll", function () { box = null; }, { passive: true });
  addEventListener("resize", function () { box = null; }, { passive: true });
})();
function wave2d() {
  var c = document.querySelector(${JSON.stringify(o.selector)}), mm = window.matchMedia;
  if (!c || !c.getContext || !mm) return;
  var g = c.getContext("2d");
  if (!g) return;
  // Under reduced motion: one still frame, drawn once, and nothing listens to the pointer.
  var still = mm("(prefers-reduced-motion: reduce)").matches;
  var host = c.parentElement, W = 0, H = 0, dpr = 1, z = 1, raf = 0, seen = true, t0 = performance.now() - 24000;
  var ribbons = [], sprites = {}, ripples = [];
  var mx = -1e4, my = -1e4, px = -1e4, py = -1e4, box = null;
  var darkQ = mm("(prefers-color-scheme: dark)");
  function dark() { var a = document.documentElement.getAttribute("data-theme"); return a ? a === "dark" : darkQ.matches; }
  // Glow sprites, drawn once: a sharp one (bright core, thin halo) for the near layer, a soft one (dim core, wide halo)
  // for the far layers, a wide haze for the crest's bloom and the travelling lens light.
  function sprite(rgb, core, halo) {
    var s = document.createElement("canvas"), n = 64; s.width = s.height = n;
    var x = s.getContext("2d"), gr = x.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    gr.addColorStop(0, "rgba(" + rgb + ",1)"); gr.addColorStop(core, "rgba(" + rgb + ",0.9)"); gr.addColorStop(halo, "rgba(" + rgb + ",0.22)"); gr.addColorStop(1, "rgba(" + rgb + ",0)");
    x.fillStyle = gr; x.fillRect(0, 0, n, n); return s;
  }
  function rnd(i) { var v = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return v - Math.floor(v); }
  function scale() { var r = c.getBoundingClientRect(); return c.clientWidth ? r.width / c.clientWidth : 1; }
  var D = true;
  function build() {
    W = c.clientWidth; H = c.clientHeight; z = scale() || 1;
    var phone = W < 700;
    // Sharp on every screen: the screen's own pixel ratio, capped at 3 (2 on a phone).
    dpr = Math.min((window.devicePixelRatio || 1) * z, (phone ? 2 : 3) * Math.max(1, z));
    c.width = Math.max(1, Math.round(W * dpr)); c.height = Math.max(1, Math.round(H * dpr));
    // As many points as the area holds, fewer on a small screen (a phone keeps its 60 frames a second).
    var k = Math.max(0.3, Math.min(1.15, (W * H) / (1440 * 820))) * (phone ? 0.8 : 1);
    D = dark();
    sprites = D
      ? { far: sprite("124,92,246", 0.05, 0.4), mid: sprite("176,160,255", 0.08, 0.32), near: sprite("246,244,255", 0.12, 0.26), warm: sprite("232,121,249", 0.06, 0.36), haze: sprite("139,92,246", 0.02, 0.3), lens: sprite("255,255,255", 0.04, 0.24) }
      : { far: sprite("167,139,250", 0.05, 0.4), mid: sprite("139,92,246", 0.08, 0.32), near: sprite("109,40,217", 0.14, 0.26), warm: sprite("192,132,252", 0.06, 0.36), haze: sprite("167,139,250", 0.02, 0.3), lens: sprite("196,181,253", 0.04, 0.24) };
    // A ribbon: its line (y at u = 0 and 1, as shares of the height), sway, thickness, direction; its layers far to near.
    ribbons = [
      { y0: 1.02, y1: 0.22, thick: 0.3, dir: 1, layers: [
        { rows: 14, cols: Math.round(170 * k), amp: 0.06, speed: 0.006, size: 3.4, a: 0.32, ph: 0, z: 0.6, s: "far", par: 0.35 },
        { rows: 11, cols: Math.round(130 * k), amp: 0.08, speed: 0.011, size: 2.6, a: 0.6, ph: 1.7, z: 0.85, s: "mid", par: 0.7 },
        { rows: 7, cols: Math.round(96 * k), amp: 0.1, speed: 0.017, size: 2.2, a: 0.95, ph: 3.1, z: 1.1, s: "near", par: 1.2 } ] },
      { y0: 0.52, y1: 0.02, thick: 0.16, dir: -1, layers: [
        { rows: 8, cols: Math.round(110 * k), amp: 0.05, speed: 0.005, size: 3.2, a: 0.26, ph: 4.2, z: 0.6, s: "warm", par: 0.3 },
        { rows: 5, cols: Math.round(80 * k), amp: 0.07, speed: 0.009, size: 2.4, a: 0.45, ph: 5.3, z: 0.85, s: "mid", par: 0.6 } ] }
    ];
    var id = 0;
    ribbons.forEach(function (R) { R.layers.forEach(function (L) { var n = L.rows * L.cols; L.vary = new Float32Array(n); L.spark = new Uint8Array(n);
      for (var i = 0; i < n; i++, id++) { L.vary[i] = 0.55 + rnd(id) * 0.9; L.spark[i] = rnd(id * 7.3) > 0.985 ? 1 : 0; } }); });
  }
  // The ribbon's centre line at u (no rows), for the crest's haze and the lens light.
  function crest(R, L, u, t) { return H * (R.y0 + (R.y1 - R.y0) * u) + H * L.amp * (Math.sin(u * 6.2 + t * 0.45 + L.ph) + 0.3 * Math.sin(u * 13 - t * 0.3 + L.ph)); }
  function frame(now) {
    raf = 0;
    var t = (now - t0) / 1000;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = D ? "lighter" : "source-over";
    px += (mx - px) * 0.1; py += (my - py) * 0.1;
    // Parallax: the layers drift a little with the pointer, the near ones most.
    var ox = px > -1e3 ? (px / W - 0.5) * 18 : 0, oy = py > -1e3 ? (py / H - 0.5) * 12 : 0;
    ripples = ripples.filter(function (r) { return t - r.t < 2.2; });
    // The lens light: one slow highlight that travels along the main ribbon.
    var uL = (t * 0.045) % 1, main = ribbons[0], mainL = main.layers[1];
    // The crest's haze: wide faint glows along the main ribbon's centre line.
    g.globalAlpha = D ? 0.06 : 0.05;
    for (var hq = 0; hq <= 28; hq++) { var hu = hq / 28, hx = (-0.08 + hu * 1.16) * W, hy = crest(main, mainL, hu, t), hr = H * 0.2 * (0.6 + 0.4 * Math.sin(hu * 5 + t * 0.3));
      g.drawImage(sprites.haze, hx - hr, hy - hr, hr * 2, hr * 2); }
    for (var q = 0; q < ribbons.length; q++) {
      var R = ribbons[q];
      for (var l = 0; l < R.layers.length; l++) {
        var L = R.layers[l], img = sprites[L.s], idx = 0, dx0 = ox * L.par, dy0 = oy * L.par;
        for (var r = 0; r < L.rows; r++) {
          var v = r / (L.rows - 1) - 0.5;
          for (var i = 0; i < L.cols; i++, idx++) {
            var u = ((i / L.cols + R.dir * t * L.speed + r * 0.013) % 1 + 1) % 1;
            var X = (-0.08 + u * 1.16) * W + dx0;
            var Y = crest(R, L, u, t) + dy0 + v * H * R.thick * L.z * (0.5 + 0.5 * Math.sin(u * 4.1 + t * 0.28 + L.ph)) * Math.cos(u * 3 + t * 0.35 + r * 0.15);
            var ex = X - px, ey = Y - py, dd = ex * ex + ey * ey;
            if (dd < 25600) { var e = Math.sqrt(dd) + 1, f = 1 - e / 160; f = f * f * 26 * L.z; X += ex / e * f; Y += ey / e * f; }
            for (var w = 0; w < ripples.length; w++) { var rp = ripples[w], age = t - rp.t, rad = age * 420, rx = X - rp.x, ry = Y - rp.y, de = Math.sqrt(rx * rx + ry * ry) + 1, band = 1 - Math.abs(de - rad) / 70;
              if (band > 0) { var p = band * band * 16 * (1 - age / 2.2) * L.z; X += rx / de * p; Y += ry / de * p; } }
            var lens = q === 0 ? Math.exp(-((u - uL) * (u - uL)) / 0.0018) : 0;
            var tw = L.spark[idx] ? 1.4 + 0.9 * Math.sin(t * 3 + idx) : 1;
            var a = L.a * L.vary[idx] * Math.min(1, u * 6, (1 - u) * 6) * (0.35 + 0.65 * Math.abs(Math.sin(u * 14 - t * 0.9 + r * 1.3 + L.ph))) * (1 - Math.abs(v) * 1.2) * (D ? 1 : 0.7) * (tw > 1 ? 1.6 : 1) * (1 + lens * 1.6);
            if (a < 0.025) continue;
            var sz = L.size * L.vary[idx] * tw * (L.spark[idx] ? 1.8 : 1) * (1 + lens * 0.6);
            g.globalAlpha = a > 1 ? 1 : a;
            g.drawImage(img, X - sz, Y - sz, sz * 2, sz * 2);
          }
        }
      }
    }
    // The lens light itself: a soft bloom where the highlight is on the crest.
    var lx = (-0.08 + uL * 1.16) * W + ox * 0.7, ly = crest(main, mainL, uL, t) + oy * 0.7, lr = Math.min(W, H) * 0.12, fade = Math.min(1, uL * 6, (1 - uL) * 6);
    g.globalAlpha = (D ? 0.35 : 0.25) * fade; g.drawImage(sprites.lens, lx - lr, ly - lr, lr * 2, lr * 2);
    g.globalAlpha = 1;
    if (!still) go();
  }
  function go() { if (!raf && seen && !document.hidden) raf = requestAnimationFrame(frame); }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
  build();
  if (still) { frame(performance.now()); if ("ResizeObserver" in window) new ResizeObserver(function () { build(); frame(performance.now()); }).observe(c); return; }
  go();
  if ("ResizeObserver" in window) new ResizeObserver(function () { build(); }).observe(c); else addEventListener("resize", build);
  if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { seen = es[0].isIntersecting; if (seen) go(); else stop(); }).observe(c);
  document.addEventListener("visibilitychange", function () { if (document.hidden) stop(); else go(); });
  darkQ.addEventListener && darkQ.addEventListener("change", build);
  // Under reduced motion the script returns at its start: the canvas is not drawn and the still gradient stands.
  // Where the pointer or a finger is, in the canvas's own pixels; nothing here prevents a click, a tap or a scroll.
  function at(x, y) { if (!box) box = c.getBoundingClientRect(); var s = box.width / (c.clientWidth || 1) || 1; return [(x - box.left) / s, (y - box.top) / s]; }
  function move(x, y) { var p = at(x, y); if (p[1] < 0 || p[1] > H) { mx = my = -1e4; return; } mx = p[0]; my = p[1]; if (px < -1e3) { px = mx; py = my; } }
  function ripple(x, y) { var p = at(x, y); if (p[1] >= 0 && p[1] <= H && ripples.length < 4) ripples.push({ x: p[0], y: p[1], t: (performance.now() - t0) / 1000 }); }
  addEventListener("pointermove", function (e) { if (e.pointerType === "mouse" || e.pointerType === "pen") move(e.clientX, e.clientY); }, { passive: true });
  addEventListener("pointerdown", function (e) { ripple(e.clientX, e.clientY); }, { passive: true });
  if (host) {
    host.addEventListener("touchmove", function (e) { var p = e.touches[0]; if (p) move(p.clientX, p.clientY); }, { passive: true });
    host.addEventListener("touchend", function () { mx = my = -1e4; px = py = -1e4; }, { passive: true });
    host.addEventListener("mouseleave", function () { mx = my = -1e4; px = py = -1e4; });
  }
  addEventListener("scroll", function () { box = null; }, { passive: true });
  addEventListener("resize", function () { box = null; }, { passive: true });
}
})();`;

/** A canvas behind a whole page (the console, /try, sign-in), fixed, under the content; the page lifts its content above. */
export const WAVE_CANVAS_HTML = `<canvas class="pw-wave" aria-hidden="true"></canvas>`;
export const WAVE_CANVAS_CSS = `
canvas.pw-wave { position: fixed; inset: 0; width: 100%; height: 100%; z-index: 0; pointer-events: none; opacity: .85;
  -webkit-mask-image: linear-gradient(180deg, #000 0%, rgba(0,0,0,.55) 55%, rgba(0,0,0,.25) 100%); mask-image: linear-gradient(180deg, #000 0%, rgba(0,0,0,.55) 55%, rgba(0,0,0,.25) 100%); }
@media print { canvas.pw-wave { display: none; } }
`;
