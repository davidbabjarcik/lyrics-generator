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
  ob: x => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2), // out-back (mierny prekmit)
  obn: x => { // out-bounce
    const n = 7.5625, d = 2.75;
    if (x < 1 / d) return n * x * x;
    if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
    if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
    return n * (x -= 2.625 / d) * x + 0.984375;
  },
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

/* ---------- text: klipy, riadky, slová, *zvýraznenie*, [mm:ss.cc] časy ---------- */
// Prázdny riadok = nový klip. Riadok začínajúci časom [mm:ss.cc] začína nový klip aj bez
// prázdneho riadka (takto sa dá rovno vložiť LRC). Klip iba s časom = pauza (nič sa nezobrazí).
const TAG_RE = /^[ \t]*\[(\d{1,3}):(\d{1,2}(?:[.,]\d{1,3})?)\][ \t]*/;
const META_RE = /^[ \t]*\[[a-z#]+:[^\]]*\][ \t]*$/i; // LRC hlavička [ar:...], [ti:...]
function getSlides(raw) {
  const res = [];
  let blk = null, pos = 0;
  const flush = () => {
    if (blk) {
      const m = TAG_RE.exec(blk.raw);
      let time = null, text = blk.raw;
      if (m) { time = +m[1] * 60 + parseFloat(m[2].replace(',', '.')); text = blk.raw.slice(m[0].length); }
      if (time != null || text.trim()) res.push({ text, raw: blk.raw, time, gap: time != null && !text.trim(), start: blk.start, end: blk.end });
    }
    blk = null;
  };
  for (const line of String(raw || '').replace(/\r/g, '').split('\n')) {
    const ls = pos; pos += line.length + 1;
    if (!line.trim() || META_RE.test(line)) { flush(); continue; }
    if (blk && TAG_RE.test(line)) flush();
    if (!blk) blk = { start: ls, raw: line }; else blk.raw += '\n' + line;
    blk.end = ls + line.length;
  }
  flush();
  return res;
}
function fmtTag(t) {
  t = Math.max(0, Math.round(t * 100) / 100);
  const m = Math.floor(t / 60), s = t - m * 60;
  return `[${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}]`;
}
// zostaví text späť z klipov (s aktuálnymi časmi)
function joinSlides(slides) {
  return slides.map(s => {
    const body = s.text.replace(/^[ \t]+/, '');
    if (s.time == null) return body;
    return fmtTag(s.time) + (body && body[0] !== '\n' ? ' ' : '') + body;
  }).join('\n\n');
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

// jednotlivé písmená (pozície v rámci slov) – pre efekty po písmenách
function glyphs(R) {
  if (R._g) return R._g;
  const c = R.ctx, L = R.L, out = [];
  c.save(); setFont(c, R.S, L.px);
  L.words.forEach((w, wi) => {
    const chars = Array.from(w.t);
    let acc = '', x0 = 0;
    chars.forEach(ch => {
      acc += ch;
      const x1 = c.measureText(acc).width, cw = Math.max(0, x1 - x0 - L.ls);
      out.push({ t: ch, x: w.x + x0, w: cw, cx: w.x + x0 + cw / 2, yc: w.yc, base: w.base, wi, line: w.line });
      x0 = x1;
    });
  });
  c.restore();
  return (R._g = out);
}
// fáza doby (0..1) a pulz, ktorý na začiatku každej doby vyskočí a doznie
function beatPulse(R, sharp = 7) {
  const hb = R.t - R.tin;
  if (hb <= 0) return 0;
  return Math.exp(-((hb % R.beat) / R.beat) * sharp);
}

/* ---------- 3D: perspektívna projekcia bodu okolo stredu textu ---------- */
// o: { rx, ry (rad), px, py, pz (pivot rotácie relatívne k stredu), cz (posun kamery) }
function proj3(R, x, y, z, o = {}) {
  const f = R.H * 1.4, L = R.L;
  let X = x - L.cx - (o.px || 0), Y = y - L.cy - (o.py || 0), Z = z - (o.pz || 0);
  if (o.ry) { const c = Math.cos(o.ry), s = Math.sin(o.ry); [X, Z] = [X * c + Z * s, -X * s + Z * c]; }
  if (o.rx) { const c = Math.cos(o.rx), s = Math.sin(o.rx); [Y, Z] = [Y * c - Z * s, Y * s + Z * c]; }
  X += o.px || 0; Y += o.py || 0; Z += (o.pz || 0) + (o.cz || 0);
  const k = f / Math.max(f * 0.05, f + Z);
  return { x: L.cx + X * k, y: L.cy + Y * k, k, z: Z, f };
}
// nakreslí písmeno na premietnutom mieste (sx/sy = sploštenie natočením)
function paint3(R, g, P, o = {}, sx = 1, sy = 1) {
  if (P.k <= 0 || Math.abs(sx) < 0.02 || Math.abs(sy) < 0.02) return;
  const c = R.ctx;
  c.save();
  c.translate(P.x, P.y); c.scale(P.k * sx, P.k * sy); c.translate(-g.cx, -g.yc);
  paint(R, [g], o);
  c.restore();
}
// rozmazanie podľa vzdialenosti od roviny ostrosti
const dof = (R, P, amt = 0.25) => Math.min(0.35, Math.abs(P.z) / P.f * amt) * R.L.px;

/* =====================================================================
   ŠTÝLY (01–16 podľa predlohy, 17–44 nové)
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

  /* ---------- 17–26 ---------- */
  { key: 'typewriter', name: 'TYPEWRITER', draw(R) {
    const G = glyphs(R), n = G.length, L = R.L;
    if (!n) return;
    const span = clamp(n * 0.055, Math.max(0.15, R.tin), Math.max(0.2, (R.D - R.tout) * 0.7));
    const shown = (R.t / span) * n;
    G.forEach((g, i) => {
      const p = clamp((shown - i) * 2.5);
      if (p > 0) paint(R, [g], { alpha: p * R.vout, glow: 1, dy: (1 - p) * 0.04 * L.px });
    });
    const k = clamp(Math.floor(shown), 0, n), g = k > 0 ? G[k - 1] : G[0];
    const x = k > 0 ? g.x + g.w + 0.09 * L.px : g.x - 0.12 * L.px;
    const typing = shown < n;
    const blink = typing || ((R.t - span) % R.beat) / R.beat < 0.5;
    if (blink) {
      const h = L.capH * 1.12, yb = g.base + L.capH * 0.08;
      strokePath(R, (c, ox, oy) => { c.moveTo(x + ox, yb - h + oy); c.lineTo(x + ox, yb + oy); },
        { lw: Math.max(1.5, 0.075 * L.px), alpha: R.vout * (typing ? 0.9 : 0.75), glow: 0.8 });
    }
  } },

  { key: 'reveal', name: 'BLUR REVEAL', draw(R) {
    const G = glyphs(R), n = G.length, L = R.L, c = R.ctx;
    const ti = Math.max(R.tin, 0.35), to = Math.max(R.tout, 0.001);
    const rank = G.map((_, i) => i).sort((a, b) => rnd(a, 17) - rnd(b, 17));
    const ord = new Array(n); rank.forEach((gi, r) => { ord[gi] = n > 1 ? r / (n - 1) : 0; });
    G.forEach((g, i) => {
      const p = E.oc(prog(R.t, ord[i] * ti * 0.55, ti * 0.45));
      const q = R.tout > 0 ? E.ic(prog(R.t, R.D - to + (1 - ord[i]) * to * 0.5, to * 0.5)) : 0;
      const a = p * (1 - q);
      if (a <= 0.004) return;
      c.save();
      zoom(c, g.cx, g.yc, 1 + (1 - p) * 0.55 + q * 0.35);
      paint(R, [g], { alpha: a, blur: ((1 - p) * 0.22 + q * 0.18) * L.px, glow: p * (1 - q), dy: -(1 - p) * 0.08 * L.px });
      c.restore();
    });
  } },

  { key: 'wave', name: 'WAVE', draw(R) {
    const G = glyphs(R), n = G.length, L = R.L;
    const amp = 0.07 * L.px * (0.6 + 0.4 * beatPulse(R, 4));
    G.forEach((g, i) => {
      const p = E.oc(stagIn(R, i, n, 0.6)), q = E.ic(stagOut(R, i, n, 0.6));
      const a = p * (1 - q);
      if (a <= 0.004) return;
      const wv = Math.sin((TAU * R.t) / (2 * R.beat) - i * 0.5) * amp;
      paint(R, [g], { alpha: a, dy: (1 - p) * 0.7 * L.px + q * 0.5 * L.px + wv, glow: 0.4 + 0.6 * p });
    });
  } },

  { key: 'neon', name: 'NEON', draw(R) {
    const G = glyphs(R), n = G.length, L = R.L;
    const ti = Math.max(R.tin, 0.3), fr = Math.floor(R.t * 22), bar = Math.floor(R.t / (4 * R.beat));
    const lw = Math.max(1.2, 0.03 * L.px);
    // vypnutá trubica – slabý obrys
    paint(R, G, { mode: 'stroke', lw, alpha: 0.13 * R.vis, glow: 0 });
    G.forEach((g, i) => {
      const thr = clamp(R.t / ti * 1.15 - rnd(i, 23) * 0.6);
      let on = rnd(fr, i * 7 + 1) < thr ? 1 : 0;
      if (R.t >= ti) on = 1;
      // občasné bliknutie počas taktu
      const fl = Math.floor(rnd(bar, 41) * n);
      if (R.t > ti && i === fl && ((R.t / (4 * R.beat)) % 1) < 0.06 && rnd(fr, 3) < 0.6) on = 0.25;
      if (R.tout > 0 && R.t > R.D - R.tout) on *= rnd(fr, i * 3 + 9) < 1 - R.pout ? 1 : 0.15;
      if (on <= 0) return;
      paint(R, [g], { mode: 'stroke', lw, alpha: on * R.vout, glow: 1.5 * on });
      paint(R, [g], { alpha: on * 0.22 * R.vout, glow: 0 });
    });
  } },

  { key: 'karaoke', name: 'KARAOKE', draw(R) {
    const L = R.L, c = R.ctx, ws = L.words;
    const a0 = R.vis, dy = (1 - R.vin) * 0.15 * L.px;
    const fillRGB = R.acc.join() === R.rgb.join() ? R.rgb : R.acc;
    paint(R, ws, { alpha: a0 * Math.max(R.dimA, 0.12), glow: 0, dy });
    const t0 = R.tin * 0.6, t1 = Math.max(t0 + 0.2, R.D - R.tout - 0.15);
    const tot = ws.reduce((s, w) => s + w.t.length + 1, 0);
    let pos = prog(R.t, t0, t1 - t0) * tot;
    for (const w of ws) {
      const len = w.t.length + 1, f = clamp(pos / len);
      pos -= len;
      if (f <= 0) break;
      c.save();
      if (f < 1) { c.beginPath(); c.rect(w.x - L.px, w.yc - 2 * L.px, L.px + w.w * f, 4 * L.px); c.clip(); }
      paint(R, [w], { alpha: a0, glow: 1, dy, rgb: fillRGB });
      c.restore();
    }
  } },

  { key: 'bounce', name: 'BOUNCE', draw(R) {
    const L = R.L, ws = L.words, n = ws.length, c = R.ctx;
    const ti = Math.max(R.tin, 0.4), pulse = beatPulse(R, 8);
    ws.forEach((w, i) => {
      const s0 = n > 1 ? (i / (n - 1)) * ti * 0.5 : 0;
      const p = prog(R.t, s0, ti * 0.5 + 0.25);
      if (p <= 0) return;
      const b = E.obn(p), q = R.tout > 0 ? E.ic(prog(R.t, R.D - R.tout + (i / Math.max(1, n)) * R.tout * 0.4, R.tout * 0.6)) : 0;
      const land = p > 0.36 && p < 0.6 ? Math.sin(((p - 0.36) / 0.24) * Math.PI) : 0;
      c.save();
      c.translate(w.cx, w.base); c.scale(1 + land * 0.06, 1 - land * 0.1 + pulse * 0.05 * (1 - q)); c.translate(-w.cx, -w.base);
      paint(R, [w], { alpha: clamp(p * 4) * (1 - q), dy: -(1 - b) * 1.4 * L.px + q * q * 1.6 * L.px });
      c.restore();
    });
  } },

  { key: 'zoom', name: 'ZOOM THROUGH', draw(R) {
    const L = R.L, c = R.ctx, ti = Math.max(R.tin, 0.2);
    const sc = t => {
      const p = E.oe(prog(t, 0, ti)), q = R.tout > 0 ? E.ie(prog(t, R.D - R.tout, R.tout)) : 0;
      return { s: lerp(0.15, 1, p) * lerp(1, 5, q), a: clamp(prog(t, 0, ti * 0.3)) * (1 - E.ic(clamp(q * 1.3))), p, q };
    };
    const cur = sc(R.t);
    for (let j = 6; j >= 1; j--) {
      const g = sc(R.t - j * 0.025);
      if (Math.abs(g.s - cur.s) < 0.004) continue;
      c.save(); zoom(c, L.cx, L.cy, g.s);
      paint(R, L.words, { alpha: g.a * 0.16 * (1 - j / 7), glow: 0 });
      c.restore();
    }
    const hb = beatPulse(R, 9) * (1 - cur.q);
    c.save(); zoom(c, L.cx, L.cy, cur.s * (1 + 0.02 * hb));
    paint(R, L.words, { alpha: cur.a, blur: ((1 - cur.p) * 0.15 + cur.q * 0.2) * L.px });
    c.restore();
  } },

  { key: 'echo', name: 'ECHO', draw(R) {
    const L = R.L, c = R.ctx, p = E.oc(R.pin);
    // prílet troch kópií do stredu
    if (R.pin < 1) for (const k of [1.6, 1.3]) {
      c.save(); zoom(c, L.cx, L.cy, lerp(k, 1, p));
      paint(R, L.words, { mode: 'stroke', alpha: (1 - p) * 0.5, glow: 0.3 });
      c.restore();
    }
    // na každú dobu sa z textu odlepí obrys a rozpína sa
    const hb = R.t - R.tin;
    if (hb > 0) for (let k = 0; k < 3; k++) {
      const age = (hb % R.beat) + k * R.beat;
      if (age > hb) break;
      const f = age / (1.6 * R.beat);
      if (f >= 1) continue;
      c.save(); zoom(c, L.cx, L.cy, 1 + E.oc(f) * 0.32);
      paint(R, L.words, { mode: 'stroke', alpha: (1 - f) * 0.55 * R.vout, glow: 0.4 * (1 - f) });
      c.restore();
    }
    c.save(); zoom(c, L.cx, L.cy, lerp(0.92, 1, p) * (1 + 0.015 * beatPulse(R, 8)));
    paint(R, L.words, { alpha: p * R.vout, blur: E.ic(R.pout) * 0.1 * L.px });
    c.restore();
  } },

  { key: 'flip', name: 'FLIP 3D', draw(R) {
    const G = glyphs(R), n = G.length, c = R.ctx;
    G.forEach((g, i) => {
      const p = stagIn(R, i, n, 0.65), q = stagOut(R, i, n, 0.65);
      if (p <= 0) return;
      const ang = (1 - E.ob(p)) * (Math.PI / 2) + E.ic(q) * (Math.PI / 2);
      const k = Math.cos(ang);
      if (Math.abs(k) < 0.03 || q >= 1) return;
      c.save();
      c.translate(g.cx, g.yc); c.scale(1, k); c.translate(-g.cx, -g.yc);
      paint(R, [g], { alpha: clamp(p * 3) * (0.35 + 0.65 * Math.abs(k)) * (1 - E.ic(q) * 0.3), glow: Math.abs(k) });
      c.restore();
    });
  } },

  { key: 'rgb', name: 'RGB SPLIT', draw(R) {
    const L = R.L, c = R.ctx, p = E.oe(R.pin), q = E.ic(R.pout);
    const off = ((1 - p) * 0.3 + q * 0.3 + beatPulse(R, 10) * 0.06 * (1 - q)) * L.px;
    const fs = Math.floor(R.t * 30), shake = (1 - p) * 0.08 * L.px;
    const sx = (rnd(fs, 1) - 0.5) * shake, sy = (rnd(fs, 2) - 0.5) * shake;
    const a = clamp(R.pin * 2.5) * (1 - q);
    const [r, g, b] = R.rgb;
    c.save();
    c.globalCompositeOperation = 'lighter';
    zoom(c, L.cx, L.cy, lerp(1.25, 1, p) * lerp(1, 1.1, q));
    paint(R, L.words, { rgb: [r, 0, 0], dx: sx - off, dy: sy, alpha: a, glow: 0.7 });
    paint(R, L.words, { rgb: [0, g, 0], dx: sx, dy: sy + off * 0.15, alpha: a, glow: 0.7 });
    paint(R, L.words, { rgb: [0, 0, b], dx: sx + off, dy: sy, alpha: a, glow: 0.7 });
    c.restore();
  } },

  /* ---------- 27–38 ---------- */
  { key: 'scramble', name: 'SCRAMBLE', draw(R) {
    const G = glyphs(R), n = G.length, L = R.L, CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&@*+=?';
    const ti = Math.max(R.tin, 0.5), fr = Math.floor(R.t * 18);
    const to = Math.max(R.tout, 0.001), outS = R.D - to;
    G.forEach((g, i) => {
      if (g.t.trim() === '') return;
      const ord = n > 1 ? i / (n - 1) : 0;
      const appear = ord * ti * 0.35, settle = ti * (0.45 + 0.55 * ord * 0.9 + rnd(i, 3) * 0.1);
      const unset = R.tout > 0 ? outS + (1 - ord) * to * 0.5 : Infinity, gone = R.tout > 0 ? outS + to * (0.55 + 0.45 * (1 - ord)) : Infinity;
      if (R.t < appear || R.t >= gone) return;
      if (R.t >= settle && R.t < unset) { paint(R, [g], { alpha: 1, glow: 1 }); return; }
      const ch = CH[Math.floor(rnd(fr, i * 13 + 7) * CH.length)];
      paint(R, [{ t: ch, x: g.x, base: g.base }], { alpha: 0.75, glow: 0.3, rgb: mixRGB(R.rgb, R.acc, 0.5) });
    });
  } },

  { key: 'particles', name: 'PARTICLES', draw(R) {
    const G = glyphs(R), n = G.length, L = R.L, c = R.ctx, K = 14, sz = Math.max(1, 0.04 * L.px);
    const ti = Math.max(R.tin, 0.5), to = Math.max(R.tout, 0.001);
    c.save();
    c.globalCompositeOperation = 'lighter';
    G.forEach((g, i) => {
      if (!g.t.trim()) return;
      const ord = n > 1 ? i / (n - 1) : 0;
      const p = E.ioc(prog(R.t, ord * ti * 0.3, ti * 0.7));
      const q = R.tout > 0 ? E.ic(prog(R.t, R.D - to + rnd(i, 9) * to * 0.4, to * 0.6)) : 0;
      const form = p * (1 - q);
      if (form > 0.85) paint(R, [g], { alpha: (form - 0.85) / 0.15, glow: 1 });
      if (form >= 0.999) return;
      for (let k = 0; k < K; k++) {
        const tx = g.x + rnd(i * 31 + k, 1) * g.w, ty = g.base - rnd(i * 31 + k, 2) * L.capH;
        const ang = rnd(i * 31 + k, 3) * TAU, dist = (0.6 + rnd(i * 31 + k, 4) * 2.2) * L.px;
        const sx = tx + Math.cos(ang) * dist, sy = ty + Math.sin(ang) * dist * 0.6 + (q > 0 ? -q * 0.6 * L.px : 0);
        const x = lerp(sx, tx, form), y = lerp(sy, ty, form), a = (q > 0 ? 1 - q : p) * (1 - Math.max(0, form - 0.85) / 0.15) * R.vout;
        if (a <= 0.01) continue;
        c.fillStyle = rgba(R.rgb, Math.min(1, a));
        c.fillRect(x - sz / 2, y - sz / 2, sz, sz);
      }
    });
    c.restore();
  } },

  { key: 'sweep', name: 'LIGHT SWEEP', draw(R) {
    const L = R.L, c = R.ctx, ti = Math.max(R.tin, 0.4);
    const base = R.vis * Math.min(0.4, Math.max(0.25, R.dimA));
    paint(R, L.words, { alpha: base, glow: 0.2, dy: (1 - R.vin) * 0.12 * L.px });
    // pás svetla: pri nábehu a potom každé 4 doby
    let ph;
    if (R.t < ti) ph = R.t / ti;
    else { const per = 4 * R.beat; ph = ((R.t - ti) % per) / (per * 0.6); }
    if (ph >= 1) return;
    const w = L.blockW + 4 * L.px, x = L.left - 2 * L.px + E.ioc(ph) * w, bw = 2 * L.px;
    c.save();
    c.beginPath(); c.rect(x - bw, 0, bw * 2, R.H); c.clip();
    const g = c.createLinearGradient(x - bw, 0, x + bw, 0);
    g.addColorStop(0, rgba(R.acc, 0)); g.addColorStop(0.5, rgba(R.acc, 1)); g.addColorStop(1, rgba(R.acc, 0));
    paint(R, L.words, { alpha: R.vis, glow: 1.6, fill: g, rgb: R.acc, dy: (1 - R.vin) * 0.12 * L.px });
    paint(R, L.words, { alpha: R.vis * 0.6, glow: 0, fill: g, dy: (1 - R.vin) * 0.12 * L.px });
    c.restore();
    c.save(); c.beginPath(); c.rect(x - bw * 0.35, 0, bw * 0.7, R.H); c.clip();
    paint(R, L.words, { alpha: R.vis, glow: 1.4, rgb: R.acc, dy: (1 - R.vin) * 0.12 * L.px });
    c.restore();
  } },

  { key: 'wipe', name: 'WIPE', draw(R) {
    const L = R.L, c = R.ctx, ti = Math.max(R.tin, 0.3);
    const p = E.ioc(prog(R.t, 0, ti)), q = R.tout > 0 ? E.ioc(prog(R.t, R.D - R.tout, R.tout)) : 0;
    const x0 = L.left - 0.3 * L.px, x1 = L.right + 0.3 * L.px;
    const xa = lerp(x0, x1, q), xb = lerp(x0, x1, p);
    if (xb - xa > 0.5) {
      c.save(); c.beginPath(); c.rect(xa, 0, xb - xa, R.H); c.clip();
      paint(R, L.words, {});
      c.restore();
    }
    const moving = (p > 0 && p < 1) || (q > 0 && q < 1);
    if (moving) {
      const x = p < 1 ? xb : xa, h = L.blockH / 2 + 0.45 * L.px;
      strokePath(R, (c2, ox, oy) => { c2.moveTo(x + ox, L.cy - h + oy); c2.lineTo(x + ox, L.cy + h + oy); },
        { lw: Math.max(1.5, 0.04 * L.px), alpha: 1, glow: 1.2 });
    }
  } },

  { key: 'strobe', name: 'STROBE', draw(R) {
    const L = R.L, c = R.ctx, fr = Math.floor(R.t * 24);
    let a, gl, s = 1;
    if (R.t < R.tin) { const on = rnd(fr, 5) < 0.35 + 0.65 * R.pin; a = on ? 1 : 0.06; gl = on ? 1.4 : 0; }
    else { const pl = beatPulse(R, 6); a = lerp(0.42, 1, pl); gl = 0.2 + 1.3 * pl; s = 1 + 0.03 * pl; }
    if (R.tout > 0 && R.t > R.D - R.tout) { const on = rnd(fr, 8) > R.pout; a *= on ? 1 - R.pout * 0.5 : 0; }
    c.save(); zoom(c, L.cx, L.cy, s);
    paint(R, L.words, { alpha: a, glow: gl });
    c.restore();
  } },

  { key: 'extrude', name: 'EXTRUDE 3D', draw(R) {
    const L = R.L, N = 14, p = E.oc(R.pin), q = E.ic(R.pout);
    const ang = -Math.PI / 4 + 0.35 * Math.sin((TAU * R.t) / (8 * R.beat));
    const depth = 0.32 * L.px * p * (1 - q) * (1 + 0.15 * beatPulse(R, 6));
    for (let k = N; k >= 1; k--) {
      const f = k / N;
      paint(R, L.words, { mode: 'stroke', dx: -Math.cos(ang) * depth * f, dy: -Math.sin(ang) * depth * f, alpha: (1 - f) * 0.5 * R.vis + 0.05 * R.vis, glow: 0, lw: Math.max(1, 0.012 * L.px) });
    }
    paint(R, L.words, { alpha: R.vis, glow: 0.8 });
  } },

  { key: 'swing', name: 'SWING', draw(R) {
    const L = R.L, ws = L.words, n = ws.length, c = R.ctx;
    ws.forEach((w, i) => {
      const p = stagIn(R, i, n, 0.5), q = stagOut(R, i, n, 0.5);
      if (p <= 0) return;
      const damp = Math.exp(-Math.max(0, R.t - (n > 1 ? (i / (n - 1)) * R.tin * 0.5 : 0)) * 2.2);
      const ang = (1 - E.oc(p)) * 1.2 + damp * 0.35 * Math.sin(R.t * 7 + i) + 0.04 * Math.sin((TAU * R.t) / (2 * R.beat) + i * 0.9) + E.ic(q) * 0.9 * (i % 2 ? 1 : -1);
      const py = w.base - L.capH * 1.25;
      c.save();
      c.translate(w.cx, py); c.rotate(ang * (i % 2 ? -1 : 1)); c.translate(-w.cx, -py);
      paint(R, [w], { alpha: clamp(p * 2) * (1 - E.ic(q)), dy: E.ic(q) * 0.8 * L.px });
      c.restore();
    });
  } },

  { key: 'spiral', name: 'SPIRAL', draw(R) {
    const G = glyphs(R), n = G.length, L = R.L, c = R.ctx;
    G.forEach((g, i) => {
      const p = E.oc(stagIn(R, i, n, 0.55)), q = E.ic(stagOut(R, i, n, 0.55, true));
      const f = p * (1 - q);
      if (f <= 0.01) return;
      const a0 = (i / Math.max(1, n)) * TAU + (1 - f) * 3, rad = (1 - f) * 2.2 * L.px;
      const x = g.cx + Math.cos(a0) * rad - g.cx, y = Math.sin(a0) * rad;
      c.save();
      c.translate(g.cx + x, g.yc + y); c.rotate((1 - f) * Math.PI * 1.5); c.scale(lerp(0.3, 1, f), lerp(0.3, 1, f)); c.translate(-g.cx, -g.yc);
      paint(R, [g], { alpha: f, glow: f });
      c.restore();
    });
  } },

  { key: 'maskup', name: 'MASK UP', draw(R) {
    const L = R.L, c = R.ctx, n = L.lines.length;
    L.lines.forEach((ln, i) => {
      const p = E.oe(stagIn(R, i, n, 0.35)), q = E.ie(stagOut(R, i, n, 0.35));
      const top = ln.base - L.capH * 1.08, bot = ln.base + L.capH * 0.28;
      c.save(); c.beginPath(); c.rect(-R.W, top - 0.04 * L.px, R.W * 3, bot - top + 0.08 * L.px); c.clip();
      paint(R, ln.words, { dy: (1 - p) * (bot - top) - q * (bot - top), glow: 0.8 });
      c.restore();
    });
    const k = E.oe(R.pin) * (1 - E.ic(R.pout)), hw = (L.blockW / 2 + 0.3 * L.px) * k;
    if (hw > 1) strokePath(R, (c2, ox, oy) => { const y = L.bottom + 0.35 * L.px + oy; c2.moveTo(L.cx - hw + ox, y); c2.lineTo(L.cx + hw + ox, y); },
      { lw: Math.max(1, 0.018 * L.px), alpha: 0.7, glow: 0.5 });
  } },

  { key: 'heartbeat', name: 'HEARTBEAT', draw(R) {
    const L = R.L, c = R.ctx, hb = R.t - R.tin;
    let s = E.ob(clamp(R.pin)) * lerp(1, 1.25, E.ic(R.pout)), g = 0.4;
    if (hb > 0) {
      const ph = (hb % R.beat) / R.beat;
      const k = Math.exp(-ph * 14) + 0.6 * Math.exp(-Math.abs(ph - 0.22) * 22);
      s *= 1 + 0.055 * k * R.vout; g += 1.1 * k;
    }
    if (s <= 0.01) return;
    c.save(); zoom(c, L.cx, L.cy, s);
    paint(R, L.words, { alpha: clamp(R.pin * 2) * R.vout, glow: g, rgb: mixRGB(R.rgb, R.acc, clamp(g - 0.4)) });
    c.restore();
  } },

  { key: 'rain', name: 'RAIN', draw(R) {
    const G = glyphs(R), L = R.L, ti = Math.max(R.tin, 0.5), to = Math.max(R.tout, 0.001);
    G.forEach((g, i) => {
      const d = rnd(i, 21) * ti * 0.55, p = prog(R.t, d, ti * 0.45);
      if (p <= 0) return;
      const od = R.tout > 0 ? R.D - to + rnd(i, 22) * to * 0.5 : Infinity, q = R.tout > 0 ? prog(R.t, od, to * 0.5) : 0;
      if (q >= 1) return;
      const y = -(1 - E.obn(p)) * (g.base + L.px) + q * q * 2 * L.px;
      paint(R, [g], { alpha: clamp(p * 3) * (1 - q), dy: y, glow: 0.6 + 0.4 * p });
    });
  } },

  { key: 'shatter', name: 'SHATTER', draw(R) {
    const L = R.L, c = R.ctx, N = 9, y0 = L.top - 0.15 * L.px, h = (L.blockH + 0.3 * L.px) / N;
    for (let k = 0; k < N; k++) {
      const side = k % 2 ? 1 : -1, r1 = rnd(k, 31), r2 = rnd(k, 32);
      const p = E.oe(prog(R.t, r1 * R.tin * 0.4, Math.max(0.05, R.tin * 0.6)));
      const q = R.tout > 0 ? E.ie(prog(R.t, R.D - R.tout + r2 * R.tout * 0.4, R.tout * 0.6)) : 0;
      const dx = side * ((1 - p) * (0.4 + r1) * 1.6 + q * (0.4 + r2) * 1.6) * L.px * 2;
      const dy = ((1 - p) * (r2 - 0.5) + q * (r1 - 0.5)) * 0.6 * L.px;
      const a = clamp(p * 1.5) * (1 - q);
      if (a <= 0.01) continue;
      c.save(); c.beginPath(); c.rect(-R.W, y0 + k * h, R.W * 3, h + 0.5); c.clip();
      paint(R, L.words, { dx, dy, alpha: a, glow: 0.6 * a });
      c.restore();
    }
  } },

  /* ---------- 39–44: 3D priestor ---------- */
  { key: 'fly3d', name: 'FLY THROUGH 3D', draw(R) {
    const G = glyphs(R), L = R.L, c = R.ctx, f = R.H * 1.4, ti = Math.max(R.tin, 0.4);
    // hviezdne pole letiace ku kamere
    const speed = 0.5 + 0.5 * (1 - R.pin) + 1.5 * E.ic(R.pout);
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let s = 0; s < 90; s++) {
      const x0 = (rnd(s, 51) - 0.5) * R.W * 1.6, y0 = (rnd(s, 52) - 0.5) * R.H * 1.6;
      const z = ((rnd(s, 53) * 6 - R.t * speed * 1.2) % 6 + 6) % 6 * f;
      const k = f / (f + z), k2 = f / (f + z + f * 0.08 * speed);
      const a = clamp(1 - z / (6 * f)) * 0.8 * R.vis;
      c.strokeStyle = rgba(R.rgb, a); c.lineWidth = Math.max(1, 0.012 * L.px * k * 3);
      c.beginPath(); c.moveTo(L.cx + x0 * k2, L.cy + y0 * k2); c.lineTo(L.cx + x0 * k, L.cy + y0 * k); c.stroke();
    }
    c.restore();
    const p = E.oe(prog(R.t, 0, ti)), q = R.tout > 0 ? E.ie(prog(R.t, R.D - R.tout, R.tout)) : 0;
    const z = (1 - p) * 7 * f - q * 0.92 * f;
    const o = { ry: 0.12 * Math.sin(R.t * 0.9), rx: 0.08 * Math.sin(R.t * 0.7 + 1) };
    const list = G.map(g => ({ g, P: proj3(R, g.cx, g.yc, z, o) })).sort((a, b) => b.P.z - a.P.z);
    for (const { g, P } of list) paint3(R, g, P, { alpha: clamp(p * 3) * (1 - q), blur: dof(R, P, 0.06), glow: 0.5 + 0.5 * p });
  } },

  { key: 'orbit', name: 'ORBIT 3D', draw(R) {
    const G = glyphs(R), L = R.L, p = E.oc(R.pin), q = E.ic(R.pout);
    const ry = (1 - p) * -1.3 + 0.38 * Math.sin((TAU * R.t) / (16 * R.beat)) + q * 1.3;
    const rx = 0.22 * Math.sin((TAU * R.t) / (12 * R.beat) + 0.5) * p;
    const o = { ry, rx };
    const list = G.map(g => ({ g, P: proj3(R, g.cx, g.yc, 0, o) })).sort((a, b) => b.P.z - a.P.z);
    for (const { g, P } of list) paint3(R, g, P, { alpha: R.vis, blur: dof(R, P, 0.5), glow: clamp(1 - Math.abs(P.z) / (P.f * 0.4)) }, Math.cos(ry), Math.cos(rx));
  } },

  { key: 'cylinder', name: 'CYLINDER', draw(R) {
    const G = glyphs(R), L = R.L, rc = Math.max(L.blockW * 0.85, L.px * 2);
    const p = E.oc(R.pin), q = E.ic(R.pout);
    const rot = (1 - p) * -Math.PI * 1.1 + q * Math.PI * 1.1 + 0.18 * Math.sin((TAU * R.t) / (8 * R.beat)) * p;
    const list = G.map(g => {
      const th = (g.cx - L.cx) / rc + rot;
      const X = L.cx + Math.sin(th) * rc, Z = (1 - Math.cos(th)) * rc;
      return { g, th, P: proj3(R, X, g.yc, Z, { rx: 0.18 }) };
    }).sort((a, b) => b.P.z - a.P.z);
    for (const { g, th, P } of list) {
      const front = Math.cos(th);
      paint3(R, g, P, { alpha: R.vis * (front > 0 ? 1 : 0.18), glow: Math.max(0, front), blur: front < 0 ? 0.04 * L.px : 0 }, front, 1);
    }
  } },

  { key: 'floor', name: 'FLOOR 3D', draw(R) {
    const G = glyphs(R), L = R.L, p = E.ioc(prog(R.t, 0, Math.max(R.tin, 0.5))), q = E.ie(R.pout);
    const rx = (1 - p) * 1.35 - q * 1.35 + 0.05 * beatPulse(R, 6);
    const o = { rx, py: L.bottom - L.cy };
    const list = G.map(g => ({ g, P: proj3(R, g.cx, g.yc, 0, o) })).sort((a, b) => b.P.z - a.P.z);
    for (const { g, P } of list) paint3(R, g, P, { alpha: clamp(p * 2.5) * (1 - q), blur: dof(R, P, 0.3), glow: p * (1 - q) }, 1, Math.cos(rx));
    // podlaha – mriežka čiar k horizontu
    const a = 0.35 * R.vis;
    if (a > 0.01) strokePath(R, (c2, ox, oy) => {
      for (let i = -6; i <= 6; i++) {
        const A = proj3(R, L.cx + i * L.px * 0.9, L.bottom + 0.15 * L.px, 0, { rx: 1.5707, py: L.bottom - L.cy }), B = proj3(R, L.cx + i * L.px * 0.9, L.bottom + 0.15 * L.px + 6 * L.px, 0, { rx: 1.5707, py: L.bottom - L.cy });
        c2.moveTo(A.x + ox, A.y + oy); c2.lineTo(B.x + ox, B.y + oy);
      }
    }, { alpha: a * 0.5, glow: 0, lw: Math.max(1, 0.01 * L.px) });
  } },

  { key: 'depth', name: 'DEPTH LAYERS', draw(R) {
    const L = R.L, ws = L.words, n = ws.length, f = R.H * 1.4, G = glyphs(R);
    const drift = { ry: 0.14 * Math.sin((TAU * R.t) / (8 * R.beat)), rx: 0.06 * Math.cos((TAU * R.t) / (10 * R.beat)) };
    const items = [];
    ws.forEach((w, i) => {
      const lay = ((i % 3) - 1) * 0.25 * f;            // každé slovo v inej hĺbke
      const p = E.oe(stagIn(R, i, n, 0.6)), q = E.ie(stagOut(R, i, n, 0.6));
      const z = lay + (1 - p) * (rnd(i, 61) < 0.5 ? 3 : -0.7) * f - q * 0.8 * f;
      G.filter(g => g.wi === i).forEach(g => items.push({ g, a: clamp(p * 2) * (1 - q), P: proj3(R, g.cx, g.yc, z, drift) }));
    });
    items.sort((a, b) => b.P.z - a.P.z);
    for (const it of items) paint3(R, it.g, it.P, { alpha: it.a, blur: dof(R, it.P, 0.12), glow: clamp(1 - Math.abs(it.P.z) / (it.P.f * 0.5)) });
  } },

  { key: 'cube', name: 'CUBE 3D', draw(R) {
    const G = glyphs(R), L = R.L, d = Math.max(L.blockW, L.blockH) / 2 + 0.4 * L.px;
    const p = E.ioc(prog(R.t, 0, Math.max(R.tin, 0.4))), q = R.tout > 0 ? E.ioc(prog(R.t, R.D - R.tout, R.tout)) : 0;
    const ry = (1 - p) * -Math.PI / 2 + q * Math.PI / 2 + 0.03 * Math.sin((TAU * R.t) / (4 * R.beat));
    const o = { ry, pz: d, rx: -0.12 };
    const list = G.map(g => ({ g, P: proj3(R, g.cx, g.yc, 0, o) })).sort((a, b) => b.P.z - a.P.z);
    const face = Math.cos(ry);
    for (const { g, P } of list) paint3(R, g, P, { alpha: R.vis * clamp(face * 1.4), glow: face }, face, 1);
    // hrany kocky
    strokePath(R, (c2, ox, oy) => {
      const hw = d, hh = L.blockH / 2 + 0.4 * L.px;
      const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => proj3(R, L.cx + x, L.cy + y, 0, o));
      c2.moveTo(pts[0].x + ox, pts[0].y + oy); pts.slice(1).forEach(P => c2.lineTo(P.x + ox, P.y + oy)); c2.closePath();
    }, { alpha: 0.45 * R.vis * clamp(face * 2), glow: 0.5, lw: Math.max(1, 0.015 * L.px) });
  } },
];

/* ---------- AUTO režim: iný štýl pre každý klip (deterministicky) ---------- */
const AUTO_SETS = {
  all: ['clean', 'fade', 'outline', 'wordbyword', 'slide', 'stack', 'lines', 'scale', 'split', 'frame', 'chain', 'glitch', 'circle',
    'fadewords', 'bar', 'typewriter', 'reveal', 'wave', 'neon', 'karaoke', 'bounce', 'zoom', 'echo', 'flip', 'rgb',
    'scramble', 'particles', 'sweep', 'wipe', 'strobe', 'extrude', 'swing', 'spiral', 'maskup', 'heartbeat', 'rain', 'shatter',
    'fly3d', 'orbit', 'cylinder', 'floor', 'depth', 'cube'],
  calm: ['clean', 'fade', 'lines', 'frame', 'circle', 'fadewords', 'typewriter', 'reveal', 'karaoke', 'flip', 'sweep', 'wipe', 'maskup', 'orbit', 'depth', 'particles'],
  energy: ['outline', 'slide', 'stack', 'scale', 'split', 'chain', 'glitch', 'wordbyword', 'bar', 'wave', 'neon', 'bounce', 'zoom', 'echo', 'rgb',
    'scramble', 'strobe', 'extrude', 'swing', 'spiral', 'heartbeat', 'rain', 'shatter', 'fly3d', 'cylinder', 'floor', 'cube'],
  space: ['fly3d', 'orbit', 'cylinder', 'floor', 'depth', 'cube', 'extrude', 'zoom', 'flip', 'spiral'],
};
function autoStyles(texts, S) {
  const keys = AUTO_SETS[S.autoSet] || AUTO_SETS.all;
  const set = keys.map(k => STYLES.findIndex(s => s.key === k)).filter(i => i >= 0);
  const hi = STYLES.findIndex(s => s.key === 'highlight');
  const seed = (S.autoSeed | 0) * 7919 + 13, out = [];
  let prev = -1, prev2 = -1;
  texts.forEach((tx, i) => {
    let k;
    if (/\*/.test(tx) && rnd(i, seed + 5) < 0.75) k = hi;
    else {
      let j = Math.floor(rnd(i, seed) * set.length);
      for (let tries = 0; tries < set.length && (set[j] === prev || set[j] === prev2); tries++) j = (j + 1) % set.length;
      k = set[j];
    }
    out.push(k); prev2 = prev; prev = k;
  });
  return out;
}

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

/* ---------- skladba: klipy na časovej osi ---------- */
// clips: [{ text, s, e, style }] zoradené podľa času, bez prekryvu
function clipAt(clips, T) {
  for (let k = 0; k < clips.length; k++) if (T >= clips[k].s && T < clips[k].e) return k;
  return -1;
}
function renderSongFrame(ctx, W, H, T, S, clips) {
  const k = clipAt(clips, T);
  if (k < 0) { renderFrame(ctx, W, H, 0, S, '', 0); return -1; }
  const c = clips[k];
  renderFrame(ctx, W, H, T - c.s, S, c.text, c.style, c.e - c.s);
  return k;
}
