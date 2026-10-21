/* =====================================================================
   LYRICS GENERATOR — analýza skladby (BPM, fáza dôb, priebeh, začiatok/koniec)
   Všetko lokálne v prehliadači, bez knižníc.
   ===================================================================== */
'use strict';

// Načíta súbor do AudioBuffer (48 kHz – rovnaká frekvencia pre prehrávanie aj export).
async function decodeSong(arrayBuf) {
  const oc = new OfflineAudioContext(2, 1, 48000);
  return await oc.decodeAudioData(arrayBuf);
}

function analyzeSong(buf) {
  const sr = buf.sampleRate, len = buf.length, nch = buf.numberOfChannels;
  const ch = [];
  for (let c = 0; c < nch; c++) ch.push(buf.getChannelData(c));
  const mono = i => { let s = 0; for (let c = 0; c < nch; c++) s += ch[c][i]; return s / nch; };

  // 1) priebeh pre časovú os (max. amplitúda v 4000 úsekoch)
  const NP = 4000, peaks = new Float32Array(NP);
  for (let b = 0; b < NP; b++) {
    const i0 = Math.floor((b * len) / NP), i1 = Math.floor(((b + 1) * len) / NP);
    let m = 0;
    for (let i = i0; i < i1; i += 4) { const v = Math.abs(mono(i)); if (v > m) m = v; }
    peaks[b] = m;
  }

  // 2) energia po krátkych oknách → "nástupy" (rast hlasitosti)
  const hop = 512, fr = sr / hop, N = Math.floor(len / hop);
  const le = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    let e = 0;
    const i0 = n * hop, i1 = Math.min(len, i0 + 1024);
    for (let i = i0; i < i1; i += 2) { const v = mono(i); e += v * v; }
    le[n] = Math.log(1e-7 + e);
  }
  const on = new Float32Array(N);
  for (let n = 1; n < N; n++) on[n] = Math.max(0, le[n] - le[n - 1]);
  // odčítať lokálny priemer (zvýrazní údery, potlačí pozvoľné zmeny)
  const W = 12, pre = new Float64Array(N + 1);
  for (let n = 0; n < N; n++) pre[n + 1] = pre[n] + on[n];
  const loc = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    const a = Math.max(0, n - W), b = Math.min(N, n + W + 1);
    loc[n] = (pre[b] - pre[a]) / (b - a);
  }
  for (let n = 0; n < N; n++) on[n] = Math.max(0, on[n] - loc[n]);

  // 3) tempo: autokorelácia nástupov pre 70–180 BPM, mierna preferencia okolo 120
  const at = (x) => { const i = Math.floor(x), f = x - i; return i + 1 < N ? on[i] * (1 - f) + on[i + 1] * f : 0; };
  const score = bpm => {
    const lag = (fr * 60) / bpm;
    let s = 0;
    for (let n = 0; n + 2 * lag < N; n += 1) s += on[n] * (at(n + lag) + 0.5 * at(n + 2 * lag));
    return s;
  };
  let best = 120, bestS = -1;
  for (let bpm = 70; bpm <= 180; bpm += 0.5) {
    const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.8, 2));
    const s = score(bpm) * w;
    if (s > bestS) { bestS = s; best = bpm; }
  }
  // spresnenie
  for (let bpm = best - 0.5; bpm <= best + 0.5; bpm += 0.05) {
    const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.8, 2));
    const s = score(bpm) * w;
    if (s > bestS) { bestS = s; best = bpm; }
  }

  // 4) fáza: posun mriežky dôb, pri ktorom padá najviac nástupov na dobu
  const P = (fr * 60) / best;
  let phase = 0, phS = -1;
  for (let ph = 0; ph < P; ph += 0.5) {
    let s = 0;
    for (let x = ph; x < N; x += P) s += at(x) + 0.5 * (at(x - 1) + at(x + 1));
    if (s > phS) { phS = s; phase = ph; }
  }

  // 5) začiatok a koniec hudby (hlasitosť v 0,1 s oknách)
  const ew = Math.floor(sr * 0.1), NE = Math.floor(len / ew), env = new Float32Array(NE);
  for (let k = 0; k < NE; k++) {
    let e = 0;
    for (let i = k * ew; i < (k + 1) * ew; i += 8) { const v = mono(i); e += v * v; }
    env[k] = Math.sqrt(e / (ew / 8));
  }
  const sorted = Array.from(env).sort((a, b) => a - b);
  const thr = 0.2 * (sorted[Math.floor(sorted.length * 0.9)] || 0);
  let a = 0, b = NE - 1;
  while (a < NE && env[a] <= thr) a++;
  while (b > a && env[b] <= thr) b--;

  return {
    duration: len / sr, peaks, bpm: Math.round(best * 10) / 10,
    // +dĺžka okna: nástup sa v energii prejaví už keď okno začne prekrývať úder
    phase: (phase / fr + 1024 / sr) % (60 / best), start: a * 0.1, end: Math.min(len / sr, (b + 1) * 0.1),
  };
}

/* ---------- upratanie vloženého textu (Genius a pod.) ---------- */
const SECTION_RE = /^\s*\[(?!\d{1,3}:\d)[^\]]*\]\s*$/;            // [Verse 1: …], [Chorus] – nie časy
const JUNK_LINE_RE = /^\s*(\d+\s*Contributors?.*|.*\bLyrics$|\d*\s*Embed|See .+ Live|Get tickets as low as.*|Translations?|Read More)\s*$/i;
function looksLikePastedLyrics(s) {
  return /^\s*\[(verse|chorus|bridge|intro|outro|hook|pre-chorus|refrén|sloha|strofa)[^\]]*\]\s*$/im.test(s) || /You might also like/i.test(s);
}
// rozdelí dlhý riadok na 2–3 vyvážené riadky (najradšej za čiarkou alebo pred zátvorkou)
function wrapLine(line, max = 26) {
  const L = line.length;
  if (L <= max + 4) return line;
  const rows = Math.min(3, Math.ceil(L / max));
  const words = line.split(/\s+/);
  const out = [];
  let curRow = '';
  for (let i = 0; i < words.length; i++) {
    const w = words[i], target = (L / rows) * (out.length + 1), done = out.join(' ').length + (out.length ? 1 : 0);
    const cand = curRow ? curRow + ' ' + w : w;
    const pos = done + cand.length;
    const nice = /[,;]$/.test(curRow) || /^\(/.test(w);
    if (curRow && out.length < rows - 1 && (pos > target + 4 || (nice && pos > target - 6))) { out.push(curRow); curRow = w; }
    else curRow = cand;
  }
  if (curRow) out.push(curRow);
  return out.join('\n');
}
function cleanLyrics(raw, opts = {}) {
  const lines = String(raw || '').replace(/\r/g, '').replace(/ /g, ' ').split('\n');
  const per = opts.perClip || 1, out = [];
  let skip = false, buf = [];
  const flush = () => { if (buf.length) { out.push(buf.join('\n')); buf = []; } };
  lines.forEach((ln, i) => {
    const t = ln.trim();
    if (/^You might also like/i.test(t)) { skip = true; return; }
    if (SECTION_RE.test(t)) { skip = false; flush(); return; }
    if (!t) { skip = false; flush(); return; }
    if (skip || JUNK_LINE_RE.test(t) || (i === 0 && /Lyrics/i.test(t) && lines.length > 3)) return;
    buf.push(wrapLine(t.replace(/\s+/g, ' ')));
    if (buf.length >= per) flush();
  });
  flush();
  return out.join('\n\n');
}

/* ---------- import LRC / SRT → text s časmi ---------- */
function parseTimedLyrics(src) {
  src = String(src || '').replace(/^﻿/, '').replace(/\r/g, '');
  const items = [];
  if (/-->/.test(src)) {
    // SRT (aj WebVTT)
    const ts = s => { const m = /(?:(\d+):)?(\d+):(\d+)[,.](\d+)/.exec(s); return m ? (+(m[1] || 0)) * 3600 + +m[2] * 60 + +m[3] + +('0.' + m[4]) : null; };
    for (const blk of src.split(/\n\s*\n/)) {
      const lines = blk.split('\n').map(l => l.trim()).filter(Boolean);
      const k = lines.findIndex(l => /-->/.test(l));
      if (k < 0) continue;
      const [a, b] = lines[k].split('-->');
      const s = ts(a), e = ts(b);
      const text = lines.slice(k + 1).join('\n').replace(/<[^>]+>/g, '').trim();
      if (s != null && text) items.push({ s, e, text });
    }
  } else {
    // LRC – riadok môže mať viac časov (opakovaný refrén)
    const re = /\[(\d{1,3}):(\d{1,2}(?:[.,]\d{1,3})?)\]/g;
    for (const line of src.split('\n')) {
      const times = [];
      let m, last = 0;
      re.lastIndex = 0;
      while ((m = re.exec(line)) && m.index === last) { times.push(+m[1] * 60 + parseFloat(m[2].replace(',', '.'))); last = re.lastIndex; }
      if (!times.length) continue;
      const text = line.slice(last).replace(/<\d+:\d+(?:[.,]\d+)?>/g, '').trim(); // odstrániť časy slov (enhanced LRC)
      for (const s of times) items.push({ s, e: null, text });
    }
  }
  items.sort((x, y) => x.s - y.s);
  // výstup: klip na každý riadok; pauza, keď SRT titulok skončí skôr než ďalší
  const out = [];
  items.forEach((it, i) => {
    out.push({ time: it.s, text: it.text, gap: !it.text });
    const nx = items[i + 1];
    if (it.e != null && (!nx || nx.s - it.e > 1)) out.push({ time: it.e, text: '', gap: true });
  });
  return out;
}
