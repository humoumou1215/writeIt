# ============================================================
# writeIt CPU 采样（内网单机版，无需 Node，仅用 Windows 自带 PowerShell 5.1）
# 用途：对 WebView2 渲染进程做 15 秒 CPU Profiler，输出热点函数，用于定位
#       「空闲时 msedgewebview2.exe 持续 34% CPU」的根因。
# 前置（必做）：1) 设置用户环境变量
#                 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
#              2) 完全退出 writeIt（任务管理器结束所有 msedgewebview2.exe）后重启
#              3) 打开那个 readme.md，保持不动
# 运行：powershell -ExecutionPolicy Bypass -File probe-win.ps1
# 输出：采样总数、idle 占比、TOP 15 热点函数 —— 把这十几行念给 AI 即可
# ============================================================
$ErrorActionPreference = 'Stop'
$port = if ($args.Count -ge 1) { [int]$args[0] } else { 9222 }
$secs = if ($args.Count -ge 2) { [int]$args[1] } else { 15 }

# ---------- 1. 连接 ----------
$list = $null
try {
  $list = Invoke-RestMethod "http://127.0.0.1:$port/json" -TimeoutSec 10
} catch {
  Write-Host "ERR: cannot connect http://127.0.0.1:$port/json"
  Write-Host "Please check: 1) env WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=$port is set;"
  Write-Host "2) writeIt fully restarted (kill all msedgewebview2.exe), UI visible; 3) then rerun."
  exit 1
}
$page = @($list | Where-Object { $_.type -eq 'page' } | Select-Object -First 1)
if (-not $page) {
  Write-Host "ERR: no page target found. targets:"
  $list | ForEach-Object { Write-Host ("  type=" + $_.type + " url=" + $_.url) }
  exit 1
}
$url = $page[0].url
Write-Host ("OK: connected to page: " + $(if ($url.Length -gt 100) { $url.Substring(0, 100) } else { $url }))

# ---------- 2. WebSocket CDP ----------
$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ws.ConnectAsync([Uri]$page[0].webSocketDebuggerUrl, [System.Threading.CancellationToken]::None).GetAwaiter().GetResult()

$script:id = 0
function Receive-Message {
  $mem = New-Object System.IO.MemoryStream
  while ($true) {
    $buf = New-Object byte[] 262144
    $seg = [ArraySegment[byte]]::new($buf)
    $res = $ws.ReceiveAsync($seg, [System.Threading.CancellationToken]::None).GetAwaiter().GetResult()
    $mem.Write($buf, 0, $res.Count)
    if ($res.EndOfMessage) { break }
  }
  $txt = [System.Text.Encoding]::UTF8.GetString($mem.ToArray())
  return ($txt | ConvertFrom-Json)
}
function Invoke-Cdp($method, $params = @{}) {
  $script:id++
  $payload = @{ id = $script:id; method = $method; params = $params } | ConvertTo-Json -Compress -Depth 12
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
  $seg = [ArraySegment[byte]]::new($bytes)
  $ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [System.Threading.CancellationToken]::None).GetAwaiter().GetResult()
  while ($true) {
    $m = Receive-Message
    if ($m.id -eq $script:id) { return $m.result }
  }
}

# ---------- 3. 采样 ----------
Invoke-Cdp 'Profiler.enable' | Out-Null
Invoke-Cdp 'Profiler.start' | Out-Null
Write-Host ("Sampling for {0}s... keep the app idle, do NOT touch it." -f $secs)
Start-Sleep -Seconds $secs
$profile = (Invoke-Cdp 'Profiler.stop').profile
$ws.Dispose()

# ---------- 4. 解析热点（samples 计数近似 self-time）----------
$nameById = @{}
foreach ($n in $profile.nodes) {
  $fn = $n.callFrame.functionName
  $u = $n.callFrame.url
  if (-not $fn) { $fn = '(anonymous)' }
  if (-not $u) { $u = 'native' }
  if ($u.Length -gt 80) { $u = '...' + $u.Substring($u.Length - 80) }
  $nameById[$n.id] = $fn + '  @  ' + $u
}
$acc = @{}
$totalSamples = $profile.samples.Count
$i = 0
foreach ($sid in $profile.samples) {
  if ($nameById.ContainsKey($sid)) {
    $k = $nameById[$sid]
    if ($acc.ContainsKey($k)) { $acc[$k] = $acc[$k] + 1 } else { $acc[$k] = 1 }
  }
  $i++
}
$sum = 0; foreach ($v in $acc.Values) { $sum += $v }

Write-Host ""
Write-Host "========== CPU PROFILE RESULT ($secs s, samples=$totalSamples) =========="
$idlePct = 0.0
if ($acc.ContainsKey('(idle)  @  native')) { $idlePct = 100.0 * $acc['(idle)  @  native'] / $totalSamples }
Write-Host ("MAIN THREAD BUSY: {0}%   (idle {1}%)" -f [Math]::Round(100.0 - $idlePct, 1), [Math]::Round($idlePct, 1))
Write-Host "TOP 15 hot functions:"
$top = $acc.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 15
foreach ($t in $top) {
  $pct = [Math]::Round(100.0 * $t.Value / $totalSamples, 1)
  Write-Host ("  {0,5}%  {1}" -f $pct, $t.Key)
}
Write-Host "==============================================================="
Write-Host "(done)"