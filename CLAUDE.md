# Lyrics Generator — kontext pre Claude Code

Offline generátor animovaných textov (lyrics) pre LED obrazovky. Používateľ vloží text,
vyberie štýl/font/animáciu a exportuje MP4 s čiernym pozadím v ľubovoľnom rozlíšení.
Autor: Dejvo (JEF PRODUCTION). UI aj komunikácia sú **po slovensky**.

## Výstup
Jeden samostatný súbor `LyricsGenerator.html` (otvára sa dvojklikom v Chrome/Edge, funguje offline).
Fonty a knižnice sú doň vložené ako base64 / inline — žiadne externé požiadavky.

## Štruktúra
- `src/engine.js` — renderovací engine. Pole `STYLES` (26 štýlov: 01–16 podľa predlohy „Lyrics Template“, 17–26 nové),
  `autoStyles()` (AUTO režim — iný štýl pre každý klip), `getSlides()/joinSlides()` (klipy + časy `[mm:ss.cc]`),
  `renderSongFrame()` (aktívny klip podľa času v skladbe), `glyphs(R)` (pozície jednotlivých písmen),
  `renderFrame(ctx, W, H, t, S, text, styleIdx, Doverride)`, rozloženie textu `makeLayout()`,
  kreslenie `paint()` (text so žiarou), `strokePath()` (čiary), časovanie `stagIn/stagOut/beatSpot`.
  Všetky rozmery sú relatívne k výške obrazu → náhľad aj export vyzerajú rovnako.
- `src/app.js` — UI, náhľad (requestAnimationFrame), náhľady štýlov, export cez WebCodecs
  `VideoEncoder` + `mp4-muxer` (H.264, fallback VP9), ukladanie do priečinka (File System Access API)
  alebo Stiahnutých. Nastavenia a nahrané fonty v localStorage.
- `src/audio.js` — analýza skladby (BPM, fáza dôb, priebeh, začiatok/koniec hudby), import LRC/SRT.
- `src/app.html` — HTML/CSS šablóna so značkami `/*@@FONTS@@*/`, `//@@MP4MUXER@@`, `//@@ENGINE@@`, `//@@AUDIO@@`, `//@@APP@@`.
- `server.py` — lokálny server (port 5173): servíruje appku + `/api/align` (stable-ts `model.align(..., original_split=True)`,
  voliteľne `denoiser='demucs'`), úlohy na pozadí `/api/job/<id>`. Python prostredie v `.venv` (torch cu126), modely v `models/`.
  `spustit.bat` ho spustí. V appke `aiAlign()` posiela 16 kHz mono float32 PCM + riadky.
- `build.py` — vloží fonty (@fontsource, latin + latin-ext) a skripty do `LyricsGenerator.html`.

## Príkazy
```
npm install          # fonty (@fontsource/*) a mp4-muxer
python build.py      # zostaví LyricsGenerator.html
```
Po každej zmene v `src/` treba spustiť `python build.py`.

## Štýly (index → key)
01 clean · 02 highlight (`*SLOVO*` v texte) · 03 fade · 04 outline · 05 wordbyword · 06 slide ·
07 stack · 08 lines · 09 scale · 10 split · 11 frame · 12 chain · 13 glitch · 14 circle ·
15 fadewords · 16 bar · 17 typewriter · 18 reveal · 19 wave · 20 neon · 21 karaoke · 22 bounce · 23 zoom · 24 echo · 25 flip · 26 rgb

## Režim Skladba
Nahraná skladba (dekódovaná na 48 kHz, pamätá sa v IndexedDB) + text, kde klip začína časom `[mm:ss.cc]`
(klip iba s časom = pauza). Časy: Automaticky (rovnomerne po dobách), Ťukanie (Enter počas prehrávania),
import LRC/SRT, ťahanie značiek na časovej osi. Klip trvá do ďalšieho času (max. `songMax`), začína o `lead` skôr.
Export celej skladby = jedno MP4 s H.264 + AAC (fallback Opus), zapisované priamo do súboru (File System Access).

Nový štýl: objekt `{ key, name, lay?, draw(R) }` v `STYLES`. `R.L` = rozloženie (lines, words, px, capH,
cx, cy, blockW…), `R.t` čas, `R.D` dĺžka, `R.pin/R.pout` priebeh nábehu/odchodu (0–1),
`R.vin/R.vout/R.vis` viditeľnosť, `R.beat` dĺžka doby z BPM, `R.rgb/R.acc` farby, `R.dimA` tlmenie.
`lay`: `single` (všetko na jeden riadok), `row` (slová vedľa seba), `rowsH` (výška pre opakované riadky),
`padW/padH` (miesto pre rámik). Náhodnosť len cez deterministické `rnd()` — export musí byť opakovateľný.

## Pravidlá
- Text v UI a hláškach po slovensky, s diakritikou.
- Pozadie čierne (`S.bg`), rozlíšenie zadáva používateľ (párne čísla — `even()` pri exporte).
- Žiadne externé CDN — všetko musí fungovať offline v jednom súbore.
- Testovanie: Playwright/Chromium — render kontaktného hárku všetkých štýlov v rôznych časoch
  a export (kontrola cez ffprobe: rozlíšenie, počet snímok, dĺžka). Spustenie: `node tests/smoke.mjs`
  (playwright-core + nainštalovaný Edge; testovacia skladba `tests/out/test120.wav` sa generuje Pythonom).
- Lokálny server pre náhľad: `.claude/launch.json` (python http.server na porte 5173; 8080 je blokovaný).

## Nápady na ďalej
- Export PNG sekvencie s priehľadným pozadím (alfa) pre Resolume / Madrix
- Predvoľby (uložené kombinácie štýl + font + farby)
