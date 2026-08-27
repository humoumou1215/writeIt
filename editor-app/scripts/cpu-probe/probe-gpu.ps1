# ============================================================
# writeIt GPU 决策检查（内网单机）—— 确认 WebView2 是否软件合成
# 前置：与 probe-win.ps1 相同——环境变量
#   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
# 已设、writeIt 完全重启、页面已打开、保持空闲。
# 运行：powershell -ExecutionPolicy Bypass -File probe-gpu.ps1
# 判读：featureStatus 里 "gpu_compositing": "software"（或 devices 含
#       SwiftShader）=> WebView2 在软件合成 = 34% CPU 的根因（环境性）。
# ============================================================
$ErrorActionPreference = 'Stop'
$port = if ($args.Count -ge 1) { [int]$args[0] } else { 9222 }

$list = $null
try {
  $list = Invoke-RestMethod "http://127.0.0.1:$port/json" -TimeoutSec 10
} catch {
  Write-Host "ERR: cannot connect http://127.0.0.1:$port/json"
  Write-Host "Please set env WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=$port, fully restart writeIt, then rerun."
  exit 1
}
$page = @($list | Where-Object { $_.type -eq 'page' } | Select-Object -First 1)
if (-not $page) { Write-Host "ERR: no page target"; exit 1 }

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
  return ([System.Text.Encoding]::UTF8.GetString($mem.ToArray()) | ConvertFrom-Json)
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

$info = (Invoke-Cdp 'SystemInfo.getInfo')
$ws.Dispose()

Write-Host ""
Write-Host "========== WebView2 GPU DECISION =========="
Write-Host ("model : " + $info.modelName + " / " + $info.modelVersion)
Write-Host "GPU devices:"
foreach ($d in $info.gpu.devices) {
  Write-Host ("  vendor=" + $d.vendorId + " device=" + $d.deviceId + " active=" + $d.active)
  Write-Host ("    name: " + ($d.name -replace '[\x00-\x1f]', '?'))
  if ($d.driverVersion) { Write-Host ("    driver: " + $d.driverVersion) }
}
Write-Host "featureStatus (key fields):"
$k = 'gpu_compositing','rasterization','webgl','webgl2','2d_canvas','opengl','video_decode','vk','swiftshader'
foreach ($f in $k) {
  try { $v = $info.gpu.featureStatus.$f } catch { $v = $null }
  if ($v) { Write-Host ("  {0,-16}: {1}" -f $f, $v) }
}
Write-Host "auxAttributes:"
Write-Host ("  " + (($info.gpu.auxAttributes | ConvertTo-Json -Compress -Depth 6)))
Write-Host "============================================"
Write-Host ""
$soft = $false
try { if ($info.gpu.featureStatus.gpu_compositing -eq 'software') { $soft = $true } } catch {}
if (-not $soft) {
  foreach ($d in $info.gpu.devices) { if (($d.name -match 'SwiftShader') -or ($d.name -match 'llvmpipe')) { $soft = $true } }
}
if ($soft) {
  Write-Host "VERDICT: WebView2 is using SOFTWARE COMPOSITING (SwiftShader) -> 34% CPU is the VM display backend, NOT app code."
} else {
  Write-Host "VERDICT: hardware compositing appears ENABLED -> GPU process 34% needs another look (WPR deep sampling recommended)."
}