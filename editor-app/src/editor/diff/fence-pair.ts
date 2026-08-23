// M18 §4.2：mermaid 栅栏配对纯函数（结构配对主路径的 md 行级加权配对 fallback）
// 无 DOM 无 IO；「两张同内容图」「中途插图」两组用例入 fixture。
import { contentHash } from '../../git/hash'

/** 归一化 fence body（两侧一致：NodeView data-fence-id 与 registry key 同源） */
export function normalizeFenceBody(body: string): string {
  return body.replace(/\s+$/, '').trimEnd()
}

/** 栅栏身份（内容派生）：同一 body → 同一 fenceId（重复/未变更栅栏共享，不重复 eager） */
export function fenceIdOf(body: string): string {
  return `fence-${contentHash(normalizeFenceBody(body))}`
}

/**
 * 两条 body 的包含相似度（0..1）：|inter| / min(|A|,|B|)。
 * 比 Jaccard 更能区分「同图改了部分节点」（旧 token 大多保留 → 高值）与
 * 「同位完全不同的图」（旧 token 保留少 → 低值），配合位置项一起用于配对阈值。
 */
export function bodySimilarity(a: string, b: string): number {
  const ta = new Set(normalizeFenceBody(a).split(/[^A-Za-z0-9_\u4e00-\u9fa5]+/).filter(Boolean))
  const tb = new Set(normalizeFenceBody(b).split(/[^A-Za-z0-9_\u4e00-\u9fa5]+/).filter(Boolean))
  if (!ta.size && !tb.size) return 1
  if (!ta.size || !tb.size) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return inter / Math.min(ta.size, tb.size)
}

export interface FencePair {
  /** 新 md 中的栅栏下标 */
  newIdx: number
  /** 旧 md 中的栅栏下标；null = 该栅栏为全新增（不产 diagram 标注，块级新增表达） */
  oldIdx: number | null
}

/**
 * 新旧 mermaid 栅栏配对（§4.2 fallback）：评分 = 0.7·相似度 + 0.3·(1/(1+|Δidx|))；
 * 未达阈值（0.6）＝新增；未被匹配的旧 = 删除（整段删除的 fence）。
 * 免疫「fence 前插入一段文字导致的下标漂移」与「中途插图」（新图配到旧图时相似度低 → 判新增）。
 * 阈值取 0.6：同位弱相似（如 X-->Y vs C-->D，s≈0.53）不得仅凭位置配对；
 * 同图改标签（s≈0.77）与同内容移位（s≈0.85）正常配对。
 */
export function pairFences(oldBodies: string[], newBodies: string[]): FencePair[] {
  const out: FencePair[] = []
  const usedOld = new Set<number>()
  for (let j = 0; j < newBodies.length; j++) {
    let best: number | null = null
    let bestScore = 0
    for (let i = 0; i < oldBodies.length; i++) {
      if (usedOld.has(i)) continue
      const sim = bodySimilarity(oldBodies[i], newBodies[j])
      const idxPenalty = 0.15 / (1 + Math.abs(i - j))
      const score = 0.85 * sim + idxPenalty
      if (score > bestScore) {
        bestScore = score
        best = i
      }
    }
    if (best !== null && bestScore > 0.6) {
      usedOld.add(best)
      out.push({ newIdx: j, oldIdx: best })
    } else {
      out.push({ newIdx: j, oldIdx: null })
    }
  }
  return out
}