// ============================================================
// unit: docstore/serialize —— canonical md（spec §5.6）
// 纯函数 + 最小 milkdown parser/serializer（shared helper）
// ============================================================
// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestParser } from '../helpers/parser'
import { canonicalOf, isCanonicalStable } from '../../../src/editor/docstore/serialize'
import type { DocPipeline } from '../../../src/editor/docstore/serialize'

let p: DocPipeline
let destroyParser: () => Promise<void>

beforeAll(async () => {
  const r = await createTestParser()
  p = { parse: r.parser, serialize: r.serialize }
  destroyParser = r.destroy
})
afterAll(async () => {
  await destroyParser?.()
})

describe('docstore/serialize canonical', () => {
  it('常规 md 已是 round-trip 不动点（canonical 形式）', () => {
    for (const md of [
      '# 标题\n\n正文段落内容。\n\n* 列表 a\n* 列表 b\n\n> 引用行\n',
      'plain text only\n',
      '## 二级\n\n`code` 与 **bold** 与 *italic*\n',
    ]) {
      expect(isCanonicalStable(p, md), md.slice(0, 40)).toBe(true)
      expect(canonicalOf(p, md)).toBe(md)
    }
  })

  it('canonical 幂等：非 canonical 输入（- 列表）归一为 * 后收敛', () => {
    const md = '# 标题\n\n- 列表 a\n- 列表 b\n'
    const c = canonicalOf(p, md)
    expect(c).toContain('* 列表 a')
    expect(canonicalOf(p, c)).toBe(c) // 不动点
    // 幂等（管理 `savedContent = getMarkdown()` 同构语义：磁盘永远落 canonical）
    for (const md0 of ['', '  \n', '\n\n']) {
      expect(canonicalOf(p, canonicalOf(p, md0))).toBe(canonicalOf(p, md0))
    }
  })

  it('嵌入引用语法不被改写（![[path]] / [[path|ro]]）', () => {
    const md = '# A\n\n![[B]]\n\n![[C|ro]]\n\n[[D#标题]] 内联\n'
    const c = canonicalOf(p, md)
    expect(c).toContain('![[B]]')
    expect(c).toContain('![[C|ro]]')
    expect(c).toContain('[[D#标题]]')
  })

  it('解析失败降级返回原串', () => {
    const bad: DocPipeline = {
      parse: () => null,
      serialize: (d) => '',
    }
    expect(canonicalOf(bad, 'anything at all')).toBe('anything at all')
  })

  it('canonical 幂等（不动点）,空文档稳定', () => {
    for (const md of ['', '  \n', '\n\n']) {
      expect(canonicalOf(p, canonicalOf(p, md))).toBe(canonicalOf(p, md))
    }
  })})