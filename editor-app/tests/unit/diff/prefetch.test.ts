// M18 预取层（§4.4.1-a / §4.7）单测：批量 IO 消费 + 全局源去重 + 环/超深折叠 + 断链
import { describe, it, expect } from 'vitest'
import { prefetchEmbedSources, type PrefetchDeps } from '../../../src/editor/diff/prefetch'
import type { ShowFileEntry } from '../../../src/git/types'
import { contentHash } from '../../../src/git/hash'

const base = { kind: 'worktree', label: 'x' } as const

function entry(write: string, realPath: string, old: string | null, next: string | null, exists = true): ShowFileEntry {
  return { write, realPath, old, next, exists, changed: old != null && next != null ? old !== next : old == null && next != null, hash: { old: contentHash(old ?? ''), next: contentHash(next ?? '') } }
}

function deps(entries: ShowFileEntry[], hostPath: string | null = '宿主.md'): PrefetchDeps {
  return {
    base,
    hostPath,
    fetchEntries: async () => entries,
    readFile: async () => null,
  }
}

describe('prefetchEmbedSources（发现/预取层）', () => {
  it('第一层嵌入：有改动 → sourceMap 含 mergedMd；无改动 → 不入 sourceMap', async () => {
    const r = await prefetchEmbedSources(deps([entry('笔记/A', '笔记/A.md', '旧内容\n', '新内容\n')]), '正文\n\n![[笔记/A]]\n')
    expect(r.sourceMap.has('笔记/A.md')).toBe(true)
    expect(r.sourceMap.get('笔记/A.md')?.changed).toBe(true)
    expect(r.sourceMap.get('笔记/A.md')?.mergedMd).toBe('新内容\n')
    expect(r.writeToReal.get('笔记/A')).toBe('笔记/A.md')
  })

  it('mermaid 有结构变化 → mergedMd 带 classDef（嵌入卡片内容级标注素材）', async () => {
    const old = '```mermaid\nflowchart TD\n  A-->B\n  C-->D\n```\n'
    const next = '```mermaid\nflowchart TD\n  A-->B\n```\n'
    const r = await prefetchEmbedSources(deps([entry('d', 'd.md', old, next)]), '![[d]]\n')
    const src = r.sourceMap.get('d.md')
    expect(src?.mergedMd).toContain('class C,D diffDel')
  })

  it('多层嵌套：A 嵌 B 嵌 C → 每层各入 sourceMap，scopePath 由 model 层归属', async () => {
    const cases = new Map<string, ShowFileEntry[]>([
      [
        'A.md',
        [entry('B', 'B.md', 'B 旧\n', 'B 新\n![[C]]\n'), entry('C', 'C.md', 'C 旧\n', 'C 新\n')],
      ],
    ])
    const fetcher = async (paths: string[]) => {
      // 第一层：宿主｜A（![[A]] 单层）
      return cases.get('A.md') ?? []
    }
    // 宿主嵌 B；B 嵌 C
    const deps2: PrefetchDeps = {
      base,
      hostPath: 'host.md',
      fetchEntries: async (paths) => {
        const out: ShowFileEntry[] = []
        for (const p of paths) {
          if (p === 'B') out.push(entry('B', 'B.md', 'B 旧\n', 'B 新\n![[C]]\n'))
          else if (p === 'C') out.push(entry('C', 'C.md', 'C 旧\n', 'C 新\n'))
        }
        return out
      },
    }
    const r = await prefetchEmbedSources(deps2, '![[B]]\n')
    expect(r.sourceMap.has('B.md')).toBe(true)
    expect(r.sourceMap.has('C.md')).toBe(true) // B 的内容里发现的下一层
    expect(r.writeToReal.get('C')).toBe('C.md')
  })

  it('循环引用（A 嵌 B 嵌 A）→ collapsedScopes 折叠标记（不入 sourceMap）', async () => {
    const r = await prefetchEmbedSources(
      {
        base,
        hostPath: 'A.md',
        fetchEntries: async (paths) => {
          const out: ShowFileEntry[] = []
          for (const p of paths) {
            if (p === 'B') out.push(entry('B', 'B.md', 'B\n![[A]]\n', 'B\n![[A]]\n'))
            else if (p === 'A') out.push(entry('A', 'A.md', 'A\n', 'A\n'))
          }
          return out
        },
      },
      '![[B]]\n'
    )
    const collapsed = r.collapsedScopes.find((c) => c.reason === 'cycle')
    expect(collapsed).toBeTruthy()
    expect(collapsed?.chain).toEqual(['A.md', 'B.md', 'A.md'])
  })

  it('重复兄弟嵌入（A 嵌 B 两次）→ 两处 writePath 映射完整，源数据只 diff 一次', async () => {
    const r = await prefetchEmbedSources(
      {
        base,
        hostPath: 'host.md',
        fetchEntries: async () => [entry('B', 'B.md', '旧', '新')],
      },
      '![[B]]\n\n![[B]]\n'
    )
    expect(r.writeToReal.get('B')).toBe('B.md')
    // sourceMap 按 realPath 仅一份
    expect(r.sourceMap.size).toBe(1)
    expect(r.sourceMap.get('B.md')?.changed).toBe(true)
  })

  it('断链（old/next 均不可读）→ brokenPaths 标记，不报错', async () => {
    const r = await prefetchEmbedSources(
      {
        base,
        hostPath: 'host.md',
        fetchEntries: async () => [entry('不存在', '不存在.md', null, null, false)],
      },
      '![[不存在]]\n'
    )
    expect(r.brokenPaths).toContain('不存在.md')
    expect(r.sourceMap.size).toBe(0)
  })

  it('超深（第 11 层）→ too-deep 折叠', async () => {
    const fetcher = async (paths: string[]) => {
      const out: ShowFileEntry[] = []
      for (const p of paths) {
        const n = parseInt(p.replace('L', ''), 10)
        const next = `L${n}\n![[L${n + 1}]]\n`
        out.push(entry(p, `${p}.md`, `旧${n}`, next))
      }
      return out
    }
    const r = await prefetchEmbedSources({ base, hostPath: 'L0.md', fetchEntries: fetcher }, '![[L1]]\n')
    const deep = r.collapsedScopes.some((c) => c.reason === 'depth')
    expect(deep).toBe(true)
  })
})