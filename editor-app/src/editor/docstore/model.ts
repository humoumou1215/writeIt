// ============================================================
// docstore/model.ts —— 运行态文档层：数据结构与不变式
// 对应 spec §5.1 / 附录 B（I1-I4）
// 纯数据模块：不 import 任何 app 模块（同 ref/registry 的 P0 承诺）。
// ============================================================
import type { Node } from '@milkdown/kit/prose/model'
import { contentHash } from '../../git/hash'

/** 嵌入范围：嵌入块内容 = 模型 doc 内 [from, to) 的子树（闭环到块边界） */
export interface EmbedRange {
  /** 嵌入目标：整文件或标题片段（沿用现有 ![[path#heading]] fragment 语义） */
  target: { kind: 'whole' } | { kind: 'heading'; fragment: string }
  /** 模型 doc 坐标（顶层块对齐） */
  from: number
  to: number
}

/** 顶层块（模型 doc 的顶层子节点 ≈ 逻辑块列） */
export interface BlockModel {
  /** 模型生命周期内稳定 ID。M1 影子模式：whole-content 记录下序号即身份；
   *  M3 steps 事务流落地后改为事务派生身份（spec §5.4.1——不落盘、不跨会话）。 */
  blockId: string
  kind: string
  /** 内容指纹（schema 无关：结构 JSON hash）；未变块跳过分发（性能闸门 §5.1） */
  fingerprint: string
  size: number
  textPreview: string
}

/** 订阅者（spec §5.2）。M1 影子模式：仅登记元数据，不分发。 */
export type SubscriptionKind =
  | { kind: 'doc'; tabId: string }
  | { kind: 'block'; tabId: string; blockId: string }
  | { kind: 'snapshot'; token: string; rev: number }

export interface Subscription {
  key: string
  source: SubscriptionKind
  /** 视图剩余基线 rev（落后 = 待刷新，I2） */
  rev: number
  /** 失步标记（I2：无静默滞后） */
  stale: boolean
}

export interface DocModel {
  readonly realPath: string
  /** 解析后的模型文档树；null = 解析失败（记录 degraded，不崩溃） */
  doc: Node | null
  blocks: BlockModel[]
  /** 内容版本；每次成功事务 +1（I2） */
  rev: number
  /** 最后一次磁盘对账成功时的 rev；rev > diskRev 即脏（I3） */
  diskRev: number
  /** 磁盘内容 hash（对账用） */
  diskHash: string | null
  /** 最近一次 record/apply 后的内容 hash（影子一致性断言基线） */
  lastHash: string
  subscribers: Map<string, Subscription>
}

export function makeSubscriptionKey(source: SubscriptionKind): string {
  switch (source.kind) {
    case 'doc':
      return `doc:${source.tabId}`
    case 'block':
      return `${source.tabId}#${source.blockId}`
    case 'snapshot':
      return `snap:${source.token}`
  }
}

const MAX_PREVIEW = 40

/** 摘要顶层块（模型 doc 顶层子节点） */
export function extractBlocks(doc: Node | null): BlockModel[] {
  if (!doc) return []
  const out: BlockModel[] = []
  let i = 0
  doc.content.forEach((n) => {
    i++
    const texts: string[] = []
    n.descendants((c) => {
      if (c.isText) {
        texts.push(c.text ?? '')
        return false
      }
      return true
    })
    out.push({
      blockId: `b${i}`,
      kind: n.type.name,
      fingerprint: blockFingerprint(n),
      size: n.nodeSize,
      textPreview: texts.join('').slice(0, MAX_PREVIEW),
    })
  })
  return out
}

/** 内容指纹：结构 JSON hash（同构文档同内容必同指纹；无需 schema） */
export function blockFingerprint(node: Node): string {
  return contentHash(JSON.stringify(node.toJSON()))
}

export function modelIsDirty(m: DocModel): boolean {
  return m.rev > m.diskRev
}

/** 模型内容 hash（诊断/基线用：doc 结构指纹）。
 *  注意：不与磁盘 hash 直接比较——磁盘指纹是 canonical md 文本 hash（store 侧统一），
 *  两者维度不同（doc JSON vs md 文本）。一致性断言（I3）见 store.modelIsConsistent。 */
export function docHash(doc: Node | null): string {
  return doc ? contentHash(JSON.stringify(doc.toJSON())) : contentHash('')
}