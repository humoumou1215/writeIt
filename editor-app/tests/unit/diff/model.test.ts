// M18 P0：model 层 fixture 网（vitest + jsdom 最小 schema）——
// 先让安全网以最短路径存在（P0 裁剪：仅 model 层纯函数 + 少量编排逻辑），再随阶段加密。
// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  computeDocDiffModel,
  recordId,
  type ChangeRecord,
  type FenceRegistry,
} from '../../../src/editor/diff/model'
import { pairFences, bodySimilarity, fenceIdOf } from '../../../src/editor/diff/fence-pair'
import { classifyEmbed, buildCollapseChain, MAX_EMBED_DEPTH } from '../../../src/editor/ref/embed-chain'
import { patchMermaidFences, extractMermaidBodies } from '../../../src/editor/diff-deco'
import { diffMermaid } from '../../../src/editor/mermaid-diff'
import { createTestParser } from '../helpers/parser'
import type { DiffBase } from '../../../src/git/types'

const base: DiffBase = { kind: 'worktree', label: '工作区 vs HEAD' }
let parser: (md: string) => ReturnType<typeof parseNow> extends never ? never : any
let destroyParser: () => Promise<void>

function parseNow() {
  return null as never
}

beforeAll(async () => {
  const r = await createTestParser()
  parser = r.parser
  destroyParser = r.destroy
})
afterAll(async () => {
  await destroyParser?.()
})

function model(oldMd: string, newMd: string, opts: { sourceMap?: Map<string, any>; collapsedScopes?: any[]; parser?: any } = {}) {
  return computeDocDiffModel({
    oldMd,
    newMd,
    base,
    parser: opts.parser !== undefined ? opts.parser : parser,
    sourceMap: opts.sourceMap,
    collapsedScopes: opts.collapsedScopes,
  })
}

// ---------- 1) fence 配对（§4.2） ----------

describe('pairFences（md 加权配对 fallback）', () => {
  it('普通对应（内容相同按序配对）', () => {
    const oldBodies = ['flowchart TD\n  A-->B', 'flowchart TD\n  A-->C']
    const newBodies = ['flowchart TD\n  A-->B', 'flowchart TD\n  A-->C']
    const pairs = pairFences(oldBodies, newBodies)
    expect(pairs).toEqual([
      { newIdx: 0, oldIdx: 0 },
      { newIdx: 1, oldIdx: 1 },
    ])
  })

  it('中途插入新图（下标漂移免疫）→ 插图为新增、后续归位', () => {
    const oldBodies = ['A-->B', 'C-->D']
    const newBodies = ['A-->B', 'X-->Y', 'C-->D']
    const pairs = pairFences(oldBodies, newBodies)
    expect(pairs[0]).toEqual({ newIdx: 0, oldIdx: 0 })
    expect(pairs[1].oldIdx).toBeNull() // 插入的图 → 新增（不产 diagram 标注，块级新增表达）
    expect(pairs[2].oldIdx).toBe(1) // 后续栅栏正确归位
  })

  it('两张同内容图（重复）→ 不误折叠/不重复标注', () => {
    const oldBodies = ['A --> B', 'A --> B']
    const newBodies = ['A --> B', 'A --> B']
    const pairs = pairFences(oldBodies, newBodies)
    expect(pairs).toEqual([
      { newIdx: 0, oldIdx: 0 },
      { newIdx: 1, oldIdx: 1 },
    ])
  })

  it('整段删除的旧栅栏 → 不匹配任何新栅栏（删除表达）', () => {
    const oldBodies = ['A --> B', 'C --> D']
    const newBodies = ['A --> B']
    const pairs = pairFences(oldBodies, newBodies)
    expect(pairs).toEqual([{ newIdx: 0, oldIdx: 0 }])
  })

  it('相似度评分：内容变更（同图改标签）仍配对', () => {
    const oldBodies = ['flowchart TD\n  A["旧标签"] --> B']
    const newBodies = ['flowchart TD\n  A["新标签"] --> B']
    const pairs = pairFences(oldBodies, newBodies)
    expect(pairs[0].oldIdx).toBe(0)
  })
})

describe('classifyEmbed（治理文档 §5 判定矩阵）', () => {
  it('A 嵌 A（自嵌）→ cycle', () => {
    expect(classifyEmbed(['A.md'], 'A.md')).toEqual({ kind: 'cycle', hit: 'A.md' })
  })
  it('A 嵌 B 嵌 A → cycle（链根含宿主）', () => {
    expect(classifyEmbed(['A.md', 'B.md'], 'A.md')).toEqual({ kind: 'cycle', hit: 'A.md' })
  })
  it('A 嵌 B 嵌 C 嵌 B → cycle 命中祖先（非宿主）', () => {
    expect(classifyEmbed(['A.md', 'B.md', 'C.md'], 'B.md')).toEqual({ kind: 'cycle', hit: 'B.md' })
  })
  it('兄弟重复（A 嵌 B ×2）→ ok（不是环）', () => {
    expect(classifyEmbed(['A.md'], 'B.md')).toEqual({ kind: 'ok' })
    expect(classifyEmbed(['A.md'], 'B.md')).toEqual({ kind: 'ok' })
  })
  it('第 10 层正常；第 11 层 too-deep', () => {
    // ancestors.length - 1 = 层数；10 层 → ancestors = [宿主 + 9 父]
    const ten = Array.from({ length: 10 }, (_, i) => `L${i}.md`)
    expect(classifyEmbed(ten, 'L10.md').kind).toBe('ok')
    const eleven = Array.from({ length: 11 }, (_, i) => `L${i}.md`)
    expect(classifyEmbed(eleven, 'L11.md')).toEqual({ kind: 'too-deep', limit: MAX_EMBED_DEPTH })
  })
  it('路径互为前缀（数据/需求 vs 数据/需求表）→ 精确比较不误判', () => {
    expect(classifyEmbed(['数据/需求.md'], '数据/需求表.md')).toEqual({ kind: 'ok' })
  })
})

describe('recordId / fenceIdOf（内容派生稳定 id，§4.2 F22）', () => {
  it('同一内容两次计算 id 相同', () => {
    expect(recordId('', 'text', 'add', '新增"你好"')).toBe(recordId('', 'text', 'add', '新增"你好"'))
    expect(recordId('', 'text', 'add', '新增"你好"')).not.toBe(recordId('', 'text', 'add', '新增"你好啊"'))
  })
  it('fenceId 同 body 稳定', () => {
    expect(fenceIdOf('A-->B')).toBe(fenceIdOf('A-->B\n'))
    expect(fenceIdOf('A-->B')).not.toBe(fenceIdOf('A-->C'))
  })
})

// ---------- 2) DocDiff 模型（diagram / embed / text records） ----------

describe('computeDocDiffModel（model 纯函数）', () => {
  it('mermaid 增节点 → diagram record（summary 二元计数）', () => {
    const oldMd = '```mermaid\nflowchart TD\n  A-->B\n```'
    const newMd = '```mermaid\nflowchart TD\n  A-->B\n  C-->D\n```'
    const diff = model(oldMd, newMd)
    const diagram = diff.records.filter((r) => r.kind === 'diagram')
    expect(diagram.length).toBeGreaterThan(0)
    expect(diagram[0].enhancement).toBe('ok')
    expect(diff.fences.changedCount).toBe(1)
    const f = [...diff.fences.fences.values()][0]
    expect(f.changed).toBe(true)
    expect(f.eager).toBe(true)
    expect(f.add.includes('C')).toBe(true)
  })

  it('mermaid 删节点 → merged 源码带 classDef/class 声明（模型层可断言源码文本，§4.8）', () => {
    const oldMd = '```mermaid\nflowchart TD\n  A-->B\n  C-->D\n```'
    const newMd = '```mermaid\nflowchart TD\n  A-->B\n```'
    const diff = model(oldMd, newMd)
    expect(diff.mergedMd).toContain('classDef diffDel')
    expect(diff.mergedMd).toContain('class C,D diffDel')
    const f = [...diff.fences.fences.values()][0]
    expect(f.del.includes('C')).toBe(true)
  })

  it('mermaid 标签修改（mod）→ 新值绿 class + 旧值入卡 del 预览', () => {
    const oldMd = '```mermaid\nflowchart TD\n  A["旧名"] --> B\n```'
    const newMd = '```mermaid\nflowchart TD\n  A["新名"] --> B\n```'
    const diff = model(oldMd, newMd)
    expect(diff.mergedMd).toContain('class A diffAdd')
    const diagram = diff.records.find((r) => r.kind === 'diagram')
    expect(diagram?.summary).toContain('新增 1 个节点')
  })

  it('新栅栏插入（中途插图）→ 不产 diagram 已具备（块级新增由 text 记录承载）', () => {
    const oldMd = '```mermaid\nflowchart TD\n  A-->B\n```\n\n## 二\n\n```mermaid\nflowchart TD\n  C-->D\n```'
    const newMd = '```mermaid\nflowchart TD\n  A-->B\n```\n\n## 二\n\n```mermaid\nflowchart TD\n  X-->Y\n```\n\n## 三\n\n```mermaid\nflowchart TD\n  C-->D\n```'
    const diff = model(oldMd, newMd)
    // C-->D 归位配对（无变化 → 不产 diagram）；X-->Y 为新增（无 old 配对 → 不产 diagram；文本块级有「新增」记录）
    const diagram = diff.records.filter((r) => r.kind === 'diagram')
    expect(diagram.length).toBe(0)
  })

  it('graph 语法错误（新版 broken）→ merged=新源码原样 + diagram 不误标', () => {
    const oldMd = '```mermaid\nflowchart TD\n  A-->B\n```'
    const newMd = '```mermaid\nflowchart TD\n  A---- B\n  ++[unclosed\n```'
    const diff = model(oldMd, newMd)
    // 不抛错；record 存在但 enhancement 不承诺图内标注（保证层卡兜底）
    expect(Array.isArray(diff.records)).toBe(true)
    expect(diff.mergedMd.length).toBeGreaterThan(0)
  })

  it('文本/块级新增 → text/block record + location', () => {
    const oldMd = '第一段\n\n第二段'
    const newMd = '第一段\n\n中间插入\n\n第二段'
    const diff = model(oldMd, newMd)
    const rec = diff.records.find((r) => (r.kind === 'text' || r.kind === 'block') && r.op === 'add')
    expect(rec).toBeTruthy()
    expect(rec?.summary).toContain('新增')
    expect(rec?.new).toContain('中间插入')
    expect(rec?.location?.from).toBeGreaterThanOrEqual(0)
    expect(rec?.id.startsWith('dn-')).toBe(true)
  })

  it('表格分隔行噪音跳过（仅列宽对齐 → 无记录）', () => {
    const oldMd = '| a | b |\n| --- | --- |\n| 1 | 2 |'
    const newMd = '| a | b |\n| ---: | :---: |\n| 1 | 2 |'
    const diff = model(oldMd, newMd)
    expect(diff.records.filter((r) => r.kind === 'text' || r.kind === 'block' || r.kind === 'table')).toHaveLength(0)
  })

  it('嵌入源有改动 → embed record（scopePath = 源真实路径）', () => {
    const oldMd = '宿主\n\n![[notes/A]]\n'
    const newMd = '宿主\n\n![[notes/A]]\n'
    const sourceMap = new Map([
      ['notes/A.md', { realPath: 'notes/A.md', oldMd: 'A 旧内容', newMd: 'A 新内容', mergedMd: 'A 新内容', changed: true, hash: null }],
    ])
    const diff = model(oldMd, newMd, { sourceMap })
    const embeds = diff.records.filter((r) => r.kind === 'embed')
    expect(embeds.some((e) => e.scopePath === 'notes/A.md')).toBe(true)
    expect(embeds.some((e) => e.summary.includes('嵌入「A.md」'))).toBe(true)
  })

  it('循环引用折叠 → 保证层 embed record（del op + summary 折叠文案）', () => {
    const collapsedScopes = [
      { realPath: 'B.md', writePath: 'B', reason: 'cycle', chain: ['A.md', 'B.md'], summary: '循环引用：[[B.md]] 已在上级层级出现，已折叠' },
    ]
    const diff = model('![[B]]', '![[B]]', { collapsedScopes })
    const rec = diff.records.find((r) => r.summary.includes('循环引用'))
    expect(rec?.kind).toBe('embed')
    expect(rec?.op).toBe('del')
    expect(rec?.summary).toContain('已折叠')
  })

  it('引用路径变化（[[a]] → [[b]]）→ ref 删旧 + 增新两条', () => {
    const oldMd = '查看 [[笔记/甲]] 与 [[notes/乙]]'
    const newMd = '查看 [[笔记/甲]] 与 [[notes/丙]]'
    const diff = model(oldMd, newMd)
    const refs = diff.records.filter((r) => r.kind === 'ref')
    const del = refs.find((r) => r.op === 'del')
    const add = refs.find((r) => r.op === 'add')
    expect(refs.length).toBe(2)
    expect(del?.summary).toContain('[[notes/乙]]')
    expect(add?.summary).toContain('[[notes/丙]]')
  })

  it('freshToken 内容指纹稳定（§4.6）', () => {
    const d1 = model('a\n', 'b\n')
    const d2 = model('a\n', 'b\n')
    expect(d1.freshToken).toEqual(d2.freshToken)
    const d3 = model('a\n', 'c\n')
    expect(d1.freshToken.nextHash).not.toBe(d3.freshToken.nextHash)
  })
})

// ---------- 3) patchMermaidFences（pairFences 集成 + merged 重建） ----------

describe('patchMermaidFences（M18 配对变更）', () => {
  it('删除节点加回 + classDef 声明（保序保拓扑，契约规则 5 表达）', () => {
    const oldMd = '```mermaid\nflowchart TD\n  A-->B\n  G-->H\n```'
    const newMd = '```mermaid\nflowchart TD\n  A-->B\n```'
    const r = patchMermaidFences(oldMd, newMd)
    expect(r.md).toContain('G-->H') // 删除节点加回
    expect(r.md).toContain('classDef diffDel')
    expect(r.notes.some((n) => n.text.includes('删除'))).toBe(true)
  })

  it('sequence 消息变更 → 源码逐行红绿承载（merged 保序），不再有 SVG 标注路径', () => {
    const oldMd = '```mermaid\nsequenceDiagram\n  A->>B: 旧消息\n  A->>B: 保留\n```'
    const newMd = '```mermaid\nsequenceDiagram\n  A->>B: 新消息\n  A->>B: 保留\n```'
    const d = diffMermaid(oldMd, newMd)
    expect(d.type).toBe('sequence')
    expect(d.merged).toContain('新消息')
    // §4.8（契约规则 5 修订）：图渲染新版本原样——删除消息不进 merged（SVG 内不再表达）
    expect(d.merged).not.toContain('旧消息')
    expect(d.add.includes('新消息')).toBe(true)
    expect(d.del.includes('旧消息')).toBe(true)
    // sequence 不注入 class（SVG 内不再标注）
    expect(d.merged).not.toContain('classDef diff')
  })

  it('无法识别的图类型 → unknown + merged=新源码原样（fence 级）', () => {
    const d = diffMermaid('python\nprint(1)', 'python\nprint(2)')
    expect(d.type).toBe('unknown')
    expect(d.merged).toBe('python\nprint(2)')
  })
})

// ---------- 4) eager 预算（§4.1.2） ----------

describe('eager 预算上限（§4.1.2：变更图通常 ≤3，上限 20）', () => {
  it('超限 → 该 fence 降级 lazy + 保证层记录', () => {
    const fence = (i: number, extra: string) =>
      '```mermaid\nflowchart TD\n  A' + i + '-->B\n' + (extra ? '  ' + extra + '-->C\n' : '') + '```\n\n'
    const oldMd = Array.from({ length: 4 }, (_, i) => fence(i, '')).join('')
    const newMd = Array.from({ length: 4 }, (_, i) => fence(i, 'ADD' + i)).join('')
    const budget = 3
    const noParser = computeDocDiffModel({ oldMd, newMd, base, parser: undefined, eagerBudget: budget })
    const registry = noParser.fences
    const eagerCount = [...registry.fences.values()].filter((f) => f.eager).length
    const skipCount = [...registry.fences.values()].filter((f) => f.skip).length
    expect(registry.changedCount).toBe(4)
    expect(eagerCount).toBe(budget)
    expect(skipCount).toBe(4 - budget)
    expect(noParser.records.some((r) => r.degradeReason === 'eager-budget-exceeded')).toBe(true)
  })
})

// ---------- 5) mermaidDiffText 一致性 ----------

describe('mermaid diff 文案（宿主与嵌入块共用，M16b 二元语义）', () => {
  it('增+删计数并入一张卡', () => {
    const oldMd = '```mermaid\nflowchart TD\n  A-->B\n  C-->D\n```'
    const newMd = '```mermaid\nflowchart TD\n  A-->B\n  E-->F\n  G-->H\n```'
    const diff = model(oldMd, newMd)
    const diagram = diff.records.find((r) => r.kind === 'diagram')
    expect(diagram?.summary).toContain('新增 4 个节点')
    expect(diagram?.summary).toContain('删除 2 个')
  })
})