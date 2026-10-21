#!/usr/bin/env python3
"""Lokálny server pre Lyrics Generator.

- servíruje LyricsGenerator.html na http://localhost:5173
- /api/align: zarovná text skladby na zvuk (stable-ts / Whisper) a vráti čas každého riadku

Spustenie:  .venv\\Scripts\\python server.py   (alebo spustit.bat)
"""
import json, os, struct, sys, threading, time, traceback, uuid, webbrowser
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MODELS = ROOT / "models"
os.environ.setdefault("TORCH_HOME", str(MODELS / "torch"))  # demucs a pod. – nie na disk C:
PORT = int(os.environ.get("PORT", "5173"))
SR = 16000

JOBS = {}
MODEL_CACHE = {}
LOCK = threading.Lock()  # na GPU naraz len jedna úloha


def status_info():
    info = {"ok": True, "align": False}
    try:
        import torch, stable_whisper  # noqa: F401
        info.update(align=True, cuda=torch.cuda.is_available(),
                    device=torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU")
        try:
            import demucs  # noqa: F401
            info["demucs"] = True
        except ImportError:
            info["demucs"] = False
    except ImportError as e:
        info["error"] = f"chýba balík: {e.name}"
    return info


def get_model(name):
    import torch, stable_whisper
    if name not in MODEL_CACHE:
        MODEL_CACHE.clear()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        dev = "cuda" if torch.cuda.is_available() else "cpu"
        MODEL_CACHE[name] = stable_whisper.load_model(name, device=dev, download_root=str(MODELS / "whisper"))
    return MODEL_CACHE[name]


def split_by_words(result, lines):
    """Záloha: ak sa počet segmentov nezhoduje s riadkami, rozdelí slová postupne podľa počtu slov v riadkoch."""
    words = [w for seg in result.segments for w in seg.words]
    out, k = [], 0
    for ln in lines:
        n = max(1, len(ln.split()))
        chunk = words[k:k + n]
        k += n
        if chunk:
            out.append({"start": float(chunk[0].start), "end": float(chunk[-1].end)})
        else:
            out.append(None)
    return out


def run_align(job, pcm, opts):
    import numpy as np
    lines = [str(x).strip() for x in opts.get("lines", []) if str(x).strip()]
    lang = opts.get("language") or None
    model_name = opts.get("model") or "medium"
    vocals = bool(opts.get("vocals"))
    with LOCK:
        t0 = time.time()
        job.update(state="running", message=f"Načítavam model {model_name}… (prvýkrát sa sťahuje)")
        model = get_model(model_name)
        audio = np.frombuffer(pcm, dtype=np.float32).copy()
        job["message"] = ("Oddeľujem vokál a z" if vocals else "Z") + f"arovnávam {len(lines)} riadkov na {len(audio) / SR / 60:.1f} min zvuku…"
        kw = dict(language=lang, original_split=True)
        if vocals:
            kw["denoiser"] = "demucs"
        result = model.align(audio, "\n".join(lines), **kw)
        if result is None:
            raise RuntimeError("zarovnanie zlyhalo (skús iný jazyk alebo model)")
        segs = result.segments
        if len(segs) == len(lines):
            times = [{"start": float(s.start), "end": float(s.end)} for s in segs]
        else:
            times = split_by_words(result, lines)
        job.update(state="done", message=f"Hotovo za {time.time() - t0:.0f} s", result={"lines": times, "language": result.language})


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def log_message(self, fmt, *args):
        if "/api/job/" not in self.path:
            sys.stderr.write("%s\n" % (fmt % args))

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/":
            self.send_response(302)
            self.send_header("Location", "/LyricsGenerator.html")
            self.end_headers()
            return
        if self.path == "/api/status":
            return self.send_json(status_info())
        if self.path.startswith("/api/job/"):
            job = JOBS.get(self.path.rsplit("/", 1)[-1])
            if not job:
                return self.send_json({"state": "error", "message": "neznáma úloha"}, 404)
            return self.send_json({k: v for k, v in job.items() if k != "thread"})
        return super().do_GET()

    def do_POST(self):
        if self.path != "/api/align":
            return self.send_json({"error": "not found"}, 404)
        n = int(self.headers.get("Content-Length", "0"))
        data = self.rfile.read(n)
        jl = struct.unpack("<I", data[:4])[0]
        opts = json.loads(data[4:4 + jl].decode("utf-8"))
        pcm = data[4 + jl:]
        jid = uuid.uuid4().hex[:12]
        job = {"state": "queued", "message": "Čakám…", "started": time.time()}
        JOBS[jid] = job

        def work():
            try:
                run_align(job, pcm, opts)
            except Exception as e:  # noqa: BLE001
                traceback.print_exc()
                msg = str(e)
                if "out of memory" in msg.lower():
                    msg = "grafike došla pamäť — skús menší model (small)"
                job.update(state="error", message=msg)

        threading.Thread(target=work, daemon=True).start()
        self.send_json({"job": jid})


def main():
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = f"http://localhost:{PORT}/LyricsGenerator.html"
    info = status_info()
    print(f"Lyrics Generator beží na {url}")
    print("Zarovnanie textu:", f"áno ({info.get('device')})" if info["align"] else f"nie — {info.get('error')}")
    if "--open" in sys.argv:
        webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
