# ============================================================
# [撤销] 删除 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 并重启 writeIt
# 用法：powershell -ExecutionPolicy Bypass -File restore-env.ps1
# ============================================================
$ErrorActionPreference = 'Continue'
[Environment]::SetEnvironmentVariable('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS', $null, 'User')
Write-Host 'env removed (user level).'
Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match 'writeit|msedgewebview' } | ForEach-Object {
    try { Stop-Process -Id $_.Id -Force -ErrorAction Stop; Write-Host ("killed PID=" + $_.Id) } catch {}
  }
Start-Sleep -Seconds 2
Write-Host 'old processes killed. Start writeIt again manually.'
Write-Host '(sudo note: this also wipes the debug port if it was set before.)'