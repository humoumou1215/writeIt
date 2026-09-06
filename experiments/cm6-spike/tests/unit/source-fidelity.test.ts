import { describe, expect, it } from 'vitest'
import { DocumentStore } from '../../src/core/document-store'

const goldenCorpus: Record<string, string> = {
  paragraphs: 'plain text\n\nsecond paragraph\n',
  headingsLists: '# 标题\n\n- one\n  - nested\n- two\n',
  blockquoteCode: '> quote\n\n```ts\nconst x = 1\n```\n',
  mermaid: '```mermaid\ngraph LR\nA --> B\n```\n',
  table: '| A | B |\n| --- | --- |\n| 1 | 2 |\n',
  refs: '[link](https://example.com)\n[[Wiki title]]\n![[A.md]]\n![image](image.png)\n',
  rawHtml: '<details><summary>raw</summary>body</details>\n',
  unknown: ':::unknown-syntax\nkeep me\n:::\n',
  unicode: '中文 · 日本語 · 😀\n',
  mixedLineEndings: 'first\r\nsecond\nthird\r\n',
}

describe('Markdown source fidelity', () => {
  it('keeps every golden fixture unchanged when opened and saved without edits', () => {
    const store = new DocumentStore(goldenCorpus)
    for (const [id, source] of Object.entries(goldenCorpus)) {
      expect(store.get(id).markdown, id).toBe(source)
      expect(store.save(id), id).toBe(source)
      expect(store.get(id).revision, id).toBe(1)
    }
    expect(store.diskContents()).toEqual(goldenCorpus)
  })
})
