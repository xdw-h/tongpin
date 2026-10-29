param([switch]$Disable)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$key='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
if($Disable){Remove-ItemProperty -LiteralPath $key -Name 'Tongpin' -ErrorAction SilentlyContinue;Write-Host '已关闭同频登录自启动';exit 0}
$pwshPath='C:\Program Files\PowerShell\7\pwsh.exe'
$script=Join-Path $PSScriptRoot 'start-tongpin.ps1'
$command='"'+$pwshPath+'" -NoLogo -NoProfile -WindowStyle Hidden -File "'+$script+'"'
New-ItemProperty -LiteralPath $key -Name 'Tongpin' -PropertyType String -Value $command -Force | Out-Null
Write-Host '已启用同频登录自启动，仅作用于当前 Windows 用户。'
