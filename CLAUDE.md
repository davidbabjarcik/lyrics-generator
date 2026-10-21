# Lyrics Generator — kontext pre Claude Code

Offline generátor animovaných textov (lyrics) pre LED obrazovky. Používateľ vloží text,
vyberie štýl/font/animáciu a exportuje MP4 s čiernym pozadím v ľubovoľnom rozlíšení.
Autor: Dejvo (JEF PRODUCTION). UI aj komunikácia sú **po slovensky**.

## Výstup
Jeden samostatný súbor `LyricsGenerator.html` (otvára sa dvojklikom v Chrome/Edge, funguje offline).
Fonty a knižnice sú doň vložené ako base64 / inline — žiadne externé požiadavky.

## Štruktúra
- `src/engine.js` — renderovací engine. Pole `STYLES` (16 štýlov podľa predlohy „Lyrics Template“),
  `renderFrame(ctx, W, H, t, S, text, styleIdx, Doverride)`, rozloženie textu `makeLayout()`,
  kreslenie `paint()` (text so žiarou), `strokePath()` (čiary), časovanie `stagIn/stagOut/beatSpot`.
  Všetky rozmery sú relatívne k výške obrazu → náhľad aj export vyzerajú rovnako.
- `src/app.js` — UI, náhľad (requestAnimationFrame), náhľady štýlov, export cez WebCodecs
  `VideoEncoder` + `mp4-muxer` (H.264, fallback VP9), ukladanie do priečinka (File System Access API)
  alebo Stiahnutých. Nastavenia a nahrané fonty v localStorage.
- `src/app.html` — HTML/CSS šablóna so značkami `/*@@FONTS@@*/`, `//@@MP4MUXER@@`, `//@@ENGINE@@`, `//@@APP@@`.
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
15 fadewords · 16 bar

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
  a export (kontrola cez ffprobe: rozlíšenie, počet snímok, dĺžka).

## Nápady na ďalej
- Import SRT/LRC a export celej skladby podľa časov
- Export PNG sekvencie s priehľadným pozadím (alfa) pre Resolume / Madrix
- Predvoľby (uložené kombinácie štýl + font + farby)
