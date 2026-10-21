// M&K hero: a photographic plate lit by a canvas engine.
// Sequence: edge outline scans out from the grille, a light sweep reveals the paint,
// LED strips flicker on, main beams ignite (bloom, anamorphic streak, floor reflections),
// then the chrome monogram and wordmark draw in above the car.
// Scene units are the plate's pixels (960 x 734); the logo sits above it at negative y.
(() => {
  const params = new URLSearchParams(location.search);
  const CAPTURE = params.has("capture");
  const VERTICAL = params.get("view") === "v";
  const CARD = params.has("card");
  const canvas = document.getElementById("scene");
  if (!canvas) return;
  if (CAPTURE) document.documentElement.classList.add("capture");
  const ctx = canvas.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- plate geometry (measured on the photo) ----------
  const PW = 960, PH = 734;
  const GRILLE = { x: 472, y: 330 };
  const LAMPS = [{ x: 240, y: 274 }, { x: 704, y: 274 }];
  const DRL = [
    new Path2D("M209 231 L262 266 Q273 273 272 284 L270 299"),
    new Path2D("M735 232 L677 268 Q666 276 668 286 L671 299"),
  ];
  const LEDS = [[218, 284.5], [229.5, 288], [240.5, 291.5], [252, 294.5], [690, 294.5], [702, 291.5], [713.75, 288], [724.5, 284.5]];
  const REFL = [1, 0, 0, -0.717, 0, 765.6]; // car point -> its reflection in the gloss floor
  const FLOOR = 408;

  // ---------- timeline (seconds) ----------
  const T_EDGE = 0.5, T_EDGE_END = 3.6, T_SWEEP = 3.0, T_SWEEP_LEN = 2.0;
  const T_DRL = 5.1, T_LAMP = 6.0, T_LOGO = 6.7, T_AMBIENT = 15, AMBIENT_EVERY = 11;

  const clamp = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const lerp = (a, b, k) => a + (b - a) * k;
  const inOut = k => { k = clamp(k); return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; };
  const out3 = k => 1 - Math.pow(1 - clamp(k), 3);
  const rng = seed => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  function drlLevel(t, t0) {
    const d = t - t0;
    if (d < 0) return 0;
    const steps = [[0.05, 1], [0.1, 0.06], [0.17, 0.9], [0.23, 0.12], [0.31, 1], [0.36, 0.35]];
    for (const [end, v] of steps) if (d < end) return v;
    return Math.min(1, 0.35 + (d - 0.36) * 3);
  }
  const lampLevel = t => {
    const d = t - T_LAMP;
    if (d < 0) return 0;
    if (d < 0.12) return (d / 0.12) * 1.8;
    return 1 + 0.8 * Math.exp(-(d - 0.12) * 2.4);
  };
  const exposure = t => (t < T_SWEEP ? 0 : t < T_LAMP ? 0.4 : 0.4 + 0.6 * out3((t - T_LAMP) / 1.6));
  const edgeAlpha = t => {
    if (t < T_EDGE) return 0;
    const fadeFrom = T_SWEEP + 0.9;
    return t < fadeFrom ? 1 : lerp(1, 0.1, out3((t - fadeFrom) / 2.4));
  };
  // diagonal sweep: returns the band centre (along x*.8 + y*.6) and its strength
  function sweepAt(t) {
    if (t >= T_SWEEP && t < T_SWEEP + T_SWEEP_LEN) return { c: lerp(-260, 1500, inOut((t - T_SWEEP) / T_SWEEP_LEN)), k: 1, intro: true };
    if (t >= T_AMBIENT) {
      const local = (t - T_AMBIENT) % AMBIENT_EVERY;
      if (local < 2.4) return { c: lerp(-260, 1500, inOut(local / 2.4)), k: 0.6, intro: false };
    }
    return null;
  }

  // ---------- offscreen helpers ----------
  const make = (w, h) => { const c = document.createElement("canvas"); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; };
  const plateC = make(PW, PH), plateX = plateC.getContext("2d");
  const maskC = make(PW, PH), maskX = maskC.getContext("2d");
  const ES = 2, EW = PW * ES, EH = PH * ES; // the outline is traced at double resolution
  const eMaskC = make(EW, EH), eMaskX = eMaskC.getContext("2d");
  let photo, edges, highlights;

  // Canny-style tracer: blur, gradient, thin to one-pixel ridges, then keep only
  // weak edges that connect to strong ones. Gives clean continuous lines, no JPEG speckle.
  function traceEdges(img) {
    const c = make(EW, EH), g = c.getContext("2d", { willReadFrequently: true });
    g.imageSmoothingQuality = "high"; g.drawImage(img, 0, 0, EW, EH);
    const src = g.getImageData(0, 0, EW, EH).data, N = EW * EH;
    let a = new Float32Array(N), b = new Float32Array(N);
    for (let i = 0, j = 0; i < N; i++, j += 4) a[i] = (0.2126 * src[j] + 0.7152 * src[j + 1] + 0.0722 * src[j + 2]) / 255;

    const K = [1, 6, 15, 20, 15, 6, 1].map(v => v / 64);
    for (let y = 0; y < EH; y++) for (let x = 0; x < EW; x++) {
      let s = 0;
      for (let k = -3; k <= 3; k++) { const xx = x + k < 0 ? 0 : x + k >= EW ? EW - 1 : x + k; s += a[y * EW + xx] * K[k + 3]; }
      b[y * EW + x] = s;
    }
    for (let y = 0; y < EH; y++) for (let x = 0; x < EW; x++) {
      let s = 0;
      for (let k = -3; k <= 3; k++) { const yy = y + k < 0 ? 0 : y + k >= EH ? EH - 1 : y + k; s += b[yy * EW + x] * K[k + 3]; }
      a[y * EW + x] = s;
    }

    const mag = new Float32Array(N), dir = new Uint8Array(N);
    for (let y = 1; y < EH - 1; y++) for (let x = 1; x < EW - 1; x++) {
      const i = y * EW + x;
      const gx = a[i - EW + 1] + 2 * a[i + 1] + a[i + EW + 1] - a[i - EW - 1] - 2 * a[i - 1] - a[i + EW - 1];
      const gy = a[i + EW - 1] + 2 * a[i + EW] + a[i + EW + 1] - a[i - EW - 1] - 2 * a[i - EW] - a[i - EW + 1];
      mag[i] = Math.sqrt(gx * gx + gy * gy);
      let ang = Math.atan2(gy, gx) * 57.2958; if (ang < 0) ang += 180;
      dir[i] = ang < 22.5 || ang >= 157.5 ? 0 : ang < 67.5 ? 1 : ang < 112.5 ? 2 : 3;
    }
    const OFF = [1, EW + 1, EW, EW - 1];
    const thin = b; thin.fill(0);
    for (let y = 1; y < EH - 1; y++) for (let x = 1; x < EW - 1; x++) {
      const i = y * EW + x, m = mag[i], o = OFF[dir[i]];
      if (m >= mag[i + o] && m > mag[i - o]) thin[i] = m;
    }

    const HI = 0.13, LO = 0.045, keep = new Uint8Array(N), stack = new Int32Array(N);
    for (let i = EW; i < N - EW; i++) {
      if (keep[i] || thin[i] < HI) continue;
      let sp = 0; stack[sp++] = i; keep[i] = 1;
      while (sp) {
        const p = stack[--sp];
        for (const q of [p - EW - 1, p - EW, p - EW + 1, p - 1, p + 1, p + EW - 1, p + EW, p + EW + 1])
          if (!keep[q] && thin[q] >= LO) { keep[q] = 1; stack[sp++] = q; }
      }
    }

    const out = g.createImageData(EW, EH);
    for (let i = 0; i < N; i++) {
      if (!keep[i]) continue;
      const y = i / EW / ES, fade = y < FLOOR ? 1 : 0.4 * (1 - (y - FLOOR) / (PH - FLOOR));
      const j = i * 4;
      out.data[j] = 214; out.data[j + 1] = 236; out.data[j + 2] = 255;
      out.data[j + 3] = clamp(0.6 + thin[i] * 1.6) * fade * 255;
    }
    const raw = make(EW, EH); raw.getContext("2d").putImageData(out, 0, 0);
    // soft halo under a crisp core so the lines read as smooth light, not pixels
    const soft = make(EW, EH), sx = soft.getContext("2d");
    if ("filter" in sx) { sx.filter = "blur(2px)"; sx.drawImage(raw, 0, 0); sx.drawImage(raw, 0, 0); sx.filter = "blur(0.7px)"; sx.drawImage(raw, 0, 0); sx.filter = "none"; }
    sx.globalCompositeOperation = "lighter"; sx.drawImage(raw, 0, 0);
    return soft;
  }

  function analyse(img) {
    const c = make(PW, PH), g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0, PW, PH);
    const src = g.getImageData(0, 0, PW, PH).data;
    const lum = new Float32Array(PW * PH);
    for (let i = 0, j = 0; i < lum.length; i++, j += 4) lum[i] = (0.2126 * src[j] + 0.7152 * src[j + 1] + 0.0722 * src[j + 2]) / 255;

    const h = g.createImageData(PW, PH);
    for (let y = 1; y < PH - 1; y++) {
      const fade = y < FLOOR ? 1 : 0.4 * (1 - (y - FLOOR) / (PH - FLOOR));
      for (let x = 1; x < PW - 1; x++) {
        const i = y * PW + x;
        const j = i * 4;
        const hl = clamp((lum[i] - 0.62) / 0.38);
        h.data[j] = src[j]; h.data[j + 1] = src[j + 1]; h.data[j + 2] = src[j + 2]; h.data[j + 3] = hl * fade * 255;
      }
    }
    edges = traceEdges(img);
    highlights = make(PW, PH); highlights.getContext("2d").putImageData(h, 0, 0);
    photo = make(PW, PH); photo.getContext("2d").drawImage(img, 0, 0, PW, PH);
  }

  // ---------- logo geometry ----------
  const SVGNS = "http://www.w3.org/2000/svg";
  const host = document.createElementNS(SVGNS, "svg");
  host.setAttribute("width", "0"); host.setAttribute("height", "0");
  host.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  document.body.appendChild(host);
  // Mark: a tuned power curve rising over the stock curve, like a dyno sheet.
  const MONO_SC = 1.0, MONO_CY = -150;
  const MONO_X = 480 - 150 * MONO_SC, MONO_Y = MONO_CY - 42 * MONO_SC;
  function sample(d, step = 1.5) {
    const p = document.createElementNS(SVGNS, "path");
    p.setAttribute("d", d); host.appendChild(p);
    const len = p.getTotalLength(), n = Math.max(2, Math.ceil(len / step)), pts = [];
    for (let i = 0; i <= n; i++) { const q = p.getPointAtLength((len * i) / n); pts.push([q.x * MONO_SC + MONO_X, q.y * MONO_SC + MONO_Y]); }
    p.remove();
    return pts;
  }
  const MONO = [
    { d: "M0 76 H300", kind: "axis", delay: 0, dur: 0.9 },
    { d: "M0 74 C50 72 90 66 130 54 C170 42 200 36 240 34 C265 33 285 36 300 40", kind: "stock", delay: 0.25, dur: 1.0 },
    { d: "M0 74 C45 71 80 60 120 42 C160 24 195 12 235 10 C262 9 284 14 300 20", kind: "tuned", delay: 0.75, dur: 1.2 },
  ].map(m => ({ ...m, pts: sample(m.d) }));
  const WORD_Y = -38, TAG_Y = -6;

  // ---------- atmosphere ----------
  const R = rng(7);
  const motes = Array.from({ length: 150 }, () => ({
    x: R() * 1500 - 270, y: R() * 1000 - 260, r: 0.6 + R() * 2.4,
    vx: (R() - 0.5) * 6, vy: -2 - R() * 5, ph: R() * 6.28, a: 0.25 + R() * 0.75,
  }));
  const sprite = make(64, 64);
  { const g = sprite.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.35, "rgba(220,236,255,.35)"); gr.addColorStop(1, "rgba(220,236,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }
  const grain = Array.from({ length: 4 }, (_, k) => {
    const c = make(192, 192), g = c.getContext("2d"), d = g.createImageData(192, 192), r = rng(31 + k);
    for (let i = 0; i < d.data.length; i += 4) { const v = r() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
    g.putImageData(d, 0, 0); return c;
  });

  // ---------- sizing ----------
  let W = 0, H = 0, emit, emitX, b1, b1X, b2, b2X, b3, b3X, grainPats = [];
  const hasFilter = "filter" in ctx;
  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = CAPTURE ? 1 : Math.min(window.devicePixelRatio || 1, 1.75);
    W = Math.max(2, Math.round(r.width * dpr)); H = Math.max(2, Math.round(r.height * dpr));
    canvas.width = W; canvas.height = H;
    emit = make(W / 2, H / 2); emitX = emit.getContext("2d");
    b1 = make(W / 8, H / 8); b1X = b1.getContext("2d");
    b2 = make(W / 24, H / 24); b2X = b2.getContext("2d");
    b3 = make(W / 64, H / 64); b3X = b3.getContext("2d");
    grainPats = grain.map(c => ctx.createPattern(c, "repeat"));
  }
  function view() {
    if (VERTICAL) return { cx: 480, cy: 360, vw: 980, vh: 1000 };
    return W / H < 0.85 ? { cx: 470, cy: 240, vw: 900, vh: 960 } : { cx: 472, cy: 226, vw: 860, vh: 965 };
  }

  // ---------- drawing pieces ----------
  function band(g, c, half, k, base = 0) {
    // linear gradient perpendicular to the sweep direction (.8, .6)
    const gr = g.createLinearGradient(0.8 * (c - half), 0.6 * (c - half), 0.8 * (c + half), 0.6 * (c + half));
    gr.addColorStop(0, `rgba(255,255,255,${base})`); gr.addColorStop(0.5, `rgba(255,255,255,${k})`); gr.addColorStop(1, "rgba(255,255,255,0)");
    return gr;
  }

  function maskedEdges(t, ringOnly) {
    // edges revealed by an ellipse growing out from the grille; ringOnly keeps just the travelling front
    const R0 = 1150 * out3((t - T_EDGE) / (T_EDGE_END - T_EDGE));
    const maskX = eMaskX;
    maskX.globalCompositeOperation = "source-over"; maskX.globalAlpha = 1;
    maskX.setTransform(1, 0, 0, 1, 0, 0); maskX.clearRect(0, 0, EW, EH);
    maskX.drawImage(edges, 0, 0);
    if (R0 >= 1149 && !ringOnly) return eMaskC;
    maskX.globalCompositeOperation = "destination-in";
    maskX.setTransform(ES, 0, 0, ES, 0, 0);
    maskX.translate(GRILLE.x, GRILLE.y); maskX.scale(1.55, 1);
    const r = Math.max(R0, 1);
    const gr = maskX.createRadialGradient(0, 0, 0, 0, 0, r);
    if (ringOnly) { gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(Math.max(0, 1 - 110 / r), "rgba(0,0,0,0)"); gr.addColorStop(Math.max(0, 1 - 18 / r), "rgba(0,0,0,1)"); gr.addColorStop(1, "rgba(0,0,0,0)"); }
    else { gr.addColorStop(0, "#000"); gr.addColorStop(Math.max(0, 1 - 70 / r), "#000"); gr.addColorStop(1, "rgba(0,0,0,0)"); }
    maskX.fillStyle = gr; maskX.fillRect(-1200, -1200, 2400, 2400);
    maskX.setTransform(1, 0, 0, 1, 0, 0); maskX.globalCompositeOperation = "source-over";
    return eMaskC;
  }

  function renderPlate(t) {
    const base = exposure(t);
    if (base <= 0) return null;
    const sw = sweepAt(t);
    plateX.globalCompositeOperation = "source-over"; plateX.clearRect(0, 0, PW, PH);
    plateX.drawImage(photo, 0, 0);
    plateX.globalCompositeOperation = "destination-in";
    if (sw && sw.intro) {
      const c = sw.c, gr = plateX.createLinearGradient(0.8 * (c - 600), 0.6 * (c - 600), 0.8 * (c + 120), 0.6 * (c + 120));
      gr.addColorStop(0, `rgba(0,0,0,${base})`); gr.addColorStop(520 / 720, `rgba(0,0,0,${base})`);
      gr.addColorStop(600 / 720, "rgba(0,0,0,1)"); gr.addColorStop(1, "rgba(0,0,0,0)");
      plateX.fillStyle = gr;
    } else plateX.fillStyle = `rgba(0,0,0,${base})`;
    plateX.fillRect(0, 0, PW, PH);
    plateX.globalCompositeOperation = "source-over";
    return plateC;
  }

  function glints(t) {
    const sw = sweepAt(t);
    if (!sw) return null;
    maskX.setTransform(1, 0, 0, 1, 0, 0); maskX.globalCompositeOperation = "source-over"; maskX.globalAlpha = 1;
    maskX.clearRect(0, 0, PW, PH); maskX.drawImage(highlights, 0, 0);
    maskX.globalCompositeOperation = "destination-in";
    maskX.fillStyle = band(maskX, sw.c, 110, sw.k); maskX.fillRect(0, 0, PW, PH);
    maskX.globalCompositeOperation = "source-over";
    return maskC;
  }

  function lights(g, t, scale, crisp) {
    // DRL strips, LED dots and lamp cores, drawn for the car and again for its reflection
    const dl = drlLevel(t, T_DRL), dr = drlLevel(t, T_DRL + 0.08), L = lampLevel(t);
    const pass = refl => {
      const k = refl ? 0.42 : 1;
      g.lineCap = "round"; g.lineJoin = "round";
      DRL.forEach((p, i) => {
        const lv = (i ? dr : dl) * k;
        if (lv <= 0) return;
        if (crisp) { g.strokeStyle = `rgba(255,255,255,${lv})`; g.lineWidth = 1.7; g.stroke(p); }
        else { g.strokeStyle = `rgba(190,226,255,${lv})`; g.lineWidth = 5; g.stroke(p); g.strokeStyle = `rgba(255,255,255,${lv})`; g.lineWidth = 2.2; g.stroke(p); }
      });
      const led = Math.min(1, L) * k;
      if (led > 0) {
        g.fillStyle = `rgba(255,255,255,${led})`;
        for (const [x, y] of LEDS) { g.beginPath(); g.arc(x, y, crisp ? 2.6 : 4.2, 0, 6.283); g.fill(); }
        if (!crisp) for (const lp of LAMPS) {
          const gr = g.createRadialGradient(lp.x, lp.y + 12, 0, lp.x, lp.y + 12, 40);
          gr.addColorStop(0, `rgba(235,246,255,${0.42 * Math.min(L, 1.4) * k})`); gr.addColorStop(1, "rgba(150,200,255,0)");
          g.fillStyle = gr; g.fillRect(lp.x - 60, lp.y - 48, 120, 120);
        }
      }
    };
    pass(false);
    g.save(); g.transform(...REFL); pass(true); g.restore();
  }

  function monogram(g, t, glow) {
    const d = t - T_LOGO;
    if (d <= 0) return;
    const top = MONO_Y + 8 * MONO_SC, bot = MONO_Y + 76 * MONO_SC;
    g.lineCap = "round"; g.lineJoin = "round";
    for (const s of MONO) {
      if (glow && s.kind !== "tuned") continue;
      const k = inOut((d - s.delay) / s.dur);
      if (k <= 0) continue;
      const n = Math.max(1, Math.floor(k * (s.pts.length - 1)));
      g.beginPath(); g.moveTo(s.pts[0][0], s.pts[0][1]);
      for (let i = 1; i <= n; i++) g.lineTo(s.pts[i][0], s.pts[i][1]);
      if (glow) { g.strokeStyle = "rgba(200,230,255,.55)"; g.lineWidth = 4; }
      else if (s.kind === "axis") { g.strokeStyle = "rgba(60,70,82,.9)"; g.lineWidth = 1; }
      else if (s.kind === "stock") { g.strokeStyle = "rgba(110,122,136,.9)"; g.lineWidth = 1.6; }
      else {
        const gr = g.createLinearGradient(MONO_X, 0, MONO_X + 300 * MONO_SC, 0);
        gr.addColorStop(0, "#6c7783"); gr.addColorStop(0.6, "#e9eef4"); gr.addColorStop(1, "#ffffff");
        g.strokeStyle = gr; g.lineWidth = 5;
      }
      g.stroke();
      if (s.kind === "tuned" && k < 1) { const [x, y] = s.pts[n]; g.drawImage(sprite, x - 18, y - 18, 36, 36); } // pen tip
    }
    // shine running along the tuned curve once it has drawn
    const sk = (d - 2.1) / 1.0;
    if (!glow && sk > 0 && sk < 1) {
      const tuned = MONO[2], x = lerp(MONO_X - 60, MONO_X + 360, inOut(sk));
      const gr = g.createLinearGradient(x - 50, 0, x + 50, 0);
      gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(0.5, "rgba(255,255,255,.95)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.save(); g.globalCompositeOperation = "lighter";
      g.beginPath(); tuned.pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
      g.strokeStyle = gr; g.lineWidth = 5; g.stroke(); g.restore();
    }
  }

  const RUNS = [{ text: "M&K", w: 700 }, { text: " AUTO SERVICES", w: 300 }];
  function spaced(g, runs, cx, y, size, family, track, alphaAt) {
    const chars = [];
    for (const r of runs) { g.font = `${r.w} ${size}px ${family}`; for (const ch of r.text) chars.push({ ch, w: r.w, adv: g.measureText(ch).width + size * track }); }
    const total = chars.reduce((s, c) => s + c.adv, 0) - size * track;
    let x = cx - total / 2;
    chars.forEach((c, i) => {
      const a = alphaAt ? alphaAt(i, chars.length) : 1;
      if (a > 0.001) { g.globalAlpha = a; g.font = `${c.w} ${size}px ${family}`; g.fillText(c.ch, x, y + (1 - a) * 8); }
      x += c.adv;
    });
    g.globalAlpha = 1;
    return { left: cx - total / 2, right: cx + total / 2 };
  }

  function wordmark(g, t) {
    const d = t - T_LOGO - 0.7;
    if (d <= 0) return;
    const DISPLAY = '"Unbounded", "Arial Black", sans-serif', MONO_F = '"JetBrains Mono", ui-monospace, monospace';
    g.textBaseline = "alphabetic"; g.textAlign = "left";
    const grd = g.createLinearGradient(0, WORD_Y - 30, 0, WORD_Y + 4);
    grd.addColorStop(0, "#ffffff"); grd.addColorStop(0.45, "#c3ccd5"); grd.addColorStop(0.55, "#6c7783"); grd.addColorStop(0.62, "#e8edf2"); grd.addColorStop(1, "#8d98a4");
    g.fillStyle = grd;
    const reveal = (i, n) => clamp((d - Math.abs(i - (n - 1) / 2) * 0.05) / 0.6);
    const box = spaced(g, RUNS, 480, WORD_Y, 30, DISPLAY, 0.42, reveal);
    // travelling shine, clipped to glyphs by drawing the text again with a band fill
    const sk = (d - 0.9) / 1.4;
    if (sk > 0 && sk < 1) {
      const x = lerp(box.left - 80, box.right + 80, inOut(sk));
      const gr = g.createLinearGradient(x - 60, 0, x + 60, 0);
      gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(0.5, "rgba(255,255,255,.95)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.save(); g.globalCompositeOperation = "lighter"; g.fillStyle = gr; spaced(g, RUNS, 480, WORD_Y, 30, DISPLAY, 0.42); g.restore();
    }
    g.fillStyle = "rgba(150,163,178,1)";
    spaced(g, [{ text: "REMAPPING · KEYS · CODING · REPAIRS", w: 500 }], 480, TAG_Y, 11.5, MONO_F, 0.32, () => clamp((d - 0.8) / 0.8) * 0.9);
    // hairline under the tagline, drawn outward from the centre
    const lk = out3((d - 1.1) / 1.2);
    if (lk > 0) {
      const gr = g.createLinearGradient(480 - 260, 0, 480 + 260, 0);
      gr.addColorStop(0, "rgba(191,227,255,0)"); gr.addColorStop(0.5, "rgba(191,227,255,.55)"); gr.addColorStop(1, "rgba(191,227,255,0)");
      g.fillStyle = gr; g.fillRect(480 - 260 * lk, TAG_Y + 16, 520 * lk, 1);
    }
  }

  function card(g, t) {
    const d = t - 9.6;
    if (!CARD || d <= 0) return;
    const DISPLAY = '"Unbounded", "Arial Black", sans-serif', MONO_F = '"JetBrains Mono", ui-monospace, monospace';
    g.textBaseline = "alphabetic";
    const lines = ["ECU REMAPPING", "KEY PROGRAMMING", "MERCEDES CODING"];
    lines.forEach((s, i) => {
      g.fillStyle = "#e9eef4";
      spaced(g, [{ text: s, w: 500 }], 480, 860 + i * 58, 30, DISPLAY, 0.18, () => clamp((d - i * 0.18) / 0.6));
    });
    g.fillStyle = "#bfe3ff";
    spaced(g, [{ text: "DM TO BOOK YOUR CAR IN", w: 500 }], 480, 1080, 15, MONO_F, 0.3, () => clamp((d - 0.8) / 0.6));
  }

  // ---------- frame ----------
  function frame(t) {
    const v = view();
    const z = 0.94 + 0.06 * out3(t / 10) + 0.004 * Math.sin(t * 0.3);
    const S = Math.min(W / v.vw, H / v.vh) * z;
    const ox = W / 2 - v.cx * S, oy = H / 2 - (v.cy + Math.sin(t * 0.21) * 2) * S;
    const L = lampLevel(t), Lc = Math.min(L, 1);
    const drl = Math.max(drlLevel(t, T_DRL), drlLevel(t, T_DRL + 0.08));

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);

    ctx.setTransform(S, 0, 0, S, ox, oy);
    // backdrop: cool studio falloff behind the car, rising when the lights come on
    {
      const gr = ctx.createRadialGradient(480, 260, 0, 480, 260, 760);
      const a = 0.04 + 0.06 * clamp(t / 4) + 0.08 * Lc;
      gr.addColorStop(0, `rgba(54,74,98,${a})`); gr.addColorStop(0.55, `rgba(24,34,48,${a * 0.45})`); gr.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gr; ctx.fillRect(-800, -700, 2560, 2000);
    }

    // haze: dust in the air, catching the beams
    ctx.globalCompositeOperation = "lighter";
    const hazeIn = clamp(t / 2.5);
    for (const m of motes) {
      let x = m.x + m.vx * t, y = m.y + m.vy * t;
      x = ((x + 270) % 1500 + 1500) % 1500 - 270; y = ((y + 260) % 1000 + 1000) % 1000 - 260;
      let lit = 0;
      for (const lp of LAMPS) { const dx = (x - lp.x) / 260, dy = (y - lp.y) / 170; lit += Math.exp(-(dx * dx + dy * dy)); }
      const a = m.a * (0.05 * hazeIn + 0.5 * Lc * lit + 0.12 * drl * lit) * (0.7 + 0.3 * Math.sin(t * 1.3 + m.ph));
      if (a < 0.004) continue;
      ctx.globalAlpha = Math.min(1, a); const s = m.r * 6;
      ctx.drawImage(sprite, x - s / 2, y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;

    // the plate itself (black adds nothing under "lighter", so there is no visible frame edge)
    const plate = renderPlate(t);
    if (plate) ctx.drawImage(plate, 0, 0);
    const ea = edgeAlpha(t);
    if (ea > 0) { ctx.globalAlpha = ea; ctx.drawImage(maskedEdges(t, false), 0, 0, PW, PH); ctx.globalAlpha = 1; }
    const gl = glints(t);
    if (gl) ctx.drawImage(gl, 0, 0);

    // emission layer for bloom (half resolution)
    emitX.setTransform(1, 0, 0, 1, 0, 0); emitX.globalCompositeOperation = "source-over"; emitX.clearRect(0, 0, emit.width, emit.height);
    emitX.setTransform(S / 2, 0, 0, S / 2, ox / 2, oy / 2);
    emitX.globalCompositeOperation = "lighter";
    if (t > T_EDGE && t < T_EDGE_END + 0.4) { emitX.globalAlpha = 0.9; emitX.drawImage(maskedEdges(t, true), 0, 0, PW, PH); emitX.globalAlpha = 1; }
    const gl2 = glints(t);
    if (gl2) { emitX.globalAlpha = 0.9; emitX.drawImage(gl2, 0, 0); emitX.globalAlpha = 1; }
    lights(emitX, t, S, false);
    monogram(emitX, t, true);

    // bloom chain
    b1X.clearRect(0, 0, b1.width, b1.height); if (hasFilter) b1X.filter = "blur(1.5px)";
    b1X.drawImage(emit, 0, 0, b1.width, b1.height); if (hasFilter) b1X.filter = "none";
    b2X.clearRect(0, 0, b2.width, b2.height); b2X.drawImage(b1, 0, 0, b2.width, b2.height);
    b3X.clearRect(0, 0, b3.width, b3.height); b3X.drawImage(b2, 0, 0, b3.width, b3.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.globalAlpha = 0.85; ctx.drawImage(emit, 0, 0, W, H);
    ctx.globalAlpha = 0.75; ctx.drawImage(b1, 0, 0, W, H);
    ctx.globalAlpha = 0.8; ctx.drawImage(b2, 0, 0, W, H);
    ctx.globalAlpha = 0.8; ctx.drawImage(b3, 0, 0, W, H);
    ctx.globalAlpha = 1;

    // crisp light sources on top of their bloom
    ctx.setTransform(S, 0, 0, S, ox, oy);
    lights(ctx, t, S, true);

    if (L > 0) {
      // anamorphic streaks through the lamps, with a slight colour split, and their reflection
      const streak = (cx, cy, rx, ry, color, a) => {
        ctx.save(); ctx.translate(cx, cy); ctx.scale(1, ry / rx);
        const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
        gr.addColorStop(0, color.replace("A", a)); gr.addColorStop(0.25, color.replace("A", a * 0.35)); gr.addColorStop(1, color.replace("A", 0));
        ctx.fillStyle = gr; ctx.fillRect(-rx, -rx, rx * 2, rx * 2); ctx.restore();
      };
      for (const lp of LAMPS) {
        const y = lp.y + 14;
        streak(lp.x, y, 720, 6, "rgba(170,210,255,A)", 0.45 * Lc);
        streak(lp.x, y - 2, 420, 2.2, "rgba(255,255,255,A)", 0.75 * Lc);
        streak(lp.x + 3, y + 3, 380, 3, "rgba(255,140,120,A)", 0.12 * Lc);
        streak(lp.x - 3, y - 4, 380, 3, "rgba(120,170,255,A)", 0.14 * Lc);
        const ry = REFL[5] + REFL[3] * y;
        streak(lp.x, ry, 240, 3, "rgba(170,210,255,A)", 0.18 * Lc);
        // glare
        const gr = ctx.createRadialGradient(lp.x, y, 0, lp.x, y, 300);
        gr.addColorStop(0, `rgba(200,228,255,${0.13 * Lc})`); gr.addColorStop(1, "rgba(200,228,255,0)");
        ctx.fillStyle = gr; ctx.fillRect(lp.x - 300, y - 300, 600, 600);
      }
      // lens ghosts along the line from each lamp through the frame centre
      const cx = v.cx, cy = v.cy;
      for (const lp of LAMPS) for (const [k, r, col] of [[1.35, 26, "190,220,255"], [1.7, 54, "255,214,170"], [2.15, 16, "190,220,255"]]) {
        const gx = lp.x + (cx - lp.x) * k, gy = lp.y + (cy - lp.y) * k;
        const gr = ctx.createRadialGradient(gx, gy, r * 0.6, gx, gy, r);
        gr.addColorStop(0, `rgba(${col},${0.035 * Lc})`); gr.addColorStop(0.85, `rgba(${col},${0.06 * Lc})`); gr.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = gr; ctx.fillRect(gx - r, gy - r, r * 2, r * 2);
      }
      // floor spill in front of the bumper
      ctx.save(); ctx.translate(472, FLOOR + 40); ctx.scale(1, 0.1);
      const fg = ctx.createRadialGradient(0, 0, 0, 0, 0, 620);
      fg.addColorStop(0, `rgba(180,215,255,${0.16 * Lc})`); fg.addColorStop(1, "rgba(180,215,255,0)");
      ctx.fillStyle = fg; ctx.fillRect(-620, -620, 1240, 1240); ctx.restore();
    }

    // logo, drawn in normal blending above the car
    ctx.globalCompositeOperation = "source-over";
    monogram(ctx, t, false);
    wordmark(ctx, t);
    card(ctx, t);

    // ignition flash
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const fl = t - T_LAMP;
    if (fl > 0 && fl < 0.7) { ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = `rgba(190,220,255,${0.1 * (1 - fl / 0.7)})`; ctx.fillRect(0, 0, W, H); }

    // grain, vignette
    ctx.globalCompositeOperation = "overlay"; ctx.globalAlpha = 0.06;
    const fi = Math.floor(t * 24);
    const pat = grainPats[fi % grainPats.length];
    if (pat) { ctx.save(); ctx.translate((fi * 37) % 192, (fi * 71) % 192); ctx.fillStyle = pat; ctx.fillRect(-192, -192, W + 384, H + 384); ctx.restore(); }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    const vg = ctx.createRadialGradient(W / 2, H * 0.48, Math.min(W, H) * 0.35, W / 2, H * 0.48, Math.hypot(W, H) * 0.62);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.8)");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    if (!CAPTURE) { // melt into the page at the bottom edge
      const bf = ctx.createLinearGradient(0, H * 0.82, 0, H);
      bf.addColorStop(0, "rgba(5,6,8,0)"); bf.addColorStop(1, "rgba(5,6,8,1)");
      ctx.fillStyle = bf; ctx.fillRect(0, H * 0.82, W, H * 0.18);
    }
  }

  // ---------- run ----------
  // Returning visitors (seen the intro in the last 30 days) start on the finished scene.
  // Stored only in the visitor's browser; nothing is sent anywhere.
  const SEEN_KEY = "mk-intro-seen", SEEN_FOR = 30 * 864e5, SETTLED = 9.4;
  const seenRecently = () => { try { const v = +localStorage.getItem(SEEN_KEY); return v > 0 && Date.now() - v < SEEN_FOR; } catch (e) { return false; } };
  const markSeen = () => { try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch (e) {} };
  let start = 0, raf = 0, visible = true, last = 14, marked = false;
  const loop = now => {
    if (!start) start = now;
    last = (now - start) / 1000;
    frame(last);
    if (!marked && last > SETTLED) { marked = true; markSeen(); }
    raf = visible ? requestAnimationFrame(loop) : 0;
  };
  const play = (skip) => {
    cancelAnimationFrame(raf);
    if (reduce) { frame(14); return; }
    start = skip === true ? performance.now() - SETTLED * 1000 : 0;
    if (skip === true && canvas.animate) canvas.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 700, easing: "ease-out" });
    raf = requestAnimationFrame(loop);
  };

  const img = new Image();
  img.src = canvas.dataset.plate || "assets/amg-front.jpg";
  const fonts = Promise.race([
    Promise.all([document.fonts.load('700 30px "Unbounded"'), document.fonts.load('300 30px "Unbounded"'), document.fonts.load('500 12px "JetBrains Mono"')]),
    new Promise(r => setTimeout(r, 2500)),
  ]).catch(() => {});
  const ready = Promise.all([img.decode(), fonts]).then(() => { analyse(img); resize(); });

  window.MKHero = { ready, seek: t => frame(t), replay: play };
  if (CAPTURE) return;

  ready.then(() => {
    play(seenRecently());
    addEventListener("resize", () => { resize(); if (reduce || !raf) frame(last); });
    new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !raf && !reduce) { const off = last; start = performance.now() - off * 1000; raf = requestAnimationFrame(loop); }
    }).observe(canvas);
    const btn = document.getElementById("replay");
    if (btn) btn.addEventListener("click", () => play(false));
  });
})();
