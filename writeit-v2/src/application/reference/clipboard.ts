import {
  createReferenceClipboardPayload,
  defaultReferenceClipboardStore,
  extractReferenceClipboardItems,
  normalizeReferenceClipboardNodes,
  type ReferenceClipboardData,
  type ReferenceClipboardExtractOptions,
  type ReferenceClipboardNode,
  type ReferenceClipboardNodeInput,
  type ReferenceClipboardPayload,
  type ReferenceClipboardParseOptions,
  type ReferenceClipboardStore,
} from '../../core/reference'

export interface ReferenceClipboardWritePort {
  write(payload: ReferenceClipboardPayload): Promise<void>
}

export interface ReferenceClipboardCopyResult {
  readonly nodes: readonly ReferenceClipboardNode[]
  /** False means the in-memory app fallback remains the usable channel. */
  readonly systemClipboardWritten: boolean
  readonly payload: ReferenceClipboardPayload
}

/**
 * Application policy for copying workspace entries. The local store is
 * updated before the platform write so a text-only paste can still be
 * freshness-checked when the browser cannot preserve custom MIME data.
 */
export class ReferenceClipboardService {
  readonly store: ReferenceClipboardStore

  constructor(store: ReferenceClipboardStore = defaultReferenceClipboardStore) {
    this.store = store
  }

  copy(
    values: readonly (ReferenceClipboardNode | ReferenceClipboardNodeInput)[],
    writer?: ReferenceClipboardWritePort,
  ): Promise<ReferenceClipboardCopyResult> {
    const nodes = normalizeReferenceClipboardNodes(values)
    const payload = createReferenceClipboardPayload(nodes)
    this.store.set(nodes)

    if (!writer) {
      return Promise.resolve(Object.freeze({
        nodes,
        systemClipboardWritten: false,
        payload,
      }))
    }

    let writeResult: Promise<void>
    try {
      writeResult = Promise.resolve(writer.write(payload))
    } catch {
      writeResult = Promise.reject(new Error('Reference clipboard write failed'))
    }
    return writeResult.then(
      () =>
        Object.freeze({
          nodes,
          systemClipboardWritten: true,
          payload,
        }),
      () =>
        Object.freeze({
          nodes,
          systemClipboardWritten: false,
          payload,
        }),
    )
  }

  extract(
    data: ReferenceClipboardData | null | undefined,
    options: Omit<ReferenceClipboardExtractOptions, 'store'> = {},
  ): readonly ReferenceClipboardNode[] | undefined {
    return extractReferenceClipboardItems(data, {
      ...options,
      store: this.store,
    })
  }

  parse(
    data: ReferenceClipboardData | null | undefined,
    options: ReferenceClipboardParseOptions = {},
  ): readonly ReferenceClipboardNode[] | undefined {
    return extractReferenceClipboardItems(data, options)
  }
}

export * from '../../core/reference/clipboard'
