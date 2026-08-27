# ============================================================
# [一键] 应用 WebView2 闲置 CPU 缓解参数并重启 writeIt
# 作用：
#   1. 设置用户环境变量 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 为：
#      --disable-features=CalculateNativeWinOcclusion --force-device-scale-factor=1
#      （关闭白耗 CPU 的窗口遮挡检测 + 强制 1:1 渲染，规避软件合成翻倍开销）
#   2. 彻底结束残留 writeIt / WebView2 进程（参数只对重启后的进程生效）
#   3. 自动/引导重新启动 writeIt
# 用法：powershell -ExecutionPolicy Bypass -File apply-fix.ps1
# 之后跑 measure-cpu.ps1 验证 CPU 是否下降、参数是否生效。
# 撤销：restore-env.ps1
# ============================================================
$ErrorActionPreference = 'Continue'

$newArgs = '--disable-features=CalculateNativeWinOcclusion --force-device-scale-factor=1'

# ---------- 1. 设置环境变量（用户级 + 本会话）----------
[Environment]::SetEnvironmentVariable('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS', $newArgs, 'User')
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $newArgs
Write-Host ''
Write-Host 'STEP 1/4  env set:'
Write-Host ("  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = " + $newArgs)

# ---------- 2. 杀干净残留进程 ----------
Write-Host ''
Write-Host 'STEP 2/4  killing old processes...'
$killed = $false
Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match 'writeit|msedgewebview' } | ForEach-Object {
    try { Stop-Process -Id $_.Id -Force -ErrorAction Stop; $killed = $true; Write-Host ("  killed PID=" + $_.Id + " name=" + $_.Name) } catch {}
  }
Start-Sleep -Seconds 2
if (-not $killed) { Write-Host '  no old process found (already clean).' }

# ---------- 3. 找 writeIt.exe ----------
Write-Host ''
Write-Host 'STEP 3/4  locating WriteIt.exe...'
$exe = $null
$candidates = @(
  "$env:LOCALAPPDATA\WriteIt\WriteIt.exe",
  "$env:LOCALAPPDATA\Programs\WriteIt\WriteIt.exe",
  "$env:LOCALAPPDATA\Programs\writeit\writeit.exe",
  "$env:ProgramFiles\WriteIt\WriteIt.exe",
  "$env:ProgramFiles\writeit\writeit.exe"
)
foreach ($c in $candidates) { if (Test-Path $c) { $exe = $c; break } }
if (-not $exe) {
  $p = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^writeit$' } | Select-Object -First 1
  if ($p -and $p.Path) { $exe = $p.Path }
}
if ($exe) {
  Write-Host ("  found: " + $exe)
  Start-Process -FilePath $exe
  Write-Host '  started. waiting 8s for WebView2 to come up...'
  Start-Sleep -Seconds 8
} else {
  Write-Host '  NOT FOUND automatically.'
  Write-Host '  -> Edit this script: set $exe = "C:\\path\\to\\WriteIt.exe" at STEP 3, or start writeIt manually now.'
  Write-Host '  -> After it is running, run measure-cpu.ps1.'
  exit 1
}

# ---------- 4. 提示 ----------
Write-Host ''
Write-Host 'STEP 4/4  done.'
Write-Host 'NOW: 1) open your readme.md  2) keep the app idle for ~30s.'
Write-Host 'THEN: run measure-cpu.ps1 (reads CPU average + verifies the new args are active).'
Write-Host ''
Write-Host 'Expectation: msedgewebview2 total CPU should drop vs the 34% you saw before.'
Write-Host '(To undo later: powershell -ExecutionPolicy Bypass -File restore-env.ps1)'