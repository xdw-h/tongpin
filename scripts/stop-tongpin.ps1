$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$statePath=Join-Path $projectRoot 'work/service-state.json'
if(-not(Test-Path -LiteralPath $statePath)){Write-Host '同频尚未启动';exit 0}
$state=Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
foreach($entry in @(@{Id=$state.supervisorPid;File='supervisor.cjs'},@{Id=$state.childPid;File='serve.cjs'})){
 if(-not $entry.Id){continue}
 $process=Get-CimInstance Win32_Process -Filter "ProcessId=$($entry.Id)"
 if(-not $process){continue}
 $expected=Join-Path $projectRoot ('outputs/ai-team/'+$entry.File)
 if($process.CommandLine -notlike ('*'+$expected+'*')){throw "进程 $($entry.Id) 的归属不匹配，已停止操作"}
 Stop-Process -Id $entry.Id
}
Write-Host '同频已停止。下次登录仍会按自启动设置运行。'
