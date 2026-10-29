param([switch]$Open)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$configPath=Join-Path $projectRoot 'work/startup-config.json'
$config=if(Test-Path -LiteralPath $configPath){Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json}else{@{}}
$runtime=$config.nodePath
if(-not $runtime){
 $bundledNode=Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
 if(Test-Path -LiteralPath $bundledNode){$runtime=$bundledNode}
 elseif(Get-Command node -ErrorAction SilentlyContinue){$runtime=(Get-Command node).Source}
}
if(-not $runtime -or -not(Test-Path -LiteralPath $runtime)){throw '未找到 Node.js，请安装 Node.js 18+，或配置 work/startup-config.json 中的 nodePath'}
$port=if($null -ne $config.port){[int]$config.port}else{4188}
if($port -lt 1 -or $port -gt 65535){throw '端口应介于 1 与 65535 之间'}
$privateDirectory=Join-Path $projectRoot 'work/private'
New-Item -ItemType Directory -Path $privateDirectory -Force | Out-Null
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& "$env:SystemRoot/System32/icacls.exe" $privateDirectory /inheritance:r /grant:r "*$($sid):(OI)(CI)(F)" '*S-1-5-18:(OI)(CI)(F)' '*S-1-5-32-544:(OI)(CI)(F)' | Out-Null
if($LASTEXITCODE -ne 0){throw '配对目录权限设置失败'}
try {$health=Invoke-RestMethod "http://127.0.0.1:$port/health" -TimeoutSec 2} catch {$health=$null}
if($health -and ($health.service -ne 'tongpin' -or -not $health.supervised)){throw "端口 $port 已被其他实例占用，请先停止旧实例"}
if(-not $health){
 $env:AI_TEAM_PORT="$port"
 $entry=Join-Path $projectRoot 'outputs/ai-team/supervisor.cjs'
 Start-Process -FilePath $runtime -ArgumentList @(('"'+$entry+'"')) -WorkingDirectory $projectRoot -WindowStyle Hidden
 for($i=0;$i -lt 15;$i++){
  Start-Sleep -Milliseconds 500
  try {$health=Invoke-RestMethod "http://127.0.0.1:$port/health" -TimeoutSec 2;if($health.service -eq 'tongpin'){break}}catch{}
 }
 if(-not $health){throw '同频未启动成功，请查看 work/service.log'}
}
$secret=Join-Path $privateDirectory 'lan-access.json'
if(Test-Path -LiteralPath $secret){
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 & "$env:SystemRoot/System32/icacls.exe" $secret /inheritance:r /grant:r "*$($sid):(F)" '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null
 if($LASTEXITCODE -ne 0){throw '访问码文件权限设置失败'}
}
Write-Host "同频已启动：http://127.0.0.1:$port/"
if($Open){Start-Process "http://127.0.0.1:$port/"}
