// Gearbox illustration: a small 3D renderer (painter's algorithm) that draws a five-pair
// manual gearbox in the site's chrome-on-black style. Every tooth is modelled, the gears
// turn in mesh at their real ratios, and the assembly comes together from an exploded view.
// Usage: <canvas class="gearbox"></canvas>; a button[data-explode] next to it toggles the view.
(() => {
  const TAU = Math.PI * 2;
  const clamp = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const inOut = k => { k = clamp(k); return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- profiles (u, v) in the plane across the shaft ----------
  function gearProfile(z, m) {
    const r = (m * z) / 2, ra = r + m, rf = r - 1.25 * m, p = TAU / z, pts = [], tips = [];
    for (let i = 0; i < z; i++) {
      const a = i * p;
      const seq = [[a - p / 2, rf], [a - p * 0.3, rf], [a - p * 0.24, r], [a - p * 0.13, ra], [a + p * 0.13, ra], [a + p * 0.24, r], [a + p * 0.3, rf]];
      seq.forEach(([ang, rad], j) => { if (j === 4) tips.push(pts.length / 2 - 1); pts.push(Math.cos(ang) * rad, Math.sin(ang) * rad); });
    }
    return { pts, tips, r: ra };
  }
  function circleProfile(r, n = 40) {
    const pts = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU; pts.push(Math.cos(a) * r, Math.sin(a) * r); }
    return { pts, tips: [], r };
  }
  function boxProfile(u0, v0, u1, v1) { return { pts: [u1, v0, u1, v1, u0, v1, u0, v0], tips: [0, 1, 2, 3], r: Math.max(Math.abs(u0), Math.abs(u1), Math.abs(v0), Math.abs(v1)) }; }
  function arcBand(r0, r1, a0, a1, n = 24) {
    const pts = [];
    for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push(Math.cos(a) * r1, Math.sin(a) * r1); }
    for (let i = n; i >= 0; i--) { const a = a0 + ((a1 - a0) * i) / n; pts.push(Math.cos(a) * r0, Math.sin(a) * r0); }
    return { pts, tips: [0, n, n + 1, 2 * n + 1], r: r1 };
  }

  // ---------- the gearbox ----------
  // Main axis (input + output shafts) at the origin; the countershaft sits below and toward the viewer.
  const MAIN = [0, 0], CTR = [-60, 36]; // [y, z]
  const CONTACT = Math.atan2(CTR[0] - MAIN[0], CTR[1] - MAIN[1]); // angle from main to counter in (u, v)
  const M = 2.5, W_IN = 0.9; // module, input speed (rad/s)
  const PAIRS = [ // [x, main teeth, counter teeth, face width]
    [-62, 20, 36, 16], // constant mesh
    [-12, 28, 28, 16], // 3rd
    [18, 34, 22, 16],  // 2nd
    [72, 40, 16, 18],  // 1st
  ];
  const W_CTR = (-W_IN * 20) / 36;
  const W_OUT = (-W_CTR * 22) / 34; // engaged in 2nd

  const parts = [];
  const add = (o) => (parts.push(Object.assign({ hole: 0, rings: [], holes: 0, tint: 0, spin: () => 0, ex: [0, 0, 0] }, o)), o);

  PAIRS.forEach(([x, zm, zc, w], i) => {
    const gm = gearProfile(zm, M), gc = gearProfile(zc, M);
    const pm = TAU / zm, pc = TAU / zc;
    const wm = i === 0 ? W_IN : (-W_CTR * zc) / zm;
    const m0 = CONTACT, c0 = CONTACT + Math.PI - pc / 2 + (pc / 2) * 0; // tooth on main meets a gap on the counter
    add({ name: "gear-m" + i, prof: gm, axis: MAIN, x0: x - w / 2, x1: x + w / 2, spin: t => m0 + wm * t, rings: [(M * zm) / 2 - 6, 15], holes: zm >= 34 ? 6 : 0, ex: [x * 0.35, 46 + i * 4, -10] });
    add({ name: "gear-c" + i, prof: gc, axis: CTR, x0: x - w / 2, x1: x + w / 2, spin: t => c0 + W_CTR * t + (i ? pc * 0.5 : 0), rings: [(M * zc) / 2 - 6, 14], holes: zc >= 34 ? 6 : 0, ex: [x * 0.35, -46 - i * 4, 22] });
  });

  // shafts as short segments so depth sorting stays local
  const seg = (axis, x0, x1, r, spin, ex, splined) => add({ prof: splined ? gearProfile(splined, (2 * r) / splined) : circleProfile(r, 32), axis, x0, x1, spin, ex });
  const spinIn = t => W_IN * t, spinOut = t => W_OUT * t, spinCtr = t => W_CTR * t;
  seg(MAIN, -178, -150, 9, spinIn, [-70, 0, 0], 22);
  seg(MAIN, -150, -94, 10.5, spinIn, [-70, 0, 0]);
  seg(MAIN, -94, -70, 12, spinIn, [-60, 0, 0]);
  seg(MAIN, -54, -48, 10, spinOut, [-20, 0, 0]);
  seg(MAIN, -28, -20, 11, spinOut, [-10, 0, 0]);
  seg(MAIN, -4, 10, 11, spinOut, [0, 0, 0]);
  seg(MAIN, 26, 34, 11, spinOut, [10, 0, 0]);
  seg(MAIN, 54, 63, 11, spinOut, [20, 0, 0]);
  seg(MAIN, 81, 112, 11, spinOut, [40, 0, 0]);
  seg(MAIN, 112, 158, 9.5, spinOut, [60, 0, 0], 20);
  seg(CTR, -100, -70, 9, spinCtr, [-40, -30, 20]);
  for (const [a, b] of [[-54, -20], [-4, 10], [26, 63], [81, 104]]) seg(CTR, a, b, 10, spinCtr, [(a + b) * 0.15, -30, 20]);

  // synchronisers: sleeve with a groove for the fork, cones either side (tinted)
  for (const [x, i] of [[-38, 0], [44, 1]]) {
    const dy = 70 + i * 10;
    add({ prof: gearProfile(36, 1.6), axis: MAIN, x0: x - 9, x1: x - 4, spin: spinOut, ex: [x * 0.3, dy, -20] });
    add({ prof: circleProfile(25, 40), axis: MAIN, x0: x - 4, x1: x + 4, spin: spinOut, ex: [x * 0.3, dy, -20] });
    add({ prof: gearProfile(36, 1.6), axis: MAIN, x0: x + 4, x1: x + 9, spin: spinOut, ex: [x * 0.3, dy, -20] });
    add({ prof: gearProfile(30, 1.5), axis: MAIN, x0: x - 12, x1: x - 9, spin: spinOut, tint: 1, ex: [x * 0.3 - 14, dy - 20, -20] });
    add({ prof: gearProfile(30, 1.5), axis: MAIN, x0: x + 9, x1: x + 12, spin: spinOut, tint: 1, ex: [x * 0.3 + 14, dy - 20, -20] });
    // fork: a band riding in the groove, an arm, and a boss on the rail
    add({ prof: arcBand(26.5, 35, 0.35, Math.PI - 0.35), axis: MAIN, x0: x - 3, x1: x + 3, tint: 1, ex: [x * 0.3, 120, -20] });
    add({ prof: boxProfile(-4.5, 33, 4.5, 58), axis: MAIN, x0: x - 3, x1: x + 3, tint: 1, ex: [x * 0.3, 120, -20] });
    add({ prof: circleProfile(8, 28), axis: [62, 0], x0: x - 10, x1: x + 10, ex: [x * 0.3, 120, -20] });
  }
  // shift rail
  for (const [a, b] of [[-70, -48], [-28, 34], [54, 112]]) add({ prof: circleProfile(4.5, 20), axis: [62, 0], x0: a, x1: b, ex: [(a + b) * 0.2, 130, -20] });

  // bearings: outer and inner race with balls between
  const bearings = [];
  for (const [axis, x, ro, ri, spin, ex] of [[MAIN, -82, 27, 13, spinIn, [-90, 0, 0]], [MAIN, 96, 27, 12, spinOut, [70, 0, 0]], [CTR, -86, 21, 10, spinCtr, [-60, -30, 20]], [CTR, 92, 21, 10, spinCtr, [60, -30, 20]]]) {
    add({ prof: circleProfile(ro, 40), axis, x0: x - 6, x1: x + 6, hole: ro - 4, ex, rings: [ro - 2.2] });
    add({ prof: circleProfile(ri + 3, 32), axis, x0: x - 6, x1: x + 6, spin, ex });
    bearings.push({ axis, x, r: (ro - 4 + ri + 3) / 2, br: (ro - 4 - ri - 3) / 2 + 0.6, n: 11, spin, ex });
  }

  // ---------- renderer ----------
  function Gearbox(canvas) {
    const ctx = canvas.getContext("2d");
    const btn = canvas.parentElement.querySelector("[data-explode]");
    let W = 0, H = 0, dpr = 1, f = 1, raf = 0, visible = false, start = 0;
    let explodeFrom = 1, explodeTo = 1, explodeAt = 0, assembled = false, mx = 0, my = 0;
    const sprite = document.createElement("canvas");
    sprite.width = sprite.height = 64;
    { const g = sprite.getContext("2d"), gr = g.createRadialGradient(24, 22, 2, 32, 32, 32);
      gr.addColorStop(0, "#ffffff"); gr.addColorStop(0.25, "#b9c6d4"); gr.addColorStop(0.7, "#2a333e"); gr.addColorStop(1, "rgba(10,13,17,1)");
      g.fillStyle = gr; g.beginPath(); g.arc(32, 32, 31, 0, TAU); g.fill(); }

    function size() {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(devicePixelRatio || 1, 2);
      W = Math.max(2, Math.round(r.width * dpr)); H = Math.max(2, Math.round(r.height * dpr));
      canvas.width = W; canvas.height = H;
    }

    function frame(now) {
      const t = (now - start) / 1000;
      const e = lerpE(now);
      const yaw = -0.58 + mx * 0.22 + (reduce ? 0 : Math.sin(t * 0.17) * 0.06);
      const pitch = 0.38 + my * 0.12;
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const T = [6, -18, 14], DIST = 560;
      const narrow = W / dpr < 640 ? 1.22 : 1;
      const span = lerp(370, 560, e) * narrow;
      f = Math.min((W * 0.94 * DIST) / span, (H * 0.9 * DIST) / lerp(235, 360, e) * narrow);
      const ox = W / 2, oy = H / 2 + H * 0.02;
      const cam = (X, Y, Z, out, o) => {
        X -= T[0]; Y -= T[1]; Z -= T[2];
        const x1 = X * cy - Z * sy, z1 = X * sy + Z * cy;
        const y2 = Y * cp - z1 * sp, z2 = Y * sp + z1 * cp + DIST;
        out[o] = x1; out[o + 1] = y2; out[o + 2] = z2;
      };
      const L = norm([-0.45, 0.75, -0.55]);
      const faces = [];

      for (let pi = 0; pi < parts.length; pi++) {
        const p = parts[pi], P = p.prof.pts, n = P.length / 2;
        const k = reduce ? 0 : clamp(e * 1.15 - (pi % 7) * 0.02);
        const ex = inOut(k), dx = p.ex[0] * ex, dy = p.ex[1] * ex, dz = p.ex[2] * ex;
        const th = reduce ? 0.4 : p.spin(t), c = Math.cos(th), s = Math.sin(th);
        const B = new Float32Array(n * 3), F = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          const u = P[2 * i] * c - P[2 * i + 1] * s, v = P[2 * i] * s + P[2 * i + 1] * c;
          const Y = p.axis[0] + v + dy, Z = p.axis[1] + u + dz;
          cam(p.x0 + dx, Y, Z, B, i * 3); cam(p.x1 + dx, Y, Z, F, i * 3);
        }
        const tipSet = p.prof.tips;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n, a = i * 3, b = j * 3;
          // order back[i], front[i], front[j], back[j] gives an outward normal
          const nx = (F[a + 1] - B[a + 1]) * (F[b + 2] - B[a + 2]) - (F[a + 2] - B[a + 2]) * (F[b + 1] - B[a + 1]);
          const ny = (F[a + 2] - B[a + 2]) * (F[b] - B[a]) - (F[a] - B[a]) * (F[b + 2] - B[a + 2]);
          const nz = (F[a] - B[a]) * (F[b + 1] - B[a + 1]) - (F[a + 1] - B[a + 1]) * (F[b] - B[a]);
          const cx = (B[a] + F[b]) / 2, cyy = (B[a + 1] + F[b + 1]) / 2, cz = (B[a + 2] + F[b + 2]) / 2;
          if (nx * cx + ny * cyy + nz * cz >= 0) continue; // facing away
          const len = Math.hypot(nx, ny, nz) || 1;
          faces.push({ z: cz, kind: 0, q: [B[a], B[a + 1], B[a + 2], F[a], F[a + 1], F[a + 2], F[b], F[b + 1], F[b + 2], B[b], B[b + 1], B[b + 2]], n: [nx / len, ny / len, nz / len], tint: p.tint, tip: tipSet.includes(i) });
        }
        // caps: the one facing the camera
        const axisDir = [p.x1 - p.x0, 0, 0];
        const ad = [axisDir[0] * cy, -axisDir[0] * sy * sp, axisDir[0] * sy * cp]; // (1,0,0) rotated, scaled
        const frontVisible = ad[2] < 0; // +X face points toward the eye
        const R = frontVisible ? F : B;
        const cn = norm(frontVisible ? ad : [-ad[0], -ad[1], -ad[2]]);
        let zc = 0; for (let i = 0; i < n; i++) zc += R[i * 3 + 2]; zc /= n;
        const capX = frontVisible ? p.x1 : p.x0;
        faces.push({ z: zc + 0.01, kind: 1, ring: R, n: cn, tint: p.tint, part: p, capX: capX + dx, d: [dy, dz], th, cam });
      }
      // bearing balls
      for (const b of bearings) {
        const ex = reduce ? 0 : inOut(clamp(e * 1.15)), th = (reduce ? 0 : b.spin(t)) * 0.45;
        for (let i = 0; i < b.n; i++) {
          const a = th + (i / b.n) * TAU, o = new Float32Array(3);
          cam(b.x + b.ex[0] * ex, b.axis[0] + Math.sin(a) * b.r + b.ex[1] * ex, b.axis[1] + Math.cos(a) * b.r + b.ex[2] * ex, o, 0);
          faces.push({ z: o[2], kind: 2, o, r: b.br });
        }
      }
      faces.sort((a, b) => b.z - a.z);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      // floor light under the assembly
      {
        const o = new Float32Array(3); cam(0, -128, 30, o, 0);
        const sx = ox + (f * o[0]) / o[2], sy2 = oy - (f * o[1]) / o[2];
        ctx.save(); ctx.translate(sx, sy2); ctx.scale(1, 0.18);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, W * 0.42);
        g.addColorStop(0, "rgba(120,160,205,.16)"); g.addColorStop(1, "rgba(120,160,205,0)");
        ctx.fillStyle = g; ctx.fillRect(-W, -W, 2 * W, 2 * W); ctx.restore();
      }
      const P2 = (x, y, z) => [ox + (f * x) / z, oy - (f * y) / z];
      ctx.lineJoin = "round";
      for (const fc of faces) {
        if (fc.kind === 2) {
          const [sx, sy2] = P2(fc.o[0], fc.o[1], fc.o[2]), r = (f * fc.r) / fc.o[2];
          ctx.drawImage(sprite, sx - r, sy2 - r, 2 * r, 2 * r);
          continue;
        }
        const c3 = shade(fc.n, L, fc.tint), col = rgb(c3);
        ctx.beginPath();
        if (fc.kind === 0) {
          const q = fc.q;
          for (let i = 0; i < 4; i++) { const [sx, sy2] = P2(q[i * 3], q[i * 3 + 1], q[i * 3 + 2]); i ? ctx.lineTo(sx, sy2) : ctx.moveTo(sx, sy2); }
          ctx.closePath();
          ctx.fillStyle = col; ctx.fill();
          ctx.strokeStyle = col; ctx.lineWidth = 0.8; ctx.stroke(); // hide seams
          if (fc.tip) { // crisp edge along each tooth tip
            const [a0, a1] = P2(q[3], q[4], q[5]), [b0, b1] = P2(q[0], q[1], q[2]);
            ctx.beginPath(); ctx.moveTo(a0, a1); ctx.lineTo(b0, b1);
            ctx.strokeStyle = fc.tint ? "rgba(191,227,255,.55)" : "rgba(225,236,248,.42)"; ctx.lineWidth = 0.7 * dpr; ctx.stroke();
          }
        } else {
          const R = fc.ring, n = R.length / 3;
          for (let i = 0; i < n; i++) { const [sx, sy2] = P2(R[i * 3], R[i * 3 + 1], R[i * 3 + 2]); i ? ctx.lineTo(sx, sy2) : ctx.moveTo(sx, sy2); }
          ctx.closePath();
          const p = fc.part;
          if (p.hole) circlePath(ctx, p, fc, p.hole, P2, true);
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (let i = 0; i < n; i += 3) { const [sx, sy2] = P2(R[i * 3], R[i * 3 + 1], R[i * 3 + 2]); if (sx < x0) x0 = sx; if (sx > x1) x1 = sx; if (sy2 < y0) y0 = sy2; if (sy2 > y1) y1 = sy2; }
          const cf = [Math.max(c3[0], 34), Math.max(c3[1], 40), Math.max(c3[2], 48)]; // faces catch some of the softbox
          const sheen = ctx.createLinearGradient(x0, y0, x1, y1);
          sheen.addColorStop(0, rgb(cf, 0.6)); sheen.addColorStop(0.4, rgb(cf, 1.35));
          sheen.addColorStop(0.5, rgb(cf, 2.4)); sheen.addColorStop(0.6, rgb(cf, 1.3)); sheen.addColorStop(1, rgb(cf, 0.55));
          ctx.fillStyle = sheen; ctx.fill("evenodd");
          ctx.strokeStyle = fc.tint ? "rgba(191,227,255,.6)" : "rgba(230,240,250,.5)"; ctx.lineWidth = 0.7 * dpr; ctx.stroke();
          // machined detail: concentric rings and lightening holes on the face
          ctx.lineWidth = 0.5 * dpr; ctx.strokeStyle = "rgba(200,215,232,.22)";
          for (const rr of p.rings) { ctx.beginPath(); circlePath(ctx, p, fc, rr, P2); ctx.stroke(); }
          if (p.holes) {
            const rm = (p.rings[0] + p.rings[1]) / 2;
            for (let h = 0; h < p.holes; h++) {
              const a = fc.th + (h / p.holes) * TAU;
              ctx.beginPath(); circlePath(ctx, p, fc, 5.5, P2, false, [Math.cos(a) * rm, Math.sin(a) * rm]);
              ctx.fillStyle = "rgba(4,6,8,.85)"; ctx.fill(); ctx.stroke();
            }
          }
        }
      }
      // callouts
      labels(ctx, cam, P2, e);
    }

    function circlePath(g, p, fc, r, P2, reverse, off) {
      const o = new Float32Array(3), N = 36;
      for (let i = 0; i <= N; i++) {
        const a = ((reverse ? N - i : i) / N) * TAU;
        const u = (off ? off[0] : 0) + Math.cos(a) * r, v = (off ? off[1] : 0) + Math.sin(a) * r;
        fc.cam(fc.capX, p.axis[0] + v + fc.d[0], p.axis[1] + u + fc.d[1], o, 0);
        const [sx, sy] = P2(o[0], o[1], o[2]);
        i ? g.lineTo(sx, sy) : g.moveTo(sx, sy);
      }
      g.closePath();
    }

    const LABELS = [
      ["Input shaft", [-164, 0, 0], [-1, 0.9]],
      ["Synchroniser", [44, 30, 0], [0.5, 1]],
      ["Shift fork", [-38, 62, 0], [-0.6, 1]],
      ["Gear set", [18, -87, 36], [0.7, -1]],
      ["Countershaft", [-30, -60, 36], [-1, -0.7]],
      ["Output shaft", [140, 0, 0], [1, -0.2]],
      ["Bearing", [96, -27, 0], [0.8, -0.9]],
    ];
    function labels(g, cam, P2, e) {
      const a = clamp(1 - e * 3);
      if (a <= 0) return;
      const o = new Float32Array(3), len = (W / dpr < 640 ? 20 : 34) * dpr + W * 0.02;
      g.font = `300 ${Math.max(9, 10.5 * dpr)}px Unbounded, "Arial Black", sans-serif`;
      g.textBaseline = "middle";
      for (const [text, p, d] of LABELS) {
        cam(p[0], p[1], p[2], o, 0);
        const [x, y] = P2(o[0], o[1], o[2]);
        const dl = Math.hypot(d[0], d[1]), ex = x + (d[0] / dl) * len, ey = y - (d[1] / dl) * len;
        const run = (d[0] >= 0 ? 1 : -1) * 18 * dpr;
        g.globalAlpha = a;
        g.strokeStyle = "rgba(191,227,255,.55)"; g.lineWidth = 0.8 * dpr;
        g.beginPath(); g.moveTo(x, y); g.lineTo(ex, ey); g.lineTo(ex + run, ey); g.stroke();
        g.beginPath(); g.arc(x, y, 2.2 * dpr, 0, TAU); g.stroke();
        const label = text.toUpperCase().split("").join(String.fromCharCode(8202)), tw = g.measureText(label).width, pad = 6 * dpr;
        let lx = ex + run + (d[0] >= 0 ? 6 : -6) * dpr;
        lx = d[0] >= 0 ? Math.min(lx, W - pad - tw) : Math.max(lx, pad + tw); // keep every label inside the frame
        g.textAlign = d[0] >= 0 ? "left" : "right";
        g.strokeStyle = "rgba(5,6,8,.85)"; g.lineWidth = 4 * dpr; g.strokeText(label, lx, ey); // halo where a label crosses metal
        g.fillStyle = "#e9eef4"; g.fillText(label, lx, ey);
      }
      g.globalAlpha = 1;
    }

    function lerpE(now) { const k = clamp((now - explodeAt) / 2600); return explodeFrom + (explodeTo - explodeFrom) * inOut(k); }
    function loop(now) { if (!start) start = now; frame(now); raf = visible ? requestAnimationFrame(loop) : 0; }
    function setExplode(to) { const now = performance.now(); explodeFrom = lerpE(now); explodeTo = to; explodeAt = now; if (btn) btn.textContent = to ? "Assemble" : "Exploded view"; }

    size();
    addEventListener("resize", () => { size(); if (!raf) frame(performance.now()); });
    canvas.addEventListener("pointermove", ev => { const r = canvas.getBoundingClientRect(); mx = ((ev.clientX - r.left) / r.width - 0.5) * 2; my = ((ev.clientY - r.top) / r.height - 0.5) * 2; });
    canvas.addEventListener("pointerleave", () => { mx = my = 0; });
    if (btn) btn.addEventListener("click", () => setExplode(explodeTo > 0.5 ? 0 : 1));
    if (reduce) { explodeFrom = explodeTo = 0; }
    new IntersectionObserver(([en]) => {
      visible = en.isIntersecting;
      if (visible && !assembled && !reduce) { assembled = true; setExplode(0); }
      if (visible && !raf) raf = requestAnimationFrame(loop);
    }, { threshold: 0.35 }).observe(canvas);
    frame(performance.now());
  }

  function shade(n, L, tint) {
    const diff = Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
    const h = norm([L[0], L[1], L[2] - 1]);
    const nh = Math.max(0, n[0] * h[0] + n[1] * h[1] + n[2] * h[2]);
    const spec = Math.pow(nh, 40) * 1.2 + Math.pow(nh, 8) * 0.18;
    const sky = Math.pow(Math.max(0, n[1]), 2) * 0.55;      // softbox overhead
    const floor = Math.max(0, -n[1]) * 0.08;                // bounce from below
    const rim = Math.pow(1 - Math.abs(n[2]), 3);
    let r = 7 + diff * 70 + sky * 92 + floor * 60 + spec * 255 + rim * 30;
    let g = 9 + diff * 76 + sky * 100 + floor * 66 + spec * 255 + rim * 44;
    let b = 12 + diff * 84 + sky * 110 + floor * 74 + spec * 255 + rim * 60;
    if (tint) { r *= 0.72; g *= 0.92; b *= 1.15; }
    return [Math.min(255, r), Math.min(255, g), Math.min(255, b)];
  }
  const rgb = (c, k = 1) => `rgb(${Math.min(255, c[0] * k) | 0},${Math.min(255, c[1] * k) | 0},${Math.min(255, c[2] * k) | 0})`;
  function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function lerp(a, b, k) { return a + (b - a) * k; }

  const boot = () => document.querySelectorAll("canvas.gearbox").forEach(c => { if (!c.dataset.ready) { c.dataset.ready = 1; Gearbox(c); } });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
