# ============================================================
# [验证] 测量 writeIt/WebView2 的 CPU 占用 + 确认缓解参数是否生效
# 用法：powershell -ExecutionPolicy Bypass -File measure-cpu.ps1 [采样秒数=25]
# 前提：writeIt 正开着、只打开 readme.md、什么都不做（保持空闲）
# 输出几行文本，照念给 AI 即可。
# 判读：
#   - VERDICT contains your new args -> 参数已生效（来自 tauri.conf.json additionalBrowserArgs）；
#     此时如果 msedgewebview2 总占用明显低于 34%，即为缓解成功。
#   - VERDICT missing args -> 该打包没包含新参数（需用新 tauri.conf.json 重打包），
#     或 WebView2 版本仍未采纳 → CPU 高为环境性，按 README 环境层处理。
# ============================================================
$ErrorActionPreference = 'Continue'
$secs = if ($args.Count -ge 1) { [int]$args[0] } else { 25 }

$coreCount = 0
try { $coreCount = [int](Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors } catch {}
if ($coreCount -le 0) { $coreCount = [int]$env:NUMBER_OF_PROCESSORS }

Write-Host ''
Write-Host ("Sampling for {0}s (app must stay idle)..." -f $secs)

$p0 = @{}
Get-Process msedgewebview2 -ErrorAction SilentlyContinue | ForEach-Object { $p0[$_.Id] = $_.CPU }
Start-Sleep -Seconds $secs
$p1 = @{}
Get-Process msedgewebview2 -ErrorAction SilentlyContinue | ForEach-Object { $p1[$_.Id] = $_.CPU }

# 进程类型（命令行）
$typeMap = @{}
try {
  Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | ForEach-Object {
    if ($_.CommandLine) {
      $t = 'browser'
      if ($_.CommandLine -match '--type=gpu-process') { $t = 'gpu' }
      elseif ($_.CommandLine -match '--type=renderer') { $t = 'renderer' }
      elseif ($_.CommandLine -match '--type=utility') { $t = 'utility' }
      $typeMap[[int]$_.ProcessId] = $t
    }
  }
} catch {}

Write-Host ''
Write-Host "========== CPU RESULT ($secs s window, logical cores=$coreCount) =========="
$totalCores = 0.0
foreach ($id in ($p1.Keys | Sort-Object)) {
  $c0 = 0.0; if ($p0.ContainsKey($id)) { $c0 = [double]$p0[$id] }
  $c1 = 0.0; if ($p1.ContainsKey($id)) { $c1 = [double]$p1[$id] }
  $dt = $c1 - $c0
  $cores = [Math]::Max(0.0, $dt / $secs)
  $taskmgrPct = $cores / $coreCount * 100.0
  $t = '?'; if ($typeMap.ContainsKey([int]$id)) { $t = $typeMap[[int]$id] }
  $totalCores += $cores
  Write-Host ("  {0,-8} PID={1,-7} cores={2,5:N3}  taskmgr~{3,5:N1}%" -f $t, $id, $cores, $taskmgrPct)
}
Write-Host ("  TOTAL msedgewebview2: {0:N2} cores  ~ {1:N1}% of total CPU" -f $totalCores, ($totalCores / $coreCount * 100.0))

# 确认 browser 进程命令行里有没有我们的参数
Write-Host ''
Write-Host "Argument check (browser process command line):"
$hasArgs = $false
$browserCmd = ''
try {
  Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | ForEach-Object {
    if ($_.CommandLine -and ($_.CommandLine -notmatch '--type=')) { $browserCmd = $_.CommandLine }
  }
} catch {}
if ($browserCmd) {
  Write-Host ("  " + $browserCmd.Substring(0, [Math]::Min(160, $browserCmd.Length)))
  # 验收参数来自 tauri.conf.json additionalBrowserArgs（打包时写死）
  $hasArgs = $browserCmd -match 'CalculateNativeWinOcclusion' -and ($browserCmd -match 'ignore-gpu-blocklist')
} else {
  Write-Host '  (browser process not observed on this sample)'
}
Write-Host ("  VERDICT: {0}" -f $(if ($hasArgs) { "additionalBrowserArgs ARE active -> compare CPU with the old 34%" } else { "args NOT in command line -> repackage with the new tauri.conf.json, or this WebView2 ignores them (env issue)" }))
Write-Host "============================================================"
Write-Host "(done - send the lines above to the AI)"