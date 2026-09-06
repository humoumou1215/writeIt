import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DocumentStore,
  createDocumentId,
  createDocumentOrigin,
  createDocumentPath,
  documentById,
} from '../../../../src/core/document'
import { MemoryFileSystem } from '../../../../src/platform/filesystem'

const id = createDocumentId('doc-guardrails')
const path = createDocumentPath('notes/guardrails.md')
const locator = documentById(id)
const editOrigin = createDocumentOrigin('user', 'guardrails-test')

describe('DocumentStore foundation guardrails', () => {
  it('bounds compact timeline facts and per-document source history', () => {
    const store = new DocumentStore({
      timeline: { maxEvents: 2 },
      history: { maxEntries: 2 },
    })
    store.load({ id, path, markdown: 'zero' })
    store.applyChange(locator, { markdown: 'one', origin: editOrigin })
    store.applyChange(locator, { markdown: 'two', origin: editOrigin })
    store.applyChange(locator, { markdown: 'three', origin: editOrigin })

    const timeline = store.getTimeline(locator)
    expect(timeline.map((event) => event.sequence)).toEqual([3, 4])
    expect(timeline.every((event) => !('markdown' in event))).toBe(true)
    for (const event of timeline) {
      if ('document' in event) {
        expect(event.document).not.toHaveProperty('markdown')
        if ('previous' in event) {
          expect(event.previous).not.toHaveProperty('markdown')
        }
      }
    }

    const history = store.getHistory(locator)
    expect(history.undo).toHaveLength(2)
    expect(history.undo.map((entry) => entry.after)).toEqual(['two', 'three'])
  })

  it('preserves unknown Markdown through no-edit save and targeted edit save', async () => {
    const corpus = readFileSync(
      new URL('../../../fixtures/source-fidelity/unknown-markdown.md', import.meta.url),
      'utf8',
    )
    const originalMarker = 'preserve this exact marker'
    const replacement = 'changed without normalizing the rest'
    expect(corpus).toContain(originalMarker)

    const noEditFileSystem = new MemoryFileSystem({ [path]: corpus })
    const noEditStore = new DocumentStore()
    const noEdit = noEditStore.load({
      id,
      path,
      markdown: await noEditFileSystem.readFile(path),
    })
    expect(noEdit.markdown).toBe(corpus)
    expect(noEditStore.applyChange(locator, {
      markdown: corpus,
      origin: editOrigin,
    })).toBe(noEdit)
    await noEditFileSystem.writeFile(path, noEdit.markdown)
    expect(await noEditFileSystem.readFile(path)).toBe(corpus)

    const editedMarkdown = corpus.replace(originalMarker, replacement)
    const editedFileSystem = new MemoryFileSystem({ [path]: corpus })
    const editedStore = new DocumentStore()
    editedStore.load({
      id,
      path,
      markdown: await editedFileSystem.readFile(path),
    })
    const edited = editedStore.applyChange(locator, {
      markdown: editedMarkdown,
      origin: editOrigin,
    })
    await editedFileSystem.writeFile(path, edited.markdown)

    expect(await editedFileSystem.readFile(path)).toBe(editedMarkdown)
    expect(edited.markdown.replace(replacement, originalMarker)).toBe(corpus)
  })
})
