# Lyrics Generator

Offline generátor animovaných textov pre LED obrazovku. Výsledok je jeden súbor
`LyricsGenerator.html` — otvor ho dvojklikom v Chrome alebo Edge.

## Použitie
1. Napíš text — prázdny riadok = nový klip, Enter = zalomenie, `*SLOVO*` = zvýraznenie.
2. Vyber štýl (16 variantov), font, veľkosť, žiaru.
3. Nastav dĺžku, nábeh/odchod a BPM (krokové štýly idú do rytmu).
4. Zadaj rozlíšenie (šírka × výška) a FPS, klikni **Exportovať MP4**
   (aktuálny klip alebo všetky naraz; voliteľne priamo do vybraného priečinka).

Export: H.264 MP4, čierne pozadie, kľúčová snímka každú sekundu.
Nastavenia aj nahrané fonty sa pamätajú v prehliadači.

## Štruktúra projektu
- `src/engine.js` — renderovací engine, všetkých 16 štýlov (`STYLES`), `renderFrame()`
- `src/app.js` — UI, náhľad, export (WebCodecs `VideoEncoder` + mp4-muxer)
- `src/app.html` — HTML/CSS šablóna s miestami pre vloženie fontov a skriptov
- `build.py` — zostaví samostatný `LyricsGenerator.html` (fonty a knižnice vložené ako base64)

## Zostavenie
```
npm install
python3 build.py
```

## Pridanie nového štýlu
Pridaj objekt do poľa `STYLES` v `src/engine.js`:
`{ key, name, lay?, draw(R) }` — `R.L` je rozloženie textu (riadky, slová, pozície),
`R.t` čas, `R.pin`/`R.pout` priebeh nábehu/odchodu, `R.beat` dĺžka doby podľa BPM.
Na kreslenie použi `paint()` (text so žiarou) a `strokePath()` (čiary).
