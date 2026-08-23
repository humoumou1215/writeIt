// 多层块嵌入链判定（编辑视图 × Git Diff 共用，embed-nesting-governance.md 3.1）
// 无 DOM 无 IO 纯函数，两视图共享同一实现——双视图语义唯一来源。
//
// 语义：
//  - 深度 = 嵌入链深度（宿主正文里的 ![[B]] 是第 1 层、B 里的 ![[C]] 是第 2 层…），
//    与 doc 结构深度（列表/引用/表格嵌套）解耦（治理文档 N3）。
//  - 环 = 路径在自身祖先链（含宿主文件）中再次出现（realPath 经 chainKey 规范化后精确比较）。
//    兄弟重复 / 菱形引用不是环（治理文档 G3：环检测 × 全局源去重是两个概念）。
//  - 判定顺序（互斥，短路）：断链（读失败，由调用方先行判定）→ 环 → 超深。

/** 支持渲染的最大嵌入链层数（用户裁决：第 11 层起折叠） */
export const MAX_EMBED_DEPTH = 10

/** 折叠原因（CollapsedInfo.reason） */
export type CollapseReason = 'cycle' | 'depth'

/** 折叠信息（运行时 attrs 载体；md 序列化不输出 → round-trip 无损） */
export type CollapsedInfo = {
  reason: CollapseReason
  /** 展示链路：宿主 › 各级父嵌入块 › 本块（realPath 序列，含结尾的本块自身） */
  chain: string[]
}

export type ChainVerdict =
  | { kind: 'ok' }
  | { kind: 'cycle'; hit: string }
  | { kind: 'too-deep'; limit: number }

/**
 * 链比较键：realPath 的规范比较形式。
 * 判定基于「精确相等」（严禁 endsWith/includes 前缀匹配——M16 路径匹配事故教训：
 * 数据/需求 与 数据/需求表 是两个文件）；键统一斜杠并小写折叠，对齐大小写不敏感
 * 文件系统（macOS 默认：A.md 与 a.md 是同一文件——直接字符串比较会把文件系统的
 * 同一性判断错）。展示路径保留原始大小写。
 */
export function chainKey(realPath: string): string {
  return realPath.replace(/\\/g, '/').toLowerCase()
}

/**
 * ancestors：宿主文件 realPath 在前，其后为各级父嵌入块 realPath
 * （长度 = 父块链深 + 1；第 1 层块 ancestors = [宿主]，长度 1）——不含本块自身。
 * 第 11 层块的 ancestors 长度 = 11 → depth 10 >= MAX → 折叠。
 */
export function classifyEmbed(ancestors: string[], realPath: string): ChainVerdict {
  const self = chainKey(realPath)
  // 环：无论深度，先判（A 嵌 A 哪怕只有 1 层，也是环）
  const hit = ancestors.find((a) => chainKey(a) === self)
  if (hit !== undefined) return { kind: 'cycle', hit }
  // 超深：当前块层数 = ancestors.length - 1；达到 MAX_EMBED_DEPTH 即第 MAX_EMBED_DEPTH+1 层
  const depth = ancestors.length - 1
  if (depth >= MAX_EMBED_DEPTH) return { kind: 'too-deep', limit: MAX_EMBED_DEPTH }
  return { kind: 'ok' }
}

/** 折叠链路（CollapsedInfo.chain：宿主 › 各级父 › 本块 realPath） */
export function buildCollapseChain(ancestors: string[], selfReal: string): string[] {
  return [...ancestors, selfReal]
}

/** 折叠原因 → 保证层卡片文案（diff 侧 record / 编辑侧提示卡共用） */
export function collapseSummary(verdict: ChainVerdict & { kind: 'cycle' | 'too-deep' }, path: string): string {
  if (verdict.kind === 'cycle') return `循环引用：[[${path}]] 已在上级层级出现，已折叠`
  return `嵌套层级超过 ${MAX_EMBED_DEPTH} 层，已折叠`
}

/** 链路展示文本（提示卡副行：宿主 › … › 当前） */
export function chainLabel(ancestors: string[], leaf: string): string {
  const short = (p: string) => {
    const name = p.split('/').pop() || p
    return name.length > 18 ? name.slice(0, 17) + '…' : name
  }
  return buildCollapseChain(ancestors, leaf).map(short).join(' › ')
}