// ============================================================
// AI 阅读摘要（D2.5）—— 00-summary.md
// 给 AI agent / 开发者第一眼的信息：以最少 token 给出关键结论 + 文件索引。
// 设计：先结论后细节；关键指标用符号（✅/⚠️/❌）；每层给出「建议下一步看哪个文件」。
// ============================================================
import type { DiagLogEntry, DiagTimelineEntry } from './logger'
import type { DiffProbe, DomSnapshot, EditorProbe, CompatProbe } from './probes'

export interface SummaryInput {
  env: Record<string, unknown>
  appState: Record<string, unknown>
  settingsData: Record<string, unknown>
  logs: DiagLogEntry[]
  timeline: DiagTimelineEntry[]
  dom: DomSnapshot | null
  diff: DiffProbe | null
  editor: EditorProbe | null
  compat: CompatProbe | null
  monitor: Record<string, unknown> | null
  fileIndex: Array<{ name: string; size: number; desc: string }>
  notesUserText: string
  schemaVersion: number
}

const ok = (b: boolean | null | undefined) => (b === true ? '✅' : b === false ? '⚠️' : '·')

/** 组装 00-summary.md（紧凑，~1.5KB 目标） */
export function buildSummary(s: SummaryInput): string {
  const env = s.env
  const errors = s.logs.filter((l) => l.level === 'error')
  const warns = s.logs.filter((l) => l.level === 'warn')
  const fps = s.monitor?.fps as { avgFps?: number | null; lowFpsSeconds?: number; lowRatio?: number | null } | undefined
  const diff = s.diff

  const lines: string[] = []
  lines.push('# WriteIt 诊断摘要', '')
  lines.push(`> 版本 ${String(env.appVersion ?? '?')} · 宿主 ${String(env.host ?? '?')}${env.tauri ? `(${String(env.tauri.os)})` : ''} · 生成 ${String(env.bootAt ?? '').slice(0, 19)}`)
  lines.push(
    `> 系统 ${String(env.platform ?? '?')} · ${String(env.screen?.width ?? '?')}×${String(env.screen?.height ?? '?')}@${String(env.devicePixelRatio ?? 1)}x · reduced-motion ${env.prefersReducedMotion ? '开' : '关'}`
  )
  const activeTab = (s.appState.activeTab as { path?: string; viewMode?: string; dirty?: boolean } | null) ?? null
  lines.push(`> 当前文件 ${activeTab?.path ?? '（无）'} · 视图 ${activeTab?.viewMode ?? '?'}${activeTab?.dirty ? ' · 未保存' : ''} · git ${String((s.appState.git as { branch?: string })?.branch ?? '-')}`)
  lines.push('')

  // ---- 异常 ----
  lines.push('## 异常与警告')
  if (!errors.length && !warns.length) {
    lines.push('- 无 error/warn 日志（问题可能无异常，参考下方分层指标）')
  } else {
    if (errors.length) {
      lines.push(`- ❌ error ×${errors.length}（最近 ${Math.min(3, errors.length)} 条）：`)
      for (const e of errors.slice(-3)) {
        lines.push(`  - \`${e.area}\`: ${e.msg.slice(0, 160)}`)
        // 异常附带的上下文面包屑（还原异常前用户在做什么）
        const crumbs = ((e.data as { crumbs?: Array<{ type: string; target?: string }> } | undefined)?.crumbs ?? []).slice(-3)
        for (const c of crumbs) {
          lines.push(`    ↳ ${c.type}${c.target ? ` ${c.target}` : ''}`)
        }
      }
    }
    const warnTail = warns.slice(-3)
    if (warnTail.length) lines.push(`- ⚠️ warn ×${warns.length}（最近 ${warnTail.length} 条）：${warnTail.map((w) => w.msg.slice(0, 80)).join(' ｜ ')}`)
  }
  lines.push('')

  // ---- 关键结论（基于探针的 AI 推论） ----
  lines.push('## 关键结论')
  const notes: string[] = []
  if (diff) {
    const totalDel = diff.mermaid.del.length + (diff.text.del ? 0 : 0)
    if (diff.mermaid.del.length) {
      notes.push(`${diff.mermaid.del.length} 个删除标注节点：${diff.trulyRedDels}/${diff.mermaid.del.length} 计算色为红${diff.trulyRedDels < diff.mermaid.del.length ? '（⚠️ 样式层未生效，多为 color-mix 不支持）' : ''}`)
    }
    if (diff.mermaid.add.length) {
      notes.push(`${diff.mermaid.add.length} 个新增标注节点：${diff.trulyGreenAdds}/${diff.mermaid.add.length} 计算色为绿`)
    }
    if (diff.styleFailed) notes.push(`⚠️ 共 ${diff.styleFailed} 个标注节点颜色未生效——先查 compat.colorMix（=${s.compat?.colorMix ?? '?'}）`)
  }
  if (s.compat) {
    notes.push(`color-mix() 支持=${s.compat.colorMix}${s.compat.colorMix === 'no' ? '（⚠️ 填充色会失效→少红/少绿，建议兼容写法）' : ''} · 应用含 ${s.compat.colorMixUsages} 处 color-mix`)
  }
  if (s.editor && s.editor.brokenRefs > 0) {
    notes.push(`⚠️ 断链引用 ×${s.editor.brokenRefs}${s.editor.brokenPaths.slice(0, 3).map((p) => ` ${p}`).join('')}`)
  }
  if (fps && fps.avgFps != null && fps.avgFps < 55) {
    notes.push(`⚠️ 平均帧率 ${fps.avgFps}fps${fps.lowFpsSeconds ? ` · 低帧 ${fps.lowFpsSeconds}s` : ''}（动画卡顿线索）`)
  }
  if (s.monitor?.longTaskCount && (s.monitor.longTaskCount as number) > 0) {
    notes.push(`长任务 ×${String(s.monitor.longTaskCount)}（最长 ${String(s.monitor.maxLongTaskMs)}ms）`)
  }
  const mmRenderStats = renderStats(s.timeline)
  if (mmRenderStats.count) {
    notes.push(`mermaid 渲染 ${mmRenderStats.count} 次（成功 ${mmRenderStats.ok}/${mmRenderStats.count}${mmRenderStats.avgMs != null ? `，平均 ${mmRenderStats.avgMs}ms` : ''}）`)
  }
  if (activeTab?.viewMode === 'diff') {
    notes.push(`ⓘ 生成时处于 diff 视图——编辑器几何 0×0 属正常（diff 覆盖编辑区）`)
  }
  lines.push(...(notes.length ? notes.map((n) => `- ${n}`) : ['- 无显著异常指标']))
  lines.push('')

  // ---- 分层指标表 ----
  lines.push('## 分层指标')
  const rows: Array<[string, string, string, string]> = []
  const editor = s.editor
  rows.push([
    '编辑器/文档',
    editor?.activeDoc ? `引用 ${editor.activeDoc.fileRefs}/${editor.activeDoc.objectRefs}/${editor.activeDoc.fileBlocks} · 批注 ${editor.activeDoc.annotations} · 表格 ${editor.activeDoc.tables}` : '无活动文档',
    ok(editor?.activeDoc != null),
    '08-probes.json → editor',
  ])
  rows.push(['多标签健康', `${editor?.tabs.count ?? 0} 标签 / ${editor?.tabs.instances ?? 0} 实例 · 脏 ${editor?.tabs.dirty ?? 0} · 视图 ${Object.entries(editor?.tabs.byView ?? {}).map(([k, v]) => `${k} ${v}`).join(' ')}`, ok(editor != null), '08-probes.json → editor.tabs'])
  rows.push([
    '性能/动画',
    `fps ${fps?.avgFps ?? '-'} · 低帧 ${fps?.lowFpsSeconds ?? 0}s · 长任务 ${String(s.monitor?.longTaskCount ?? 0)} · 渲染 ${String(s.monitor?.editorRenders ? (s.monitor.editorRenders as { count: number }).count : 0)}次/分 ${(s.monitor?.editorRenders as { perMin?: number })?.perMin ?? '-'}`,
    ok((fps?.avgFps ?? 60) >= 55),
    '08-probes.json → monitor',
  ])
  rows.push([
    'diff 标注',
    diff ? `红 ${diff.trulyRedDels}/${diff.mermaid.del.length} · 绿 ${diff.trulyGreenAdds}/${diff.mermaid.add.length} · 样式失效 ${diff.styleFailed} · 文本标注 ${diff.text.ins}/${diff.text.del}/${diff.text.mod}` : '无 diff 视图',
    ok(diff ? diff.styleFailed === 0 : null),
    '08-probes.json → diff',
  ])
  rows.push(['兼容性', `color-mix ${s.compat?.colorMix ?? '?'} · exports ${String((env.jsHeap as { usedJSHeapMB?: number })?.usedJSHeapMB ?? '?')}MB heap`, ok(s.compat?.colorMix !== 'no'), '08-probes.json → compat'])
  rows.push(['界面/面板', `侧栏${s.dom?.panels.sidebarCollapsed ? '收' : '展'} · 抽屉 ${s.dom?.panels.annotationDrawer ? (s.dom.panels.annotationDrawer.collapsed ? '折叠' : '展开') : '无'} · 大纲 ${s.dom?.panels.outlinePanel ? '显' : '隐'} · 动画 ${s.dom?.animations.length ?? 0} 个 · reduced-motion ${s.dom?.pref.prefersReducedMotion ? '开' : '关'}`, ok(null), '08-probes.json → ui'])

  const W = [14, 52, 8, 22]
  const fmt = (r: [string, string, string, string]) => `| ${r[0].padEnd(W[0])} | ${r[1].padEnd(W[1])} | ${r[2].padEnd(W[2])} | ${r[3].padEnd(W[3])} |`
  lines.push(fmt(['层', '关键指标', '状态', '细节来源']))
  lines.push(`| ${'-'.repeat(W[0])} | ${'-'.repeat(W[1])} | ${'-'.repeat(W[2])} | ${'-'.repeat(W[3])} |`)
  for (const r of rows) lines.push(fmt(r))
  lines.push('')

  // ---- 操作时间轴（最近） ----
  const recent = s.timeline.slice(-8)
  if (recent.length) {
    lines.push('## 最近操作')
    for (const e of recent) {
      const t = new Date(e.t).toISOString().slice(11, 19)
      lines.push(`- ${t} ${e.type}${e.target ? ` → ${e.target}` : ''}${e.ms != null ? ` (${Math.round(e.ms)}ms)` : ''}${e.ok === false ? ' ✗' : ''}`)
    }
    lines.push('')
  }

  // ---- 用户描述 ----
  const userText = s.notesUserText?.trim()
  if (userText && userText !== '我在 ____________ 时遇到 ____________，预期 ____________，实际 ____________') {
    lines.push('## 用户描述', '', userText.slice(0, 500), '')
  }

  // ---- 文件索引 ----
  lines.push('## 文件索引（AI 阅读顺序）')
  lines.push('| 建议顺序 | 文件 | 大小 | 内容 |')
  lines.push('| --- | --- | --- | --- |')
  const order: Array<[string, string]> = [
    ['①', 'manifest.json'],
    ['②', '00-summary.md'],
    ['③', '04-events.log'],
    ['④', '08-probes.json'],
    ['⑤', '05-timeline.jsonl'],
    ['⑥', '03-app-state.json'],
    ['⑦', '02-settings.json'],
    ['⑧', '01-environment.json'],
    ['⑨', '06-snapshot.svg'],
    ['⑩', '07-document.md'],
    ['⑪', '09-notes.md'],
  ]
  const byName = new Map(s.fileIndex.map((f) => [f.name, f]))
  for (const [no, name] of order) {
    const f = byName.get(name)
    if (!f) continue
    lines.push(`| ${no} | ${name} | ${fmtSize(f.size)} | ${f.desc} |`)
  }
  const unlisted = s.fileIndex.filter((f) => !byName.has(f.name))
  for (const f of unlisted) lines.push(`| · | ${f.name} | ${fmtSize(f.size)} | ${f.desc} |`)
  lines.push('')
  lines.push(`_schemaVersion ${s.schemaVersion} · 由 WriteIt 诊断功能生成_`)
  return lines.join('\n')
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n}B`
  return `${(n / 1024).toFixed(0)}KB`
}

/** 从 timeline 统计 mermaid 渲染口径 */
function renderStats(timeline: DiagTimelineEntry[]): { count: number; ok: number; avgMs: number | null } {
  const renders = timeline.filter((e) => e.type === 'mermaid:render')
  if (!renders.length) return { count: 0, ok: 0, avgMs: null }
  const okN = renders.filter((e) => e.ok !== false).length
  const ms = renders.map((e) => e.ms ?? 0).filter((m) => m > 0)
  const avg = ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null
  return { count: renders.length, ok: okN, avgMs: avg }
}