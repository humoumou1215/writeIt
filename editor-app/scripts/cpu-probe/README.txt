writeIt CPU 定位与优化工具（内网单机使用）—— 中文使用说明
====================================================

背景：打包后的 writeIt 在 QEMU 虚拟机上，只打开一个文件、未编辑、已关诊断时，
msedgewebview2.exe（GPU 进程/合成）持续约 34% CPU。根因：虚拟机无硬件 GPU，
WebView2 回退 SwiftShader 软件合成（本机同代码在真机是 99.3% 空闲，非应用缺陷）。
本目录工具用于在该内网机器上自行采样验证与对比优化效果。

两类可调项（务必分清）：
  A. WebView2 启动参数（--ignore-gpu-blocklist / --disable-features=CalculateNativeWinOcclusion）：
     只能在 WebView2 进程创建时生效，运行时改不了。**已做成运行时设置**：
     设置 → ⚡ 性能 → 两个勾选 + 「保存并重启」→ Rust 持久化到 webview-args.txt，
     重启后由 setup 读取注入（无需重打包）。
  B. 应用设置开关「⚡ 性能 → 低功耗模式」（settings.liteMode）：运行时切换，
     关动画/降阴影/去毛玻璃/不自动聚焦/停 500ms 红点轮询 → 进 app 设置里开即可。
  （build-matrix.ps1 已废弃：旧 conf 的打包参数矩阵模式被运行时设置取代）

------------------------------------------------------------
方法：参数组合对照（无需重打包）
------------------------------------------------------------
1) 设置 → ⚡ 性能：勾选/取消「忽略 GPU 黑名单」「关闭窗口遮挡检测」
2) 点「保存并重启」→ 应用整进程重启使参数生效
3) 打开 readme.md、保持空闲 → powershell -ExecutionPolicy Bypass -File scripts/cpu-probe/measure-cpu.ps1
循环 1~3 覆盖 4 组合 × 低功耗模式开/关 = 8 组数据，带给 AI 定结论。
（若改回「装默认包测基线」，可把两个勾选都取消后保存并重启）

------------------------------------------------------------
辅助：区分进程类型（确认 34% 是 GPU 进程还是渲染进程）
------------------------------------------------------------
  Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" |
    ForEach-Object {
      $t = if ($_.CommandLine -match '--type=gpu-process') { 'GPU(合成)' }
           elseif ($_.CommandLine -match '--type=renderer') { '渲染(JS+排版)' }
           else { 'browser/utility' }
      "{0,-14} PID={1}  {2}" -f $t, $_.ProcessId, $_.CommandLine.Substring(0, [Math]::Min(80, $_.CommandLine.Length))
    }

------------------------------------------------------------
辅助：JS 主线程热点（仅当 34% 属于渲染进程时使用）
------------------------------------------------------------
1) 设用户环境变量 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222，
   完全重启 writeIt；2) 空闲时跑：
  powershell -ExecutionPolicy Bypass -File scripts/cpu-probe/probe-win.ps1
输出 MAIN THREAD BUSY% + TOP 函数。判读：BUSY≈0 但进程仍高 → 非 JS 线程问题。
若机器有 Node ≥22 可用 node scripts/cpu-probe/probe-win.mjs。

------------------------------------------------------------
工具文件清单
------------------------------------------------------------
  probe-win.ps1    采样 JS 主线程热点
  probe-gpu.ps1    读 WebView2 GPU 决策（需 9222 端口）
  measure-cpu.ps1  测每进程 CPU + 验证启动参数是否生效（8 组对照用）
  build-matrix.ps1 打包参数矩阵（4 组 webview 参数，产物分名）
  apply-fix.ps1    旧 env 参数方案（已被 build-matrix 取代，可不用）
  restore-env.ps1  删除 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 环境变量
------------------------------------------------------------
注：环境变量方案（apply-fix）在目标机器上不生效（WebView2 忽略 env 参数），
   因此参数统一走打包配置（build-matrix），不要再用 env 方案。
------------------------------------------------------------