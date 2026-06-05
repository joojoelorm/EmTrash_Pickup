@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  node server.mjs
  goto :eof
)
where py >nul 2>nul
if %errorlevel%==0 (
  py -m http.server 8080
  goto :eof
)
python -m http.server 8080
