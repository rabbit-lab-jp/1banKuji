@echo off
cd /d "%~dp0"

where py >nul 2>nul
if not errorlevel 1 (
  start "" /b py -3 server.py
) else (
  where python >nul 2>nul
  if errorlevel 1 (
    echo Python 3 が見つかりません。Python 3 をインストールしてください。
    exit /b 1
  )
  start "" /b python server.py
)

ping -n 2 127.0.0.1 >nul
start "" http://localhost:8000/
