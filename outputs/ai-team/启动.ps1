param([switch]$Lan, [switch]$Codex, [string]$CodexPath)
$ErrorActionPreference = 'Stop'
$taskBundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if (Test-Path -LiteralPath $taskBundledNode) { $taskNode = $taskBundledNode }
elseif (Get-Command node -ErrorAction SilentlyContinue) { $taskNode = (Get-Command node).Source }
else { throw '未找到 Node.js，请先安装 Node.js 18 或更高版本。' }
if ($Codex) {
    if ($Lan) { throw '当前 Codex 接入仅支持本机，请勿同时传入 -Lan。' }
    if ($CodexPath) { $env:AI_TEAM_CODEX_BIN = $CodexPath }
    elseif (Get-Command codex -ErrorAction SilentlyContinue) { $env:AI_TEAM_CODEX_BIN = (Get-Command codex).Source }
    else { throw '未找到 codex，请使用 -CodexPath 指定 Codex 自带的 codex.exe。' }
    & $taskNode (Join-Path $PSScriptRoot 'serve.cjs') --codex
}
elseif ($Lan) { & $taskNode (Join-Path $PSScriptRoot 'serve.cjs') --lan }
else { & $taskNode (Join-Path $PSScriptRoot 'serve.cjs') }
