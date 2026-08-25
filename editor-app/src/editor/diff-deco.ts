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
import { pairFences } from './diff/fence-pair'
import { contentHash } from '../git/hash'

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

export function makeNote(
  kind: DiffNote['kind'],
  text: string,
  del: string | undefined,
  add: string | undefined,
  anchor: string,
  from: number,
  to: number
): DiffNote {
  const clip = (s: string | undefined, max = 48) => (s && s.length > max ? s.slice(0, max) + '…' : s)
  // M18 §4.2/F22：id 内容派生（scopePath+kind+op+摘要 hash）——重算稳定，批注激活态/滚动保持
  const id = `dn-${contentHash(`diff|${kind}|${text}|${clip(del) ?? ''}|${clip(add) ?? ''}`)}`
  return { id, kind, text, del: clip(del), add: clip(add), anchor, from, to }
}

/** 原始 makeNote（构建期遮蔽去重版本内部调用它；避免同值多处修改产出相同 id 导致连线串指） */
const makeNoteStd = makeNote

// ---------- 结构实体收集（引用 / 批注）：供实体级批注卡（M18 §4.9 引用记录接入渲染） ----------

interface RefEntity {
  path: string
  fragment: string | null
  pos: number
  nodeSize: number
}

/** 收集 doc 内所有 file_ref / object_ref（内含引用实体的 path + fragment/object） */
function collectRefEntities(doc: Node): RefEntity[] {
  const out: RefEntity[] = []
  doc.descendants((n, pos) => {
    if (n.type.name === 'file_ref' || n.type.name === 'object_ref') {
      out.push({
        path: String(n.attrs.path ?? ''),
        fragment: (n.attrs.fragment as string | null) ?? (n.attrs.object as string | null) ?? null,
        pos,
        nodeSize: n.nodeSize,
      })
    }
    return true
  })
  return out
}

interface AnnEntity {
  id: string
  note: string
  text: string
  pos: number
  nodeSize: number
}

/** 收集 doc 内所有 annotation 批注（mark，按 attrs.id 分组；note = 评论线程 JSON） */
function collectAnnEntities(doc: Node): AnnEntity[] {
  const byId = new Map<string, { note: string; text: string; pos: number; end: number }>()
  doc.descendants((n, pos) => {
    for (const m of n.marks) {
      if (m.type.name === 'annotation') {
        const id = String(m.attrs.id ?? '')
        if (!id) continue
        const rec = byId.get(id)
        if (!rec) {
          byId.set(id, {
            note: String(m.attrs.note ?? ''),
            text: n.textContent,
            pos,
            end: pos + n.nodeSize,
          })
        } else {
          rec.end = pos + n.nodeSize
          rec.text += '…' + n.textContent
        }
      }
    }
    return true
  })
  const out: AnnEntity[] = []
  for (const [id, rec] of byId) {
    out.push({ id, note: rec.note, text: rec.text, pos: rec.pos, nodeSize: rec.end - rec.pos })
  }
  return out
}

/** M18 §4.2：装饰携带 data-dnote（record.id）——连线/定位/批注卡锚定的身份接口 */
export function dnote(recordId: string): Record<string, string> {
  return { 'data-dnote': recordId }
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

export interface BuildDiffDecoOptions {
  /** 位置偏移（嵌入块内容 diff：把源文档坐标映射到宿主文档该块的 content 区） */
  offset?: number
}

interface DelInfo {
  fromA: number
  toA: number
  posB: number
  block: boolean
  /** 是否与新增配对（删除+新增 = 修改，只出一张「修改」卡，不重复出「删除」卡） */
  paired: boolean
}

export function buildDiffDecorations(oldDoc: Node, newDoc: Node, opts?: BuildDiffDecoOptions): BuildDiffDecoResult {
  const decorations: Decoration[] = []
  const notes: DiffNote[] = []
  const off = opts?.offset ?? 0

  // 遮蔽去重：同 id（同值多处修改，如 10-多hunk折叠 的三处「将改→已经改过」）追加序号，
  // 保证每个 note 的 data-dnote 唯一 → 连线/定位分别命中各自锚点（F22 同值锚点 used 去重分配）
  const usedNoteIds = new Set<string>()
  const makeNote = (
    kind: DiffNote['kind'],
    text: string,
    del: string | undefined,
    add: string | undefined,
    anchor: string,
    from: number,
    to: number
  ): DiffNote => {
    let n = makeNoteStd(kind, text, del, add, anchor, from, to)
    if (usedNoteIds.has(n.id)) {
      let i = 2
      while (usedNoteIds.has(n.id + '-' + i)) i++
      n = { ...n, id: n.id + '-' + i }
    }
    usedNoteIds.add(n.id)
    return n
  }

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
        embedDeleteDecoration(oldDoc, newDoc, ch.fromA, ch.fromB, decorations, notes, off)
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
      // M18：先产批注卡（内容派生 id）再建装饰（携带 data-dnote）——装饰 = record 投影
      let insNote: DiffNote | null = null
      newDoc.nodesBetween(ch.fromB, ch.toB, (node, pos) => {
        const end = pos + node.nodeSize
        if (!node.isBlock || pos < ch.fromB || end > ch.toB) return true
        if (node.type.name === 'paragraph' && node.content.size === 0) return true
        if (!insNote) {
          if (inTable && hasDel) {
            insNote = makeNote('table', '修改了表格单元格', delText, addText, SNAP(addText), ch.fromB + off, ch.toB + off)
          } else {
            const addLines = addText.split('\n').filter((l) => l.trim())
            insNote = makeNote(
              'block',
              hasDel
                ? `修改了此段${addLines.length > 1 ? `（${addLines.length} 行）` : ''}`
                : `新增了此段${addLines.length > 1 ? `（${addLines.length} 行）` : ''}`,
              delText || undefined,
              addText,
              SNAP(addText),
              ch.fromB + off,
              ch.toB + off
            )
          }
          notes.push(insNote)
        }
        decorations.push(Decoration.node(pos + off, end + off, { class: 'diff-ins diff-ins-block', ...dnote(insNote.id) }))
        addedNode = true
        return false
      })
      if (!addedNode && !insNote) {
        // 空块级新增（如空段落删除后被替换）：无装饰无卡（保持现状——current 也有此行为）
      }
    } else if (!hasDel) {
      // 纯行内新增
      if (addText.trim()) {
        const note = makeNote(
          inTable ? 'table' : 'word',
          inTable ? '修改了表格单元格' : `新增"${SNAP(addText)}"`,
          undefined,
          addText,
          SNAP(addText),
          ch.fromB + off,
          ch.toB + off
        )
        notes.push(note)
        decorations.push(Decoration.inline(ch.fromB + off, ch.toB + off, { class: 'diff-ins', ...dnote(note.id) }))
      }
    } else {
      // 修改对（行内）：新文本绿（旧文本删除侧插回）
      if (addText.trim()) {
        const oldInline = oldDoc.textBetween(ch.fromA, ch.toA, '', '')
        const note = oldInline.trim()
          ? makeNote('word', `修改"${SNAP(oldInline)}"为"${SNAP(addText)}"`, oldInline, addText, SNAP(addText), ch.fromB + off, ch.toB + off)
          : makeNote('word', `新增"${SNAP(addText)}"`, undefined, addText, SNAP(addText), ch.fromB + off, ch.toB + off)
        notes.push(note)
        decorations.push(Decoration.inline(ch.fromB + off, ch.toB + off, { class: 'diff-ins', ...dnote(note.id) }))
      }
    }
  }

  // ---- 删除侧：合并同位块级删除，全部 widget 插在 ins 之前 ----
  const inlineDels = dels.filter((d) => !d.block)
  const blockDels = dels.filter((d) => d.block)
  for (const d of inlineDels) {
    const text = oldDoc.textBetween(d.fromA, d.toA, '', '')
    if (!text.trim()) continue
    // 纯删除才有「删除」卡（修改对的删除已由「修改」卡表达）
    const note = !d.paired
      ? makeNote('word', `删除"${SNAP(text)}"`, text, undefined, SNAP(text), d.posB + off, Math.min(d.posB + 1, newDoc.content.size) + off)
      : null
    if (note) notes.push(note)
    const el = document.createElement('span')
    el.className = 'diff-del'
    el.textContent = text
    decorations.push(Decoration.widget(d.posB + off, el, { side: -1, key: `diff-del-inline-${d.fromA}`, ...(note ? dnote(note.id) : {}) }))
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
    const vis = text.split('\n').filter((l) => l.trim())
    const note = makeNote('block', `删除了此段${vis.length > 1 ? `（${vis.length} 行）` : ''}`, text, undefined, SNAP(vis[0] || ''), posB + off, Math.min(posB + 1, newDoc.content.size) + off)
    notes.push(note)
    const el = document.createElement('span')
    el.className = isInlineWidgetPos(newDoc, posB) ? 'diff-del' : 'diff-del diff-del-block'
    el.textContent = text || '（已删除）'
    decorations.push(Decoration.widget(posB + off, el, { side: -1, key: `diff-del-block-${group[0].fromA}`, ...dnote(note.id) }))
  }

  // ---- 结构实体级：引用（file_ref/object_ref）增删改 + 批注（annotation）增删改（§4.9 接入渲染） ----
  const oEnd = (p: number, size: number) => Math.min(Math.max(p + size, p + 1), newDoc.content.size + off)

  const oldRefs = collectRefEntities(oldDoc)
  const newRefs = collectRefEntities(newDoc)
  const refKey = (r: RefEntity) => `${r.path}#${r.fragment ?? ''}`
  const newRefKeys = new Set(newRefs.map(refKey))
  for (const r of oldRefs) {
    if (newRefKeys.has(refKey(r))) continue // 未变化的引用（位置移动不算）
    const disp = `[[${r.path}${r.fragment ? '#' + r.fragment : ''}]]`
    const posB = Math.min(r.pos, newDoc.content.size - 1) + off
    const note = makeNote('block', `移除引用：${disp}`, r.path, undefined, `移除引用 ${disp}`, posB, posB + 1)
    notes.push(note)
    const el = document.createElement('span')
    el.className = 'diff-del diff-del-block'
    el.textContent = `移除引用：${disp}`
    decorations.push(Decoration.widget(posB, el, { side: -1, key: `diff-ref-del-${r.pos}`, ...dnote(note.id) }))
  }
  const oldRefKeys = new Set(oldRefs.map(refKey))
  for (const r of newRefs) {
    if (oldRefKeys.has(refKey(r))) continue
    const disp = `[[${r.path}${r.fragment ? '#' + r.fragment : ''}]]`
    const from = r.pos + off
    const note = makeNote('block', `新增引用：${disp}`, undefined, r.path, `新增引用 ${disp}`, from, oEnd(from, r.nodeSize))
    notes.push(note)
    decorations.push(Decoration.inline(from, oEnd(from, r.nodeSize), { class: 'diff-ins', ...dnote(note.id) }))
  }

  const oldAnn = collectAnnEntities(oldDoc)
  const newAnn = collectAnnEntities(newDoc)
  const newAnnNotes = new Set(newAnn.map((a) => a.note))
  for (const a of oldAnn) {
    if (newAnnNotes.has(a.note)) continue // 评论线程不变的批注：锚定文本变化由普通文本 diff 覆盖
    const posB = Math.min(a.pos, newDoc.content.size - 1) + off
    const note = makeNote('block', '移除批注', a.note, undefined, '移除批注', posB, posB + 1)
    notes.push(note)
    const el = document.createElement('span')
    el.className = 'diff-del diff-del-block'
    el.textContent = '移除批注'
    decorations.push(Decoration.widget(posB, el, { side: -1, key: `diff-ann-del-${a.pos}`, ...dnote(note.id) }))
  }
  const oldAnnNotes = new Set(oldAnn.map((a) => a.note))
  for (const a of newAnn) {
    if (oldAnnNotes.has(a.note)) continue
    const from = a.pos + off
    const note = makeNote('block', '新增批注', undefined, a.note, '新增批注', from, oEnd(from, a.nodeSize))
    notes.push(note)
    decorations.push(Decoration.inline(from, oEnd(from, a.nodeSize), { class: 'diff-ins', ...dnote(note.id) }))
  }

  return { decorations, notes }
}

function embedDeleteDecoration(
  oldDoc: Node,
  newDoc: Node,
  fromA: number,
  posB: number,
  decorations: Decoration[],
  notes: DiffNote[],
  off = 0
): void {
  const path = fileBlockPathNear(oldDoc, fromA)
  const txt = path ? `移除引用：[[${path}]]` : '移除引用'
  // 内容派生 id（同一 path 的移除引用重算稳定；去重）
  if (notes.some((n) => n.kind === 'block' && n.del === path)) return
  const note = makeNote('block', `移除了引用「${path || '?'}」`, path || undefined, undefined, txt, posB + off, Math.min(posB + 1, newDoc.content.size) + off)
  notes.push(note)
  const el = document.createElement('span')
  el.className = 'diff-del diff-del-block'
  el.textContent = txt
  decorations.push(Decoration.widget(posB + off, el, { side: -1, key: `diff-embed-del-${fromA}`, ...dnote(note.id) }))
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

// ---------- mermaid fence 预合并（节点级 diff 的唯一入口；M18：配对走 pairFences 加权） ----------

const FENCE_RE = /^```(\w*)\s*$/

export interface PatchMermaidResult {
  md: string
  mermaid: MermaidNodeDiff[]
  notes: DiffNote[]
  /** 每一条新 md 栅栏的配对（newIdx → oldIdx/新增）；与 mermaid 列表一一对应 */
  pairs: Array<{ newIdx: number; oldIdx: number | null }>
}

/** 提取 md 中所有 mermaid 栅栏 body（按出现顺序） */
export function extractMermaidBodies(md: string): string[] {
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

/** 统一的 mermaid 变更文案（宿主正文与嵌入块共用同一口径）：修改 = 删旧+增新（M16b 二元语义），
 *  分别并入「新增 / 删除」计数 → 如「流程图：新增 2 个节点、删除 2 个」 */
export function mermaidDiffText(d: MermaidNodeDiff): string {
  const label = d.type === 'flowchart' ? '流程图' : d.type === 'sequence' ? '时序图' : d.type === 'state' ? '状态图' : '图表'
  const unit = d.type === 'sequence' ? '消息' : '节点'
  // 二元语义：新增 = 纯新增 + 标签修改（新值绿），删除 = 纯删除（与图内 svgDel 一一对应）；
  // 标签修改（mod）的旧值由卡片 del 预览承载，不再计入「删除 N」（否则统计>图内红数）——F25 口径=视觉
  const ac = d.add.length + d.mod.length
  const dc = d.del.length
  const parts: string[] = []
  if (ac) parts.push(`新增 ${ac} 个${unit}`)
  if (dc) parts.push(`删除 ${dc} 个`)
  if (d.mod.length) parts.push(`${d.mod.length} 处标签修改`)
  return parts.length ? `${label}：${parts.join('、')}` : `${label}：无结构变化`
}

function mermaidNote(d: MermaidNodeDiff): DiffNote {
  const modOld = d.mod.map((m) => `${m.id}: ${m.old}→${m.new}`).join('；')
  return makeNote('mermaid', mermaidDiffText(d), modOld || undefined, undefined, mermaidDiffText(d), -1, -1)
}

/**
 * 把新 md 中 mermaid 栅栏替换为「合并源码」（新为底 + 删除节点/消息加回 + classDef/class 声明，
 * §4.8 由 diffMermaid 产出），供 NodeView 渲染图内红绿标注；非 mermaid 行原样。
 * 配对：M18 起走 pairFences（加权配对，免疫下标漂移）；返回 pairs 供 FenceRegistry 消费。
 */
export function patchMermaidFences(oldMd: string, newMd: string): PatchMermaidResult {
  const oldBodies = extractMermaidBodies(oldMd)
  const newBodies = extractMermaidBodies(newMd)
  const pairs = pairFences(oldBodies, newBodies)
  const mermaid: MermaidNodeDiff[] = []
  const notes: DiffNote[] = []

  const pairsByNew = new Map<number, { oldIdx: number | null }>()
  for (const p of pairs) pairsByNew.set(p.newIdx, p)
  const mergedByIndex = new Map<number, string>()

  // 逐条新栅栏：配对 → diff → merged（有结构变化才合并）；未配对新栅栏不产 diagram 标注（块级新增表达）
  for (let j = 0; j < newBodies.length; j++) {
    const p = pairsByNew.get(j)
    const oldBody = p?.oldIdx != null ? oldBodies[p.oldIdx] : ''
    const d = diffMermaid(oldBody, newBodies[j])
    mermaid.push(d)
    if (p?.oldIdx != null && meaningfulMermaid(d)) {
      mergedByIndex.set(j, d.merged)
      notes.push(mermaidNote(d))
    }
  }
  // 整段删除的旧栅栏（未被任何新栅栏匹配）：删旧 → 产删除卡（渲染无对应图）
  const matchedOld = new Set(pairs.map((p) => p.oldIdx).filter((x): x is number => x != null))
  for (let i = 0; i < oldBodies.length; i++) {
    if (matchedOld.has(i)) continue
    const d = diffMermaid(oldBodies[i], '')
    if (meaningfulMermaid(d)) {
      mermaid.push(d)
      notes.push(mermaidNote(d))
    }
  }
  if (!mergedByIndex.size) return { md: newMd, mermaid, notes, pairs }

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
  return { md: out.join('\n'), mermaid, notes, pairs }
}