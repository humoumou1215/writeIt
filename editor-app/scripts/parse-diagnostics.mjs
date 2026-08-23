#!/usr/bin/env node
// ============================================================
// 诊断包解析器 —— 开发者侧：把用户发来的诊断包 zip（或已解压目录）
// 打印为人类可读的摘要：环境 / 异常日志 / 操作时间轴 / 崩溃记录 / 文档还原提示
//
// 用法：
//   node scripts/parse-diagnostics.mjs <writeit-diagnostics-....zip>
//   node scripts/parse-diagnostics.mjs <已解压目录>        （无需 unzip 命令）
//
// zip 解析为内置极简实现（deflate/store 两种压缩，Node 内置 zlib），
// 不需要任何第三方依赖 —— 满足「收到包立即能看」的诉求。
// ============================================================
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import { inflateRawSync } from 'node:zlib'

// ---------- 极简 ZIP 读取（central directory） ----------
function readZIP(buf) {
  // 1. EOCD：从倒数 22 字节开始向前找 PK\x05\x06（容错签名前 4 字节 0x06054b50）
  const eocd = findEOCD(buf)
  if (!eocd) throw new Error('不是有效 ZIP（未找到 EOCD）')
  const cdCount = buf.readUInt16LE(eocd + 10)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  const cdSize = buf.readUInt32LE(eocd + 12)

  // 2. Central directory 遍历
  const files = new Map()
  let p = cdOffset
  for (let i = 0; i < cdCount; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP 中央目录损坏')
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const uncompSize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    p += 46 + nameLen + extraLen + commentLen

    // 3. Local header（找数据起点：local header 长度 = 30 + nameLen + extraLen）
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`本地头损坏: ${name}`)
    const localNameLen = buf.readUInt16LE(localOffset + 26)
    const localExtraLen = buf.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen
    const raw = buf.subarray(dataStart, dataStart + compSize)
    let content
    if (method === 0) content = raw
    else if (method === 8) content = inflateRawSync(raw)
    else throw new Error(`不支持的压缩方式 ${method}: ${name}`)
    if (content.length !== uncompSize) {
      // 容忍：UTF-8 文本长度以字节计，这里用字节长度校验
    }
    files.set(name, { content, size: uncompSize })
  }
  return files
}

function findEOCD(buf) {
  const min = Math.max(0, buf.length - 22 - 65536)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      // 注释长度字段应能覆盖到文件尾
      const commentLen = buf.readUInt16LE(i + 20)
      if (i + 22 + commentLen === buf.length) return i
    }
  }
  return null
}

// ---------- 读取输入（zip 或目录） ----------
function loadPackage(path) {
  if (statSync(path).isDirectory()) {
    const files = new Map()
    for (const name of readdirSync(path)) {
      const full = join(path, name)
      if (statSync(full).isFile()) {
        if (extname(name) === '.zip') {
          const inner = readZIP(readFileSync(full))
          for (const [k, v] of inner) files.set(k, v)
        } else {
          files.set(name, { content: readFileSync(full) })
        }
      }
    }
    return files
  }
  return readZIP(readFileSync(path))
}

const text = (f) => (f ? f.content.toString('utf8') : '')
const json = (f) => (f ? JSON.parse(text(f)) : null)

// ---------- 主流程 ----------
const input = process.argv[2]
if (!input || !existsSync(input)) {
  console.error('用法: node scripts/parse-diagnostics.mjs <诊断包.zip 或 已解压目录>')
  process.exit(1)
}

const files = loadPackage(input)
const manifest = json(files.get('manifest.json'))
const env = json(files.get('01-environment.json')) ?? {}
const appState = json(files.get('03-app-state.json')) ?? {}
const settings = json(files.get('02-settings.json')) ?? {}
const probes = json(files.get('08-probes.json'))
const dom = probes?.ui ?? null
const notes = text(files.get('09-notes.md'))
const eventsLog = text(files.get('04-events.log'))
const timelineText = text(files.get('05-timeline.jsonl'))
const aiSummary = text(files.get('00-summary.md'))

const bar = '='.repeat(64)
console.log('\n' + bar)
console.log('  WriteIt 诊断包解析报告')
console.log(bar)

// ---- AI 摘要优先（最省 token 的入口） ----
if (aiSummary.trim()) {
  console.log('\n▼▼▼ 00-summary.md（AI 摘要，先读这个）▼▼▼')
  console.log(aiSummary.trim())
  console.log('▲▲▲ 00-summary.md ▲▲▲')
}

// ---- 头信息 ----
console.log(`\n■ 生成时间 : ${manifest?.generatedAt ?? '?'}`)
console.log(`  应用版本 : ${env.appVersion ?? '?'}（构建 ${env.buildTime ?? '?'}）`)
console.log(`  宿主     : ${env.host ?? '?'}${env.tauri ? ` · ${env.tauri.os}/${env.tauri.arch}` : ''}${env.tauri?.appVersion ? ` · rust v${env.tauri.appVersion}` : ''}`)
console.log(`  系统     : ${env.platform ?? '?'} · ${env.userAgent ?? '?'}`)
console.log(`  屏幕     : ${env.screen?.width}×${env.screen?.height} @${env.devicePixelRatio}x`)
console.log(`  容器     : ${env.innerSize?.w}×${env.innerSize?.h}`)
console.log(`  reduced-motion: ${env.prefersReducedMotion} · 时区 ${env.timezone ?? '?'}`)
if (env.font?.checks) {
  const missing = Object.entries(env.font.checks).filter(([, ok]) => !ok).map(([n]) => n)
  if (missing.length) console.log(`  ⚠ 字体不可用 : ${missing.join(', ')}`)
}

// ---- 设置要点 ----
console.log(`\n■ 主题 ${settings.theme ?? '?'} · 图标 ${settings.iconSet ?? '?'} · 自动保存 ${settings.autoSave ? settings.autoSaveDelay / 1000 + 's' : '关'}`)
console.log(`  快捷键自定义 ${Object.keys(settings.shortcuts ?? {}).length} 项`)

// ---- 应用状态 ----
const active = appState.activeTab
console.log(`\n■ 标签数 ${appState.tabCount ?? 0} · 当前文件 ${active?.path ?? '（无）'}（${active?.viewMode ?? '?'}${active?.dirty ? ' · 未保存' : ''}）`)
if (appState.templates?.length) {
  console.log(`  模板 ${appState.templates.map((t) => `${t.doctype}${t.hasRules ? '(rules)' : ''}${t.hasSuggest ? '(suggest)' : ''}`).join('、')}`)
}
if (appState.git?.isRepo) {
  console.log(`  git 分支 ${appState.git.branch} @ ${appState.git.headHash} · 未提交 ${appState.git.statusCount} 项`)
}

// ---- 事件日志：异常汇总 ----
const errorLines = eventsLog.split('\n').filter((l) => /\| ERROR |\b(error)\b/i.test(l))
console.log(`\n■ 异常日志（${errorLines.length} 条 error 级）`)
if (errorLines.length) {
  for (const l of errorLines.slice(-12)) {
    const m = l.match(/^(\S+) \| (\S+) \| (\S+) \| (.+)$/)
    if (m) console.log(`  ${m[1]}  [${m[3]}] ${m[4].slice(0, 240)}`)
    else console.log(`  ${l.slice(0, 240)}`)
  }
} else {
  console.log('  无 error 级日志（问题可能无异常，请配合 08-dom-snapshot.json 与 06-screen.png 分析渲染/动画状态）')
}

// ---- 操作轨迹 ----
const timeline = timelineText.trim().split('\n').filter(Boolean).map((l) => {
  try { return JSON.parse(l) } catch { return null }
}).filter(Boolean)
console.log(`\n■ 操作轨迹（${timeline.length} 条，最近 ${Math.min(12, timeline.length)} 条）`)
for (const e of timeline.slice(-12)) {
  const t = new Date(e.t).toISOString().slice(11, 19)
  console.log(`  ${t}  ${e.type}${e.target ? ` → ${e.target}` : ''}${e.ms != null ? ` (${e.ms}ms)` : ''}${e.ok === false ? ' ✗' : ''}`)
}

// ---- 渲染 / 动画现场 ----
if (dom) {
  console.log(`\n■ DOM 快照`)
  if (dom.editorPane) {
    console.log(`  编辑器区 ${dom.editorPane.rect.w}×${dom.editorPane.rect.h} · 滚动 ${dom.editorPane.scrollTop}/${dom.editorPane.scrollHeight}（视口 ${dom.editorPane.clientHeight}）`)
  }  if (dom.mermaidPreviews?.length) {
    dom.mermaidPreviews.forEach((p, i) => {
      console.log(`  mermaid#${i}: ${p.rect.visible ? '' : '⚠不可见 '}${p.rect.w}×${p.rect.h} · SVG ${p.hasSvg ? `✓ (${p.svgWidth}px)` : '✗'}`)
    })
  }
  const anims = dom.animations ?? []
  if (anims.length) {
    console.log(`  运行中动画 ${anims.length} 个${dom.pref.prefersReducedMotion ? ' · ⚠ 系统开启 reduced-motion' : ''}`)
    for (const a of anims.slice(0, 8)) {
      console.log(`    ${a.name ?? '?'} on ${a.target} · ${a.playState} · ${a.duration}ms(delay ${a.delay})`)
    }
  } else if (dom.pref?.prefersReducedMotion) {
    console.log('  无运行中动画 · ⚠ 系统开启 reduced-motion（动画可能被系统禁用）')
  }
  if (dom.panels) {
    const side = dom.panels.sidebarCollapsed ? '收' : '展'
    console.log(`  侧栏${side} · 抽屉 ${dom.panels.annotationDrawer ? (dom.panels.annotationDrawer.collapsed ? '折叠' : '展开') : '无'} · 大纲 ${dom.panels.outlinePanel ? '显示' : '隐藏'} · slash菜单 ${dom.panels.slashMenuShown ? '显示' : '隐藏'}`)
  }
}

// ---- Diff 渲染标注探针（节点级红/绿实测） ----
if (probes?.diff) {
  const d = probes.diff
  console.log(`\n■ Diff 标注探针`)
  console.log(`  删除标注节点 ${d.mermaid?.del?.length ?? 0} 个：其中计算色为红的 ${d.trulyRedDels ?? 0}/${d.mermaid?.del?.length ?? 0}${(d.styleFailed ?? 0) ? ` · ⚠️ ${d.styleFailed} 个颜色未生效` : ''}`)
  console.log(`  新增标注节点 ${d.mermaid?.add?.length ?? 0} 个：其中计算色为绿的 ${d.trulyGreenAdds ?? 0}/${d.mermaid?.add?.length ?? 0}`)
  for (const n of [...(d.mermaid?.del ?? []), ...(d.mermaid?.add ?? [])].slice(0, 8)) {
    console.log(`    [${n.kind}] ${n.label} · stroke=${n.stroke ?? '-'} · 删除线=${n.lineThrough ? '✓' : '✗'}`)
  }
  if (d.text) console.log(`  文本级标注 ins/del/mod = ${d.text.ins}/${d.text.del}/${d.text.mod}`)
}

// ---- 兼容性探针 ----
if (probes?.compat) {
  const c = probes.compat
  console.log(`\n■ WebView 兼容性`)
  console.log(`  color-mix() 支持=${c.colorMix}${c.colorMix === 'no' ? '（⚠️ 填充色失效→diff 标注少红/少绿，建议 diff.css 改用兼容写法）' : ''} · 应用含 ${c.colorMixUsages} 处 color-mix`)
}

// ---- 性能监控 ----
if (probes?.monitor) {
  const m = probes.monitor
  const fps = m.fps ?? {}
  console.log(`\n■ 性能监控（运行 ${m.uptimeSec}s）`)
  console.log(`  平均帧率 ${fps.avgFps ?? '-'}fps · 低帧 ${fps.lowFpsSeconds ?? 0}s（占比 ${fps.lowRatio ?? '-'}%） · 长任务 ×${m.longTaskCount ?? 0}（最长 ${m.maxLongTaskMs ?? 0}ms）`)
  console.log(`  编辑器渲染 ${m.editorRenders?.count ?? 0} 次 · ${m.editorRenders?.perMin ?? '-'} 次/分`)
  if (m.longTasks?.length) {
    for (const t of m.longTasks.slice(-3)) console.log(`    长任务 +${t.duration}ms @ ${t.start}ms`)
  }
}

// ---- 笔记 ----
if (notes) {
  const user = notes.match(/## 用户描述\s*\n\s*\n([\s\S]*?)\n\s*\n## /)
  if (user?.[1]?.trim()) console.log(`\n■ 用户描述：${user[1].trim()}`)
}

// ---- 崩溃记录（panic.log 不在 zip 内；提示查看位置） ----
console.log(`\n■ 崩溃提示`)
console.log(`  桌面端如果存在闪退，请用户在系统应用数据目录查找 writeit-panic.log：`)
console.log(`    Windows: %APPDATA%\\com.writeit.app\\writeit-panic.log`)
console.log(`    macOS  : ~/Library/Application Support/com.writeit.app/writeit-panic.log`)

// ---- 文档还原 ----
const doc = files.get('07-document.md')
if (doc) {
  console.log(`\n■ 文档还原`)
  console.log(`  当前文档已包含（07-document.md，${doc.content.length} 字节）——可直接保存为 ${active?.path ?? 'document.md'}`)
  console.log(`  还原: 新建同名文件并把 07-document.md 内容粘贴进去`)
}

// ---- 界面快照 ----
const snap = files.get('06-snapshot.svg')
if (snap) {
  console.log(`\n■ 界面快照`)
  console.log(`  06-snapshot.svg（${snap.content.length} 字节）——用浏览器打开即可查看当时界面（真实渲染，可文本搜索）`)
}

console.log(`\n■ 文件清单（${files.size} 项）`)
console.log(`  ${[...files.keys()].join('  ')}`)
console.log('\n完成。\n')