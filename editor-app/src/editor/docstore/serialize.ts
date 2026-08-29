// ============================================================
// docstore/serialize.ts —— canonical md（spec §5.6）
// parse/serialize 由装配层注入（运行时从任一编辑器 ctx 取 parserCtx/serializerCtx；
// 测试用 tests/unit/helpers/parser.ts）。
// round-trip 稳定化收编自 ref/writeback 的历史修补（serializeBlockContent）：
//   canonical = serialize(parse(serialize(parse(md)))) —— 二次解析再序列化，
//   消除「块序列化值」与「源标签 replaceAll 后 round-trip 值」的末尾换行等差异，
//   使脏检测不再被 round-trip 差异误报（spec 附录 A：writeback round-trip → 本模块）。
// 纯函数模块：无 DOM、无 app 依赖。
// ============================================================
import type { Node } from '@milkdown/kit/prose/model'

export interface DocPipeline {
  parse(md: string): Node | null
  serialize(doc: Node): string
}

/** canonical md：round-trip 稳定化。解析失败降级返回原串（不阻塞下游）。 */
export function canonicalOf(p: DocPipeline, md: string): string {
  const doc = p.parse(md)
  if (!doc) return md
  const first = p.serialize(doc)
  const reparsed = p.parse(first)
  if (!reparsed) return first
  return p.serialize(reparsed)
}

/** 判断 md 是否为 stable（round-trip 不动点）——影子一致性断言用 */
export function isCanonicalStable(p: DocPipeline, md: string): boolean {
  return canonicalOf(p, md) === md
}