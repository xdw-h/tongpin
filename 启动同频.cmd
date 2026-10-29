@echo off
"C:\Program Files\PowerShell\7\pwsh.exe" -NoLogo -NoProfile -File "%~dp0scripts\start-tongpin.ps1" -Open
if errorlevel 1 pause
