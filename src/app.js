/* =====================================================================
   LYRICS GENERATOR — UI, náhľad, skladba, export MP4
   ===================================================================== */
'use strict';
(function () {
  const $ = id => document.getElementById(id);
  const LS_KEY = 'lyricsgen.v1', LS_FONTS = 'lyricsgen.fonts';

  const DEF = {
    text: "TAKE ME\nHIGHER\n\nI JUST WANNA\n*FEEL* ALIVE\n\nWE'LL BE\nTOGETHER",
    style: 0, fontSel: 'Montserrat', weight: 900, otherFamily: '',
    upper: true, size: 14, tracking: 0, leading: 1.0, safe: 86, posX: 0, posY: 0,
    color: '#ffffff', accent: '#ffffff', glow: 45, dim: 38,
    duration: 4, tin: 0.8, tout: 0.6, bpm: 120,
    w: 1920, h: 1080, fps: 30, quality: 'high', ssaa: true, scope: 'current',
    mode: 'clips', auto: false, autoSet: 'all', autoSeed: 1, lead: 0.2, songMax: 10, withAudio: true,
    alignLang: '', alignModel: 'medium', alignVocals: true,
  };
  const FONTS = [
    { g: 'Vstavané (fungujú všade)', items: [['Montserrat', 900], ['Inter', 900], ['Poppins', 800], ['Archivo Black', 400], ['Anton', 400], ['Bebas Neue', 400], ['Oswald', 700], ['Barlow Condensed', 800]] },
    { g: 'Systémové (Windows)', items: [['Arial Black', 900], ['Impact', 400], ['Segoe UI', 900], ['Bahnschrift', 700], ['Arial', 700]] },
  ];
  const RES = [[1920, 1080], [3840, 2160], [1280, 720], [2560, 1440], [1080, 1920]];
  // bity na pixel a snímku – čierne pozadie sa kóduje lacno, takže reálne súbory sú menšie
  const BPP = { std: 0.1, high: 0.2, max: 0.35, ultra: 0.6 };

  let S = Object.assign({}, DEF);
  try { const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); if (s) Object.assign(S, s); } catch (e) {}
  if (!BPP[S.quality]) S.quality = 'high';
  const customFonts = [];
  let slides = [], cur = 0, tNow = 0, playing = true, dirty = true, hover = -1;
  let dirHandle = null, busy = false, cancelFlag = false;
  let autoList = [], clips = [];
  let song = null;               // { name, buf, duration, peaks, bpm, phase, start, end }
  let actx = null, src = null, t0 = 0;
  let tap = null;                // režim ťukania { idx, hist }
  let view = { a: 0, b: 1 };     // výrez časovej osi (s)

  /* ---------- pomocné ---------- */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const even = v => Math.max(2, Math.round(v / 2) * 2);
  let saveT = 0;
  function save() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) {} }, 250); }
  function applyFamily() { S.family = S.fontSel === '__other' ? (S.otherFamily.trim() || 'Montserrat') : S.fontSel; }
  function slideText(i = cur) { return slides[i] ? slides[i].text : ''; }
  const songMode = () => S.mode === 'song' && !!song;
  const styleOf = i => (S.auto && autoList[i] != null ? autoList[i] : S.style);
  function clipOf(i) { return clips.find(c => c.i === i) || null; }
  function curD() { const c = songMode() ? clipOf(cur) : null; return c ? c.e - c.s : S.duration; }
  function poseTime(D = curD()) { return clamp(D - Math.min(S.tout, D / 2) - 0.03, Math.min(S.tin, D / 2) + 0.01, D); }
  function totalDur() { return songMode() ? song.duration : S.duration; }
  function bitrate(W, H, fps) { return Math.round(Math.min(240e6, Math.max(2e6, W * H * fps * BPP[S.quality]))); }
  function plural(n, a, b, c) { return n === 1 ? a : n >= 2 && n <= 4 ? b : c; }
  function fmtT(t, dec = 1) {
    t = Math.max(0, t);
    const m = Math.floor(t / 60), s = t - m * 60;
    return `${m}:${s.toFixed(dec).padStart(dec ? 3 + dec : 2, '0')}`;
  }
  function slug(s) {
    return s.replace(/\*/g, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40).toUpperCase() || 'TEXT';
  }
  function fileName(SS, text, idx, style, W, H, ext) {
    return `${String(idx + 1).padStart(2, '0')}_${slug(text)}_${STYLES[style].key}_${W}x${H}.${ext}`;
  }
  function status(msg, kind) { const el = $('status'); el.textContent = msg || ''; el.className = 'status' + (kind ? ' ' + kind : ''); }
  function ensureFont() {
    applyFamily();
    return Promise.all([
      document.fonts.load(fontStr(S, 64), 'AÁÄČĎÉÍĽĹŇÓÔŔŠŤÚÝŽ aáäčďéíľĺňóôŕšťúýž'),
      document.fonts.load('800 20px "Montserrat"'),
    ]).catch(() => {});
  }
  function ab2b64(buf) { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
  function b642ab(b64) { const s = atob(b64), b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b.buffer; }

  /* ---------- IndexedDB (skladba sa pamätá aj po zatvorení) ---------- */
  const idb = {
    open() {
      return new Promise((res, rej) => {
        const r = indexedDB.open('lyricsgen', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
    },
    async run(mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const tx = db.transaction('kv', mode), st = tx.objectStore('kv'), rq = fn(st);
        tx.oncomplete = () => res(rq && rq.result); tx.onerror = () => rej(tx.error);
      });
    },
    get(k) { return this.run('readonly', st => st.get(k)); },
    put(k, v) { return this.run('readwrite', st => st.put(v, k)); },
    del(k) { return this.run('readwrite', st => st.delete(k)); },
  };

  /* ---------- odvodené dáta: auto štýly, klipy na časovej osi ---------- */
  function recompute() {
    autoList = autoStyles(slides.map(s => s.text), S);
    clips = [];
    if (!song) return;
    const arr = slides.map((s, i) => ({ i, time: s.time, gap: s.gap, text: s.text }))
      .filter(x => x.time != null).sort((a, b) => a.time - b.time || a.i - b.i);
    arr.forEach((a, k) => {
      if (a.gap) return;
      const s = a.time - S.lead, nx = arr[k + 1];
      let e = nx ? nx.time - S.lead : song.duration;
      e = Math.min(e, a.time + S.songMax, song.duration + 0.001);
      if (e - s >= 0.15) clips.push({ i: a.i, text: a.text, s, e, style: styleOf(a.i) });
    });
  }

  /* ---------- zmena nastavení ---------- */
  let thumbT = 0;
  function changed(opts = {}) {
    applyFamily(); recompute(); save(); dirty = true;
    if (!playing && !songMode()) tNow = Math.min(tNow, S.duration);
    clearTimeout(thumbT); thumbT = setTimeout(renderThumbs, opts.now ? 0 : 140);
    markStyle(); updateInfo();
  }

  /* ---------- fonty ---------- */
  function buildFontSel() {
    const sel = $('fontSel'); sel.innerHTML = '';
    for (const grp of FONTS) {
      const og = document.createElement('optgroup'); og.label = grp.g;
      for (const [f] of grp.items) og.appendChild(new Option(f, f));
      sel.appendChild(og);
    }
    if (customFonts.length) {
      const og = document.createElement('optgroup'); og.label = 'Nahraté';
      for (const f of customFonts) og.appendChild(new Option(f, f));
      sel.appendChild(og);
    }
    sel.appendChild(new Option('Iný nainštalovaný font…', '__other'));
    sel.value = S.fontSel;
    if (sel.value !== S.fontSel) { S.fontSel = 'Montserrat'; sel.value = 'Montserrat'; }
    $('otherWrap').hidden = S.fontSel !== '__other';
  }
  async function addCustomFont(name, buf, persist) {
    const fam = ('Vlastný ' + name).replace(/["'\\]/g, '').slice(0, 60);
    const ff = new FontFace(fam, buf, { weight: '100 900' });
    await ff.load();
    document.fonts.add(ff);
    if (!customFonts.includes(fam)) customFonts.push(fam);
    if (persist) {
      try {
        const list = JSON.parse(localStorage.getItem(LS_FONTS) || '[]').filter(x => x.fam !== fam);
        if (buf.byteLength < 2.5e6) { list.push({ fam, name, b64: ab2b64(buf) }); localStorage.setItem(LS_FONTS, JSON.stringify(list)); }
      } catch (e) { /* plný localStorage – font platí len do zatvorenia */ }
    }
    return fam;
  }
  async function restoreFonts() {
    try {
      const list = JSON.parse(localStorage.getItem(LS_FONTS) || '[]');
      for (const f of list) { try { await addCustomFont(f.name, b642ab(f.b64), false); } catch (e) {} }
    } catch (e) {}
  }

  /* ---------- posuvníky ---------- */
  const SL1 = [
    ['size', 'Veľkosť', 3, 40, 0.5, v => v + ' %'],
    ['tracking', 'Rozostup písmen', -10, 60, 1, v => (v > 0 ? '+' : '') + v],
    ['leading', 'Riadkovanie', 0.7, 1.8, 0.01, v => v.toFixed(2)],
    ['safe', 'Max. šírka textu', 30, 100, 1, v => v + ' %'],
  ];
  const SL2 = [
    ['glow', 'Žiara', 0, 100, 1, v => v + ' %'],
    ['dim', 'Tlmené prvky', 0, 100, 1, v => v + ' %'],
    ['posX', 'Posun vodorovne', -40, 40, 0.5, v => (v > 0 ? '+' : '') + v + ' %'],
    ['posY', 'Posun zvisle', -40, 40, 0.5, v => (v > 0 ? '+' : '') + v + ' %'],
  ];
  const sliderSync = [];
  function mkSlider(host, [k, label, min, max, step, fmt]) {
    const d = document.createElement('div');
    d.className = 'field';
    d.title = 'Dvojklik = predvolená hodnota';
    d.innerHTML = `<div class="lbl"><span>${label}</span><output></output></div><input type="range" min="${min}" max="${max}" step="${step}">`;
    const r = d.querySelector('input'), o = d.querySelector('output');
    const sync = () => { r.value = S[k]; o.textContent = fmt(+S[k]); };
    sync(); sliderSync.push(sync);
    r.addEventListener('input', () => { S[k] = +r.value; o.textContent = fmt(S[k]); changed(); });
    r.addEventListener('dblclick', () => { S[k] = DEF[k]; sync(); changed(); });
    host.appendChild(d);
  }

  /* ---------- klipy ---------- */
  function refreshSlides() {
    slides = getSlides(S.text);
    if (cur >= slides.length) cur = Math.max(0, slides.length - 1);
    recompute();
    const host = $('clips'); host.innerHTML = '';
    slides.forEach((s, i) => {
      const b = document.createElement('button');
      b.className = 'chip' + (i === cur ? ' on' : '') + (s.gap ? ' muted' : '');
      const first = s.gap ? '— pauza —' : s.text.replace(/\*/g, '').trim().split('\n').map(x => x.trim()).join(' / ');
      b.innerHTML = `<b>${String(i + 1).padStart(2, '0')}</b>` + (s.time != null ? `<span style="opacity:.6;margin-right:6px">${fmtT(s.time, 0)}</span>` : '');
      b.appendChild(document.createTextNode(first.length > 26 ? first.slice(0, 25) + '…' : first));
      b.title = s.text.replace(/\*/g, '');
      b.onclick = () => {
        cur = i;
        if (songMode() && s.time != null) seek(s.time - S.lead);
        else tNow = 0;
        markChips(); changed({ now: true });
      };
      host.appendChild(b);
    });
    const n = slides.filter(s => !s.gap).length, timed = slides.filter(s => !s.gap && s.time != null).length;
    $('clipsLbl').textContent = n ? `${n} ${plural(n, 'klip', 'klipy', 'klipov')}` + (song ? ` · ${timed} s časom` : '') : 'Žiadny text';
    $('scope').querySelector('[data-v=all]').textContent = `Všetky (${n})`;
  }
  function markChips() { [...$('clips').children].forEach((b, i) => b.classList.toggle('on', i === cur)); }
  function caretSlide() {
    if (tap) return;
    const pos = $('text').selectionStart;
    let idx = 0;
    slides.forEach((s, i) => { if (s.start <= pos) idx = i; });
    if (idx !== cur) { cur = idx; markChips(); changed({ now: true }); }
  }
  // zapíše časy z `slides` späť do textu
  function writeTimes() {
    S.text = joinSlides(slides);
    const ta = $('text'), st = ta.scrollTop;
    ta.value = S.text; ta.scrollTop = st;
    refreshSlides(); changed();
  }

  /* ---------- náhľad ---------- */
  const pc = $('preview'), pctx = pc.getContext('2d');
  function fitPreview() {
    const vp = $('viewport'), aw = vp.clientWidth - 24, ah = vp.clientHeight - 24;
    const ar = S.w / S.h;
    let cw = Math.max(50, Math.min(aw, ah * ar)), ch = cw / ar;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const bw = Math.round(Math.min(S.w, cw * dpr));
    pc.width = bw; pc.height = Math.max(2, Math.round(bw / ar));
    pc.style.width = cw + 'px'; pc.style.height = ch + 'px';
    fitTimeline();
    dirty = true;
  }
  function drawPreview() {
    const D = totalDur();
    if (songMode()) {
      const k = renderSongFrame(pctx, pc.width, pc.height, tNow, S, clips);
      const ci = k >= 0 ? clips[k].i : -1;
      if (ci >= 0 && ci !== cur) {
        cur = ci; markChips(); markStyle(); updateInfo();
        clearTimeout(thumbT); thumbT = setTimeout(renderThumbs, 60);
      }
      drawTimeline();
      $('time').textContent = `${fmtT(tNow)} / ${fmtT(D)}`;
    } else {
      renderFrame(pctx, pc.width, pc.height, tNow, S, slideText(), styleOf(cur));
      $('time').textContent = `${tNow.toFixed(2)} / ${D.toFixed(2)} s`;
    }
    $('scrub').value = Math.round((tNow / D) * 1000);
    const beat = 60 / Math.max(20, S.bpm), ph = (((tNow - (songMode() ? song.phase : 0)) % beat) + beat) % beat / beat;
    $('beatDot').style.opacity = (0.12 + 0.88 * Math.exp(-ph * 6)).toFixed(3);
  }
  function setPlaying(p) {
    playing = p;
    $('play').innerHTML = p
      ? '<svg viewBox="0 0 12 12"><rect x="1.5" y="1" width="3" height="10"/><rect x="7.5" y="1" width="3" height="10"/></svg>'
      : '<svg viewBox="0 0 12 12"><path d="M2 1l9 5-9 5z"/></svg>';
    if (songMode()) {
      if (p) { if (tNow >= song.duration - 0.05) tNow = 0; audioPlay(tNow); }
      else audioStop();
    }
    dirty = true;
  }
  function seek(t) {
    tNow = clamp(t, 0, totalDur());
    if (playing && songMode()) audioPlay(tNow);
    dirty = true;
  }
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (playing && !busy) {
      if (songMode()) {
        if (actx && src) {
          tNow = actx.currentTime - t0;
          if (tNow >= song.duration) { tNow = song.duration; if (tap) endTap(); setPlaying(false); }
          followPlayhead();
        }
      } else { tNow += dt; if (tNow >= S.duration) tNow %= S.duration; }
      dirty = true;
    }
    if (dirty) { drawPreview(); dirty = false; }
    if (hover >= 0 && !busy) { const D = curD(); drawThumb(hover, (now / 1000) % D, D); }
    requestAnimationFrame(loop);
  }

  /* ---------- zvuk ---------- */
  function audioPlay(from) {
    audioStop();
    if (!song) return;
    if (!actx) actx = new AudioContext({ sampleRate: 48000 });
    actx.resume();
    src = actx.createBufferSource();
    src.buffer = song.buf; src.connect(actx.destination);
    const f = clamp(from, 0, song.duration);
    t0 = actx.currentTime - f;
    src.start(0, f);
  }
  function audioStop() {
    if (src) { try { src.stop(); } catch (e) {} src.disconnect(); src = null; }
  }

  /* ---------- skladba ---------- */
  async function loadSong(file, isNew) {
    status('Načítavam skladbu…');
    const buf = await decodeSong(await file.arrayBuffer());
    await sleep(0);
    const an = analyzeSong(buf);
    audioStop();
    song = Object.assign({ name: (file.name || 'skladba').replace(/\.[^.]+$/, ''), buf }, an);
    view = { a: 0, b: song.duration };
    if (isNew) {
      S.bpm = Math.round(an.bpm); $('bpm').value = S.bpm;
      try { await idb.put('song', file); } catch (e) { console.warn('Skladbu sa nepodarilo zapamätať:', e); }
    }
    S.mode = 'song';
    refreshSlides();
    if (isNew && !slides.some(s => s.time != null) && slides.length) autoDistribute(true);
    setMode('song');
    status(`Skladba „${song.name}“ · ${fmtT(song.duration, 0)} · zistené tempo ~${an.bpm} BPM.` +
      (isNew ? ' Text som rozložil automaticky — dolaď ťukaním alebo ťahaním značiek.' : ''), 'ok');
  }
  function songInfo() {
    $('songInfo').textContent = song
      ? `${song.name} · ${fmtT(song.duration, 0)} · ~${song.bpm} BPM`
      : 'Žiadna skladba — nahraj MP3/WAV a text sa načasuje do hudby.';
    ['autoTime', 'tapTime', 'songDel', 'alignBtn'].forEach(id => { $(id).disabled = !song; });
    $('mode').querySelector('[data-v=song]').disabled = !song;
    $('scope').querySelector('[data-v=song]').disabled = !song;
  }
  function setMode(m) {
    if (tap) endTap();
    audioStop();
    S.mode = m === 'song' && song ? 'song' : 'clips';
    document.querySelectorAll('#mode button').forEach(b => b.classList.toggle('on', b.dataset.v === S.mode));
    $('tlWrap').hidden = !songMode();
    ['duration', 'beatChips'].forEach(id => $(id).closest('.field').classList.toggle('muted', songMode()));
    if (songMode()) S.scope = 'song';
    else if (S.scope === 'song') S.scope = 'current';
    tNow = 0;
    setPlaying(!songMode());
    songInfo(); fitPreview(); changed({ now: true });
  }
  // rozloží klipy rovnomerne medzi začiatok a koniec hudby, zarovnané na doby
  function autoDistribute(silent) {
    if (!song) return;
    const list = slides.filter(s => !s.gap);
    if (!list.length) { status('Najprv napíš text.', 'err'); return; }
    const beat = 60 / Math.max(20, S.bpm), n = list.length;
    const a = song.start, b = Math.max(song.start + n * beat, song.end - 2 * beat);
    const step = (b - a) / n;
    const snap = t => song.phase + Math.round((t - song.phase) / beat) * beat;
    list.forEach((s, k) => { s.time = Math.max(0, snap(a + k * step)); });
    slides = list;
    writeTimes();
    if (!silent) status(`Rozložené: ${n} ${plural(n, 'klip', 'klipy', 'klipov')}, ~${step.toFixed(1)} s na klip. Dolaď ťahaním značiek (Shift = posunie aj všetky ďalšie).`, 'ok');
  }

  /* ---------- upratanie vloženého textu ---------- */
  let preClean = null;
  function setText(t, keepUndo) {
    if (!keepUndo) { preClean = null; $('undoClean').disabled = true; }
    S.text = t; $('text').value = t; cur = 0;
    refreshSlides(); changed({ now: true });
  }
  function doClean(src, insert) {
    const before = $('text').value;
    const cleaned = cleanLyrics(src);
    let t = cleaned;
    if (insert) { const ta = $('text'); t = before.slice(0, ta.selectionStart) + cleaned + before.slice(ta.selectionEnd); }
    setText(t, true);
    preClean = before; $('undoClean').disabled = false;
    const n = slides.filter(s => !s.gap).length;
    status(`Text upratený: ${n} ${plural(n, 'klip', 'klipy', 'klipov')} (riadok = klip, hlavičky a doplnky odstránené).` +
      (song ? ' Teraz klikni „Rozpoznať, kde sa čo spieva“.' : ' Teraz nahraj skladbu.'), 'ok');
  }

  /* ---------- AI zarovnanie (server.py + stable-ts) ---------- */
  let aligning = false;
  async function toMono16k(buf) {
    const oc = new OfflineAudioContext(1, Math.ceil(buf.duration * 16000), 16000);
    const s = oc.createBufferSource(); s.buffer = buf; s.connect(oc.destination); s.start();
    return (await oc.startRendering()).getChannelData(0);
  }
  async function aiAlign() {
    if (aligning) return;
    if (!song) { status('Najprv nahraj skladbu.', 'err'); return; }
    const list = slides.filter(s => !s.gap);
    if (!list.length) { status('Najprv vlož text.', 'err'); return; }
    const noServer = 'Rozpoznávanie potrebuje lokálny server — spusti spustit.bat a otvor http://localhost:5173';
    if (location.protocol === 'file:') { status(noServer, 'err'); return; }
    let st;
    try { st = await (await fetch('/api/status')).json(); } catch (e) { st = null; }
    if (!st || !st.ok) { status(noServer, 'err'); return; }
    if (!st.align) { status('Server beží, ale AI nie je nainštalovaná (' + (st.error || '?') + '). Pozri README.', 'err'); return; }
    if (slides.some(s => s.time != null) && !confirm('Prepísať existujúce časy klipov časmi z AI?')) return;
    aligning = true; $('alignBtn').disabled = true;
    const t0 = performance.now();
    try {
      status('Pripravujem zvuk…');
      const pcm = await toMono16k(song.buf);
      const lines = list.map(s => s.text.replace(/\*/g, '').replace(/\s*\n\s*/g, ' ').trim());
      const head = new TextEncoder().encode(JSON.stringify({ lines, language: S.alignLang, model: S.alignModel, vocals: S.alignVocals && st.demucs }));
      const body = new Uint8Array(4 + head.length + pcm.byteLength);
      new DataView(body.buffer).setUint32(0, head.length, true);
      body.set(head, 4); body.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 4 + head.length);
      const { job } = await (await fetch('/api/align', { method: 'POST', body })).json();
      let j;
      for (;;) {
        await sleep(800);
        j = await (await fetch('/api/job/' + job)).json();
        const el = Math.round((performance.now() - t0) / 1000);
        if (j.state === 'error') throw new Error(j.message);
        if (j.state === 'done') break;
        status(`AI (${st.device}): ${j.message} · ${el} s`);
      }
      const res = j.result.lines;
      // chýbajúce časy dopočítať medzi susedmi
      const starts = res.map(r => (r ? r.start : null));
      for (let k = 0; k < starts.length; k++) if (starts[k] == null) {
        let a = k - 1; while (a >= 0 && starts[a] == null) a--;
        let b = k + 1; while (b < starts.length && starts[b] == null) b++;
        const ta = a >= 0 ? starts[a] : 0, tb = b < starts.length ? starts[b] : song.duration;
        starts[k] = ta + ((tb - ta) * (k - a)) / (b - a);
      }
      // pauzy: keď je medzi riadkami dlhšie ticho, text zmizne
      const out = [];
      list.forEach((s, k) => {
        s.time = Math.max(0, starts[k]);
        out.push(s);
        const end = res[k] ? res[k].end : null, nx = k + 1 < list.length ? starts[k + 1] : song.duration;
        if (end != null && nx - end > 4) out.push({ text: '', time: end + 1, gap: true });
      });
      slides = out;
      writeTimes();
      const miss = res.filter(r => !r).length;
      status(`Hotovo: ${list.length} riadkov načasovaných za ${Math.round((performance.now() - t0) / 1000)} s (jazyk ${j.result.language || '?'})` +
        (miss ? `, ${miss} riadkov dopočítaných` : '') + '. Skontroluj prehrávaním, chyby oprav ťahaním značiek.', 'ok');
    } catch (e) {
      console.error(e);
      status('Rozpoznávanie zlyhalo: ' + (e.message || e), 'err');
    } finally {
      aligning = false; $('alignBtn').disabled = false;
    }
  }

  /* ---------- ťukanie ---------- */
  function startTap() {
    if (!song) return;
    if (!slides.length) { status('Najprv napíš text.', 'err'); return; }
    if (!songMode()) setMode('song');
    document.activeElement && document.activeElement.blur();
    let idx = slides.filter(s => s.time != null && s.time < tNow - 0.01).length;
    if (idx >= slides.length) { idx = 0; tNow = 0; }
    tap = { idx, hist: [] };
    $('tapbar').classList.add('show');
    updateTap();
    if (!playing) setPlaying(true);
  }
  function updateTap() {
    if (!tap) return;
    const s = slides[tap.idx];
    const t = s ? (s.gap ? '— pauza —' : s.text.replace(/\*/g, '').trim().split('\n')[0]) : '';
    $('tapInfo').textContent = s ? `${tap.idx + 1}/${slides.length}: ${t}` : 'hotovo';
  }
  function tapMark() {
    const s = slides[tap.idx];
    if (!s) return endTap();
    tap.hist.push({ idx: tap.idx, prev: s.time });
    s.time = Math.max(0, tNow - 0.05); // ~reakčný čas
    tap.idx++;
    writeTimes();
    if (tap.idx >= slides.length) { endTap(); status('Ťukanie hotové — všetky klipy majú čas.', 'ok'); }
    else updateTap();
  }
  function tapUndo() {
    const h = tap.hist.pop();
    if (!h) return;
    slides[h.idx].time = h.prev;
    tap.idx = h.idx;
    writeTimes(); updateTap();
    seek(Math.max(0, tNow - 3));
  }
  function endTap() {
    tap = null;
    $('tapbar').classList.remove('show');
  }

  /* ---------- časová os ---------- */
  const tc = $('timeline'), tctx = tc.getContext('2d');
  let drag = null;
  function fitTimeline() {
    const r = tc.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    tc.width = Math.max(10, Math.round(r.width * dpr)); tc.height = Math.max(10, Math.round(r.height * dpr));
  }
  const x2t = x => view.a + (x / tc.clientWidth) * (view.b - view.a);
  const t2x = t => ((t - view.a) / (view.b - view.a)) * tc.clientWidth;
  function followPlayhead() {
    const span = view.b - view.a;
    if (song && (tNow > view.b || tNow < view.a) && span < song.duration) {
      view.a = clamp(tNow - span * 0.1, 0, song.duration - span); view.b = view.a + span;
    }
  }
  function drawTimeline() {
    if (!songMode() || $('tlWrap').hidden) return;
    const c = tctx, dpr = tc.width / Math.max(1, tc.clientWidth), w = tc.clientWidth, h = tc.clientHeight;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#0a0a0a'; c.fillRect(0, 0, w, h);
    const span = view.b - view.a, mid = h * 0.5, amp = h * 0.36;
    // takty
    const beat = 60 / Math.max(20, S.bpm), bar = beat * 4;
    if ((bar / span) * w > 5) {
      c.fillStyle = '#161616';
      const k0 = Math.ceil((view.a - song.phase) / bar);
      for (let t = song.phase + k0 * bar; t < view.b; t += bar) c.fillRect(Math.round(t2x(t)), 0, 1, h);
    }
    // klipy
    clips.forEach(cl => {
      const x0 = t2x(cl.s), x1 = t2x(cl.e);
      if (x1 < 0 || x0 > w) return;
      c.fillStyle = cl.i === cur ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.055)';
      c.fillRect(x0, 0, x1 - x0, h);
    });
    // priebeh
    const P = song.peaks, NP = P.length;
    for (let x = 0; x < w; x++) {
      const ta = x2t(x), tb = x2t(x + 1);
      const i0 = Math.max(0, Math.floor((ta / song.duration) * NP)), i1 = Math.min(NP, Math.ceil((tb / song.duration) * NP));
      let m = 0;
      for (let i = i0; i < i1; i++) if (P[i] > m) m = P[i];
      const hh = Math.max(0.5, Math.sqrt(m) * amp);
      c.fillStyle = ta < tNow ? '#7a7a7a' : '#3c3c3c';
      c.fillRect(x, mid - hh, 1, hh * 2);
    }
    // značky klipov
    c.font = '600 10px "Segoe UI", sans-serif'; c.textBaseline = 'top';
    slides.forEach((s, i) => {
      if (s.time == null) return;
      const x = t2x(s.time);
      if (x < -60 || x > w + 2) return;
      c.fillStyle = s.gap ? '#777' : i === cur ? '#fff' : '#cfcfcf';
      c.fillRect(Math.round(x), 0, 1.5, h);
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 7, 0); c.lineTo(x, 9); c.fill();
      const lbl = String(i + 1).padStart(2, '0') + (s.gap ? ' ·' : ' ' + s.text.replace(/\*/g, '').trim().split('\n')[0]);
      const nxt = slides.slice(i + 1).find(q => q.time != null);
      const room = (nxt ? t2x(nxt.time) : w) - x - 8;
      if (room > 18) {
        c.save(); c.beginPath(); c.rect(x + 3, 10, room, 14); c.clip();
        c.fillStyle = s.gap ? '#888' : '#e6e6e6'; c.fillText(lbl, x + 4, 11); c.restore();
      }
    });
    // časová stupnica
    const steps = [1, 2, 5, 10, 15, 30, 60, 120];
    const st = steps.find(v => (v / span) * w > 70) || 300;
    c.fillStyle = '#5c5c5c'; c.textBaseline = 'bottom';
    for (let t = Math.ceil(view.a / st) * st; t < view.b; t += st) {
      const x = t2x(t);
      c.fillRect(x, h - 4, 1, 4); c.fillText(fmtT(t, 0), x + 3, h - 1);
    }
    // prehrávacia hlava
    const px = t2x(tNow);
    c.fillStyle = '#ff3b3b'; c.fillRect(Math.round(px) - 1, 0, 2, h);
  }
  function markerAt(x) {
    let best = -1, bd = 7;
    slides.forEach((s, i) => { if (s.time != null) { const d = Math.abs(t2x(s.time) - x); if (d < bd) { bd = d; best = i; } } });
    return best;
  }
  function bindTimeline() {
    const pos = e => e.clientX - tc.getBoundingClientRect().left;
    tc.addEventListener('mousedown', e => {
      if (!songMode()) return;
      e.preventDefault();
      const x = pos(e), m = markerAt(x);
      if (m >= 0) {
        drag = { kind: 'mark', idx: m, shift: e.shiftKey, orig: slides.map(s => s.time), t0: x2t(x) };
        cur = slides[m].gap ? cur : m; markChips();
      } else { drag = { kind: 'seek' }; seek(x2t(x)); }
    });
    window.addEventListener('mousemove', e => {
      if (!songMode()) return;
      const x = pos(e);
      if (!drag) { tc.style.cursor = markerAt(x) >= 0 ? 'ew-resize' : 'crosshair'; return; }
      if (drag.kind === 'seek') { seek(x2t(x)); return; }
      const dt = x2t(x) - drag.t0, o = drag.orig, me = o[drag.idx];
      if (drag.shift) {
        slides.forEach((s, j) => { if (o[j] != null && o[j] >= me) s.time = Math.max(0, o[j] + dt); });
      } else {
        let lo = 0, hi = song.duration;
        o.forEach((t, j) => { if (j === drag.idx || t == null) return; if (t <= me && t > lo) lo = t + 0.05; if (t > me && t < hi) hi = t - 0.05; });
        slides[drag.idx].time = clamp(me + dt, lo, hi);
      }
      recompute(); dirty = true;
    });
    window.addEventListener('mouseup', () => {
      if (drag && drag.kind === 'mark') writeTimes();
      drag = null;
    });
    tc.addEventListener('wheel', e => {
      if (!songMode()) return;
      e.preventDefault();
      const t = x2t(pos(e)), span = view.b - view.a;
      const ns = clamp(span * (e.deltaY > 0 ? 1.25 : 0.8), 2, song.duration);
      view.a = clamp(t - ((t - view.a) * ns) / span, 0, song.duration - ns); view.b = view.a + ns;
      dirty = true;
    }, { passive: false });
    tc.addEventListener('dblclick', () => { if (song) { view = { a: 0, b: song.duration }; dirty = true; } });
  }

  /* ---------- náhľady štýlov ---------- */
  const thumbs = [];
  function buildStyles() {
    const host = $('styles');
    STYLES.forEach((st, i) => {
      const b = document.createElement('button');
      b.className = 'card';
      b.innerHTML = `<div class="th"></div><span><b>${String(i + 1).padStart(2, '0')}</b>${st.name}</span>`;
      b.title = `${String(i + 1).padStart(2, '0')} ${st.name}`;
      const cv = document.createElement('canvas');
      b.firstChild.appendChild(cv);
      b.onclick = () => {
        S.style = i; S.auto = false; $('auto').checked = false;
        if (!songMode()) tNow = 0;
        changed();
      };
      b.onmouseenter = () => { hover = i; };
      b.onmouseleave = () => { hover = -1; const D = curD(); drawThumb(i, poseTime(D), D); };
      host.appendChild(b);
      thumbs.push({ b, cv, ctx: cv.getContext('2d') });
    });
    markStyle();
  }
  function markStyle() {
    const k = styleOf(cur);
    thumbs.forEach((th, i) => { th.b.classList.toggle('on', !S.auto && i === S.style); th.b.classList.toggle('auto', S.auto && i === k); });
    $('styleNote').textContent = S.auto && slides.length ? `Klip ${cur + 1} → ${String(k + 1).padStart(2, '0')} ${STYLES[k].name}` : '';
    $('autoSet').disabled = $('autoShuffle').disabled = !S.auto;
  }
  function drawThumb(i, t, D) {
    const th = thumbs[i], text = slideText() || 'TEXT';
    renderFrame(th.ctx, th.cv.width, th.cv.height, t, S, slides[cur] && slides[cur].gap ? 'PAUZA' : text, i, D);
  }
  function renderThumbs() {
    const ar = S.w / S.h, tw = 320, thh = Math.max(24, Math.round(tw / ar)), D = curD(), t = poseTime(D);
    thumbs.forEach((th, i) => {
      if (th.cv.width !== tw || th.cv.height !== thh) { th.cv.width = tw; th.cv.height = thh; }
      drawThumb(i, t, D);
    });
  }

  /* ---------- info ---------- */
  function updateInfo() {
    const W = even(S.w), H = even(S.h);
    const st = styleOf(cur), stTxt = `${String(st + 1).padStart(2, '0')} ${STYLES[st].name}${S.auto ? ' (AUTO)' : ''}`;
    if (songMode()) {
      $('vinfo').textContent = `${S.w}×${S.h} · ${S.fps} FPS · SKLADBA ${fmtT(song.duration, 0)} · KLIP ${cur + 1}/${slides.length} · ${stTxt}`;
    } else {
      $('vinfo').textContent = `${S.w}×${S.h} · ${S.fps} FPS · KLIP ${slides.length ? cur + 1 : 0}/${slides.length} · ${stTxt}`;
    }
    $('beatsOut').textContent = `≈ ${(S.duration * S.bpm / 60).toFixed(1)} dôb`;
    const scope = S.scope === 'song' && songMode() ? 'song' : S.scope === 'song' ? 'current' : S.scope;
    const dur = scope === 'song' ? song.duration : S.duration;
    const frames = Math.max(1, Math.ceil(dur * S.fps));
    const mb = (bitrate(W, H, S.fps) * dur) / 8 / 1e6;
    const k = S.ssaa ? ssaaK(W, H) : 1;
    $('estimate').textContent = `${frames} snímok ${scope === 'song' ? 'v skladbe' : 'na klip'} · max. ~${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB · ${(bitrate(W, H, S.fps) / 1e6).toFixed(0)} Mb/s` +
      (k > 1 ? ` · vyhladzovanie ${k}×` : '');
    document.querySelectorAll('#resChips .chip').forEach(c => c.classList.toggle('on', c.dataset.w == S.w && c.dataset.h == S.h));
    document.querySelectorAll('#scope button').forEach(b => b.classList.toggle('on', b.dataset.v === scope));
  }

  /* =====================================================================
     EXPORT
     ===================================================================== */
  // faktor supersamplingu podľa veľkosti (aby 4K export nezabral celú pamäť)
  function ssaaK(W, H) { const px = W * H; return px <= 4.2e6 ? 2 : px <= 9e6 ? 1.5 : 1; }
  function makeRenderTarget(W, H, ss) {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { alpha: false });
    const k = ss ? ssaaK(W, H) : 1;
    if (k <= 1) return { cv, k, draw: fn => fn(ctx, W, H) };
    const big = document.createElement('canvas'); big.width = Math.round(W * k); big.height = Math.round(H * k);
    const bctx = big.getContext('2d', { alpha: false });
    return {
      cv, k,
      draw(fn) {
        fn(bctx, big.width, big.height);
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(big, 0, 0, W, H);
      },
    };
  }
  async function pickCodec(W, H, fps, br) {
    const avc = ['avc1.640033', 'avc1.640034', 'avc1.64003C', 'avc1.64003D', 'avc1.64003E', 'avc1.640028', 'avc1.64002A', 'avc1.640032',
      'avc1.4D0033', 'avc1.4D0034', 'avc1.4D0028', 'avc1.42E033', 'avc1.42E034', 'avc1.42E028'];
    const extras = [{ bitrateMode: 'variable', latencyMode: 'quality' }, {}];
    for (const ex of extras) for (const codec of avc) {
      const cfg = Object.assign({ codec, width: W, height: H, bitrate: br, framerate: fps, avc: { format: 'avc' } }, ex);
      try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return { cfg, mux: 'avc', name: 'H.264' }; } catch (e) {}
    }
    for (const ex of extras) for (const codec of ['vp09.00.40.08', 'vp09.00.41.08', 'vp09.00.50.08', 'vp09.00.51.08', 'vp09.00.60.08', 'vp09.00.61.08']) {
      const cfg = Object.assign({ codec, width: W, height: H, bitrate: br, framerate: fps }, ex);
      try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return { cfg, mux: 'vp9', name: 'VP9' }; } catch (e) {}
    }
    return null;
  }
  async function pickAudio(sr) {
    if (!('AudioEncoder' in window)) return null;
    for (const [codec, mux, br, name] of [['mp4a.40.2', 'aac', 256000, 'AAC'], ['mp4a.40.2', 'aac', 192000, 'AAC'], ['mp4a.40.2', 'aac', 160000, 'AAC'], ['opus', 'opus', 192000, 'Opus']]) {
      const cfg = { codec, sampleRate: sr, numberOfChannels: 2, bitrate: br };
      try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) return { cfg, mux, name }; } catch (e) {}
    }
    return null;
  }
  function waitQueue(enc, max = 4) {
    return new Promise(res => {
      if (enc.encodeQueueSize <= max) return res();
      const h = () => { if (enc.encodeQueueSize <= max) { enc.removeEventListener('dequeue', h); clearTimeout(to); res(); } };
      const to = setTimeout(() => { enc.removeEventListener('dequeue', h); res(); }, 250);
      enc.addEventListener('dequeue', h);
    });
  }
  // spoločné kódovanie: video (+ voliteľne zvuk) do MP4
  async function encodeMovie(o) {
    const { W, H, fps, frames, codec, target, fastStart, render, onProg } = o;
    const gop = o.gop || Math.max(1, Math.round(fps));
    const rt = makeRenderTarget(W, H, o.ssaa);
    const mo = { target, video: { codec: codec.mux, width: W, height: H, frameRate: fps }, fastStart, firstTimestampBehavior: 'offset' };
    const A = o.audio ? o.audio.buf : null;
    if (A) mo.audio = { codec: o.audio.codec.mux, numberOfChannels: 2, sampleRate: A.sampleRate };
    const muxer = new Mp4Muxer.Muxer(mo);
    let err = null;
    const venc = new VideoEncoder({ output: (ch, meta) => muxer.addVideoChunk(ch, meta), error: e => { err = e; } });
    venc.configure(codec.cfg);
    let aenc = null, aPos = 0;
    const sr = A ? A.sampleRate : 0, aLen = A ? A.length : 0;
    const c0 = A ? A.getChannelData(0) : null, c1 = A ? (A.numberOfChannels > 1 ? A.getChannelData(1) : c0) : null;
    if (A) {
      aenc = new AudioEncoder({ output: (ch, meta) => muxer.addAudioChunk(ch, meta), error: e => { err = e; } });
      aenc.configure(o.audio.codec.cfg);
    }
    const feed = async until => {
      const end = Math.min(aLen, Math.round(until * sr));
      while (aPos < end) {
        const n = Math.min(4096, end - aPos), data = new Float32Array(n * 2);
        data.set(c0.subarray(aPos, aPos + n), 0); data.set(c1.subarray(aPos, aPos + n), n);
        const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((aPos / sr) * 1e6), data });
        aenc.encode(ad); ad.close();
        aPos += n;
        await waitQueue(aenc, 24);
      }
    };
    try {
      for (let i = 0; i < frames; i++) {
        if (cancelFlag) throw new Error('cancel');
        if (err) throw err;
        rt.draw((ctx, w, h) => render(ctx, w, h, i));
        const vf = new VideoFrame(rt.cv, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
        venc.encode(vf, { keyFrame: i % gop === 0 });
        vf.close();
        if (aenc) await feed((i + 1) / fps + 0.5);
        await waitQueue(venc);
        if (i % 4 === 0 || i === frames - 1) { onProg(i + 1, frames); await sleep(0); }
      }
      if (aenc) { await feed(frames / fps); await aenc.flush(); }
      await venc.flush();
      if (err) throw err;
    } finally {
      if (venc.state !== 'closed') venc.close();
      if (aenc && aenc.state !== 'closed') aenc.close();
    }
    muxer.finalize();
    return rt.k;
  }
  async function saveBlob(blob, name) {
    if (dirHandle) {
      try {
        const fh = await dirHandle.getFileHandle(name, { create: true });
        const w = await fh.createWritable(); await w.write(blob); await w.close();
        return 'dir';
      } catch (e) { console.warn('Zápis do priečinka zlyhal, sťahujem:', e); }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    await sleep(350);
    return 'dl';
  }
  function setBusy(b) {
    busy = b;
    $('exportBtn').disabled = b; $('stillBtn').disabled = b; $('pickDir').disabled = b;
    $('cancelBtn').disabled = !b;
    $('exportBtn').textContent = b ? 'EXPORTUJEM…' : 'EXPORTOVAŤ MP4';
    if (b && songMode()) { audioStop(); if (playing) setPlaying(false); }
  }
  // kam uložiť dlhé video skladby: priamo do súboru (bez držania v pamäti), inak stiahnuť
  async function songTarget(name, forceMemory) {
    if (!forceMemory && dirHandle) {
      try {
        const fh = await dirHandle.getFileHandle(name, { create: true }), ws = await fh.createWritable();
        return { target: new Mp4Muxer.FileSystemWritableFileStreamTarget(ws), fastStart: false, ws, where: 'dir', label: dirHandle.name + '/' + name };
      } catch (e) { console.warn(e); }
    }
    if (!forceMemory && window.showSaveFilePicker) {
      try {
        const fh = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }] });
        const ws = await fh.createWritable();
        return { target: new Mp4Muxer.FileSystemWritableFileStreamTarget(ws), fastStart: false, ws, where: 'file', label: fh.name };
      } catch (e) { if (e.name === 'AbortError') throw new Error('cancel'); console.warn(e); }
    }
    return { target: new Mp4Muxer.ArrayBufferTarget(), fastStart: 'in-memory', where: 'dl', label: name };
  }
  function eta(t0, done, tot) {
    const el = (performance.now() - t0) / 1000;
    if (done < 8 || el < 1) return '';
    const s = (el / done) * (tot - done);
    return ` · zostáva ~${s >= 60 ? Math.floor(s / 60) + ' min ' : ''}${Math.round(s % 60)} s`;
  }
  async function exportSong(SS, W, H, opts = {}) {
    const name = `${slug(song.name)}_${W}x${H}_${SS.fps}fps.mp4`;
    const tg = await songTarget(name, opts.blob);
    const clipsSnap = clips.map(c => Object.assign({}, c));
    const dur = song.duration, frames = Math.max(1, Math.ceil(dur * SS.fps));
    let ok = false;
    try {
      await ensureFont();
      const codec = await pickCodec(W, H, SS.fps, bitrate(W, H, SS.fps));
      if (!codec) throw new Error(`prehliadač nevie kódovať video ${W}×${H} pri ${SS.fps} FPS. Skús nižšie rozlíšenie alebo FPS.`);
      let audio = null;
      if (SS.withAudio) {
        const ac = await pickAudio(song.buf.sampleRate);
        if (ac) audio = { buf: song.buf, codec: ac };
        else status('Prehliadač nevie kódovať zvuk — video bude bez zvuku.', 'warn');
      }
      const tStart = performance.now();
      const k = await encodeMovie({
        W, H, fps: SS.fps, frames, codec, target: tg.target, fastStart: tg.fastStart, ssaa: SS.ssaa, audio, gop: Math.round(SS.fps * 2),
        render: (ctx, w, h, i) => renderSongFrame(ctx, w, h, i / SS.fps, SS, clipsSnap),
        onProg: (fr, tot) => {
          $('bar').style.width = ((fr / tot) * 100).toFixed(1) + '%';
          status(`Skladba · ${fmtT(fr / SS.fps, 0)} / ${fmtT(dur, 0)} · snímka ${fr}/${tot} · ${codec.name}${audio ? ' + ' + audio.codec.name : ''}${eta(tStart, fr, tot)}`);
        },
      });
      if (tg.ws) await tg.ws.close();
      ok = true;
      if (opts.blob) return new Blob([tg.target.buffer], { type: 'video/mp4' });
      let where = tg.where;
      if (tg.where === 'dl') where = await saveBlob(new Blob([tg.target.buffer], { type: 'video/mp4' }), name);
      const loc = where === 'dir' ? `do priečinka „${dirHandle.name}“` : where === 'file' ? `ako „${tg.label}“` : 'do Stiahnutých súborov';
      let msg = `Hotovo: video skladby uložené ${loc} (${W}×${H}, ${SS.fps} FPS, ${fmtT(dur, 0)}, ${codec.name}${audio ? ' + ' + audio.codec.name : ', bez zvuku'}${k > 1 ? ', vyhladzovanie ' + k + '×' : ''}).`;
      if (codec.mux !== 'avc') msg += ' Pozor: použil sa VP9 — pre H.264 otvor generátor v Chrome alebo Edge.';
      status(msg, codec.mux !== 'avc' ? 'warn' : 'ok');
    } finally {
      if (!ok && tg.ws) { try { await tg.ws.abort(); } catch (e) {} }
    }
  }
  async function exportClips(SS, W, H) {
    const list = (SS.scope === 'all' ? slides.map((_, i) => i) : [cur]).filter(i => slides[i] && !slides[i].gap);
    if (!list.length) throw new Error('vybraný klip je prázdny (pauza).');
    await ensureFont();
    const codec = await pickCodec(W, H, SS.fps, bitrate(W, H, SS.fps));
    if (!codec) throw new Error(`prehliadač nevie kódovať video ${W}×${H} pri ${SS.fps} FPS. Skús nižšie rozlíšenie alebo FPS.`);
    let where = 'dl', k = 1;
    const frames = Math.max(1, Math.round(SS.duration * SS.fps));
    // pri odchode > 0 je posledná snímka úplne čierna; bez odchodu klip plynulo loopuje
    const Dr = SS.tout > 0 ? Math.max(1, frames - 1) / SS.fps : frames / SS.fps;
    for (let n = 0; n < list.length; n++) {
      const idx = list[n], text = slides[idx].text, style = styleOf(idx);
      const target = new Mp4Muxer.ArrayBufferTarget();
      k = await encodeMovie({
        W, H, fps: SS.fps, frames, codec, target, fastStart: 'in-memory', ssaa: SS.ssaa,
        render: (ctx, w, h, i) => renderFrame(ctx, w, h, i / SS.fps, SS, text, style, Dr),
        onProg: (fr, tot) => {
          $('bar').style.width = (((n + fr / tot) / list.length) * 100).toFixed(1) + '%';
          status(`Klip ${n + 1}/${list.length} · snímka ${fr}/${tot} · ${codec.name}`);
        },
      });
      where = await saveBlob(new Blob([target.buffer], { type: 'video/mp4' }), fileName(SS, text, idx, style, W, H, 'mp4'));
    }
    const c = list.length;
    let msg = `Hotovo: ${c} ${plural(c, 'video uložené', 'videá uložené', 'videí uložených')} ${where === 'dir' ? 'do priečinka „' + dirHandle.name + '“' : 'do Stiahnutých súborov'} (${W}×${H}, ${SS.fps} FPS, ${codec.name}${k > 1 ? ', vyhladzovanie ' + k + '×' : ''}).`;
    if (codec.mux !== 'avc') msg += ' Pozor: tento prehliadač nemá H.264, použil sa VP9 — pre H.264 otvor generátor v Chrome alebo Edge.';
    status(msg, codec.mux !== 'avc' ? 'warn' : 'ok');
  }
  async function doExport(opts = {}) {
    if (busy) return;
    if (!('VideoEncoder' in window)) { status('Tento prehliadač nevie exportovať video. Otvor súbor v Chrome alebo Edge.', 'err'); return; }
    if (!slides.length) { status('Najprv napíš text.', 'err'); return; }
    const SS = JSON.parse(JSON.stringify(S)); SS.family = S.family;
    const W = even(SS.w), H = even(SS.h);
    const isSong = SS.scope === 'song' && songMode();
    if (isSong && !clips.length) { status('Klipy nemajú časy — klikni „Automaticky“ alebo „Ťukať“.', 'err'); return; }
    cancelFlag = false; setBusy(true); $('bar').style.width = '0%';
    status('Pripravujem kódovanie…');
    try {
      if (isSong) return await exportSong(SS, W, H, opts);
      await exportClips(SS, W, H);
    } catch (e) {
      if (e && e.message === 'cancel') status('Export zrušený.', 'warn');
      else { console.error(e); status('Chyba exportu: ' + (e && e.message ? e.message : e), 'err'); }
    } finally {
      $('bar').style.width = '100%';
      setBusy(false); dirty = true;
    }
  }
  async function doStill() {
    if (busy || !slides.length) return;
    await ensureFont();
    const W = even(S.w), H = even(S.h);
    const rt = makeRenderTarget(W, H, S.ssaa);
    let t, name;
    if (songMode()) {
      t = tNow;
      rt.draw((ctx, w, h) => renderSongFrame(ctx, w, h, t, S, clips));
      name = `${slug(song.name)}_${fmtT(t, 2).replace(/[:.]/g, '-')}_${W}x${H}.png`;
    } else {
      t = playing ? poseTime() : tNow;
      rt.draw((ctx, w, h) => renderFrame(ctx, w, h, t, S, slideText(), styleOf(cur)));
      name = fileName(S, slideText(), cur, styleOf(cur), W, H, 'png');
    }
    const blob = await new Promise(r => rt.cv.toBlob(r, 'image/png'));
    const where = await saveBlob(blob, name);
    status(`Snímka uložená ${where === 'dir' ? 'do priečinka „' + dirHandle.name + '“' : 'do Stiahnutých súborov'} (${t.toFixed(2)} s).`, 'ok');
  }

  /* =====================================================================
     NAPOJENIE OVLÁDANIA
     ===================================================================== */
  function bindNumber(id, key, min, max, after) {
    const el = $(id);
    el.value = S[key];
    el.addEventListener('input', () => {
      const v = parseFloat(String(el.value).replace(',', '.'));
      if (!isFinite(v)) return;
      S[key] = clamp(v, min, max); if (after) after(); changed();
    });
    el.addEventListener('change', () => { el.value = S[key]; });
  }

  async function init() {
    await restoreFonts();
    buildFontSel(); applyFamily();
    SL1.forEach(s => mkSlider($('sliders1'), s));
    SL2.forEach(s => mkSlider($('sliders2'), s));
    buildStyles();

    const ta = $('text');
    ta.value = S.text;
    ta.addEventListener('input', () => { S.text = ta.value; refreshSlides(); caretSlide(); changed(); });
    ['click', 'keyup', 'focus'].forEach(ev => ta.addEventListener(ev, caretSlide));
    // vložený celý text piesne (Genius, alebo veľa riadkov bez prázdnych riadkov) → upratať automaticky
    ta.addEventListener('paste', e => {
      const p = (e.clipboardData || window.clipboardData).getData('text');
      const lines = p.replace(/\r/g, '').split('\n');
      if (looksLikePastedLyrics(p) || (lines.length > 4 && !lines.some(l => !l.trim()))) { e.preventDefault(); doClean(p, true); }
    });
    $('cleanBtn').onclick = () => doClean($('text').value, false);
    $('undoClean').onclick = () => { if (preClean != null) { setText(preClean); status('Vrátený pôvodný text.', 'ok'); } };
    $('upper').checked = S.upper;
    $('upper').addEventListener('change', e => { S.upper = e.target.checked; changed(); });

    $('fontSel').addEventListener('change', async e => {
      S.fontSel = e.target.value;
      $('otherWrap').hidden = S.fontSel !== '__other';
      const def = FONTS.flatMap(g => g.items).find(x => x[0] === S.fontSel);
      if (def) { S.weight = def[1]; $('weight').value = String(S.weight); }
      applyFamily(); await ensureFont(); changed({ now: true });
    });
    $('otherFamily').value = S.otherFamily;
    $('otherFamily').addEventListener('input', async e => { S.otherFamily = e.target.value; applyFamily(); await ensureFont(); changed(); });
    $('weight').value = String(S.weight);
    $('weight').addEventListener('change', async e => { S.weight = +e.target.value; await ensureFont(); changed({ now: true }); });
    $('fontUpload').onclick = () => $('fontFile').click();
    $('fontFile').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const fam = await addCustomFont(f.name.replace(/\.[^.]+$/, ''), await f.arrayBuffer(), true);
        S.fontSel = fam; buildFontSel(); applyFamily(); await ensureFont(); changed({ now: true });
        status(`Font „${f.name}“ načítaný.`, 'ok');
      } catch (err) { status('Font sa nepodarilo načítať: ' + err.message, 'err'); }
      e.target.value = '';
    });
    $('color').value = S.color; $('accent').value = S.accent;
    $('color').addEventListener('input', e => { S.color = e.target.value; changed(); });
    $('accent').addEventListener('input', e => { S.accent = e.target.value; changed(); });

    // auto režim
    $('auto').checked = S.auto;
    $('auto').addEventListener('change', e => { S.auto = e.target.checked; changed({ now: true }); });
    $('autoSet').value = S.autoSet;
    $('autoSet').addEventListener('change', e => { S.autoSet = e.target.value; changed({ now: true }); });
    $('autoShuffle').onclick = () => { S.autoSeed = (S.autoSeed | 0) + 1; changed({ now: true }); };

    // skladba
    document.querySelectorAll('#mode button').forEach(b => b.onclick = () => { if (!b.disabled) setMode(b.dataset.v); });
    $('songLoad').onclick = () => $('songFile').click();
    $('songFile').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      try { await loadSong(f, true); } catch (err) { console.error(err); status('Skladbu sa nepodarilo načítať: ' + (err.message || err), 'err'); }
      e.target.value = '';
    });
    $('songDel').onclick = async () => {
      if (!song) return;
      audioStop(); song = null;
      try { await idb.del('song'); } catch (e) {}
      setMode('clips'); status('Skladba odstránená.', 'ok');
    };
    $('autoTime').onclick = () => {
      if (slides.some(s => s.time != null) && !confirm('Prepísať existujúce časy klipov?')) return;
      autoDistribute();
    };
    $('tapTime').onclick = startTap;
    $('tapEnd').onclick = endTap;
    $('clearTime').onclick = () => {
      if (!slides.some(s => s.time != null) || !confirm('Zmazať všetky časy z textu?')) return;
      slides = slides.filter(s => !s.gap); slides.forEach(s => { s.time = null; }); writeTimes();
    };
    $('lrcLoad').onclick = () => $('lrcFile').click();
    $('lrcFile').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      e.target.value = '';
      const items = parseTimedLyrics(await f.text());
      if (!items.length) { status('V súbore som nenašiel žiadne časy (LRC alebo SRT).', 'err'); return; }
      if (S.text.trim() && S.text !== DEF.text && !confirm(`Nahradiť aktuálny text textom zo súboru „${f.name}“?`)) return;
      S.text = joinSlides(items);
      $('text').value = S.text; cur = 0;
      refreshSlides(); changed({ now: true });
      status(`Importovaných ${items.filter(i => !i.gap).length} riadkov s časmi.` + (song ? '' : ' Teraz nahraj skladbu.'), 'ok');
    });
    $('alignBtn').onclick = aiAlign;
    $('alignLang').value = S.alignLang; $('alignLang').addEventListener('change', e => { S.alignLang = e.target.value; save(); });
    $('alignModel').value = S.alignModel; $('alignModel').addEventListener('change', e => { S.alignModel = e.target.value; save(); });
    $('alignVocals').checked = S.alignVocals; $('alignVocals').addEventListener('change', e => { S.alignVocals = e.target.checked; save(); });
    bindNumber('lead', 'lead', 0, 3);
    bindNumber('songMax', 'songMax', 1, 120);
    $('withAudio').checked = S.withAudio;
    $('withAudio').addEventListener('change', e => { S.withAudio = e.target.checked; changed(); });
    bindTimeline();

    // čas
    bindNumber('duration', 'duration', 0.5, 600);
    bindNumber('tin', 'tin', 0, 20);
    bindNumber('tout', 'tout', 0, 20);
    bindNumber('bpm', 'bpm', 40, 240);
    const bc = $('beatChips');
    [2, 4, 8, 16].forEach(n => {
      const b = document.createElement('button'); b.className = 'chip'; b.textContent = `${n} ${plural(n, 'doba', 'doby', 'dôb')}`;
      b.onclick = () => { S.duration = Math.round((n * 60 / S.bpm) * 100) / 100; $('duration').value = S.duration; changed(); };
      bc.appendChild(b);
    });
    let taps = [];
    $('tap').onclick = () => {
      const now = performance.now();
      if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
      taps.push(now); if (taps.length > 8) taps.shift();
      if (taps.length >= 2) {
        const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
        S.bpm = clamp(Math.round(60000 / avg), 40, 240); $('bpm').value = S.bpm; changed();
      }
    };

    // výstup
    const onRes = () => { fitPreview(); };
    bindNumber('resW', 'w', 64, 8192, onRes);
    bindNumber('resH', 'h', 64, 8192, onRes);
    const rc = $('resChips');
    RES.forEach(([w, h]) => {
      const b = document.createElement('button'); b.className = 'chip'; b.dataset.w = w; b.dataset.h = h;
      b.textContent = h > w ? `${w}×${h} na výšku` : `${w}×${h}`;
      b.onclick = () => { S.w = w; S.h = h; $('resW').value = w; $('resH').value = h; fitPreview(); changed({ now: true }); };
      rc.appendChild(b);
    });
    $('fps').value = String(S.fps);
    $('fps').addEventListener('change', e => { S.fps = +e.target.value; changed(); });
    $('quality').value = S.quality;
    $('quality').addEventListener('change', e => { S.quality = e.target.value; changed(); });
    $('ssaa').checked = S.ssaa;
    $('ssaa').addEventListener('change', e => { S.ssaa = e.target.checked; changed(); });

    // export
    document.querySelectorAll('#scope button').forEach(b => b.onclick = () => { if (!b.disabled) { S.scope = b.dataset.v; changed(); } });
    $('pickDir').onclick = async () => {
      if (!window.showDirectoryPicker) { status('Výber priečinka tento prehliadač nepodporuje — súbory pôjdu do Stiahnutých.', 'warn'); return; }
      try {
        dirHandle = await window.showDirectoryPicker({ id: 'lyricsgen', mode: 'readwrite' });
        $('pickDir').textContent = 'Priečinok: ' + dirHandle.name;
      } catch (e) { if (e.name !== 'AbortError') status('Priečinok sa nepodarilo otvoriť: ' + e.message, 'err'); }
    };
    $('exportBtn').onclick = () => doExport();
    $('stillBtn').onclick = doStill;
    $('cancelBtn').onclick = () => { cancelFlag = true; };

    // prehrávanie
    $('play').onclick = () => setPlaying(!playing);
    $('scrub').addEventListener('input', e => {
      const t = (e.target.value / 1000) * totalDur();
      if (songMode()) seek(t); else { setPlaying(false); tNow = t; dirty = true; }
    });
    document.addEventListener('keydown', e => {
      if (tap) {
        if (e.key === 'Enter' || e.code === 'KeyT') { e.preventDefault(); tapMark(); return; }
        if (e.key === 'Backspace') { e.preventDefault(); tapUndo(); return; }
        if (e.key === 'Escape') { e.preventDefault(); endTap(); return; }
        if (e.code === 'Space') { e.preventDefault(); setPlaying(!playing); return; }
      }
      if (e.code === 'Space' && !/^(TEXTAREA|INPUT|SELECT|BUTTON)$/.test(document.activeElement.tagName)) { e.preventDefault(); setPlaying(!playing); }
    }, true);

    if (!('VideoEncoder' in window)) $('banner').classList.add('show');
    refreshSlides();
    new ResizeObserver(fitPreview).observe($('viewport'));
    new ResizeObserver(fitTimeline).observe($('tlWrap'));
    // zapamätaná skladba
    let wantSong = S.mode === 'song';
    try {
      const f = await idb.get('song');
      if (f) await loadSong(f, false);
    } catch (e) { console.warn('Skladbu sa nepodarilo obnoviť:', e); }
    setMode(wantSong && song ? 'song' : 'clips');
    if (song && wantSong) status('');
    fitPreview();
    await ensureFont();
    document.fonts.ready.then(() => { dirty = true; renderThumbs(); });
    changed({ now: true });
    requestAnimationFrame(loop);
  }
  // pre testovanie z konzoly / Playwright
  window.LyricsGen = {
    get state() { return S; }, get clips() { return clips; }, get slides() { return slides; }, get song() { return song; },
    doExport, renderThumbs, loadSong, autoDistribute, setMode,
    setT: t => { if (songMode()) { if (playing) setPlaying(false); seek(t); } else { setPlaying(false); tNow = t; dirty = true; } },
    set(k, v) { S[k] = v; changed({ now: true }); },
    setText(t) { S.text = t; $('text').value = t; refreshSlides(); changed({ now: true }); },
    exportSongBlob: () => doExport({ blob: true }),
    aiAlign,
    pickCodec,
  };
  init();
})();
