@echo off
title DYNOZ PLAYLIST
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js belum dipasang dalam komputer ni.
  echo   Muat turun versi LTS dari https://nodejs.org, pasang, lepas tu buka START.bat semula.
  echo.
  pause
  exit /b 1
)
node server.js --open
echo.
pause
