import { describe, expect, it } from 'vitest'
import {
  createReferenceClipboardEdit,
  createReferenceClipboardPayload,
  extractReferenceClipboardItems,
  fileUriToAbsolute,
  parseFileUriList,
  parseReferenceClipboardData,
  ReferenceClipboardStore,
  splitReferenceClipboardItems,
} from '../../../../src/core/reference'

function data(values: Readonly<Record<string, string>>) {
  return {
    types: Object.keys(values),
    getData: (type: string) => values[type] ?? '',
  }
}

describe('reference clipboard core contract', () => {
  it('serializes application copies with file and directory kinds', () => {
    const items = [
      { kind: 'file' as const, path: 'notes/one.md' },
      { kind: 'directory' as const, path: 'assets' },
    ]
    const payload = createReferenceClipboardPayload(items)

    expect(JSON.parse(payload.json)).toEqual(items)
    expect(payload.text).toBe('notes/one.md\nassets')
    expect(splitReferenceClipboardItems(items)).toMatchObject({
      files: ['notes/one.md'],
      dirs: ['assets'],
      items,
    })
  })

  it('reads the custom MIME before system file URLs and preserves order', () => {
    const custom = JSON.stringify([
      { kind: 'file', path: 'notes/one.md' },
      { kind: 'dir', path: 'assets' },
    ])
    expect(
      parseReferenceClipboardData(
        data({
          'application/x-writeit-node': custom,
          'text/uri-list': 'file:///outside/two.md',
        }),
      ),
    ).toEqual([
      { kind: 'file', path: 'notes/one.md' },
      { kind: 'directory', path: 'assets' },
    ])
  })

  it('maps file URLs into a workspace or falls back to a basename', () => {
    expect(fileUriToAbsolute('file:///Users/test/notes/%E6%B5%8B%E8%AF%95.md')).toBe(
      '/Users/test/notes/测试.md',
    )
    expect(parseFileUriList('# comment\nfile:///workspace/notes/a.md\nhttps://example/a.md')).toEqual([
      '/workspace/notes/a.md',
    ])
    expect(
      parseReferenceClipboardData(
        data({ 'text/uri-list': 'file:///workspace/notes/a.md\nfile:///workspace/b.md' }),
        { workspaceRootAbsolutePath: '/workspace' },
      ),
    ).toEqual([
      { kind: 'file', path: 'notes/a.md' },
      { kind: 'file', path: 'b.md' },
    ])
    expect(
      parseReferenceClipboardData(
        data({ 'text/uri-list': 'file:///outside/a.md' }),
        { externalFallback: 'basename' },
      ),
    ).toEqual([{ kind: 'file', path: 'a.md' }])
  })

  it('does not turn ordinary text or invalid payloads into references', () => {
    expect(parseReferenceClipboardData(data({ 'text/plain': 'ordinary text' }))).toBeUndefined()
    expect(
      parseReferenceClipboardData(data({ 'application/x-writeit-node': '{bad' })),
    ).toBeUndefined()
    expect(
      parseReferenceClipboardData(data({ 'text/uri-list': 'https://example.test/a.md' })),
    ).toBeUndefined()
  })

  it('creates source-preserving link/embed and multi-entry edits', () => {
    const file = { kind: 'file' as const, path: 'notes/one.md' }
    const directory = { kind: 'directory' as const, path: 'assets' }
    expect(createReferenceClipboardEdit('before after', 7, 12, [file])).toMatchObject({
      insert: '[[notes/one.md]]',
      from: 7,
      to: 12,
    })
    expect(
      createReferenceClipboardEdit({
        source: '',
        from: 0,
        to: 0,
        items: [file],
        mode: 'embed',
      })?.insert,
    ).toBe('![[notes/one.md]]')
    expect(
      createReferenceClipboardEdit('', 0, 0, [file, directory], 'embed-readonly')?.insert,
    ).toBe('![[notes/one.md|ro]]\nassets')
  })

  it('uses the app-local fallback without making it Document authority', () => {
    const store = new ReferenceClipboardStore()
    store.set([{ kind: 'file', path: 'copied.md' }])
    expect(extractReferenceClipboardItems(null, { store })).toEqual([
      { kind: 'file', path: 'copied.md' },
    ])
    store.clear()
    expect(store.get()).toBeUndefined()
  })
})
