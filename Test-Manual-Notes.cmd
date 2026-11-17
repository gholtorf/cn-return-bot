@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File "scripts\manual-notes\local.ps1" -Action Browser
if errorlevel 1 pause
