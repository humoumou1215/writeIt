// ============================================================
// unit: docstore/posmap —— 模型坐标 → 宿主块坐标 steps 映射（spec §5.4.3）
// 构造真实 PM steps：EditorState.create({doc}) → tr.insertText/deleteRange → tr.steps
// ============================================================
// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { EditorState } from '@milkdown/kit/prose/state'
import type { Node } from '@milkdown/kit/prose/model'
import { createTestParser } from '../helpers/parser'
import {
  mapStepToHost,
  mapStepsToHost,
  stepRawRange,
  collectBlockRanges,
  filterHostSteps,
  collectBlockSizes,
  mapDocStepsToModel,
  mapBlockStepToModel,
  mapBlockStepsToModel,
  type BlockContentRange,
} from '../../../src/editor/docstore/posmap'
import { ReplaceStep } from '@milkdown/kit/prose/transform'
import type { EmbedRange } from '../../../src/editor/docstore/model'

let parser: (md: string) => Node | null
let destroyParser: () => Promise<void>

beforeAll(async () => {
  const r = await createTestParser()
  parser = r.parser
  destroyParser = r.destroy
})
afterAll(async () => {
  await destroyParser?.()
})

const MD = '# 标题\n\n第一段内容 ABC\n\n第二段 XYZ\n\n末尾段\n'
const HOST_START = 1000 // 宿主 doc 中嵌入块内容起始（任意偏移）

function rangeWhole(doc: Node): EmbedRange {
  return { target: { kind: 'whole' }, from: 0, to: doc.content.size }
}

function stepsFrom(fn: (tr: ReturnType<EditorState['create']> extends never ? never : any['tr']) => void) {
  const doc = parser(MD)!
  const st = EditorState.create({ doc })
  const tr = st.tr
  fn(tr as never)
  return { steps: tr.steps, doc }
}

describe('docstore/posmap', () => {
  it('块内插入文本 → 偏移映射（主路径）', () => {
    const doc = parser(MD)!
    const st = EditorState.create({ doc })
    const tr = st.tr
    tr.insertText('X', 8) // 文内 pos 8
    const r = mapStepToHost(tr.steps[0], rangeWhole(doc), HOST_START)
    expect(r).not.toBeNull()
    expect(r!.from).toBe(8 + HOST_START)
    expect(r!.to).toBe(8 + HOST_START)
  })

  it('块内删除区间 → 偏移映射 with 长度差', () => {
    const doc = parser(MD)!
    const st = EditorState.create({ doc })
    const tr = st.tr
    // 删除「第一段内容 」中的「内容」(pos 8..10)
    tr.delete(8, 10)
    const r = mapStepToHost(tr.steps[0], rangeWhole(doc), HOST_START)
    expect(r).not.toBeNull()
    expect(r!.from).toBe(8 + HOST_START)
    expect(r!.to).toBe(10 + HOST_START)
  })

  it('范围外 step → null', () => {
    const doc = parser(MD)!
    // 嵌入范围只取中间的一段 [8, 12]
    const range: EmbedRange = { target: { kind: 'whole' }, from: 8, to: 12 }
    const st = EditorState.create({ doc })
    const tr = st.tr
    tr.insertText('ZZZ', 0) // pos 0 在范围外
    expect(mapStepToHost(tr.steps[0], range, HOST_START)).toBeNull()
  })

  it('跨界 step → null（M3 前已知简化，靠失步兜底）', () => {
    const doc = parser(MD)!
    const range: EmbedRange = { target: { kind: 'heading', fragment: '标题' }, from: 4, to: 12 }
    const st = EditorState.create({ doc })
    const tr = st.tr
    tr.delete(0, 10) // 从标题前删到范围内部 → 跨界
    expect(mapStepToHost(tr.steps[0], range, HOST_START)).toBeNull()
  })

  it('批量映射：混入范围外 step 不影响块内 step', () => {
    const doc = parser(MD)!
    const st = EditorState.create({ doc })
    const tr = st.tr
    tr.insertText('OUT', 0)
    tr.insertText('IN', 8)
    const { steps, stats } = mapStepsToHost(tr.steps, rangeWhole(doc), HOST_START)
    expect(stats.ok).toBe(1) // 只有 pos 8 的命中
    expect(stats.outside).toBe(1)
    expect(steps.length).toBe(1)
    expect(steps[0].from).toBe(8 + HOST_START)
  })

  it('stepRawRange：未知类型 step 返回 null（已知类型可读 from/to）', () => {
    const doc = parser(MD)!
    const st = EditorState.create({ doc })
    const tr = st.tr
    tr.insertText('Q', 8)
    const r = stepRawRange(tr.steps[0])
    expect(r).toEqual([8, 8])
  })

  // ---------- M2：拦截器过滤（filterHostSteps / collectBlockRanges） ----------

  const MD_BLOCKS =
    '# 标题\n\n正文前半段\n\n![[A]]\n\n![[B|ro]]\n\n正文后半段\n'

  function buildTr(md: string) {
    const doc = parser(md)!
    const st = EditorState.create({ doc })
    return { st, doc }
  }

  it('collectBlockRanges：收集 file_block 区域（含容器）', () => {
    const { doc } = buildTr(MD_BLOCKS)
    const ranges = collectBlockRanges(doc)
    expect(ranges.length).toBe(2)
    for (const r of ranges) {
      const n = doc.nodeAt(r.from)!
      expect(n.type.name).toBe('file_block')
      expect(r.to - r.from).toBe(n.nodeSize)
    }
  })

  it('filterHostSteps：块内插入被剔除，块外保留', () => {
    const { st, doc } = buildTr(MD_BLOCKS)
    const ranges = collectBlockRanges(doc)
    // 块内 pos（第一个 file_block 容器内部）
    const inside = ranges[0].from + 2
    const trIn = st.tr
    trIn.insertText('X', inside)
    const filteredIn = filterHostSteps(trIn.steps, ranges)
    expect(filteredIn.length).toBe(0)
    // 块外 pos（正文中段）
    const trOut = st.tr
    trOut.insertText('Y', 2)
    const filteredOut = filterHostSteps(trOut.steps, ranges)
    expect(filteredOut.length).toBe(1)
  })

  it('filterHostSteps：无块区域时全部保留', () => {
    const { st } = buildTr('# 纯文档\n\n正文\n')
    const tr = st.tr
    tr.insertText('Z', 5)
    expect(filterHostSteps(tr.steps, []).length).toBe(1)
  })

  // ---------- M2：doc 级消膨胀映射（mapDocStepsToModel） ----------

  it('mapDocStepsToModel：膨胀补偿公式（每个块的膨胀量按位置累计扣除）', () => {
    const { st } = buildTr('# 简单文档\n\n正文文本\n')
    // 人造：两个物化块（膨胀 14-4=10、7-4=3）
    const hostBlocks = [
      { from: 11, nodeSize: 14 },
      { from: 15, nodeSize: 7 },
    ]
    const modelBlocks = [
      { from: 11, nodeSize: 4 },
      { from: 15, nodeSize: 4 },
    ]
    const modelDocSize = 30
    // 宿主坐标 30（模型 doc 大小处·块外）→ 模型坐标 = 30 - (10+3) = 17
    const slice = st.tr.doc.slice(0, 1)
    const step = new ReplaceStep(30, 31, slice)
    const { steps, misses } = mapDocStepsToModel([step], hostBlocks, modelBlocks, modelDocSize)
    expect(misses).toBe(0)
    expect(steps.length).toBe(1)
    expect((steps[0] as ReplaceStep).from).toBe(17)
    expect((steps[0] as ReplaceStep).to).toBe(18)
  })

  it('mapDocStepsToModel：无膨胀时坐标不变（host == model 尺寸）', () => {
    const { st, doc } = buildTr(MD_BLOCKS)
    const blocks = collectBlockSizes(doc)
    const end = doc.content.size - 1
    const tr = st.tr
    tr.insertText('末', end)
    const { steps, misses } = mapDocStepsToModel(tr.steps, blocks, blocks, doc.content.size)
    expect(misses).toBe(0)
    const r = steps[0] as ReplaceStep
    expect(r.from).toBe(end)
  })

  it('mapDocStepsToModel：块内编辑被剔除（旧路处理），不产出模型 step', () => {
    const { st, doc } = buildTr(MD_BLOCKS)
    const hostBlocks = collectBlockSizes(doc)
    const modelBlocks = hostBlocks.map((b) => ({ from: b.from, nodeSize: 2 }))
    const inside = hostBlocks[0].from + 1
    const tr = st.tr
    tr.insertText('内', inside)
    const { steps, misses } = mapDocStepsToModel(tr.steps, hostBlocks, modelBlocks)
    expect(steps.length).toBe(0)
    expect(misses).toBe(0)
  })

  it('mapDocStepsToModel：替换范围含 file_block 结构（跨界）→ 丢弃 + miss 记账', () => {
    const { doc } = buildTr(MD_BLOCKS)
    const blocks = collectBlockSizes(doc)
    // 替换「两个完整文件块区域」→ slice 顶层直接含 file_block 结构
    const b0 = blocks[0]
    const b1 = blocks[1]
    const replaceTo = b1.from + b1.nodeSize + 1
    const slice = doc.slice(b0.from, replaceTo)
    const step = new ReplaceStep(b0.from, replaceTo, slice)
    const { steps, misses } = mapDocStepsToModel([step], blocks, blocks, doc.content.size)
    expect(steps.length).toBe(0)
    expect(misses).toBe(1)
  })

  // ---------- M3a：宿主块内编辑 → 源模型坐标 ----------

  it('mapBlockStepToModel：块内插入 → 源模型坐标（偏移 = modelFrom - contentFrom）', () => {
    const { st } = buildTr('# 正文\n\n这一段内容足够长可以容纳块内容区间的坐标测试用例\n')
    // 宿主块内容区 [10, 20)，对应模型 [2, 12)（Model offset：modelFrom 小于 contentFrom 也可）
    const range: BlockContentRange = { contentFrom: 10, contentTo: 20, modelFrom: 2, modelTo: 12 }
    const tr = st.tr
    tr.insertText('X', 12) // 宿主块内容坐标内
    const m = mapBlockStepToModel(tr.steps[0], range)
    expect(m).not.toBeNull()
    expect(m!.from).toBe(12 - 8) // 12 + (2-10)
    expect(m!.to).toBe(12 - 8)
  })

  it('mapBlockStepToModel：块外步骤 → null；跨界 → null', () => {
    const { st } = buildTr('# 正文\n\n这一段内容足够长可以容纳块内容区间的坐标测试用例\n')
    const range: BlockContentRange = { contentFrom: 10, contentTo: 20, modelFrom: 2, modelTo: 12 }
    const tr = st.tr
    tr.insertText('OUT', 2)
    expect(mapBlockStepToModel(tr.steps[0], range)).toBeNull()
    const tr2 = st.tr
    tr2.delete(9, 12) // 跨界（从块外 9 到块内 12）
    expect(mapBlockStepToModel(tr2.steps[0], range)).toBeNull()
  })

  it('mapBlockStepsToModel：混批过滤（块内保留、块外剔除）', () => {
    const { st } = buildTr('# 正文\n\n这一段内容足够长可以容纳块内容区间的坐标测试用例\n')
    const range: BlockContentRange = { contentFrom: 10, contentTo: 20, modelFrom: 2, modelTo: 12 }
    const tr = st.tr
    tr.insertText('IN', 12)
    tr.insertText('EX', 2)
    const { steps, stats } = mapBlockStepsToModel(tr.steps, range)
    expect(steps.length).toBe(1)
    expect(stats.ok).toBe(1)
    expect(stats.outside).toBe(1)
    expect(steps[0].from).toBe(4)
  })
})