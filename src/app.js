/* =====================================================================
   LYRICS GENERATOR — UI, náhľad, export MP4
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
    w: 1920, h: 1080, fps: 30, quality: 'high', scope: 'current',
  };
  const FONTS = [
    { g: 'Vstavané (fungujú všade)', items: [['Montserrat', 900], ['Inter', 900], ['Poppins', 800], ['Archivo Black', 400], ['Anton', 400], ['Bebas Neue', 400], ['Oswald', 700], ['Barlow Condensed', 800]] },
    { g: 'Systémové (Windows)', items: [['Arial Black', 900], ['Impact', 400], ['Segoe UI', 900], ['Bahnschrift', 700], ['Arial', 700]] },
  ];
  const RES = [[1920, 1080], [3840, 2160], [1280, 720], [2560, 1440], [1080, 1920]];
  const BPP = { std: 0.08, high: 0.15, max: 0.26 };

  let S = Object.assign({}, DEF);
  try { const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); if (s) Object.assign(S, s); } catch (e) {}
  const customFonts = [];
  let slides = [], cur = 0, tNow = 0, playing = true, dirty = true, hover = -1;
  let dirHandle = null, busy = false, cancelFlag = false;

  /* ---------- pomocné ---------- */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const even = v => Math.max(2, Math.round(v / 2) * 2);
  let saveT = 0;
  function save() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) {} }, 250); }
  function applyFamily() { S.family = S.fontSel === '__other' ? (S.otherFamily.trim() || 'Montserrat') : S.fontSel; }
  function slideText(i = cur) { return slides[i] ? slides[i].text : ''; }
  function poseTime() { return clamp(S.duration - Math.min(S.tout, S.duration / 2) - 0.03, Math.min(S.tin, S.duration / 2) + 0.01, S.duration); }
  function bitrate(W, H, fps) { return Math.round(Math.min(160e6, Math.max(2e6, W * H * fps * BPP[S.quality]))); }
  function plural(n, a, b, c) { return n === 1 ? a : n >= 2 && n <= 4 ? b : c; }
  function slug(s) {
    return s.replace(/\*/g, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40).toUpperCase() || 'TEXT';
  }
  function fileName(SS, sl, idx, W, H, ext) {
    return `${String(idx + 1).padStart(2, '0')}_${slug(sl[idx].text)}_${STYLES[SS.style].key}_${W}x${H}.${ext}`;
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

  /* ---------- zmena nastavení ---------- */
  let thumbT = 0;
  function changed(opts = {}) {
    applyFamily(); save(); dirty = true;
    if (!playing) tNow = Math.min(tNow, S.duration);
    clearTimeout(thumbT); thumbT = setTimeout(renderThumbs, opts.now ? 0 : 140);
    updateInfo();
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
    const host = $('clips'); host.innerHTML = '';
    slides.forEach((s, i) => {
      const b = document.createElement('button');
      b.className = 'chip' + (i === cur ? ' on' : '');
      const first = s.text.replace(/\*/g, '').trim().split('\n').map(x => x.trim()).join(' / ');
      b.innerHTML = `<b>${String(i + 1).padStart(2, '0')}</b>`;
      b.appendChild(document.createTextNode(first.length > 26 ? first.slice(0, 25) + '…' : first));
      b.title = s.text.replace(/\*/g, '');
      b.onclick = () => { cur = i; tNow = 0; refreshSlides(); changed({ now: true }); };
      host.appendChild(b);
    });
    $('clipsLbl').textContent = slides.length ? `${slides.length} ${plural(slides.length, 'klip', 'klipy', 'klipov')}` : 'Žiadny text';
    $('scope').querySelector('[data-v=all]').textContent = `Všetky (${slides.length})`;
  }
  function caretSlide() {
    const pos = $('text').selectionStart;
    let idx = 0;
    slides.forEach((s, i) => { if (s.start <= pos) idx = i; });
    if (idx !== cur) { cur = idx; refreshSlides(); changed({ now: true }); }
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
    dirty = true;
  }
  function drawPreview() {
    renderFrame(pctx, pc.width, pc.height, tNow, S, slideText(), S.style);
    $('scrub').value = Math.round((tNow / S.duration) * 1000);
    $('time').textContent = `${tNow.toFixed(2)} / ${S.duration.toFixed(2)} s`;
    const beat = 60 / Math.max(20, S.bpm), ph = (tNow % beat) / beat;
    $('beatDot').style.opacity = (0.12 + 0.88 * Math.exp(-ph * 6)).toFixed(3);
  }
  function setPlaying(p) {
    playing = p;
    $('play').innerHTML = p
      ? '<svg viewBox="0 0 12 12"><rect x="1.5" y="1" width="3" height="10"/><rect x="7.5" y="1" width="3" height="10"/></svg>'
      : '<svg viewBox="0 0 12 12"><path d="M2 1l9 5-9 5z"/></svg>';
  }
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (playing && !busy) { tNow += dt; if (tNow >= S.duration) tNow %= S.duration; dirty = true; }
    if (dirty) { drawPreview(); dirty = false; }
    if (hover >= 0 && !busy) drawThumb(hover, (now / 1000) % S.duration);
    requestAnimationFrame(loop);
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
      b.onclick = () => { S.style = i; tNow = 0; markStyle(); changed(); };
      b.onmouseenter = () => { hover = i; };
      b.onmouseleave = () => { hover = -1; drawThumb(i, poseTime()); };
      host.appendChild(b);
      thumbs.push({ b, cv, ctx: cv.getContext('2d') });
    });
    markStyle();
  }
  function markStyle() { thumbs.forEach((th, i) => th.b.classList.toggle('on', i === S.style)); }
  function drawThumb(i, t) {
    const th = thumbs[i], text = slideText() || 'TEXT';
    renderFrame(th.ctx, th.cv.width, th.cv.height, t, S, text, i);
  }
  function renderThumbs() {
    const ar = S.w / S.h, tw = 384, thh = Math.max(24, Math.round(tw / ar));
    thumbs.forEach((th, i) => {
      if (th.cv.width !== tw || th.cv.height !== thh) { th.cv.width = tw; th.cv.height = thh; }
      drawThumb(i, poseTime());
    });
  }

  /* ---------- info ---------- */
  function updateInfo() {
    $('vinfo').textContent = `${S.w}×${S.h} · ${S.fps} FPS · KLIP ${slides.length ? cur + 1 : 0}/${slides.length} · ${String(S.style + 1).padStart(2, '0')} ${STYLES[S.style].name}`;
    $('beatsOut').textContent = `≈ ${(S.duration * S.bpm / 60).toFixed(1)} dôb`;
    const W = even(S.w), H = even(S.h), frames = Math.max(1, Math.round(S.duration * S.fps));
    const mb = (bitrate(W, H, S.fps) * S.duration) / 8 / 1e6;
    $('estimate').textContent = `${frames} snímok na klip · max. ~${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB (čierne pozadie býva oveľa menej)`;
    document.querySelectorAll('#resChips .chip').forEach(c => c.classList.toggle('on', c.dataset.w == S.w && c.dataset.h == S.h));
    document.querySelectorAll('#scope button').forEach(b => b.classList.toggle('on', b.dataset.v === S.scope));
  }

  /* =====================================================================
     EXPORT
     ===================================================================== */
  async function pickCodec(W, H, fps, br) {
    const avc = ['avc1.640028', 'avc1.64002A', 'avc1.640032', 'avc1.640033', 'avc1.640034', 'avc1.64003C', 'avc1.64003D', 'avc1.64003E',
      'avc1.4D0028', 'avc1.4D0033', 'avc1.4D0034', 'avc1.42E028', 'avc1.42E033', 'avc1.42E034'];
    for (const codec of avc) {
      const cfg = { codec, width: W, height: H, bitrate: br, framerate: fps, avc: { format: 'avc' } };
      try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return { cfg, mux: 'avc', name: 'H.264' }; } catch (e) {}
    }
    for (const codec of ['vp09.00.40.08', 'vp09.00.41.08', 'vp09.00.50.08', 'vp09.00.51.08', 'vp09.00.60.08', 'vp09.00.61.08']) {
      const cfg = { codec, width: W, height: H, bitrate: br, framerate: fps };
      try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return { cfg, mux: 'vp9', name: 'VP9' }; } catch (e) {}
    }
    return null;
  }
  function waitQueue(enc) {
    return new Promise(res => {
      if (enc.encodeQueueSize <= 4) return res();
      const h = () => { if (enc.encodeQueueSize <= 4) { enc.removeEventListener('dequeue', h); clearTimeout(to); res(); } };
      const to = setTimeout(() => { enc.removeEventListener('dequeue', h); res(); }, 250);
      enc.addEventListener('dequeue', h);
    });
  }
  async function encodeClip(SS, text, W, H, codec, onProg) {
    const fps = SS.fps;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const frames = Math.max(1, Math.round(SS.duration * fps));
    // pri odchode > 0 je posledná snímka úplne čierna; bez odchodu klip plynulo loopuje
    const Dr = SS.tout > 0 ? Math.max(1, frames - 1) / fps : frames / fps;
    const target = new Mp4Muxer.ArrayBufferTarget();
    const muxer = new Mp4Muxer.Muxer({ target, video: { codec: codec.mux, width: W, height: H, frameRate: fps }, fastStart: 'in-memory' });
    let err = null;
    const enc = new VideoEncoder({ output: (ch, meta) => muxer.addVideoChunk(ch, meta), error: e => { err = e; } });
    enc.configure(codec.cfg);
    const gop = Math.max(1, Math.round(fps));
    try {
      for (let i = 0; i < frames; i++) {
        if (cancelFlag) throw new Error('cancel');
        if (err) throw err;
        renderFrame(ctx, W, H, i / fps, SS, text, SS.style, Dr);
        const vf = new VideoFrame(cv, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
        enc.encode(vf, { keyFrame: i % gop === 0 });
        vf.close();
        await waitQueue(enc);
        if (i % 4 === 0 || i === frames - 1) { onProg(i + 1, frames); await sleep(0); }
      }
      await enc.flush();
      if (err) throw err;
    } finally {
      if (enc.state !== 'closed') enc.close();
    }
    muxer.finalize();
    return new Blob([target.buffer], { type: 'video/mp4' });
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
  }
  async function doExport() {
    if (busy) return;
    if (!('VideoEncoder' in window)) { status('Tento prehliadač nevie exportovať video. Otvor súbor v Chrome alebo Edge.', 'err'); return; }
    if (!slides.length) { status('Najprv napíš text.', 'err'); return; }
    const SS = JSON.parse(JSON.stringify(S)); SS.family = S.family;
    const sl = slides.map(s => ({ text: s.text }));
    const list = SS.scope === 'all' ? sl.map((_, i) => i) : [cur];
    const W = even(SS.w), H = even(SS.h);
    cancelFlag = false; setBusy(true); $('bar').style.width = '0%';
    status('Pripravujem kódovanie…');
    try {
      await ensureFont();
      const codec = await pickCodec(W, H, SS.fps, bitrate(W, H, SS.fps));
      if (!codec) throw new Error(`prehliadač nevie kódovať video ${W}×${H} pri ${SS.fps} FPS. Skús nižšie rozlíšenie alebo FPS.`);
      let where = 'dl';
      for (let k = 0; k < list.length; k++) {
        const idx = list[k];
        const blob = await encodeClip(SS, sl[idx].text, W, H, codec, (fr, tot) => {
          $('bar').style.width = (((k + fr / tot) / list.length) * 100).toFixed(1) + '%';
          status(`Klip ${k + 1}/${list.length} · snímka ${fr}/${tot} · ${codec.name}`);
        });
        where = await saveBlob(blob, fileName(SS, sl, idx, W, H, 'mp4'));
      }
      $('bar').style.width = '100%';
      const n = list.length;
      let msg = `Hotovo: ${n} ${plural(n, 'video uložené', 'videá uložené', 'videí uložených')} ${where === 'dir' ? 'do priečinka „' + dirHandle.name + '“' : 'do Stiahnutých súborov'} (${W}×${H}, ${SS.fps} FPS, ${codec.name}).`;
      if (codec.mux !== 'avc') msg += ' Pozor: tento prehliadač nemá H.264, použil sa VP9 — pre H.264 otvor generátor v Chrome alebo Edge.';
      status(msg, codec.mux !== 'avc' ? 'warn' : 'ok');
    } catch (e) {
      if (e && e.message === 'cancel') status('Export zrušený.', 'warn');
      else { console.error(e); status('Chyba exportu: ' + (e && e.message ? e.message : e), 'err'); }
    } finally {
      setBusy(false); dirty = true;
    }
  }
  async function doStill() {
    if (busy || !slides.length) return;
    await ensureFont();
    const W = even(S.w), H = even(S.h), t = playing ? poseTime() : tNow;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    renderFrame(cv.getContext('2d'), W, H, t, S, slideText(), S.style);
    const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
    const where = await saveBlob(blob, fileName(S, slides, cur, W, H, 'png'));
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

    // export
    document.querySelectorAll('#scope button').forEach(b => b.onclick = () => { S.scope = b.dataset.v; changed(); });
    $('pickDir').onclick = async () => {
      if (!window.showDirectoryPicker) { status('Výber priečinka tento prehliadač nepodporuje — súbory pôjdu do Stiahnutých.', 'warn'); return; }
      try {
        dirHandle = await window.showDirectoryPicker({ id: 'lyricsgen', mode: 'readwrite' });
        $('pickDir').textContent = 'Priečinok: ' + dirHandle.name;
      } catch (e) { if (e.name !== 'AbortError') status('Priečinok sa nepodarilo otvoriť: ' + e.message, 'err'); }
    };
    $('exportBtn').onclick = doExport;
    $('stillBtn').onclick = doStill;
    $('cancelBtn').onclick = () => { cancelFlag = true; };

    // prehrávanie
    $('play').onclick = () => setPlaying(!playing);
    $('scrub').addEventListener('input', e => { setPlaying(false); tNow = (e.target.value / 1000) * S.duration; dirty = true; });
    document.addEventListener('keydown', e => {
      if (e.code === 'Space' && !/^(TEXTAREA|INPUT|SELECT|BUTTON)$/.test(document.activeElement.tagName)) { e.preventDefault(); setPlaying(!playing); }
    });

    if (!('VideoEncoder' in window)) $('banner').classList.add('show');
    setPlaying(true);
    refreshSlides();
    new ResizeObserver(fitPreview).observe($('viewport'));
    fitPreview();
    await ensureFont();
    document.fonts.ready.then(() => { dirty = true; renderThumbs(); });
    changed({ now: true });
    requestAnimationFrame(loop);
  }
  // pre testovanie z konzoly
  window.LyricsGen = { get state() { return S; }, doExport, renderThumbs, setT: t => { setPlaying(false); tNow = t; dirty = true; }, encodeClip, pickCodec };
  init();
})();
