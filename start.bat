@echo off
REM ============================================================
REM  WesternU 3D Viewer v6 - launcher (Windows)
REM  Serves this folder over read-only HTTP on 127.0.0.1:8000
REM  and opens the viewer in the default browser.
REM  Close the server window to stop.
REM ============================================================
setlocal
cd /d "%~dp0"

set "PORT=8000"
set "URL=http://localhost:%PORT%/viewer/"

REM --- pick a Python launcher -------------------------------------------------
where py >nul 2>&1 && (set "PY=py") || (where python >nul 2>&1 && (set "PY=python"))
if not defined PY (
  echo Python 3 was not found on PATH. Install Python 3 from python.org and retry.
  pause
  exit /b 1
)

REM --- bail if the port is already in use -------------------------------------
%PY% -c "import socket,sys; s=socket.socket(); r=s.connect_ex(('127.0.0.1',%PORT%)); s.close(); sys.exit(1 if r==0 else 0)"
if errorlevel 1 (
  echo Port %PORT% is already in use.
  echo If a server is already running, just open %URL%
  echo Otherwise close whatever is using port %PORT% and retry.
  pause
  exit /b 1
)

REM --- start the static server in its own window ------------------------------
start "WesternU Viewer v6 Server" cmd /k %PY% "%~dp0devserver.py" %PORT%
timeout /t 2 /nobreak >nul

REM --- open the default browser -----------------------------------------------
start "" "%URL%"

echo.
echo  Viewer v6 running at %URL%
echo  (server is the "WesternU Viewer v6 Server" window; close it to stop)
echo.
endlocal
