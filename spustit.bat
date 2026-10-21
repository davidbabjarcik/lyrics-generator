@echo off
rem Spustí Lyrics Generator na http://localhost:5173 (so zarovnaním textu cez AI)
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" server.py --open
) else (
  python server.py --open
)
pause
