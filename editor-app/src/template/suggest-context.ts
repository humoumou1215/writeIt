// SuggestContext 实现：把目标文件（已用编辑器 parser 解析的 doc）包装为
// suggest.ts 对象 resolve(ctx) 可用的结构查询上下文（设计文档 §4.2）
import type { Node } from '@milkdown/kit/prose/model'
import type { SuggestContext } from './types'

export function createSuggestContext(doc: Node): SuggestContext {
  const paragraphs: string[] = []
  const headings: Record<number, string[]> = {}
  // 标题后紧跟的段落：headingIndex → 下一段文本
  const afterHeading: Array<{ level: number; heading: string; next: string | null }> = []

  let pendingHeading: { level: number; heading: string } | null = null
  doc.descendants((node) => {
    if (node.type.name === 'paragraph') {
      const t = node.textContent.trim()
      if (t) {
        paragraphs.push(t)
        if (pendingHeading) {
          afterHeading.push({ ...pendingHeading, next: t })
          pendingHeading = null
        }
      }
    } else if (node.type.name === 'heading') {
      const lvl = node.attrs.level as number
      const h = node.textContent.trim()
      ;(headings[lvl] ??= []).push(h)
      if (h) pendingHeading = { level: lvl, heading: h }
      else pendingHeading = null
    }
    return true
  })

  return {
    findText(re) {
      const hit = paragraphs.find((p) => re.test(p))
      return hit ? [hit] : null
    },
    headingText(level, re) {
      const list = headings[level] ?? []
      const hit = list.find((h) => re.test(h))
      return hit ?? null
    },
    paragraphAfterHeading(level, re) {
      const hit = afterHeading.find(
        (x) => x.level === level && re.test(x.heading) && x.next !== null
      )
      return hit?.next ?? null
    },
  }
}
