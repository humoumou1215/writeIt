// M17：diff 渲染核心——文档结构级 diff + 装饰（替代 M13-M16 的 markdown 字符串注入管线）
//
// 思路：不再往 markdown 字符串里注入 {--..--}/{++..++} 标记（那需要穷举十几类语义边界：
//   表格分隔行 / 列表 / 引用 / 标题 marker / 元字符 LCS / 栅栏 / 嵌入 / 空行…），
// 而是用 @milkdown/plugin-diff 的 computeDocDiff 对「新旧两份 ProseMirror doc」做
// 结构感知的字符级 diff（LCS + ChangeSet），得到精确 fromA/toA/fromB/toB；
// 渲染「新 doc」为骨架（嵌入卡片 / mermaid 图用新版本内容），把变化变成装饰：
//   - 新增范围 → Decoration.inline(class 'diff-ins') / 块级 Decoration.node（绿）
//   - 删除范围 → Decoration.widget（旧文本原位插回，span.diff-del 红划线，块级加 block 样式）
// 语法外壳（列表/引用/标题/强调/表格/链接、段落独立）由 markdown 解析器天然处理，全部消失。
// 批注卡锚点在构建装饰时直接记录精确 from/to，不再渲染后值匹配。
//
// 保留的少量语义规则（均有充分理由，合计 < 60 行）：
//   1. 表格分隔行（| --- | :---: |）两侧都只含分隔语法 → 跳过（列宽格式化噪音）
//   2. mermaid 栅栏 → 节点级 diff（patchMermaidFences 预合并源码 + DOM 标注），不做文本标记
//   3. file_block（嵌入卡片）→ 不标文本；删除的引用输出红色占位行 + 批注卡

import { computeDocDiff } from '@milkdown/plugin-diff'
import type { Node } from '@milkdown/kit/prose/model'
import { Decoration } from '@milkdown/kit/prose/view'
import { diffMermaid, type MermaidNodeDiff } from './mermaid-diff'

export interface DiffNote {
  id: string
  kind: 'word' | 'block' | 'mermaid' | 'table'
  text: string
  del?: string
  add?: string
  /** 卡片预览文本 */
  anchor: string
  /** M17：锚点 = 渲染 doc 中的精确位置（构建装饰时记录，不再值匹配）；-1 = 待 render 侧定位 */
  from: number
  to: number
}

let noteSeq = 0
function makeNote(
  kind: DiffNote['kind'],
  text: string,
  del: string | undefined,
  add: string | undefined,
  anchor: string,
  from: number,
  to: number
): DiffNote {
  const clip = (s: string | undefined, max = 48) => (s && s.length > max ? s.slice(0, max) + '…' : s)
  return { id: `dn-${++noteSeq}`, kind, text, del: clip(del), add: clip(add), anchor, from, to }
}

const SNAP = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 48)

// ---------- 表格分隔行（M16 规则 3） ----------

/** GFM 分隔行：每格全为 - 与可选 : 对齐（| --- | :---: |）。列宽对齐格式化不是业务内容 → 跳过 */
function isSepRowText(text: string): boolean {
  if (!text.includes('|')) return false
  const cells = text.split('|').slice(1, -1).map((c) => c.trim())
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c))
}

// ---------- 分类辅助 ----------

/** 范围内是否命中 mermaid 代码块或 file_block */
function touches(doc: Node, from: number, to: number, pred: (n: Node) => boolean): boolean {
  let hit = false
  doc.nodesBetween(from, to, (n) => {
    if (pred(n)) {
      hit = true
      return false
    }
    return true
  })
  return hit
}

const isMermaidCode = (n: Node) => n.type.name === 'code_block' && (n.attrs.language as string) === 'mermaid'

/** 范围内第一个 file_block 的 path */
function fileBlockPathNear(doc: Node, from: number): string {
  let path = ''
  doc.nodesBetween(from, from + 2, (n) => {
    if (!path && n.type.name === 'file_block') {
      path = String(n.attrs.path ?? '')
      return false
    }
    return true
  })
  return path
}

/** 范围是否只包含文档末尾的空段落（Crepe 恒留一个尾空段，删除尾段的噪音跳过） */
function coversOnlyTrailingEmptyParagraphs(doc: Node, from: number, to: number): boolean {
  if (to !== doc.content.size) return false
  const $from = doc.resolve(from)
  if ($from.depth !== 0) return false
  for (let i = $from.index(0); i < doc.childCount; i++) {
    const child = doc.child(i)
    if (child.type.name !== 'paragraph' || child.content.size > 0) return false
  }
  return true
}

/** widget 位置是否在文本块内部（决定元素用 span 而非 div，避免 div 进 p 的非法嵌套） */
function isInlineWidgetPos(doc: Node, pos: number): boolean {
  const p = Math.min(Math.max(pos, 0), doc.content.size)
  const $pos = doc.resolve(p)
  for (let d = $pos.depth; d >= 1; d--) {
    if ($pos.node(d).isTextblock) return true
  }
  return false
}

// ---------- 主构建：changes → decorations + notes（两遍：先删后增，保证同位 del 在 ins 前） ----------

export interface BuildDiffDecoResult {
  decorations: Decoration[]
  notes: DiffNote[]
}

interface DelInfo {
  fromA: number
  toA: number
  posB: number
  block: boolean
  /** 是否与新增配对（删除+新增 = 修改，只出一张「修改」卡，不重复出「删除」卡） */
  paired: boolean
}

export function buildDiffDecorations(oldDoc: Node, newDoc: Node): BuildDiffDecoResult {
  const decorations: Decoration[] = []
  const notes: DiffNote[] = []

  let changes: ReturnType<typeof computeDocDiff>
  try {
    changes = computeDocDiff(oldDoc, newDoc)
  } catch (e) {
    console.warn('[diff-deco] computeDocDiff 失败，降级为无标注:', e)
    return { decorations, notes }
  }

  const dels: DelInfo[] = []

  for (const ch of changes) {
    const hasDel = ch.fromA < ch.toA
    const hasIns = ch.fromB < ch.toB
    if (!hasDel && !hasIns) continue

    // 语义规则 1：表格分隔行两侧都只含分隔语法 → 跳过
    if (hasDel && hasIns) {
      const dT = oldDoc.textBetween(ch.fromA, ch.toA, '\n', '\n')
      const iT = newDoc.textBetween(ch.fromB, ch.toB, '\n', '\n')
      if (isSepRowText(dT) && isSepRowText(iT)) continue
    }

    // 语义规则 2：mermaid 栅栏 → 节点级 diff 已由 patchMermaidFences 处理
    if ((hasDel && touches(oldDoc, ch.fromA, ch.toA, isMermaidCode)) || (hasIns && touches(newDoc, ch.fromB, ch.toB, isMermaidCode))) {
      continue
    }

    // 语义规则 3：file_block 卡片不标文本；纯删除 → 红色占位行 + 批注卡
    const delIsEmbed = hasDel && touches(oldDoc, ch.fromA, ch.toA, (n) => n.type.name === 'file_block')
    const insIsEmbed = hasIns && touches(newDoc, ch.fromB, ch.toB, (n) => n.type.name === 'file_block')
    if (delIsEmbed || insIsEmbed) {
      if (hasDel && !hasIns && delIsEmbed) {
        embedDeleteDecoration(oldDoc, newDoc, ch.fromA, ch.fromB, decorations, notes)
      }
      continue
    }

    // 纯删除覆盖文档末尾空段落（编辑器占位）→ 跳过
    if (hasDel && !hasIns && coversOnlyTrailingEmptyParagraphs(oldDoc, ch.fromA, ch.toA)) continue

    const delBlock = hasDel && containsBlock(oldDoc, ch.fromA, ch.toA)
    const insBlock = hasIns && containsBlock(newDoc, ch.fromB, ch.toB)

    // ---- 收集删除（先全部收集，块级按 posB 合并，保证同位 del widget 先于 ins 装饰） ----
    if (hasDel) {
      dels.push({ fromA: ch.fromA, toA: ch.toA, posB: ch.fromB, block: delBlock, paired: hasIns })
    }

    // ---- 新增侧 ----
    if (!hasIns) continue
    const addText = newDoc.textBetween(ch.fromB, ch.toB, '\n', '\n').trim()
    const delText = hasDel ? oldDoc.textBetween(ch.fromA, ch.toA, '\n', '\n').trim() : ''
    if (!addText && !insBlock) continue
    const inTable = newDoc.resolve(ch.fromB).node(1)?.type.name.startsWith('table') === true

    if (insBlock) {
      // 块级新增：标记范围内最外层完整包含的块（不回描内层，避免表格整块假绿）
      let addedNode = false
      newDoc.nodesBetween(ch.fromB, ch.toB, (node, pos) => {
        const end = pos + node.nodeSize
        if (!node.isBlock || pos < ch.fromB || end > ch.toB) return true
        if (node.type.name === 'paragraph' && node.content.size === 0) return true
        decorations.push(Decoration.node(pos, end, { class: 'diff-ins diff-ins-block' }))
        addedNode = true
        return false
      })
      if (addedNode) {
        if (inTable && hasDel) {
          notes.push(makeNote('table', '修改了表格单元格', delText, addText, SNAP(addText), ch.fromB, ch.toB))
        } else {
          const addLines = addText.split('\n').filter((l) => l.trim())
          notes.push(
            makeNote(
              'block',
              hasDel
                ? `修改了此段${addLines.length > 1 ? `（${addLines.length} 行）` : ''}`
                : `新增了此段${addLines.length > 1 ? `（${addLines.length} 行）` : ''}`,
              delText || undefined,
              addText,
              SNAP(addText),
              ch.fromB,
              ch.toB
            )
          )
        }
      }
    } else if (!hasDel) {
      // 纯行内新增
      if (addText.trim()) {
        decorations.push(Decoration.inline(ch.fromB, ch.toB, { class: 'diff-ins' }))
        notes.push(
          makeNote(
            inTable ? 'table' : 'word',
            inTable ? '修改了表格单元格' : `新增"${SNAP(addText)}"`,
            undefined,
            addText,
            SNAP(addText),
            ch.fromB,
            ch.toB
          )
        )
      }
    } else {
      // 修改对（行内）：新文本绿（旧文本删除侧插回）
      if (addText.trim()) {
        decorations.push(Decoration.inline(ch.fromB, ch.toB, { class: 'diff-ins' }))
        const oldInline = oldDoc.textBetween(ch.fromA, ch.toA, '', '')
        if (oldInline.trim()) {
          notes.push(makeNote('word', `修改"${SNAP(oldInline)}"为"${SNAP(addText)}"`, oldInline, addText, SNAP(addText), ch.fromB, ch.toB))
        }
      }
    }
  }

  // ---- 删除侧：合并同位块级删除，全部 widget 插在 ins 之前 ----
  const inlineDels = dels.filter((d) => !d.block)
  const blockDels = dels.filter((d) => d.block)
  for (const d of inlineDels) {
    const text = oldDoc.textBetween(d.fromA, d.toA, '', '')
    if (!text.trim()) continue
    const el = document.createElement('span')
    el.className = 'diff-del'
    el.textContent = text
    decorations.push(Decoration.widget(d.posB, el, { side: -1, key: `diff-del-inline-${d.fromA}` }))
    // 纯删除才有「删除」卡（修改对的删除已由「修改」卡表达）
    if (!d.paired) {
      notes.push(makeNote('word', `删除"${SNAP(text)}"`, text, undefined, SNAP(text), d.posB, Math.min(d.posB + 1, newDoc.content.size)))
    }
  }
  // 块级：按 posB 分组（连续删除映射到同一位）→ 同一 widget 拼接
  const byPos = new Map<number, DelInfo[]>()
  for (const d of blockDels) {
    const list = byPos.get(d.posB) ?? []
    list.push(d)
    byPos.set(d.posB, list)
  }
  for (const [posB, group] of byPos) {
    const lines: string[] = []
    for (const d of group) lines.push(oldDoc.textBetween(d.fromA, d.toA, '\n', '\n').trim())
    const text = lines.filter(Boolean).join('\n')
    const el = document.createElement('span')
    el.className = isInlineWidgetPos(newDoc, posB) ? 'diff-del' : 'diff-del diff-del-block'
    el.textContent = text || '（已删除）'
    decorations.push(Decoration.widget(posB, el, { side: -1, key: `diff-del-block-${group[0].fromA}` }))
    const vis = text.split('\n').filter((l) => l.trim())
    notes.push(makeNote('block', `删除了此段${vis.length > 1 ? `（${vis.length} 行）` : ''}`, text, undefined, SNAP(vis[0] || ''), posB, Math.min(posB + 1, newDoc.content.size)))
  }

  return { decorations, notes }
}

function embedDeleteDecoration(
  oldDoc: Node,
  newDoc: Node,
  fromA: number,
  posB: number,
  decorations: Decoration[],
  notes: DiffNote[]
): void {
  const path = fileBlockPathNear(oldDoc, fromA)
  const txt = path ? `移除引用：[[${path}]]` : '移除引用'
  const el = document.createElement('span')
  el.className = 'diff-del diff-del-block'
  el.textContent = txt
  decorations.push(Decoration.widget(posB, el, { side: -1, key: `diff-embed-del-${fromA}` }))
  if (!notes.some((n) => n.kind === 'block' && n.del === path))
    notes.push(makeNote('block', `移除了引用「${path || '?'}」`, path || undefined, undefined, txt, posB, Math.min(posB + 1, newDoc.content.size)))
}

/** 范围内是否包含完整块节点 */
function containsBlock(doc: Node, from: number, to: number): boolean {
  if (from >= to) return false
  const $from = doc.resolve(from)
  const $to = doc.resolve(to)
  if ($from.sameParent($to) && $from.parent.isTextblock) return false
  let found = false
  doc.nodesBetween(from, to, (node, pos) => {
    if (found) return false
    if (!node.isBlock) return true
    const end = pos + node.nodeSize
    if (pos >= from && end <= to) {
      found = true
      return false
    }
    return true
  })
  return found
}

// ---------- mermaid fence 预合并（节点级 diff 的唯一入口） ----------

const FENCE_RE = /^```(\w*)\s*$/

export interface PatchMermaidResult {
  md: string
  mermaid: MermaidNodeDiff[]
  notes: DiffNote[]
}

/** 提取 md 中所有 mermaid 栅栏 body（按出现顺序） */
function extractMermaidBodies(md: string): string[] {
  const bodies: string[] = []
  const lines = md.split('\n')
  let inFence = false
  let body: string[] = []
  const flush = () => {
    bodies.push(body.join('\n'))
    body = []
  }
  for (const ln of lines) {
    const m = FENCE_RE.exec(ln.trim())
    if (m) {
      if (inFence) {
        flush()
        inFence = false
      } else if (m[1] === 'mermaid') {
        inFence = true
      }
      continue
    }
    if (inFence) body.push(ln)
  }
  if (inFence) flush()
  return bodies
}

function meaningfulMermaid(d: MermaidNodeDiff): boolean {
  return d.type !== 'unknown' && (d.add.length > 0 || d.del.length > 0 || d.mod.length > 0)
}

function mermaidNote(d: MermaidNodeDiff): DiffNote {
  const label = d.type === 'flowchart' ? '流程图' : d.type === 'sequence' ? '时序图' : d.type === 'state' ? '状态图' : '图表'
  const unit = d.type === 'sequence' ? '消息' : '节点'
  const ac = d.add.length + d.mod.length
  const dc = d.del.length + d.mod.length
  const parts: string[] = []
  if (ac) parts.push(`新增 ${ac} 个${unit}`)
  if (dc) parts.push(`删除 ${dc} 个`)
  return makeNote('mermaid', `${label}：${parts.join('、')}`, undefined, undefined, `${label}节点`, -1, -1)
}

/** 把新 md 中 mermaid 栅栏替换为「合并源码」（新为底 + 删除节点/消息加回），
 *  供渲染后 DOM 标注红色删除目标；非 mermaid 行原样。返回合并结果 + 批注卡。 */
export function patchMermaidFences(oldMd: string, newMd: string): PatchMermaidResult {
  const oldBodies = extractMermaidBodies(oldMd)
  const newBodies = extractMermaidBodies(newMd)
  const mermaid: MermaidNodeDiff[] = []
  const notes: DiffNote[] = []
  const mergedByIndex = new Map<number, string>()

  const pairCount = Math.min(oldBodies.length, newBodies.length)
  for (let k = 0; k < pairCount; k++) {
    const d = diffMermaid(oldBodies[k], newBodies[k])
    if (meaningfulMermaid(d)) {
      mergedByIndex.set(k, d.merged)
      mermaid.push(d)
      notes.push(mermaidNote(d))
    }
  }
  // 多出的旧 fence（整段删除）
  for (let k = pairCount; k < oldBodies.length; k++) {
    const d = diffMermaid(oldBodies[k], '')
    if (meaningfulMermaid(d)) {
      mermaid.push(d)
      notes.push(mermaidNote(d))
    }
  }
  if (!mergedByIndex.size) return { md: newMd, mermaid, notes }

  // 重建 md：逐行扫描，把有合并源码的 mermaid 栅栏替换 body
  const lines = newMd.split('\n')
  const out: string[] = []
  let fi = -1
  let i = 0
  while (i < lines.length) {
    const m = FENCE_RE.exec(lines[i].trim())
    if (m && m[1] === 'mermaid') {
      fi++
      out.push(lines[i])
      i++
      // 跳到闭合行
      while (i < lines.length && !FENCE_RE.test(lines[i].trim())) i++
      const merged = mergedByIndex.get(fi)
      if (merged !== undefined) out.push(...merged.split('\n'))
      if (i < lines.length) {
        out.push(lines[i])
        i++
      }
      continue
    }
    out.push(lines[i])
    i++
  }
  return { md: out.join('\n'), mermaid, notes }
}