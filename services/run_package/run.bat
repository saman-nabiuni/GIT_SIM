@echo off
setlocal
cd /d "%~dp0"
set "PY="
py -3 -c "import sys" >nul 2>nul && set "PY=py -3"
if not defined PY python -c "import sys" >nul 2>nul && set "PY=python"
if not defined PY goto nopython
%PY% run_local.py
goto end
:nopython
echo Python was not found on this computer.
echo Install it from https://www.python.org/downloads/ and tick "Add python.exe to PATH" in the installer, then run this file again.
:end
echo.
pause
