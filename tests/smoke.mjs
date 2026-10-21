// Test: kontaktný hárok štýlov, načítanie skladby, export skladby so zvukom a export klipu.
// Spustenie: node tests/smoke.mjs   (potrebuje Edge alebo Chrome a ffprobe v PATH)
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'out');
mkdirSync(OUT, { recursive: true });
const probe = f => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', f]).toString());

const browser = await chromium.launch({ channel: process.env.BROWSER || 'msedge', headless: true });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(pathToFileURL(path.join(ROOT, 'LyricsGenerator.html')).href);
await page.waitForFunction(() => window.LyricsGen && document.fonts.status === 'loaded');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.LyricsGen && document.fonts.status === 'loaded');
await page.waitForTimeout(500);

// 1) kontaktný hárok: všetky štýly v 4 časoch
const sheet = await page.evaluate(() => {
  const S = LyricsGen.state, times = [0.3, 0.9, 2.2, 3.7], tw = 320, th = 180;
  const cv = document.createElement('canvas'); cv.width = tw * times.length; cv.height = th * STYLES.length;
  const c = cv.getContext('2d');
  const tmp = document.createElement('canvas'); tmp.width = tw; tmp.height = th;
  const tc = tmp.getContext('2d');
  STYLES.forEach((st, i) => times.forEach((t, j) => {
    const txt = st.key === 'highlight' || st.key === 'karaoke' ? 'I JUST WANNA\n*FEEL* ALIVE' : 'TAKE ME\nHIGHER';
    renderFrame(tc, tw, th, t, S, txt, i);
    c.drawImage(tmp, j * tw, i * th);
    c.fillStyle = '#f33'; c.font = '11px sans-serif'; c.fillText(`${i + 1} ${st.key} t=${t}`, j * tw + 4, i * th + 12);
  }));
  return cv.toDataURL('image/png');
});
writeFileSync(path.join(OUT, 'contact.png'), Buffer.from(sheet.split(',')[1], 'base64'));
console.log('štýlov:', await page.evaluate(() => STYLES.length));

// 2) skladba
await page.evaluate(() => LyricsGen.setText('TAKE ME\nHIGHER\n\nI JUST WANNA\n*FEEL* ALIVE\n\nWE\'LL BE\nTOGETHER\n\nNEVER\nLET GO'));
await page.setInputFiles('#songFile', path.join(OUT, 'test120.wav'));
await page.waitForFunction(() => LyricsGen.song && LyricsGen.clips.length > 0, null, { timeout: 20000 });
const info = await page.evaluate(() => ({
  bpm: LyricsGen.song.bpm, phase: LyricsGen.song.phase, start: LyricsGen.song.start, end: LyricsGen.song.end,
  dur: LyricsGen.song.duration, clips: LyricsGen.clips.map(c => [c.i, +c.s.toFixed(2), +c.e.toFixed(2), c.style]),
  text: LyricsGen.state.text,
}));
console.log('skladba:', JSON.stringify(info, null, 0));

// auto režim + screenshot UI
await page.evaluate(() => { LyricsGen.set('auto', true); LyricsGen.setT(9); });
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(OUT, 'ui-song.png') });
console.log('auto štýly:', await page.evaluate(() => LyricsGen.clips.map(c => STYLES[c.style].key).join(', ')));

// 3) export skladby so zvukom (malé rozlíšenie kvôli rýchlosti)
await page.evaluate(() => { LyricsGen.set('w', 640); LyricsGen.set('h', 360); LyricsGen.set('fps', 25); });
const t0 = Date.now();
const b64 = await page.evaluate(async () => {
  const blob = await LyricsGen.exportSongBlob();
  if (!blob) return null;
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(s);
});
console.log('status:', await page.textContent('#status'));
if (b64) {
  const f = path.join(OUT, 'song.mp4');
  writeFileSync(f, Buffer.from(b64, 'base64'));
  const p = probe(f);
  console.log(`song.mp4 (${((Date.now() - t0) / 1000).toFixed(1)} s):`, p.streams.map(s => `${s.codec_type} ${s.codec_name} ${s.width || ''}x${s.height || ''} ${s.nb_frames || ''}fr ${s.sample_rate || ''}`).join(' | '), 'dĺžka', p.format.duration);
}

// 4) export klipu (stiahnutie)
await page.evaluate(() => { LyricsGen.setMode('clips'); LyricsGen.set('scope', 'current'); LyricsGen.set('duration', 2); });
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#exportBtn')]);
const f2 = path.join(OUT, 'clip.mp4');
await dl.saveAs(f2);
const p2 = probe(f2);
console.log('clip.mp4:', p2.streams.map(s => `${s.codec_type} ${s.codec_name} ${s.width}x${s.height} ${s.nb_frames}fr`).join(' | '), 'dĺžka', p2.format.duration);
console.log('status:', await page.textContent('#status'));

console.log(errors.length ? 'CHYBY:\n' + errors.join('\n') : 'bez chýb v konzole');
await browser.close();
