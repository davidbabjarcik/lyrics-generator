# Lyrics Generator

Offline generátor animovaných textov pre LED obrazovku. Výsledok je jeden súbor
`LyricsGenerator.html` — otvor ho dvojklikom v Chrome alebo Edge.

## Použitie
1. Napíš text — prázdny riadok = nový klip, Enter = zalomenie, `*SLOVO*` = zvýraznenie.
2. Vyber štýl (44 variantov vrátane 3D priestoru) alebo zapni **Auto režim** (každý klip iný štýl), font, veľkosť, žiaru.
3. Nastav dĺžku, nábeh/odchod a BPM (krokové štýly idú do rytmu).
4. Zadaj rozlíšenie (šírka × výška) a FPS, klikni **Exportovať MP4**
   (aktuálny klip alebo všetky naraz; voliteľne priamo do vybraného priečinka).

### Celý text piesne + automatické načasovanie (AI)
1. Spusti **`spustit.bat`** — otvorí appku na http://localhost:5173 (server so zarovnaním).
2. Vlož celý text piesne (napr. z Genius) — hlavičky `[Verse]`, „You might also like“ a pod. sa
   odstránia samy, každý riadok bude klip, dlhé riadky sa zalomia (tlačidlo **Vrátiť pôvodný** vráti zmenu).
3. Nahraj skladbu a klikni **Rozpoznať, kde sa čo spieva**. Whisper (stable-ts) na tvojej grafike nájde
   začiatok každého riadku; pri dlhších pauzách text zmizne. Prvé spustenie stiahne model (~1,5 GB do `models/`).
4. Skontroluj prehrávaním, prípadné chyby oprav ťahaním značiek na časovej osi.

Inštalácia AI (raz, ~3 GB na disk projektu):
```
python -m venv .venv
.venv\Scripts\python -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu126
.venv\Scripts\python -m pip install stable-ts demucs
```

### Video do hudby
1. V sekcii **Skladba** nahraj MP3/WAV — zistí sa tempo (BPM) a text sa rozloží po skladbe.
2. Dolaď časy: **Ťukať ⏎** (počas prehrávania stlač Enter na začiatku každého klipu), ťahaním značiek
   na časovej osi (Shift = posunie aj všetky ďalšie) alebo **Import LRC/SRT**.
3. Export **Celá skladba** = jedno MP4 so zvukom (H.264 + AAC), uložené priamo do súboru.

Export: H.264 MP4, čierne pozadie, voliteľné 2× vyhladzovanie (SSAA), kvalita až „Ultra (master)“.
Nastavenia aj nahrané fonty sa pamätajú v prehliadači.

## Štruktúra projektu
- `src/engine.js` — renderovací engine, všetkých 44 štýlov (`STYLES`), `renderFrame()`, `renderSongFrame()`
- `src/audio.js` — analýza skladby (BPM, doby), import LRC/SRT
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
