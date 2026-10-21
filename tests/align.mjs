// Test AI zarovnania: spustí server.py (.venv), vloží text ako z Genius, nahrá skladbu so „spevom“
// (tests/out/vocal_test.wav, časy v vocal_truth.json) a porovná nájdené časy so skutočnými.
// Spustenie: node tests/align.mjs [model]
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5174, model = process.argv[2] || 'small';
const srv = spawn(path.join(ROOT, '.venv', 'Scripts', 'python.exe'), ['server.py'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), PYTHONIOENCODING: 'utf-8' } });
srv.stderr.on('data', d => { const s = d.toString(); if (/Error|Traceback/.test(s)) process.stderr.write(s); });
await new Promise(r => setTimeout(r, 2500));

const pasted = `[Intro]
Lights are shining over the city tonight (Yeah)

[Verse 1: Test]
We keep on dancing till the morning comes
Hands up high and never let it go
You might also like
Other Song
Other Artist
[Chorus]
Feel the music moving through your soul
This is the night we will remember
12Embed`;

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
page.on('pageerror', e => console.log('pageerror', e.message));
try {
  await page.goto(`http://localhost:${PORT}/LyricsGenerator.html`);
  await page.waitForFunction(() => window.LyricsGen && document.fonts.status === 'loaded');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.LyricsGen && document.fonts.status === 'loaded');
  // vloženie ako zo schránky
  await page.evaluate(s => {
    const ta = document.getElementById('text'); ta.focus(); ta.select();
    const dt = new DataTransfer(); dt.setData('text/plain', s);
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, pasted);
  console.log('po vložení:', JSON.stringify(await page.evaluate(() => LyricsGen.state.text)));
  await page.setInputFiles('#songFile', path.join(ROOT, 'tests', 'out', 'vocal_test.wav'));
  await page.waitForFunction(() => LyricsGen.song);
  await page.selectOption('#alignModel', model);
  await page.selectOption('#alignLang', 'en');
  page.on('dialog', d => d.accept());
  const t0 = Date.now();
  await page.click('#alignBtn');
  await page.waitForFunction(() => /Hotovo|zlyhalo|server|AI nie/.test(document.getElementById('status').textContent), null, { timeout: 15 * 60000 });
  console.log('status:', await page.textContent('#status'), `(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  const got = await page.evaluate(() => LyricsGen.slides.map(s => [s.time, s.gap ? '(pauza)' : s.text.replace(/\n/g, ' ')]));
  const truth = JSON.parse(readFileSync(path.join(ROOT, 'tests', 'out', 'vocal_truth.json'), 'utf8'));
  const lines = got.filter(g => g[1] !== '(pauza)');
  lines.forEach((g, i) => console.log(`${(g[0] ?? NaN).toFixed(2)} s  (skutočnosť ${truth[i]?.toFixed(2)}, rozdiel ${((g[0] - truth[i]) * 1000).toFixed(0)} ms)  ${g[1]}`));
  console.log('pauzy:', got.filter(g => g[1] === '(pauza)').map(g => g[0].toFixed(2)).join(', ') || 'žiadne');
} finally {
  await browser.close();
  srv.kill();
}
