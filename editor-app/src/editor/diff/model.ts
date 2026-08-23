// M18 数据层：DocDiff 单一真相（§4.4）——渲染视图装饰与批注卡都是它的投影
//
// 分层承诺（§2）：
//   · 保证层（100% 可测）：ChangeRecord.summary/old/new —— 批注卡结构化摘要
//   · 增强层（尽力而为）：diagram 图内标注（classDef/class 合并源码）—— 失败 → scoped 降级
// model 是纯函数层：old/new md + git 数据 + 注入的 parser → DocDiff（无 DOM、无 IO）。
// 递归 scope 的 IO 由 diff/prefetch.ts 承担（§4.4.1-a：发现层只读、model 只算）。
import { computeDocDiff } from '@milkdown/plugin-diff'
import type { Node } from '@milkdown/kit/prose/model'
import type { DiffBase } from '../../git/types'
import { contentHash } from '../../git/hash'
import { patchMermaidFences, extractMermaidBodies, mermaidDiffText } from '../diff-deco'
import type { MermaidNodeDiff } from '../mermaid-diff'
import { fenceIdOf, normalizeFenceBody } from './fence-pair'
import { okState, degradedState, type EnhancementState } from './status'

export type ChangeKind = 'text' | 'block' | 'table' | 'diagram' | 'embed' | 'ref'
export type DiffStatus = 'ok' | 'degraded' | 'failed'

/** 文档位置（渲染 doc 坐标；write-once 下稳定，装饰/锚点共用） */
export interface DocLocation {
  from: number
  to: number
}

export interface RefDetail {
  path: string
  fragment?: string | null
  changed: boolean
}

export interface DiagramDetail {
  type: MermaidNodeDiff['type']
  add: string[]
  del: string[]
  mod: Array<{ id: string; old: string; new: string }>
}

export interface ChangeRecord {
  /** 稳定身份 = hash(scopePath + kind + op + 内容摘要)；重算不变（§4.2 F22） */
  id: string
  kind: ChangeKind
  /** 二元化（契约规则 1）：mod = 删旧 + 增新两条语义；卡片文案由 summary 承载 */
  op: 'add' | 'del'
  summary: string
  old?: string
  new?: string
  /** 新文档位置（装饰 data-dnote 锚定；write-once 下 from/to 稳定） */
  location?: DocLocation
  /** 记录所属嵌入源（真实路径）；宿主正文为空。多层嵌套每层源各产一批 records */
  scopePath?: string
  /** 保证层恒定（§4.5 双维度：guarantee 永不因 enhancement 隐藏） */
  guarantee: 'ok'
  /** 增强层（图内标注等，§4.5） */
  enhancement?: DiffStatus
  /** 增强层失败原因（R8：静默失败视为 bug） */
  degradeReason?: string
  detail?: RefDetail | DiagramDetail
}

/** 栅栏身份注册表（§4.2）：fenceId（= 内容派生）↔ 变更记录 + eager/lazy 判定 */
export interface FenceChange {
  fenceId: string
  /** 该 fence 是否参与 eager 渲染与图内标注 */
  changed: boolean
  eager: boolean
  /** 超过 eager 预算被降级为 lazy + 保证层卡（§4.1.2） */
  skip: boolean
  type: MermaidNodeDiff['type']
  add: string[]
  del: string[]
  mod: Array<{ id: string; old: string; new: string }>
  /** 合并后的渲染 body（无变更 = null，渲染新版本原样） */
  mergedBody: string | null
}

export interface FenceRegistry {
  fences: Map<string, FenceChange>
  /** 变更 fence 总数（settle 单位数） */
  changedCount: number
}

/** 嵌入源条目（prefetch 产出；model 与预填充共同消费，§4.4.1-a） */
export interface SourceEntry {
  realPath: string
  oldMd: string | null
  newMd: string | null
  /** mermaid 合并后的新文档（删除节点加回 + classDef 声明）；无变更 = newMd 原样 */
  mergedMd: string | null
  changed: boolean
  hash: { old: string; next: string } | null
}

export type SourceMap = Map<string, SourceEntry>

/** 环/超深折叠标记（prefetch 产出，不入 sourceMap；model 转保证层 record） */
export interface CollapsedScope {
  realPath: string
  writePath: string
  reason: 'cycle' | 'depth'
  chain: string[]
  summary: string
}

export interface DocDiff {
  base: DiffBase
  /** 内容指纹（§4.6 新鲜度契约） */
  freshToken: { oldHash: string; nextHash: string }
  records: ChangeRecord[]
  /** 渲染输入（mermaid 预合并后的新文档） */
  mergedMd: string
  fences: FenceRegistry
  /** 记录所属 scope（宿主为 undefined；嵌套源各自产 DocDiff） */
  scopePath?: string
}

export interface ModelBuildOpts {
  oldMd: string
  newMd: string
  base: DiffBase
  /** 注入的 md→PM doc 解析器（schema 含 file_ref/file_block/object_ref，无法内置）；
   *  无 parser（node 测试降级）→ text/block/ref 区域分类按 md 文本近似，diagram/embed 不受影响 */
  parser?: (md: string) => Node | null
  scopePath?: string
  /** eager fence 预算上限（§4.1.2）：超限降级 lazy + 保证层卡 */
  eagerBudget?: number
  /** 递归 scope 的嵌入源（prefetch 产出）；宿主正文为空 */
  sourceMap?: SourceMap
  /** 折叠标记（prefetch 产出，环/超深） */
  collapsedScopes?: CollapsedScope[]
}

/** 内容派生稳定 id（§4.2）：scopePath + kind + op + 摘要 → hash */
export function recordId(scopePath: string | undefined, kind: ChangeKind, op: 'add' | 'del', summary: string): string {
  return `dn-${contentHash(`${scopePath ?? ''}|${kind}|${op}|${summary}`)}`
}

// ---------- FenceRegistry 构建（§4.2） ----------

/** 提取 doc 中所有 mermaid code_block（含嵌套内容级），供位置定位/卡片锚定 */
export function docMermaidFences(doc: Node): Array<{ body: string; from: number }> {
  const out: Array<{ body: string; from: number }> = []
  doc.descendants((n, pos) => {
    if (n.type.name === 'code_block' && (n.attrs.language as string) === 'mermaid') {
      out.push({ body: n.textContent ?? '', from: pos })
    }
    return true
  })
  return out
}

/** 提取 doc 中所有 file_block（含嵌套内容级），供嵌入卡片锚定 */
export function docFileBlocks(doc: Node): Array<{ path: string; from: number; size: number }> {
  const out: Array<{ path: string; from: number; size: number }> = []
  doc.descendants((n, pos) => {
    if (n.type.name === 'file_block') {
      out.push({ path: String(n.attrs.path ?? ''), from: pos, size: n.nodeSize })
    }
    return true
  })
  return out
}

export interface FenceRegistryOpts {
  oldMd: string
  newMd: string
  /** patchMermaidFences 的配对（结构/加权合并后的 pairing 事实） */
  pairs: Array<{ newIdx: number; oldIdx: number | null }>
  /** 与 pairs 对齐的每个新栅栏 body（newMd 中按序提取） */
  newBodies: string[]
  oldBodies: string[]
  /** 与 pairs 对齐的合并 body（patchMermaidFences 已替换；无变更 = null） */
  mergedBodies: Array<string | null>
  /** 各栅栏的 mermaid diff（与 pairs 对齐） */
  diffs: MermaidNodeDiff[]
  eagerBudget?: number
}

/**
 * 构建 FenceRegistry（§4.2）：fenceId 内容派生；变更栅栏 eager，超预算降级 lazy；
 * 未变更栅栏 lazy（保留 IntersectionObserver 懒加载，不参与 settle）。
 */
export function buildFenceRegistry(opts: FenceRegistryOpts): FenceRegistry {
  const fences = new Map<string, FenceChange>()
  const eagerBudget = opts.eagerBudget ?? 20
  let eagerCount = 0
  let changedCount = 0

  // 注意：合并后的 md 与 newMd 栅栏数量相同（只替换 body 不增删 fence）
  const count = opts.newBodies.length
  for (let j = 0; j < count; j++) {
    const d = opts.diffs[j] as MermaidNodeDiff | undefined
    const body = opts.mergedBodies[j] ?? opts.newBodies[j]
    const changed = Boolean(opts.mergedBodies[j]) && Boolean(d != null && (d.add.length || d.del.length || d.mod.length))
    const skip = changed && eagerCount >= eagerBudget
    const fenceId = fenceIdOf(body)
    const existing = fences.get(fenceId)
    if (existing) {
      // 同一内容的重复栅栏：共享已 eager 的实例，不重复计数
      if (changed && !existing.skip && !existing.eager) {
        existing.eager = true
        existing.changed = true
      }
      continue
    }
    if (changed) {
      changedCount++
      if (!skip) eagerCount++
    }
    fences.set(fenceId, {
      fenceId,
      changed,
      eager: changed && !skip,
      skip,
      type: (d?.type ?? 'unknown') as MermaidNodeDiff['type'],
      add: (d?.add as string[]) ?? [],
      del: (d?.del as string[]) ?? [],
      mod: (d?.mod as Array<{ id: string; old: string; new: string }>) ?? [],
      mergedBody: opts.mergedBodies[j] ?? null,
    })
  }
  return { fences, changedCount }
}

// ---------- 记录构建（§4.4） ----------

/**
 * 构建 DocDiff（纯函数）：
 *  1. patchMermaidFences（宿主 merge）→ mergedMd/mergedBodies + pairs + diffs
 *  2. FenceRegistry（§4.2）
 *  3. 装饰记录（text/block/table）— parser 可用时经 computeDocDiff 区域分类（§4.4.1-c 决策表）
 *  4. 嵌入 records（sourceMap 消费）：含环/超深折叠保证层卡
 *  5. 引用 records（结构身份 diff，§4.9）
 */
export function computeDocDiffModel(opts: ModelBuildOpts): DocDiff {
  const { oldMd, newMd, base, parser, scopePath, sourceMap, collapsedScopes, eagerBudget } = opts
  const records: ChangeRecord[] = []

  // 1) mermaid 合并 + 配对
  const patched = patchMermaidFences(oldMd, newMd)
  const mergedMd = patched.md
  const oldBodies = extractMermaidBodies(oldMd)
  const newBodies = extractMermaidBodies(newMd)
  // 合并 body 按序对齐新栅栏：从 patched.md 再提取一次（body 已替换）
  const mergedBodies = extractMermaidBodies(mergedMd)
  // 新建 diffsByNewIdx：patched.mermaid 与 newIdx 的对应关系由 pairs 语义重建
  const diffByNew = new Map<number, MermaidNodeDiff>()
  patched.pairs.forEach((p, idx) => {
    if (p.oldIdx != null && patched.mermaid[idx]) diffByNew.set(p.newIdx, patched.mermaid[idx])
  })

  const fences = buildFenceRegistry({
    oldMd,
    newMd,
    pairs: patched.pairs,
    newBodies,
    oldBodies,
    mergedBodies,
    diffs: newBodies.map((_, j) => diffByNew.get(j) ?? ({ type: 'unknown', add: [], del: [], mod: [], merged: newBodies[j] } as MermaidNodeDiff)),
    eagerBudget,
  })

  for (const f of fences.fences.values()) {
    if (f.skip) {
      records.push({
        id: recordId(scopePath, 'diagram', 'del', `${f.fenceId}-skip`),
        kind: 'diagram',
        op: 'del',
        summary: '图表标注已降级（超出 eager 预算，未渲染图内红绿）',
        guarantee: 'ok',
        enhancement: 'degraded',
        degradeReason: 'eager-budget-exceeded',
        detail: { type: f.type, add: f.add, del: f.del, mod: f.mod },
      })
      continue
    }
    if (f.changed) {
      const diff = { type: f.type, add: f.add, del: f.del, mod: f.mod } as MermaidNodeDiff
      records.push({
        id: recordId(scopePath, 'diagram', 'add', mermaidDiffText(diff)),
        kind: 'diagram',
        op: f.add.length || f.mod.length ? 'add' : 'del',
        summary: mermaidDiffText(diff),
        guarantee: 'ok',
        detail: { type: f.type, add: f.add, del: f.del, mod: f.mod } satisfies DiagramDetail,
      })
    }
  }

  // 2) 装饰记录（text/block/table）：parser 可用 → computeDocDiff 区域分类
  if (parser) {
    try {
      const oldDoc = parser(oldMd)
      const newDoc = parser(mergedMd)
      if (oldDoc && newDoc) {
        for (const r of classifyTextRegions(oldDoc, newDoc, scopePath)) records.push(r)
      }
    } catch {
      /* 区域分类失败 → 降级：仅 diagram/embed/ref 记录（保证层仍完整） */
    }
  }

  // 3) 嵌入 records（sourceMap 消费；仅宿主 scope 产生，嵌套 scope 的 records 由递归 model 分别产出）
  if (sourceMap) {
    for (const [realPath, entry] of sourceMap) {
      if (!entry.changed) continue
      const baseName = realPath.split('/').pop() ?? realPath
      records.push({
        id: recordId(scopePath, 'embed', 'add', `嵌入「${baseName}」有改动`),
        kind: 'embed',
        op: 'add',
        summary: `嵌入「${baseName}」源文件有改动（块内已标红/绿）`,
        guarantee: 'ok',
        scopePath: realPath,
      })
    }
  }
  if (collapsedScopes) {
    for (const c of collapsedScopes) {
      records.push({
        id: recordId(scopePath, 'embed', 'del', c.summary),
        kind: 'embed',
        op: 'del',
        summary: c.summary,
        guarantee: 'ok',
        scopePath: c.realPath,
      })
    }
  }

  // 4) 引用 records（按身份二元化：路径/fragment 变化 = 删旧 + 增新；label/resolvedText 变化仅轻提示）
  if (parser) {
    try {
      const oldDoc = parser(oldMd)
      const newDoc = parser(mergedMd)
      if (oldDoc && newDoc) {
        for (const r of diffRefNodes(oldDoc, newDoc, scopePath)) records.push(r)
      }
    } catch {
      /* ref 记录失败不影响主体 */
    }
  }

  return {
    base,
    freshToken: { oldHash: contentHash(oldMd), nextHash: contentHash(newMd) },
    // §4.5：enhancement 默认 'ok'（未显式降级的记录正常）；guarantee 恒定
    records: records.map((r) => ({ ...r, enhancement: r.enhancement ?? ('ok' as const) })),
    mergedMd,
    fences,
    scopePath,
  }
}

// ---------- 文本/块/表格区域分类（§4.4.1-c 决策表：除 diagram/embed/ref 外归 text/block/table） ----------

function classifyTextRegions(oldDoc: Node, newDoc: Node, scopePath?: string): ChangeRecord[] {
  const records: ChangeRecord[] = []
  let changes: ReturnType<typeof computeDocDiff>
  try {
    changes = computeDocDiff(oldDoc, newDoc)
  } catch {
    return records
  }
  const isSpecial = (n: Node) =>
    n.type.name === 'file_block' || (n.type.name === 'code_block' && (n.attrs.language as string) === 'mermaid')
  const touches = (doc: Node, from: number, to: number): boolean => {
    let hit = false
    doc.nodesBetween(from, to, (n) => {
      if (isSpecial(n)) {
        hit = true
        return false
      }
      return true
    })
    return hit
  }
  const isSep = (s: string) => {
    if (!s.includes('|')) return false
    const cells = s.split('|').slice(1, -1).map((c) => c.trim())
    return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c))
  }
  const clip = (s: string, max = 48) => (s && s.length > max ? s.slice(0, max) + '…' : s)
  const snap = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 48)
  const addLines = (s: string) => s.split('\n').filter((l) => l.trim()).length

  for (const ch of changes) {
    const hasDel = ch.fromA < ch.toA
    const hasIns = ch.fromB < ch.toB
    if (!hasDel && !hasIns) continue
    if (hasDel && touches(oldDoc, ch.fromA, ch.toA)) continue
    if (hasIns && touches(newDoc, ch.fromB, ch.toB)) continue
    const delText = hasDel ? oldDoc.textBetween(ch.fromA, ch.toA, '\n', '\n').trim() : ''
    const insText = hasIns ? newDoc.textBetween(ch.fromB, ch.toB, '\n', '\n').trim() : ''
    const inTable = hasIns && newDoc.resolve(ch.fromB).node(1)?.type.name.startsWith('table') === true
    const block = (hasDel && containsBlock(oldDoc, ch.fromA, ch.toA)) || (hasIns && containsBlock(newDoc, ch.fromB, ch.toB))
    // 表格分隔行噪音跳过（Issue 3）
    if (hasDel && hasIns && isSep(delText) && isSep(insText)) continue
    if (hasIns && insText.trim()) {
      const kind: ChangeKind = inTable ? 'table' : block ? 'block' : 'text'
      records.push({
        id: recordId(scopePath, kind, 'add', snap(insText)),
        kind,
        op: 'add',
        summary: inTable
          ? '修改了表格单元格'
          : block
            ? `新增了此段${addLines(insText) > 1 ? `（${addLines(insText)} 行）` : ''}`
            : `新增"${snap(insText)}"`,
        old: delText || undefined,
        new: clip(insText),
        location: { from: ch.fromB, to: ch.toB },
        guarantee: 'ok',
      })
    }
    if (hasDel && delText.trim() && (!hasIns || !insText.trim())) {
      const kind: ChangeKind = block ? 'block' : 'text'
      records.push({
        id: recordId(scopePath, kind, 'del', snap(delText)),
        kind,
        op: 'del',
        summary: `删除"${snap(delText)}"`,
        old: clip(delText),
        location: { from: Math.min(ch.fromB, newDoc.content.size), to: Math.min(ch.fromB + 1, newDoc.content.size) },
        guarantee: 'ok',
      })
    } else if (hasDel && delText.trim() && hasIns && insText.trim() && !block) {
      // 行内修改对：删除侧并入修改记录（二元语义：旧值预览），不单出删除卡
      records.push({
        id: recordId(scopePath, 'text', 'del', `修改"${snap(delText)}"为"${snap(insText)}"`),
        kind: 'text',
        op: 'del',
        summary: `修改"${snap(delText)}"为"${snap(insText)}"`,
        old: clip(delText),
        new: clip(insText),
        location: { from: ch.fromB, to: ch.toB },
        guarantee: 'ok',
      })
    }
  }
  return records
}

function containsBlock(doc: Node, from: number, to: number): boolean {
  if (from >= to) return false
  const $from = doc.resolve(from)
  const $to = doc.resolve(to)
  if ($from.sameParent($to) && $from.parent.isTextblock) return false
  let found = false
  doc.nodesBetween(from, to, (node, pos) => {
    if (found) return false
    if (!node.isBlock) return true
    if (pos >= from && pos + node.nodeSize <= to) {
      found = true
      return false
    }
    return true
  })
  return found
}

/** 引用身份 diff（§4.9）：file_ref/object_ref 的 path/fragment 变化 = 删旧 + 增新 */
function diffRefNodes(oldDoc: Node, newDoc: Node, scopePath?: string): ChangeRecord[] {
  const out: ChangeRecord[] = []
  const collect = (doc: Node): Array<{ type: string; path: string; fragment: string | null; from: number; to: number }> => {
    const list: Array<{ type: string; path: string; fragment: string | null; from: number; to: number }> = []
    doc.descendants((n, pos) => {
      if (n.type.name === 'file_ref' || n.type.name === 'object_ref') {
        list.push({
          type: n.type.name,
          path: String(n.attrs.path ?? ''),
          fragment: (n.attrs.fragment as string | null) ?? null,
          from: pos,
          to: pos + n.nodeSize,
        })
      }
      return true
    })
    return list
  }
  const oldRefs = collect(oldDoc)
  const newRefs = collect(newDoc)
  const key = (r: { path: string; fragment: string | null }) => `${r.path}|${r.fragment ?? ''}`
  const newKeys = new Set(newRefs.map(key))
  for (const r of oldRefs) {
    if (!newKeys.has(key(r))) {
      out.push({
        id: recordId(scopePath, 'ref', 'del', `引用[[${r.path}${r.fragment ? '#' + r.fragment : ''}]]`),
        kind: 'ref',
        op: 'del',
        summary: `移除引用：[[${r.path}${r.fragment ? '#' + r.fragment : ''}]]`,
        old: r.path,
        detail: { path: r.path, fragment: r.fragment, changed: true } satisfies RefDetail,
        location: { from: r.from, to: r.to },
        guarantee: 'ok',
      })
    }
  }
  const oldKeys = new Set(oldRefs.map(key))
  for (const r of newRefs) {
    if (!oldKeys.has(key(r))) {
      out.push({
        id: recordId(scopePath, 'ref', 'add', `引用[[${r.path}${r.fragment ? '#' + r.fragment : ''}]]`),
        kind: 'ref',
        op: 'add',
        summary: `新增引用：[[${r.path}${r.fragment ? '#' + r.fragment : ''}]]`,
        new: r.path,
        detail: { path: r.path, fragment: r.fragment, changed: true } satisfies RefDetail,
        location: { from: r.from, to: r.to },
        guarantee: 'ok',
      })
    }
  }
  return out
}

export { okState, degradedState, normalizeFenceBody }
export type { EnhancementState }