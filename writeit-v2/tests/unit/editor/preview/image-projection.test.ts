// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import {
  copyImageToClipboard,
  imageBytesToBase64,
  imageResourceDataUriFallback,
  resolveWorkspaceImageCandidates,
  WorkspaceImageProjectionResolver,
} from '../../../../src/editor/preview'
import { createWorkspacePath } from '../../../../src/core/workspace'

const pngBytes = new Uint8Array([137, 80, 78, 71])

function reader(files: Readonly<Record<string, Uint8Array>>): {
  readBinary: ReturnType<typeof vi.fn>
} {
  return {
    readBinary: vi.fn(async (path: string) => {
      const bytes = files[path]
      if (!bytes) throw new Error(`missing ${path}`)
      return new Uint8Array(bytes)
    }),
  }
}

describe('workspace image projection', () => {
  it('resolves image sources only relative to the current document directory', () => {
    expect(
      resolveWorkspaceImageCandidates('images/photo.png', 'notes/readme.md'),
    ).toEqual(['notes/images/photo.png'])
    expect(
      resolveWorkspaceImageCandidates('./photo.png', 'notes/readme.md'),
    ).toEqual(['notes/photo.png'])
    expect(
      resolveWorkspaceImageCandidates('../photo.png', 'notes/drafts/readme.md'),
    ).toEqual(['notes/photo.png'])
    expect(
      resolveWorkspaceImageCandidates(
        'images/photo%20one.png?cache=1#preview',
        'notes/readme.md',
      ),
    ).toEqual(['notes/images/photo one.png'])
    expect(
      resolveWorkspaceImageCandidates('../../photo.png', 'notes/readme.md'),
    ).toEqual([])
    expect(resolveWorkspaceImageCandidates('https://example.test/a.png')).toEqual(
      [],
    )
  })

  it('shares concurrent reads and object URLs across source-backed projections', async () => {
    let release!: (bytes: Uint8Array) => void
    const pending = new Promise<Uint8Array>((resolve) => {
      release = resolve
    })
    const readBinary = vi.fn(() => pending)
    const createObjectUrl = vi.fn(() => 'blob:shared-image')
    const resolver = new WorkspaceImageProjectionResolver({
      reader: { readBinary },
      createObjectUrl,
    })

    const firstRequest = resolver.resolve('images/photo.png', 'readme.md')
    const secondRequest = resolver.resolve('images/photo.png', 'readme.md')
    expect(readBinary).toHaveBeenCalledTimes(1)

    release(pngBytes)
    const [first, second] = await Promise.all([firstRequest, secondRequest])

    expect(first).toMatchObject({ status: 'ready', url: 'blob:shared-image' })
    expect(second).toMatchObject({ status: 'ready', url: 'blob:shared-image' })
    expect(createObjectUrl).toHaveBeenCalledTimes(1)
    resolver.dispose()
  })

  it('provides a self-contained data URL when a revocable image URL fails', () => {
    expect(
      imageResourceDataUriFallback({
        bytes: pngBytes,
        mimeType: 'image/png',
        url: 'blob:revoked-image',
      }),
    ).toBe('data:image/png;base64,iVBORw==')
    expect(
      imageResourceDataUriFallback({
        bytes: pngBytes,
        mimeType: 'image/png',
        url: 'data:image/png;base64,iVBORw==',
      }),
    ).toBeUndefined()
  })

  it('reads bytes into a browser URL, caches them, and releases object URLs', async () => {
    const source = reader({ 'images/photo.png': pngBytes })
    const createObjectUrl = vi.fn(() => 'blob:image-1')
    const revokeObjectUrl = vi.fn()
    const resolver = new WorkspaceImageProjectionResolver({
      reader: source,
      createObjectUrl,
      revokeObjectUrl,
      maxCachedImages: 1,
    })

    const first = await resolver.resolve('images/photo.png', 'readme.md')
    const second = await resolver.resolve('images/photo.png', 'readme.md')

    expect(first).toMatchObject({
      source: 'images/photo.png',
      url: 'blob:image-1',
      path: 'images/photo.png',
      name: 'photo.png',
      mimeType: 'image/png',
      status: 'ready',
    })
    expect([...first.bytes ?? []]).toEqual([...pngBytes])
    expect(second.url).toBe('blob:image-1')
    expect(source.readBinary).toHaveBeenCalledTimes(1)

    resolver.invalidate(createWorkspacePath('images/photo.png'))
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:image-1')
    resolver.dispose()
  })

  it('returns a visible unavailable result on read failure and retains the original source path', async () => {
    const source = reader({})
    const resolver = new WorkspaceImageProjectionResolver({ reader: source })
    const result = await resolver.resolve('images/missing.png', 'notes/readme.md')

    expect(result).toMatchObject({
      source: 'images/missing.png',
      path: 'notes/images/missing.png',
      url: '',
      status: 'unavailable',
    })
    expect(result.error).toContain('Could not read image notes/images/missing.png')
    resolver.dispose()
  })

  it('does not silently fall back to a same-named workspace-root image', async () => {
    const source = reader({ 'images/photo.png': pngBytes })
    const resolver = new WorkspaceImageProjectionResolver({ reader: source })

    const result = await resolver.resolve('images/photo.png', 'notes/readme.md')

    expect(result.status).toBe('unavailable')
    expect(result.path).toBe('notes/images/photo.png')
    expect(source.readBinary).toHaveBeenCalledWith('notes/images/photo.png')
    expect(source.readBinary).toHaveBeenCalledTimes(1)
    resolver.dispose()
  })

  it('copies image bytes instead of copying the Markdown destination', async () => {
    const writes: unknown[] = []
    class FakeClipboardItem {
      readonly data: unknown
      constructor(data: unknown) {
        this.data = data
      }
    }
    const previous = globalThis.ClipboardItem
    Object.defineProperty(globalThis, 'ClipboardItem', {
      configurable: true,
      value: FakeClipboardItem,
    })

    try {
      const copied = await copyImageToClipboard(
        {
          source: 'images/photo.png',
          url: 'blob:image-1',
          path: createWorkspacePath('images/photo.png'),
          name: 'photo.png',
          alt: 'photo',
          mimeType: 'image/png',
          bytes: pngBytes,
          status: 'ready',
        },
        {
          write: async (items) => {
            writes.push(items)
          },
        },
      )

      expect(copied).toBe(true)
      expect(writes).toHaveLength(1)
      expect(imageBytesToBase64(pngBytes)).toBe('iVBORw==')
    } finally {
      if (previous === undefined) delete (globalThis as { ClipboardItem?: unknown }).ClipboardItem
      else Object.defineProperty(globalThis, 'ClipboardItem', { configurable: true, value: previous })
    }
  })
})
