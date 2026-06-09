@echo off
REM ============================================================
REM  WesternU 3D Viewer v6 - stop the dev server (Windows)
REM  Kills whatever process is listening on 127.0.0.1:8000
REM  (e.g. a devserver.py left running in the background).
REM ============================================================
setlocal

set "PORT=8000"
set "FOUND="

REM --- find the PID(s) listening on the port and kill them --------------------
for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr /r /c:"LISTENING" ^| findstr /c:":%PORT% "') do (
  set "FOUND=1"
  echo Stopping process %%P on port %PORT% ...
  taskkill /pid %%P /f >nul 2>&1
)

if not defined FOUND (
  echo Nothing is listening on port %PORT% - server is not running.
) else (
  echo Done. Port %PORT% is now free.
)

endlocal
