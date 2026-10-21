/* =====================================================================
   LYRICS GENERATOR — renderovací engine (16 štýlov)
   Všetko sa kreslí na <canvas>; jednotky sú relatívne k výške obrazu,
   takže náhľad aj export (1080p, 4K, vlastné) vyzerajú rovnako.
   ===================================================================== */
'use strict';

const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const prog = (t, s, d) => (d <= 0 ? (t >= s ? 1 : 0) : clamp((t - s) / d));
const E = {
  oc: x => 1 - Math.pow(1 - x, 3),
  ic: x => x * x * x,
  ioc: x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  oe: x => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  ie: x => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10)),
};
function hexRGB(h) {
  h = String(h || '#ffffff').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${+a.toFixed(4)})`;
const mixRGB = (a, b, t) => a.map((v, i) => Math.round(lerp(v, b[i], t)));
// deterministický pseudo-náhodný generátor (0..1) – export je vždy rovnaký
function rnd(a, b = 0) {
  let t = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  t = Math.imul(t ^ (t >>> 13), 1274126177);
  t ^= t >>> 16;
  return (t >>> 0) / 4294967296;
}
function zoom(c, cx, cy, s) { c.translate(cx, cy); c.scale(s, s); c.translate(-cx, -cy); }

/* ---------- text: klipy, riadky, slová, *zvýraznenie* ---------- */
function getSlides(raw) {
  const res = [], re = /\n[ \t]*(?:\n[ \t]*)+/g;
  let last = 0, m;
  const push = (s, start) => { if (s.trim()) res.push({ text: s, start, end: start + s.length }); };
  while ((m = re.exec(raw))) { push(raw.slice(last, m.index), last); last = m.index + m[0].length; }
  push(raw.slice(last), last);
  return res;
}
function parseSlide(raw, upper) {
  let s = String(raw || '').replace(/\r/g, '').trim();
  if (upper) s = s.toLocaleUpperCase('sk');
  let mark = false;
  const out = [];
  for (const line of s.split('\n')) {
    const words = [];
    for (const w of line.trim().split(/\s+/)) {
      let t = '', wm = false, started = false;
      for (const ch of w) {
        if (ch === '*') { mark = !mark; continue; }
        if (!started) { started = true; wm = mark; }
        t += ch;
      }
      if (t) words.push({ t, m: wm });
    }
    if (words.length) out.push(words);
  }
  return out;
}

/* ---------- písmo a rozloženie ---------- */
function fontStr(S, px) {
  return `${S.weight} ${px.toFixed(2)}px "${S.family}", "Montserrat", sans-serif`;
}
function setFont(c, S, px, trackEm) {
  c.font = fontStr(S, px);
  const ls = (trackEm != null ? trackEm : S.tracking / 100) * px;
  c.letterSpacing = ls.toFixed(2) + 'px';
}
function makeLayout(R, lines, o) {
  const { ctx: c, S, W, H, base } = R;
  if (o.single || o.row) lines = [lines.flat()];
  const n = lines.length;
  let px = Math.max(4, (S.size / 100) * base);
  setFont(c, S, px);
  const ls0 = (S.tracking / 100) * px;
  const sp0 = c.measureText(' ').width;
  const capR = (c.measureText('H').actualBoundingBoxAscent || px * 0.7) / px;
  const meas = lines.map(ws => ws.map(w => c.measureText(w.t).width));
  const gap0 = o.row ? px * (o.rowGap || 1) : sp0;
  const lw0 = meas.map(ms => ms.reduce((a, b) => a + b, 0) + gap0 * (ms.length - 1) - ls0);
  const lead = S.leading;
  const needW = Math.max(1, ...lw0) + (o.padW || 0) * px;
  const needH = o.rowsH ? o.rowsH * capR * px * lead : ((n - 1) * lead + capR + (o.padH || 0)) * px;
  const f = Math.min(1, ((S.safe / 100) * W) / needW, ((o.maxH || 0.86) * H) / needH);
  px *= f;
  const ls = ls0 * f, gap = gap0 * f, capH = capR * px, lineH = px * lead;
  const cx = W / 2 + (S.posX / 100) * W, cy = H / 2 - (S.posY / 100) * H;
  const top = cy - ((n - 1) * lineH) / 2;
  const L = { px, ls, gap, capH, lineH, cx, cy, lines: [], words: [] };
  lines.forEach((ws, i) => {
    const w = lw0[i] * f, yc = top + i * lineH, bl = yc + capH / 2;
    let x = cx - w / 2;
    const words = [];
    ws.forEach((wd, j) => {
      const adv = meas[i][j] * f, vw = adv - ls;
      words.push({ t: wd.t, m: wd.m, x, w: vw, cx: x + vw / 2, yc, base: bl, line: i });
      x += adv + gap;
    });
    L.lines.push({ text: ws.map(q => q.t).join(' '), x: cx - w / 2, w, yc, base: bl, words });
    L.words.push(...words);
  });
  L.blockW = Math.max(...L.lines.map(l => l.w));
  L.blockH = (n - 1) * lineH + capH;
  L.left = cx - L.blockW / 2; L.right = cx + L.blockW / 2;
  L.top = cy - L.blockH / 2; L.bottom = cy + L.blockH / 2;
  return L;
}

/* ---------- kreslenie: žiara, text, čiary ---------- */
// Žiara = tieň vrhnutý z textu nakresleného mimo plátna (čistý glow bez zdvojenia textu)
function glowDraw(R, k, draw, col) {
  const c = R.ctx, g = (R.S.glow / 100) * k;
  if (g > 0.01) {
    const OFF = 30000, inv = c.getTransform().invertSelf();
    const vx = inv.a * OFF, vy = inv.b * OFF;
    c.save();
    c.shadowOffsetX = OFF; c.shadowOffsetY = 0;
    c.shadowColor = rgba(col, Math.min(1, 0.75 * g)); c.shadowBlur = R.L.px * 0.6 * g;
    draw(-vx, -vy, true);
    c.shadowColor = rgba(col, Math.min(1, 0.9 * g)); c.shadowBlur = R.L.px * 0.15 * g;
    draw(-vx, -vy, true);
    c.restore();
  }
  draw(0, 0, false);
}
function paint(R, words, o = {}) {
  const a = o.alpha == null ? 1 : o.alpha;
  if (a <= 0.004 || !words.length) return;
  const c = R.ctx, col = o.rgb || R.rgb, stroke = o.mode === 'stroke';
  c.save();
  c.globalAlpha = Math.min(1, a);
  setFont(c, R.S, R.L.px, o.track);
  if (stroke) { c.strokeStyle = rgba(col, 1); c.lineWidth = o.lw || R.lw; c.lineJoin = 'round'; }
  else c.fillStyle = o.fill || rgba(col, 1);
  if (o.blur > 0.4) c.filter = `blur(${o.blur.toFixed(1)}px)`;
  const dx = o.dx || 0, dy = o.dy || 0;
  glowDraw(R, o.glow == null ? 1 : o.glow, (ox, oy) => {
    for (const w of words) {
      const x = w.x + dx + ox, y = w.base + dy + oy;
      if (stroke) c.strokeText(w.t, x, y); else c.fillText(w.t, x, y);
    }
  }, col);
  c.restore();
}
function paintLineTracked(R, ln, trackEm, o) {
  const c = R.ctx;
  c.save(); setFont(c, R.S, R.L.px, trackEm);
  const w = c.measureText(ln.text).width - trackEm * R.L.px;
  c.restore();
  paint(R, [{ t: ln.text, x: R.L.cx - w / 2, base: ln.base }], Object.assign({}, o, { track: trackEm }));
}
function strokePath(R, build, o = {}) {
  const a = o.alpha == null ? 1 : o.alpha;
  if (a <= 0.004) return;
  const c = R.ctx, col = o.rgb || R.rgb;
  c.save();
  c.globalAlpha = Math.min(1, a);
  c.lineWidth = o.lw || R.lw; c.lineCap = o.cap || 'butt'; c.lineJoin = 'miter';
  glowDraw(R, o.glow == null ? 0.6 : o.glow, (ox, oy, isGlow) => {
    c.strokeStyle = isGlow || !o.stroke ? rgba(col, 1) : o.stroke;
    c.beginPath(); build(c, ox, oy); c.stroke();
  }, col);
  c.restore();
}
function vGradLine(R, x, cy, h, a) {
  const g = R.ctx.createLinearGradient(0, cy - h, 0, cy + h);
  g.addColorStop(0, rgba(R.rgb, 0)); g.addColorStop(0.5, rgba(R.rgb, a)); g.addColorStop(1, rgba(R.rgb, 0));
  return g;
}

/* ---------- časovanie ---------- */
function stagIn(R, i, n, spread) {
  if (R.tin <= 0) return 1;
  if (n <= 1) return prog(R.t, 0, R.tin);
  return prog(R.t, (spread * R.tin * i) / (n - 1), R.tin * (1 - spread));
}
function stagOut(R, i, n, spread, rev) {
  if (R.tout <= 0) return 0;
  const k = rev ? n - 1 - i : i, s0 = R.D - R.tout;
  if (n <= 1) return prog(R.t, s0, R.tout);
  return prog(R.t, s0 + (spread * R.tout * k) / (n - 1), R.tout * (1 - spread));
}
// váha "aktívneho" prvku, ktorý sa posúva o 1 na každú dobu (BPM)
function beatSpot(R, n, startIdx) {
  const w = new Array(n).fill(0);
  if (R.t < R.tin) { w[startIdx % n] = E.oc(R.pin); return w; }
  const f = (R.t - R.tin) / R.beat, k = Math.floor(f);
  const e = k >= 1 ? E.oc(clamp((f - k) / 0.28)) : 1;
  const cur = (startIdx + k) % n, prev = (startIdx + k - 1) % n;
  w[cur] = e;
  if (k >= 1) w[prev] = Math.max(w[prev], 1 - e);
  return w;
}

const scratchMap = new Map();
function getScratch(W, H) {
  const key = W + 'x' + H;
  let cv = scratchMap.get(key);
  if (!cv) {
    if (scratchMap.size > 3) scratchMap.clear();
    cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    scratchMap.set(key, cv);
  }
  return cv;
}

/* =====================================================================
   16 ŠTÝLOV
   ===================================================================== */
const STYLES = [
  { key: 'clean', name: 'CLEAN', draw(R) {
    const L = R.L, n = L.lines.length;
    L.lines.forEach((ln, i) => {
      const p = E.oc(stagIn(R, i, n, 0.4)), q = E.ic(stagOut(R, i, n, 0.3));
      paint(R, ln.words, {
        alpha: p * (1 - q),
        dy: (1 - p) * 0.3 * L.px - q * 0.15 * L.px,
        blur: ((1 - p) * 0.06 + q * 0.04) * L.px,
      });
    });
  } },

  { key: 'highlight', name: 'HIGHLIGHT WORD', draw(R) {
    const L = R.L;
    let mk = L.words.filter(w => w.m);
    if (!mk.length) mk = [L.words[L.words.length - 1]];
    const rest = L.words.filter(w => !mk.includes(w));
    const a0 = R.vis, dy = (1 - R.vin) * 0.2 * L.px;
    paint(R, rest, { alpha: a0 * R.dimA, glow: 0, dy });
    const hp = E.oc(prog(R.t, R.tin * 0.5, Math.max(0.2, R.tin * 0.6)));
    const q = R.tout > 0 ? clamp((R.t - (R.D - R.tout)) / (R.tout * 0.6)) : 0;
    const h = hp * (1 - q);
    for (const w of mk) {
      const c = R.ctx;
      c.save();
      zoom(c, w.cx, w.yc, 1 + 0.07 * Math.sin(Math.PI * hp) * (1 - q));
      paint(R, [w], { alpha: a0 * lerp(R.dimA, 1, h), glow: h, dy, rgb: mixRGB(R.rgb, R.acc, h) });
      c.restore();
    }
  } },

  { key: 'fade', name: 'FADE IN / OUT', draw(R) {
    const L = R.L, n = L.lines.length;
    const avail = R.D - R.tout - R.tin;
    const step = n > 1 ? Math.min(2 * R.beat, Math.max(0, avail * 0.7) / (n - 1)) : 0;
    const td = Math.max(R.tin, 0.05);
    L.lines.forEach((ln, i) => {
      const a = i * step, p = E.oc(prog(R.t, a, td));
      const d = i < n - 1 ? E.ioc(prog(R.t, a + step, td)) : 0;
      const c = R.ctx;
      c.save();
      zoom(c, L.cx, ln.yc, 1 + (1 - p) * 0.08);
      paint(R, ln.words, {
        alpha: p * lerp(1, R.dimA, d) * R.vout,
        blur: ((1 - p) * 0.1 + d * 0.035 + E.ic(R.pout) * 0.08) * L.px,
        glow: p * (1 - d),
      });
      c.restore();
    });
  } },

  { key: 'outline', name: 'OUTLINE', lay: { single: true, rowsH: 4.4 }, draw(R) {
    const L = R.L, sp = L.capH * 1.4 * R.S.leading;
    const e = E.oe(R.pin), q = E.ic(R.pout);
    const off = sp * e * (1 - q) * (1 + 0.04 * Math.sin((TAU * R.t) / (4 * R.beat)) * e);
    const aE = clamp(R.pin * 1.6) * (1 - R.pout);
    paint(R, L.words, { mode: 'stroke', dy: -off, alpha: aE * 0.95, glow: 0.3 });
    paint(R, L.words, { mode: 'stroke', dy: off, alpha: aE * 0.95, glow: 0.3 });
    paint(R, L.words, { alpha: E.oc(prog(R.t, R.tin * 0.25, R.tin * 0.75)) * R.vout });
    const k = lerp(0.55, 1, e) * lerp(1, 0.85, q);
    const hw = (L.blockW / 2 + 0.55 * L.px) * k, hh = (sp + L.capH / 2 + 0.45 * L.px) * k, arm = 0.22 * L.px;
    strokePath(R, (c, ox, oy) => {
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const x = L.cx + sx * hw + ox, y = L.cy + sy * hh + oy;
        c.moveTo(x - sx * arm, y); c.lineTo(x, y); c.lineTo(x, y - sy * arm);
      }
    }, { alpha: aE * 0.8, glow: 0.3, lw: Math.max(1, L.px * 0.014) });
  } },

  { key: 'wordbyword', name: 'WORD BY WORD', draw(R) {
    const ws = R.L.words, n = ws.length, st = R.beat, pd = clamp(st * 0.6, 0.1, 0.35);
    ws.forEach((w, i) => {
      const a = i * st, p = prog(R.t, a, pd);
      if (p <= 0) return;
      const f = i < n - 1 ? 1 - prog(R.t, a + st, 0.18) : 1;
      const al = E.oc(p) * R.vout, c = R.ctx;
      c.save();
      zoom(c, w.cx, w.yc, 1 + (1 - E.oc(p)) * 0.25);
      paint(R, [w], { mode: 'stroke', alpha: al * 0.9, glow: 0.25 });
      paint(R, [w], { alpha: al * f, glow: f });
      c.restore();
    });
  } },

  { key: 'slide', name: 'SLIDE', draw(R) {
    const L = R.L, W = R.W, dist = 0.75 * W;
    const pos = t => -(1 - E.oe(prog(t, 0, R.tin))) * dist + (R.tout > 0 ? E.ie(prog(t, R.D - R.tout, R.tout)) : 0) * dist;
    const pres = t => clamp(prog(t, 0, Math.max(0.05, R.tin * 0.25))) * (1 - (R.tout > 0 ? prog(t, R.D - R.tout * 0.25, R.tout * 0.25) : 0));
    L.lines.forEach((ln, i) => {
      const tt = R.t - i * 0.07, x = pos(tt), v = x - pos(tt - 1 / 30), a = pres(tt);
      if (Math.abs(v) > 0.5) {
        const K = 10;
        for (let j = K; j >= 1; j--) paint(R, ln.words, { dx: x - (v * 1.6 * j) / K, alpha: a * 0.22 * (1 - j / (K + 1)), glow: 0 });
      }
      paint(R, ln.words, { dx: x, alpha: a });
    });
    const x = pos(R.t), v = x - pos(R.t - 1 / 30);
    const sa = pres(R.t) * (0.55 + 0.45 * Math.min(1, Math.abs(v) / (0.01 * W)));
    const lw = Math.max(1, L.px * 0.022), y1 = L.cy + L.blockH * 0.42, y2 = L.cy - L.blockH * 0.42;
    const xl = L.left + x - 0.3 * L.px, xr = L.right + x + 0.3 * L.px;
    if (xl > 2) {
      const g = R.ctx.createLinearGradient(0, 0, xl, 0);
      g.addColorStop(0, rgba(R.rgb, 0)); g.addColorStop(1, rgba(R.rgb, 0.95));
      strokePath(R, (c, ox, oy) => { c.moveTo(ox, y1 + oy); c.lineTo(xl + ox, y1 + oy); }, { stroke: g, lw, alpha: sa, glow: 0.35 });
    }
    if (xr < W - 2) {
      const g = R.ctx.createLinearGradient(xr, 0, W, 0);
      g.addColorStop(0, rgba(R.rgb, 0.95)); g.addColorStop(1, rgba(R.rgb, 0));
      strokePath(R, (c, ox, oy) => { c.moveTo(xr + ox, y2 + oy); c.lineTo(W + ox, y2 + oy); }, { stroke: g, lw, alpha: sa, glow: 0.35 });
    }
  } },

  { key: 'stack', name: 'STACK', lay: { single: true, rowsH: 6.2 }, draw(R) {
    const L = R.L, N = 4, sp = L.capH * 1.38 * R.S.leading;
    const fill = beatSpot(R, N, 1), sA = [0.85, 0.7, 0.5, 0.32];
    for (let i = 0; i < N; i++) {
      const p = E.oc(stagIn(R, i, N, 0.5)), q = E.ic(stagOut(R, i, N, 0.5, true)), a = p * (1 - q);
      const dy = (i - (N - 1) / 2) * sp - (1 - p) * 0.5 * sp;
      paint(R, L.words, { mode: 'stroke', dy, alpha: a * sA[i], glow: 0.15 });
      if (fill[i] > 0.003) paint(R, L.words, { dy, alpha: a * fill[i], glow: fill[i] });
    }
  } },

  { key: 'lines', name: 'MINIMAL LINES', draw(R) {
    const L = R.L, e = E.oe(R.pin), q = E.ic(R.pout), k = e * (1 - q);
    const half = Math.max(L.blockW * 0.22, L.px * 0.9) * k, g = L.capH * 0.75;
    if (half > 0.5) {
      strokePath(R, (c, ox, oy) => {
        const y1 = L.top - g + oy, y2 = L.bottom + g + oy;
        c.moveTo(L.cx - half + ox, y1); c.lineTo(L.cx + half + ox, y1);
        c.moveTo(L.cx - half + ox, y2); c.lineTo(L.cx + half + ox, y2);
      }, { lw: Math.max(1, L.px * 0.018), alpha: clamp(R.pin * 2) * (1 - R.pout), glow: 0.5 });
    }
    const tr = R.S.tracking / 100 + (1 - E.oc(R.pin)) * 0.25 + E.ic(R.pout) * 0.12;
    const a = E.oc(prog(R.t, R.tin * 0.15, R.tin * 0.85)) * R.vout;
    L.lines.forEach(ln => paintLineTracked(R, ln, tr, { alpha: a }));
  } },

  { key: 'scale', name: 'SCALE', lay: { single: true, rowsH: 3.6 }, draw(R) {
    const L = R.L, c = R.ctx, e = E.oe(R.pin), q = E.ic(R.pout), hb = R.t - R.tin;
    let s = lerp(1.7, 1, e);
    if (hb > 0) s *= 1 + 0.025 * Math.exp(-((hb % R.beat) / R.beat) * 7) * R.vout;
    s *= lerp(1, 1.45, q);
    const blur = ((1 - e) * 0.12 + q * 0.12) * L.px, a = E.oc(clamp(R.pin * 1.5)) * (1 - q);
    const go = L.capH * (1 + 0.06 * clamp(Math.max(0, hb) / Math.max(0.1, R.D - R.tin - R.tout)));
    c.save();
    zoom(c, L.cx, L.cy, s);
    paint(R, L.words, { dy: -go, alpha: a * e * 0.3, blur: 0.05 * L.px + blur, glow: 0.3 });
    paint(R, L.words, { dy: go, alpha: a * e * 0.3, blur: 0.05 * L.px + blur, glow: 0.3 });
    paint(R, L.words, { alpha: a, blur });
    c.restore();
  } },

  { key: 'split', name: 'SPLIT', draw(R) {
    const L = R.L, c = R.ctx, W = R.W;
    L.lines.forEach((ln, i) => {
      const p = E.oe(prog(R.t, i * 0.06, R.tin));
      const q = R.tout > 0 ? E.ie(prog(R.t, R.D - R.tout, R.tout)) : 0;
      const d = (1 - p) * 0.45 * W, d2 = q * 0.45 * W;
      const drift = Math.sin((TAU * R.t) / (4 * R.beat)) * 0.012 * L.px * p;
      const a = prog(R.t, i * 0.06, Math.max(0.05, R.tin * 0.4)) * (1 - (R.tout > 0 ? prog(R.t, R.D - R.tout * 0.5, R.tout * 0.5) : 0));
      const mid = ln.base - L.capH * 0.5, gap = 0.035 * L.px;
      c.save(); c.beginPath(); c.rect(-W, mid - 3 * L.px, W * 3, 3 * L.px); c.clip();
      paint(R, ln.words, { dx: -d + d2 + drift, dy: -gap / 2, alpha: a });
      c.restore();
      c.save(); c.beginPath(); c.rect(-W, mid, W * 3, 3 * L.px); c.clip();
      const g = c.createLinearGradient(0, mid + gap / 2, 0, ln.base + gap / 2);
      g.addColorStop(0, rgba(R.rgb, 1)); g.addColorStop(1, rgba(R.rgb, 0.42));
      paint(R, ln.words, { dx: d - d2 - drift, dy: gap / 2, alpha: a, glow: 0.6, fill: g });
      c.restore();
    });
  } },

  { key: 'frame', name: 'MINIMAL FRAME', lay: { padW: 3.4, padH: 1.2 }, draw(R) {
    const L = R.L, e = E.oe(R.pin), q = E.ic(R.pout), k = e * (1 - q);
    const bw = L.blockW / 2 + 0.5 * L.px, bh = L.blockH / 2 + 0.42 * L.px;
    const arm = Math.min(bw * 0.25, 0.5 * L.px), lw = Math.max(1, L.px * 0.02);
    const x = lerp(Math.min(bw, L.px * 0.3), bw, k), h = bh * lerp(0.25, 1, k), af = clamp(e * 2) * (1 - R.pout);
    strokePath(R, (c, ox, oy) => {
      const cx = L.cx + ox, cy = L.cy + oy;
      for (const s of [-1, 1]) {
        const xx = cx + s * x;
        c.moveTo(xx - s * arm, cy - h); c.lineTo(xx, cy - h); c.lineTo(xx, cy + h); c.lineTo(xx - s * arm, cy + h);
      }
    }, { lw, alpha: af, glow: 0.5, cap: 'square' });
    const pr = 0.2 * L.px, rot = ((1 - k) * Math.PI) / 2;
    for (const s of [-1, 1]) {
      const c = R.ctx;
      c.save();
      c.translate(L.cx + s * lerp(bw * 0.5, bw + 0.8 * L.px, k), L.cy);
      c.rotate(rot * s);
      strokePath(R, (c2, ox, oy) => { c2.moveTo(-pr + ox, oy); c2.lineTo(pr + ox, oy); c2.moveTo(ox, -pr + oy); c2.lineTo(ox, pr + oy); },
        { lw: Math.max(1, lw * 0.8), alpha: af * 0.85, glow: 0.4 });
      c.restore();
    }
    const pt = E.oc(prog(R.t, R.tin * 0.35, R.tin * 0.65)), c = R.ctx;
    c.save(); zoom(c, L.cx, L.cy, lerp(0.94, 1, pt));
    paint(R, L.words, { alpha: pt * R.vout });
    c.restore();
  } },

  { key: 'chain', name: 'KINETIC CHAIN', lay: { single: true, rowsH: 7 }, draw(R) {
    const L = R.L, sp = L.capH * 1.38 * R.S.leading;
    const f = R.t / R.beat, k = Math.floor(f), pos = k + E.ioc(clamp((f - k) / 0.4)), fr = pos - Math.floor(pos);
    for (let j = -4; j <= 4; j++) {
      const y = (j - fr) * sp, d = Math.abs(y) / sp, a = clamp(1 - d / 2.7);
      if (a <= 0) continue;
      const ap = E.oc(prog(R.t, d * R.tin * 0.15, R.tin * 0.7));
      const aq = R.tout > 0 ? E.ic(prog(R.t, R.D - R.tout + ((2.7 - d) / 2.7) * R.tout * 0.4, R.tout * 0.6)) : 0;
      const A = a * ap * (1 - aq), fill = clamp(1 - d * 1.8);
      paint(R, L.words, { mode: 'stroke', dy: y, alpha: A * 0.9 * (1 - fill * 0.5), glow: 0.15 });
      if (fill > 0.003) paint(R, L.words, { dy: y, alpha: A * fill, glow: fill });
    }
  } },

  { key: 'glitch', name: 'GLITCH (MINIMAL)', draw(R) {
    const L = R.L, c = R.ctx, W = R.W, H = R.H;
    const sc = getScratch(W, H), lc = sc.getContext('2d');
    lc.setTransform(1, 0, 0, 1, 0, 0); lc.clearRect(0, 0, W, H);
    lc.globalAlpha = 1; lc.filter = 'none'; lc.textAlign = 'left'; lc.textBaseline = 'alphabetic';
    paint(Object.assign({}, R, { ctx: lc }), L.words, {});
    const inI = R.tin > 0 ? 1 - E.oc(R.pin) : 0, outI = E.ic(R.pout);
    const bl = 2 * R.beat, bi = Math.floor(R.t / bl), bt = R.t - bi * bl, blen = Math.min(0.16, R.beat * 0.6);
    const burst = R.t > R.tin && bt < blen && rnd(bi, 7) < 0.8 ? (1 - bt / blen) * 0.55 : 0;
    const I = Math.max(inI, outI, burst), fs = Math.floor(R.t * 24);
    let a = R.vis;
    if (I > 0.05 && rnd(fs, 3) < I * 0.4) a *= 0.3;
    c.save();
    c.globalAlpha = a;
    const y0 = Math.max(0, Math.floor(L.top - 0.5 * L.px)), y1 = Math.min(H, Math.ceil(L.bottom + 0.5 * L.px));
    if (I < 0.02) c.drawImage(sc, 0, 0);
    else {
      if (y0 > 0) c.drawImage(sc, 0, 0, W, y0, 0, 0, W, y0);
      if (y1 < H) c.drawImage(sc, 0, y1, W, H - y1, 0, y1, W, H - y1);
      const nS = 16, sh = (y1 - y0) / nS;
      for (let k = 0; k < nS; k++) {
        const sy = y0 + k * sh, hh = Math.min(sh + 1, H - sy);
        const big = rnd(fs + k * 7, 5) < 0.3 ? 3 : 1;
        const dx = (rnd(fs * 31 + k, 11) - 0.5) * 2 * I * 0.3 * L.px * big;
        c.drawImage(sc, 0, sy, W, hh, dx, sy, W, hh);
        if (big > 1 && I > 0.2) { c.globalAlpha = a * 0.35; c.drawImage(sc, 0, sy, W, hh, dx * 1.8, sy, W, hh); c.globalAlpha = a; }
      }
    }
    const ns = Math.round(2 + I * 7), seed = I > 0.05 ? fs : bi * 13 + 5;
    for (let s = 0; s < ns; s++) {
      const yy = L.top + rnd(seed, s * 3 + 1) * L.blockH, hh = Math.max(1, rnd(seed, s * 3 + 2) * 0.035 * L.px);
      const side = rnd(seed, s * 3 + 3) < 0.5 ? -1 : 1;
      const len = (0.15 + rnd(seed, s * 5 + 9) * 0.6) * L.blockW * (0.35 + I);
      const x0 = side < 0 ? L.left - len * 0.6 : L.right - len * 0.4;
      const g = c.createLinearGradient(x0, 0, x0 + len, 0);
      g.addColorStop(0, rgba(R.rgb, 0)); g.addColorStop(0.5, rgba(R.rgb, Math.min(1, 0.55 * (0.35 + I)))); g.addColorStop(1, rgba(R.rgb, 0));
      c.fillStyle = g; c.fillRect(x0, yy, len, hh);
    }
    c.restore();
  } },

  { key: 'circle', name: 'CIRCLE FOCUS', draw(R) {
    const L = R.L, c = R.ctx;
    const r = 0.5 * Math.hypot(L.blockW, L.blockH) + 0.3 * L.px;
    const fit = Math.min(1, (0.45 * Math.min(R.H, R.W)) / r);
    c.save(); zoom(c, L.cx, L.cy, fit);
    const e = E.oe(prog(R.t, 0, R.tin * 0.9)), q = E.ic(R.pout);
    const a0 = -Math.PI / 2 + TAU * q, a1 = -Math.PI / 2 + TAU * e;
    if (a1 - a0 > 0.001) {
      let st = rgba(R.rgb, 1);
      if (c.createConicGradient) {
        const g = c.createConicGradient((TAU * R.t) / (8 * R.beat) + Math.PI / 2, L.cx, L.cy);
        g.addColorStop(0, rgba(R.rgb, 1)); g.addColorStop(0.3, rgba(R.rgb, 0.28));
        g.addColorStop(0.7, rgba(R.rgb, 0.28)); g.addColorStop(1, rgba(R.rgb, 1));
        st = g;
      }
      strokePath(R, (c2, ox, oy) => c2.arc(L.cx + ox, L.cy + oy, r, a0, a1), { stroke: st, lw: Math.max(1.5, L.px * 0.022), glow: 0.45, cap: 'round' });
    }
    const pt = E.oc(prog(R.t, R.tin * 0.3, R.tin * 0.7)), hb = R.t - R.tin;
    let s = lerp(0.9, 1, pt);
    if (hb > 0) s *= 1 + 0.015 * Math.exp(-((hb % R.beat) / R.beat) * 7);
    zoom(c, L.cx, L.cy, s);
    paint(R, L.words, { alpha: pt * R.vout });
    c.restore();
  } },

  { key: 'fadewords', name: 'FADE WORDS', lay: { row: true, rowGap: 1.15 }, draw(R) {
    const L = R.L, ws = L.words, n = ws.length, c = R.ctx, dh = L.capH * 1.45;
    const spot = beatSpot(R, n, 0);
    for (let i = 0; i < n - 1; i++) {
      const x = (ws[i].x + ws[i].w + ws[i + 1].x) / 2;
      const h = dh * E.oe(stagIn(R, i, Math.max(1, n - 1), 0.5));
      if (h < 1) continue;
      strokePath(R, (c2, ox, oy) => { c2.moveTo(x + ox, L.cy - h + oy); c2.lineTo(x + ox, L.cy + h + oy); },
        { stroke: vGradLine(R, x, L.cy, h, 0.9), lw: Math.max(1, L.px * 0.02), alpha: R.vout * 0.8, glow: 0.2 });
    }
    ws.forEach((w, i) => {
      if (spot[i] <= 0.003) return;
      c.save();
      c.globalAlpha = spot[i] * R.vout * 0.9;
      c.translate(w.cx, L.cy); c.scale(w.w / 2 + 0.45 * L.px, dh * 1.1);
      const rg = c.createRadialGradient(0, 0, 0, 0, 0, 1);
      rg.addColorStop(0, rgba(R.rgb, 0.16)); rg.addColorStop(1, rgba(R.rgb, 0));
      c.fillStyle = rg; c.fillRect(-1, -1, 2, 2);
      c.restore();
    });
    ws.forEach((w, i) => {
      const p = E.oc(stagIn(R, i, n, 0.5));
      paint(R, [w], { alpha: p * R.vout * lerp(R.dimA, 1, spot[i]), glow: spot[i], dy: (1 - p) * 0.15 * L.px });
    });
  } },

  { key: 'bar', name: 'MINIMAL BAR', lay: { row: true, rowGap: 1.0 }, draw(R) {
    const L = R.L, ws = L.words, n = ws.length, st = R.beat, pd = clamp(st * 0.6, 0.1, 0.35), dh = L.capH * 1.35;
    for (let i = 0; i < n - 1; i++) {
      const x = (ws[i].x + ws[i].w + ws[i + 1].x) / 2;
      const h = dh * E.oe(prog(R.t, (i + 1) * st - 0.05, 0.35));
      if (h < 1) continue;
      strokePath(R, (c2, ox, oy) => { c2.moveTo(x + ox, L.cy - h + oy); c2.lineTo(x + ox, L.cy + h + oy); },
        { stroke: vGradLine(R, x, L.cy, h, 0.9), lw: Math.max(1, L.px * 0.02), alpha: R.vout * 0.85, glow: 0.2 });
    }
    ws.forEach((w, i) => {
      const a = i * st, p = E.oc(prog(R.t, a, pd));
      if (p <= 0) return;
      const b = i < n - 1 ? 1 - prog(R.t, a + st, 0.2) : 1;
      paint(R, [w], { alpha: p * R.vout * lerp(R.dimA, 1, b), glow: b, dy: (1 - p) * 0.2 * L.px });
    });
  } },
];

/* ---------- jedna snímka ---------- */
function renderFrame(ctx, W, H, t, S, raw, styleIdx, Doverride) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1; ctx.filter = 'none'; ctx.globalCompositeOperation = 'source-over';
  ctx.shadowBlur = 0; ctx.shadowColor = 'transparent'; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
  ctx.fillStyle = S.bg || '#000'; ctx.fillRect(0, 0, W, H);
  const st = STYLES[styleIdx] || STYLES[0];
  const lines = parseSlide(raw, S.upper);
  if (!lines.length) return;
  const D = Doverride || S.duration;
  const tin = Math.min(S.tin, D / 2), tout = Math.min(S.tout, D / 2);
  const R = {
    ctx, W, H, S, t, D, tin, tout,
    base: Math.min(H, (W * 9) / 16),
    beat: 60 / Math.max(20, S.bpm),
    rgb: hexRGB(S.color), acc: hexRGB(S.accent), dimA: S.dim / 100,
  };
  R.pin = prog(t, 0, tin);
  R.pout = tout > 0 ? clamp((t - (D - tout)) / tout) : 0;
  R.vin = E.oc(R.pin); R.vout = 1 - E.ic(R.pout); R.vis = R.vin * R.vout;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  R.L = makeLayout(R, lines, st.lay || {});
  R.lw = Math.max(1, R.L.px * 0.02);
  ctx.save(); st.draw(R); ctx.restore();
}
