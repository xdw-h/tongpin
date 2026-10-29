@echo off
"C:\Program Files\PowerShell\7\pwsh.exe" -NoLogo -NoProfile -File "%~dp0scripts\stop-tongpin.ps1"
if errorlevel 1 pause
