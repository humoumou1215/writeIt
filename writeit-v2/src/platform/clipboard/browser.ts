import {
  extractReferenceClipboardItems,
  parseReferenceClipboardData,
  type ReferenceClipboardData,
  type ReferenceClipboardNode,
  type ReferenceClipboardParseOptions,
  type ReferenceClipboardPayload,
  type ReferenceClipboardStore,
} from '../../core/reference'

export interface BrowserReferenceClipboardOptions
  extends ReferenceClipboardParseOptions {
  readonly store?: ReferenceClipboardStore
}

export interface BrowserReferenceClipboardWriter {
  write(payload: ReferenceClipboardPayload): Promise<void>
}

function requireBrowserClipboard(): Clipboard {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    throw new Error('Browser clipboard access is unavailable')
  }
  return navigator.clipboard
}

/** Writes the custom node MIME and a human-readable text fallback. */
export function createBrowserReferenceClipboardWriter(): BrowserReferenceClipboardWriter {
  return Object.freeze({
    async write(payload: ReferenceClipboardPayload): Promise<void> {
      const clipboard = requireBrowserClipboard()
      const clipboardItemConstructor = (
        globalThis as typeof globalThis & {
          ClipboardItem?: new (data: Record<string, Blob>) => ClipboardItem
        }
      ).ClipboardItem
      if (
        typeof clipboard.write === 'function' &&
        clipboardItemConstructor &&
        typeof Blob !== 'undefined'
      ) {
        const item = new clipboardItemConstructor({
          [payload.mimeType]: new Blob([payload.json], {
            type: payload.mimeType,
          }),
          'text/plain': new Blob([payload.text], { type: 'text/plain' }),
        })
        await clipboard.write([item])
        return
      }
      if (typeof clipboard.writeText === 'function') {
        await clipboard.writeText(payload.text)
        return
      }
      throw new Error('Browser clipboard write is unavailable')
    },
  })
}

function dataFromTextMap(
  values: ReadonlyMap<string, string>,
  types: readonly string[],
): ReferenceClipboardData {
  return {
    types,
    getData(type: string): string {
      return values.get(type) ?? ''
    },
  }
}

async function readClipboardItem(
  item: ClipboardItem,
  options: BrowserReferenceClipboardOptions,
): Promise<readonly ReferenceClipboardNode[] | undefined> {
  const values = new Map<string, string>()
  const types = [...item.types]
  for (const type of types) {
    if (
      type !== 'application/x-writeit-node' &&
      type !== 'text/uri-list' &&
      type !== 'text/plain'
    ) {
      continue
    }
    try {
      const blob = await item.getType(type)
      values.set(type, await blob.text())
    } catch {
      // Another clipboard provider may advertise a type but reject reads.
    }
  }
  if (values.size === 0) return undefined
  return parseReferenceClipboardData(
    dataFromTextMap(values, types),
    options,
  )
}

/** Reads recognized file references from the asynchronous browser clipboard. */
export async function readBrowserReferenceClipboard(
  options: BrowserReferenceClipboardOptions = {},
): Promise<readonly ReferenceClipboardNode[] | undefined> {
  const clipboard =
    typeof navigator === 'undefined' ? undefined : navigator.clipboard
  if (clipboard && typeof clipboard.read === 'function') {
    try {
      const entries = await clipboard.read()
      for (const entry of entries) {
        const parsed = await readClipboardItem(entry, options)
        if (parsed) {
          options.store?.set(parsed)
          return parsed
        }
      }
    } catch {
      // Permissions and WebView clipboard implementations may reject read().
    }
  }

  if (clipboard && typeof clipboard.readText === 'function') {
    try {
      const text = await clipboard.readText()
      const parsed = parseReferenceClipboardData(
        {
          types: ['text/plain'],
          getData: (type) => (type === 'text/plain' ? text : ''),
        },
        options,
      )
      if (parsed) {
        options.store?.set(parsed)
        return parsed
      }
    } catch {
      // Fall through to the app-local fallback.
    }
  }

  return options.store?.get()
}

/** Convenience object used by application composition. */
export function createBrowserReferenceClipboard(
  options: BrowserReferenceClipboardOptions = {},
): {
  readonly writer: BrowserReferenceClipboardWriter
  readonly read: () => Promise<readonly ReferenceClipboardNode[] | undefined>
} {
  return Object.freeze({
    writer: createBrowserReferenceClipboardWriter(),
    read: () => readBrowserReferenceClipboard(options),
  })
}

/** Structural alias for callers that use the platform adapter name. */
export const createReferenceClipboardWriter =
  createBrowserReferenceClipboardWriter

/** Parse a browser event through the shared application/core contract. */
export function parseBrowserClipboardData(
  data: ReferenceClipboardData | null | undefined,
  options: BrowserReferenceClipboardOptions = {},
): readonly ReferenceClipboardNode[] | undefined {
  return extractReferenceClipboardItems(data, options)
}
