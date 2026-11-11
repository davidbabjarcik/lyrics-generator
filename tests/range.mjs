// Test úseku skladby: export len časti (dĺžka, snímky, zvuk) a AI rozpoznanie len v úseku.
// Spustenie: node tests/range.mjs   (potrebuje .venv so stable-ts kvôli AI časti)
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'out'), PORT = 5174;
const srv = spawn(path.join(ROOT, '.venv', 'Scripts', 'python.exe'), ['server.py'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), PYTHONIOENCODING: 'utf-8' } });
await new Promise(r => setTimeout(r, 2500));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => d.accept());
try {
  await page.goto(`http://localhost:${PORT}/LyricsGenerator.html`);
  await page.waitForFunction(() => window.LyricsGen && document.fonts.status === 'loaded');
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForFunction(() => window.LyricsGen && document.fonts.status === 'loaded');

  // 1) export úseku 6–14 s
  await page.evaluate(() => LyricsGen.setText('TAKE ME\nHIGHER\n\nI JUST WANNA\nFEEL ALIVE\n\nWE\'LL BE\nTOGETHER\n\nNEVER\nLET GO'));
  await page.setInputFiles('#songFile', path.join(OUT, 'test120.wav'));
  await page.waitForFunction(() => LyricsGen.clips.length > 0);
  await page.check('#rangeOn');
  await page.fill('#rangeA', '0:06'); await page.press('#rangeA', 'Enter');
  await page.fill('#rangeB', '14'); await page.press('#rangeB', 'Enter');
  await page.evaluate(() => { LyricsGen.set('w', 640); LyricsGen.set('h', 360); LyricsGen.set('fps', 25); LyricsGen.setT(9); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'ui-range.png') });
  const b64 = await page.evaluate(async () => {
    const blob = await LyricsGen.exportSongBlob(); const u = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s);
  });
  const f = path.join(OUT, 'range.mp4'); writeFileSync(f, Buffer.from(b64, 'base64'));
  const p = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', f]).toString());
  console.log('range.mp4:', p.streams.map(s => `${s.codec_type} ${s.codec_name} ${s.nb_frames}fr`).join(' | '), 'dĺžka', p.format.duration, '(čakám 8 s, 200 snímok)');
  console.log('status:', await page.textContent('#status'));

  // 2) AI len v úseku 8–20 s, text len 2. a 3. riadku
  await page.selectOption('#alignModel', 'small'); await page.selectOption('#alignLang', 'en');
  await page.setInputFiles('#songFile', path.join(OUT, 'vocal_test.wav'));
  await page.waitForFunction(() => LyricsGen.song && /vocal_test/.test(LyricsGen.song.name));
  await page.evaluate(() => LyricsGen.setText('We keep on dancing till the morning comes\n\nHands up high and never let it go'));
  await page.check('#rangeOn');
  await page.fill('#rangeA', '8'); await page.press('#rangeA', 'Enter');
  await page.fill('#rangeB', '20'); await page.press('#rangeB', 'Enter');
  await page.click('#alignBtn');
  await page.waitForFunction(() => /Hotovo|zlyhalo/.test(document.getElementById('status').textContent), null, { timeout: 600000 });
  console.log('status:', await page.textContent('#status'));
  console.log('časy:', JSON.stringify(await page.evaluate(() => LyricsGen.slides.map(s => [s.time && +s.time.toFixed(2), s.gap ? 'pauza' : s.text.slice(0, 20)]))), '(čakám ~9.5 a ~15.0)');
} finally {
  console.log(errs.length ? 'CHYBY: ' + errs.join(' | ') : 'bez chýb v konzole');
  await browser.close(); srv.kill();
}
