#!/usr/bin/env python3
"""Zostaví jeden samostatný súbor LyricsGenerator.html (fonty + knižnice vložené, funguje offline)."""
import base64, re, pathlib

ROOT = pathlib.Path(__file__).parent
FS = ROOT / "node_modules" / "@fontsource"
FONTS = {  # balík: hrúbky
    "montserrat": [800, 900], "inter": [800, 900], "poppins": [800], "archivo-black": [400],
    "anton": [400], "bebas-neue": [400], "oswald": [700], "barlow-condensed": [800],
}

def font_css():
    out = []
    for pkg, weights in FONTS.items():
        for w in weights:
            css = (FS / pkg / f"{w}.css").read_text(encoding="utf-8")
            for m in re.finditer(r"/\*\s*([\w-]+)\s*\*/\s*@font-face\s*\{(.*?)\}", css, re.S):
                name, body = m.group(1), m.group(2)
                if not re.search(rf"-latin(-ext)?-{w}-normal$", name):
                    continue
                fam = re.search(r"font-family:\s*'([^']+)'", body).group(1)
                rng = re.search(r"unicode-range:\s*([^;]+);", body).group(1)
                data = base64.b64encode((FS / pkg / "files" / f"{name}.woff2").read_bytes()).decode()
                out.append(f"@font-face{{font-family:'{fam}';font-style:normal;font-display:block;font-weight:{w};"
                           f"src:url(data:font/woff2;base64,{data}) format('woff2');unicode-range:{rng};}}")
    return "\n".join(out)

html = (ROOT / "src" / "app.html").read_text(encoding="utf-8")
html = html.replace("/*@@FONTS@@*/", font_css())
html = html.replace("//@@MP4MUXER@@", (ROOT / "node_modules/mp4-muxer/build/mp4-muxer.js").read_text(encoding="utf-8"))
html = html.replace("//@@ENGINE@@", (ROOT / "src" / "engine.js").read_text(encoding="utf-8"))
html = html.replace("//@@AUDIO@@", (ROOT / "src" / "audio.js").read_text(encoding="utf-8"))
html = html.replace("//@@APP@@", (ROOT / "src" / "app.js").read_text(encoding="utf-8"))
out = ROOT / "LyricsGenerator.html"
out.write_text(html, encoding="utf-8")
print(out, f"{out.stat().st_size/1024:.0f} KB")
