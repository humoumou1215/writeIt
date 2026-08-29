// ============================================================
// docstore/posmap.ts —— 模型坐标 → 宿主嵌入块坐标 的 steps 映射
// （spec §5.4.3：宿主块内容 = 模型 EmbedRange 子树，同一 schema，映射是纯偏移量）
// 纯函数模块。M1 落地核心数学 + 单测；M3 起由分发循环消费。
//
// 边界声明（M3 前已知简化，见 §11 R1）：
//   · 支持 step 语义：ReplaceStep / AddMarkStep / RemoveMarkStep（编辑高频三类）
//   · step 完全落在 [range.from, range.to] 内 → 偏移映射（主路径）
//   · step 完全在范围外 → null（宿主不需要，内容在嵌入块之外）
//   · 跨界/未知类型 → null + 记录 degMiss（M3 需补 ReplaceAroundStep/跨界裁剪，
//     或等价地用「失步 + 对齐」显式恢复，spec §6.1 失步路径兜底）
// ============================================================
import {
  AddMarkStep,
  RemoveMarkStep,
  ReplaceStep,
  type Step,
} from '@milkdown/kit/prose/transform'
import type { Node } from '@milkdown/kit/prose/model'
import { contentHash } from '../../git/hash'
import type { EmbedRange } from './model'

/** file_block 区域：块内容区间 [from, to]，含容器本身（pos, pos+nodeSize） */
export interface BlockRange {
  from: number
  to: number
}

/** 收集 doc 中所有 file_block 区间（拦截器/过滤用；纯函数已可单测） */
export function collectBlockRanges(doc: Node): BlockRange[] {
  const out: BlockRange[] = []
  doc.descendants((n, p) => {
    if (n.type.name === 'file_block') {
      out.push({ from: p, to: p + n.nodeSize })
    }
    return true
  })
  return out
}

/**
 * 过滤宿主事务步骤：把「落在 file_block 区域内的编辑」剔除（M2 混合规则）。
 * 块内编辑不提交宿主模型——模型 doc 的 file_block 是未物化 marker（区域=2 节点），
 * 块内容由 propagateBlockEdits 序列化旧路单独处理；块外正文编辑才即时提交模型。
 * 语义：完全落在某个块区间内 → 剔除；跨界（含块边界的结构操作）→ 保留（保守，
 * 避免丢整块粘贴/剪切等编辑；混合期模型稍后由保存/广播快照对齐）。
 */
export function filterHostSteps(steps: Step[], ranges: BlockRange[]): Step[] {
  if (ranges.length === 0) return [...steps]
  const out: Step[] = []
  for (const s of steps) {
    const raw = stepRawRange(s)
    if (!raw) {
      out.push(s)
      continue
    }
    const [from, to] = raw
    const whollyInside = ranges.some((r) => from >= r.from && to <= r.to)
    if (!whollyInside) out.push(s)
  }
  return out
}

export interface HostStep {
  step: Step
  from: number
  to: number
}

/** 一次映射的统计（诊断/单测）：失败计数分类 */
export interface MapStats {
  ok: number
  outside: number
  skipped: number
}

/** 步骤原始影响区间；未知类型返回 null */
export function stepRawRange(s: Step): [number, number] | null {
  if (s instanceof ReplaceStep) return [s.from, s.to]
  if (s instanceof AddMarkStep || s instanceof RemoveMarkStep) return [s.from, s.to]
  return null
}

/** 单步骤映射（见文件头边界声明）。hostStart = 宿主 doc 中嵌入块内容起始 pos。 */
export function mapStepToHost(
  step: Step,
  range: EmbedRange,
  hostStart: number
): HostStep | null {
  const raw = stepRawRange(step)
  if (!raw) return null
  const [from, to] = raw
  // 完全在范围外 → 跳过
  if (from >= range.to || to <= range.from) return null
  // 跨界 → 跳过（M3 补充；当前依赖失步兜底）
  if (from < range.from || to > range.to) return null
  const delta = hostStart - range.from
  const hostFrom = from + delta
  const hostTo = to + delta
  // 重建 step（改坐标系；slice/mark 同 schema 可直接复用）
  const rebuilt = rebuildStepAt(step, hostFrom, hostTo)
  return rebuilt ? { step: rebuilt, from: hostFrom, to: hostTo } : null
}

/** 重建坐标的步骤（Replace/AddMark/RemoveMark；未知类型 null） */
function rebuildStepAt(step: Step, from: number, to: number): Step | null {
  if (step instanceof ReplaceStep) return new ReplaceStep(from, to, step.slice)
  if (step instanceof AddMarkStep) return new AddMarkStep(from, to, step.mark)
  if (step instanceof RemoveMarkStep) return new RemoveMarkStep(from, to, step.mark)
  return null
}

/** 批量映射（保持顺序；跳过 step 不打断语义——失步检测负责完整性兜底） */
export function mapStepsToHost(
  steps: Step[],
  range: EmbedRange,
  hostStart: number
): { steps: HostStep[]; stats: MapStats } {
  const out: HostStep[] = []
  const stats: MapStats = { ok: 0, outside: 0, skipped: 0 }
  for (const s of steps) {
    const raw = stepRawRange(s)
    if (!raw) {
      stats.skipped++
      continue
    }
    const [from, to] = raw
    if (from >= range.to || to <= range.from) {
      stats.outside++
      continue
    }
    const mapped = mapStepToHost(s, range, hostStart)
    if (!mapped) {
      stats.skipped++
      continue
    }
    out.push(mapped)
    stats.ok++
  }
  return { steps: out, stats }
}

/** 诊断：映射失败指纹（跨界/未知类型计数 hash，供 inspect 观测回归） */
export function mapStatsHash(stats: MapStats): string {
  return contentHash(`posmap|${stats.ok}|${stats.outside}|${stats.skipped}`)
}

// ---------- M3a：宿主块内编辑 → 源模型坐标（与 mapStepToHost 对称的逆方向） ----------
// 宿主 doc 的块内容 = 源模型 EmbedRange 的子树（同一 md 解析、同构）。
// 块内步骤坐标 → 源模型坐标：相对偏移 + EmbedRange.from。
// 边界语义（M3a 保守）：
//   · 步骤完全在块内容内 → 映射（主路径）
//   · 步骤完全在块外 → null（不属于本块）
//   · 跨界（含块边界外）→ null + conservative（外层调用方决定 stale/旧路）

export interface BlockContentRange {
  /** 宿主 doc 中嵌入块内容区 [contentFrom, contentTo)（不含容器边界） */
  contentFrom: number
  contentTo: number
  /** 模型 doc 中对应嵌入范围 [from, to) */
  modelFrom: number
  modelTo: number
}

/** 单步映射：宿主块内容坐标 → 模型 doc 坐标（仅 Replace/AddMark/RemoveMark） */
export function mapBlockStepToModel(
  step: Step,
  range: BlockContentRange
): HostStep | null {
  const raw = stepRawRange(step)
  if (!raw) return null
  const [f, t] = raw
  // 完全在块外 → null（内容末尾位置 contentTo 是合法插入点：用 > 而非 >=）
  if (f > range.contentTo || t < range.contentFrom) return null
  // 跨界（超出块内容边界）→ 保守 null
  if (f < range.contentFrom || t > range.contentTo) return null
  const delta = range.modelFrom - range.contentFrom
  const mf = f + delta
  const mt = t + delta
  if (mf < range.modelFrom || mt > range.modelTo) return null
  const rebuilt = rebuildStepAt(step, mf, mt)
  return rebuilt ? { step: rebuilt, from: mf, to: mt } : null
}

/** 批量映射（顺序保持；返回映射后 steps + 统计） */
export function mapBlockStepsToModel(
  steps: Step[],
  range: BlockContentRange
): { steps: HostStep[]; stats: MapStats } {
  const out: HostStep[] = []
  const stats: MapStats = { ok: 0, outside: 0, skipped: 0 }
  for (const s of steps) {
    const raw = stepRawRange(s)
    if (!raw) {
      stats.skipped++
      continue
    }
    const [f, t] = raw
    if (f > range.contentTo || t < range.contentFrom) {
      stats.outside++
      continue
    }
    const m = mapBlockStepToModel(s, range)
    if (!m) {
      stats.skipped++
      continue
    }
    out.push(m)
    stats.ok++
  }
  return { steps: out, stats }
}

// ---------- M2：doc 级消膨胀映射（宿主 doc → 模型 doc 坐标） ----------
// 宿主 doc 的 file_block 已物化（内容大），模型 doc 的是未物化 marker（小容器）——
// 两块之间的坐标整体错位，按块逐段补偿。每块：模型坐标 = 宿主坐标 - 该块膨胀量。
// 宿主与模型块列表可能数量不同（模型按 canonical 解析，marker 一一对应宿主已物化块
// 或折叠块/断链块——数量应一致；不一致时按宿主为准并逐块取模型对应尺寸）。

export interface BlockSize {
  from: number
  nodeSize: number
}

/** 收集 doc 顶层 file_block 的 (from, nodeSize) 列表（尺寸版）。
 *  只收顶层：物化内容里的嵌套 file_block 是「宿主块内容的一部分」，不参与膨胀补偿
 *  （膨胀配对只针对 marker↔顶层块）。 */
export function collectBlockSizes(doc: Node | null): BlockSize[] {
  if (!doc) return []
  const out: BlockSize[] = []
  doc.content.forEach((n, off) => {
    if (n.type.name === 'file_block') out.push({ from: off, nodeSize: n.nodeSize })
  })
  return out
}

/**
 * 把宿主 doc 上的 steps 映射到模型 doc 坐标（可重建步骤类型：Replace/AddMark/RemoveMark）。
 *  - 完全落在宿主某块内 → 剔除（M2 块内编辑由旧路序列化处理）
 *  - 跨界（含块边界/包含块结构）→ 丢弃 + misses++（保守：绝不把块内容写进模型）
 *  - 位置在模型 doc 范围外 → 丢弃 + misses++（失步信号，记录后可对齐）
 * 每次映射前宿主块区间描述「该 step 应用时」的文档（拦截器用 dispatch 前旧 doc）。
 */
export function mapDocStepsToModel(
  steps: Step[],
  hostBlocks: BlockSize[],
  modelBlocks: BlockSize[],
  modelDocSize?: number
): { steps: Step[]; misses: number } {
  const out: Step[] = []
  let misses = 0
  if (hostBlocks.length === 0) return { steps: [...steps], misses: 0 }
  // 宿主与模型块按位置序配对（同一份 md 解析，块排列一致，仅物化尺寸不同）：
  //   膨胀量(逐块) = host.nodeSize - model.nodeSize；模型缺失（数量错配）时按 marker 最小尺寸 4
  const pairs: Array<{ host: BlockSize; model?: BlockSize }> = hostBlocks.map((hb, i) => ({
    host: hb,
    model: modelBlocks[i],
  }))
  // 模型坐标 = 宿主坐标 - shift(pos)；shift = pos 之前所有块膨胀量累计
  const shiftAt = (pos: number): number => {
    let shift = 0
    for (const { host, model } of pairs) {
      if (host.from >= pos) break
      shift += host.nodeSize - (model ? model.nodeSize : 4)
    }
    return shift
  }
  const modelSize =
    modelDocSize ??
    (modelBlocks.length
      ? modelBlocks[modelBlocks.length - 1].from + modelBlocks[modelBlocks.length - 1].nodeSize
      : 0)
  for (const s of steps) {
    const raw = stepRawRange(s)
    if (!raw) {
      misses++
      continue
    }
    const [f, t] = raw
    const whollyInside = hostBlocks.some((b) => f >= b.from && t <= b.from + b.nodeSize)
    if (whollyInside) continue
    const sliceHasBlock =
      s instanceof ReplaceStep &&
      (() => {
        let has = false
        s.slice.content.forEach((n) => {
          // descendants 不访问节点自身——先查顶层节点本身
          if (n.type.name === 'file_block') has = true
          else
            n.descendants((c) => {
              if (c.type.name === 'file_block') {
                has = true
                return false
              }
              return true
            })
        })
        return has
      })()
    if (sliceHasBlock) {
      misses++
      continue
    }
    const mf = f - shiftAt(f)
    const mt = t - shiftAt(t)
    if (mf < 0 || mt < mf || mf > modelSize + 1) {
      misses++
      continue
    }
    // 重建 step（改坐标系；slice/mark 在同一 schema（模型 doc 与宿主同构））
    if (s instanceof ReplaceStep) {
      out.push(new ReplaceStep(mf, mt, s.slice))
    } else if (s instanceof AddMarkStep) {
      out.push(new AddMarkStep(mf, mt, s.mark))
    } else if (s instanceof RemoveMarkStep) {
      out.push(new RemoveMarkStep(mf, mt, s.mark))
    } else {
      misses++
    }
  }
  return { steps: out, misses }
}