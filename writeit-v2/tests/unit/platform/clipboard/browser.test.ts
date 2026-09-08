// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createReferenceClipboardPayload,
  ReferenceClipboardStore,
} from '../../../../src/core/reference'
import {
  createBrowserReferenceClipboardWriter,
  readBrowserReferenceClipboard,
} from '../../../../src/platform/clipboard'

const copied = [{ kind: 'file' as const, path: 'notes/copied.md' }]

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('browser reference clipboard freshness', () => {
  it('falls back to writing plain text when custom MIME write is rejected', async () => {
    const payload = createReferenceClipboardPayload(copied)
    const write = vi.fn().mockRejectedValue(new Error('custom MIME unsupported'))
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal(
      'ClipboardItem',
      class ClipboardItem {
        constructor(_data: Record<string, Blob>) {}
      },
    )
    vi.stubGlobal('navigator', { clipboard: { write, writeText } })

    await createBrowserReferenceClipboardWriter().write(payload)

    expect(write).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith(payload.text)
  })

  it('uses a matching current text payload as the fallback', async () => {
    const store = new ReferenceClipboardStore()
    const payload = createReferenceClipboardPayload(copied)
    store.set(copied)
    vi.stubGlobal('navigator', {
      clipboard: {
        readText: vi.fn().mockResolvedValue(payload.text),
      },
    })

    await expect(readBrowserReferenceClipboard({ store })).resolves.toEqual(copied)
  })

  it('does not return stale fallback nodes for changed external text', async () => {
    const store = new ReferenceClipboardStore()
    store.set(copied)
    vi.stubGlobal('navigator', {
      clipboard: {
        readText: vi.fn().mockResolvedValue('ordinary external text'),
      },
    })

    await expect(readBrowserReferenceClipboard({ store })).resolves.toBeUndefined()
    expect(store.get()).toBeUndefined()
  })

  it('fails closed when clipboard permission/read is unavailable', async () => {
    const store = new ReferenceClipboardStore()
    store.set(copied)
    vi.stubGlobal('navigator', {
      clipboard: {
        readText: vi.fn().mockRejectedValue(new Error('permission denied')),
      },
    })

    await expect(readBrowserReferenceClipboard({ store })).resolves.toBeUndefined()
    expect(store.get()).toBeUndefined()
  })

  it('does not let a late read expire a newer internal copy binding', async () => {
    const store = new ReferenceClipboardStore()
    store.set(copied)
    let resolveRead: ((value: string) => void) | undefined
    vi.stubGlobal('navigator', {
      clipboard: {
        readText: vi.fn(
          () =>
            new Promise<string>((resolve) => {
              resolveRead = resolve
            }),
        ),
      },
    })

    const pending = readBrowserReferenceClipboard({ store })
    const newer = [{ kind: 'file' as const, path: 'notes/newer.md' }]
    store.set(newer)
    resolveRead?.('notes/copied.md')

    await expect(pending).resolves.toBeUndefined()
    expect(store.get()).toEqual(newer)
  })
})
