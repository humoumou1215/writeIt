# ============================================================
# [已废弃-兼容保留] 打包参数矩阵 —— 参数已改为运行时设置！
# 新架构：WebView2 启动参数由「设置 → ⚡ 性能 → WebView2 参数 → 保存并重启」
#         持久化到 Rust 侧 webview-args.txt，重启后自动注入（无需重打包）。
# 本脚本仅适配旧版 tauri.conf.json（conf 中仍有 windows 数组时可用），
# 新版 conf 无 windows 数组 → 运行会提示后退出。
# ============================================================
param([int]$Combo = -1)

$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent   # editor-app/
Set-Location $repo
$confPath = Join-Path $repo 'src-tauri/tauri.conf.json'
if (-not (Test-Path $confPath)) { Write-Host 'ERR: tauri.conf.json not found'; exit 1 }
$conf = Get-Content $confPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 20
if (-not $conf.app.windows) {
  Write-Host 'INFO: 当前 conf 已无 windows 数组（参数改为运行时设置）。'
  Write-Host 'WebView2 参数请在应用内：设置 → ⚡ 性能 → 保存并重启。'
  exit 0
}

$combos = @(
  @{ name = 'combo0-baseline';        arg = '' },
  @{ name = 'combo1-occl';            arg = '--disable-features=CalculateNativeWinOcclusion' },
  @{ name = 'combo2-occl-unblock';    arg = '--disable-features=CalculateNativeWinOcclusion --ignore-gpu-blocklist' },
  @{ name = 'combo3-occl-unblock-nogpu'; arg = '--disable-features=CalculateNativeWinOcclusion --ignore-gpu-blocklist --disable-gpu' }
)

$targets = if ($Combo -ge 0) { @($combos[$Combo]) } else { $combos }

foreach ($c in $targets) {
  Write-Host ''
  Write-Host ("===== BUILD " + $c.name + " =====")

  # 1. 备份 + 改 conf
  $orig = Get-Content $confPath -Raw -Encoding UTF8
  try {
    $conf = $orig | ConvertFrom-Json -Depth 20
    if ($c.arg) {
      # 对象属性名区分大小写（JSON schema: windows[0].additionalBrowserArgs）
      $conf.app.windows[0].additionalBrowserArgs = $c.arg
    } else {
      $conf.app.windows[0].PSObject.Properties.Remove('additionalBrowserArgs')
    }
    ($conf | ConvertTo-Json -Depth 20) | Set-Content $confPath -Encoding UTF8
    Write-Host ('  conf additionalBrowserArgs = "' + $c.arg + '"')

    # 2. 打包
    npm run tauri build 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'tauri build failed' }

    # 3. 产物改名（区分组合）
    $srcSetup = Get-ChildItem (Join-Path $repo 'target/release/bundle/nsis') -Filter '*.exe' -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($srcSetup) {
      $dst = Join-Path $srcSetup.DirectoryName ($c.name + '-' + $srcSetup.Name)
      Copy-Item $srcSetup.FullName $dst -Force
      Write-Host ('  artifact: ' + $dst)
    } else {
      Write-Host '  WARN: no nsis exe found in target/release/bundle/nsis'
    }
  } finally {
    # 4. 恢复原 conf
    Set-Content $confPath $orig -Encoding UTF8 -NoNewline
  }
}
Write-Host ''
Write-Host 'matrix done. Install each WriteIt-comboN-*.exe into the VM and test with measure-cpu.ps1 (lite mode on/off x 4 = 8 samples).'