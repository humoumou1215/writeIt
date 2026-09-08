// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { ViewPlugin, type EditorView } from '@codemirror/view'
import { ImageAttachmentService } from '../../../../src/application/attachments'
import {
  createDocumentId,
  createDocumentPath,
  documentById,
  DocumentStore,
} from '../../../../src/core/document'
import { createWorkspacePath } from '../../../../src/core/workspace'
import { MemoryFileSystem } from '../../../../src/platform/filesystem'
import {
  createImagePasteExtension,
  mountSingleDocumentView,
  type ImagePasteHandler,
  type SingleDocumentView,
} from '../../../../src/editor/cm6'
import type { ImagePasteOrphanDiagnostic } from '../../../../src/core/workspace'
import { WorkspaceImageProjectionResolver } from '../../../../src/editor/preview'

const mountedViews: SingleDocumentView[] = []

interface MakeViewOptions {
  readonly editable?: boolean
  readonly service?: ImageAttachmentService
  readonly handle?: ImagePasteHandler
  readonly onDiagnostic?: (diagnostic: ImagePasteOrphanDiagnostic) => void
  readonly onError?: (error: unknown) => void
}

function makeView(markdown = 'before', options: MakeViewOptions = {}): {
  store: DocumentStore
  locator: ReturnType<typeof documentById>
  projection: SingleDocumentView
  rawView: EditorView
  fileSystem: MemoryFileSystem
  service: ImageAttachmentService
} {
  const store = new DocumentStore()
  const id = createDocumentId(`image-paste-${mountedViews.length}`)
  const path = createDocumentPath(`notes/image-paste-${mountedViews.length}.md`)
  const locator = documentById(id)
  store.load({ id, path, markdown })
  const fileSystem = new MemoryFileSystem()

  let rawView: EditorView | undefined
  const captureView = ViewPlugin.define((view) => {
    rawView = view
    return {}
  })
  const service = options.service ?? new ImageAttachmentService({
    fileSystem,
    nameGenerator: () => 'capture.png',
  })
  const projection = mountSingleDocumentView({
    store,
    locator,
    parent: document.body,
    projectionId: `image-paste-editor-${mountedViews.length}`,
    editable: options.editable ?? true,
    extensions: [
      captureView,
      createImagePasteExtension({
        getDocumentPath: () => path,
        handle: options.handle ?? ((images, context) =>
          service.paste({
            images,
            mode: 'file-images',
            hostPath: context.documentPath,
          })),
        cleanupAttachments: (attachments, context) =>
          service.cleanup(attachments, context),
        onDiagnostic: options.onDiagnostic,
        onError: options.onError,
      }),
    ],
  })
  if (!rawView) throw new Error('CM6 view was not captured')
  mountedViews.push(projection)
  return { store, locator, projection, rawView, fileSystem, service }
}

function fakeImageFile(
  bytes: readonly number[],
  name = 'clipboard.png',
): File {
  return {
    name,
    type: 'image/png',
    size: bytes.length,
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  } as unknown as File
}

function pasteImages(
  target: HTMLElement,
  images: readonly {
    readonly bytes: readonly number[]
    readonly name?: string
  }[],
  includeItemProjection = false,
): Event {
  const files = images.map((image) => fakeImageFile(image.bytes, image.name))
  const items = includeItemProjection
    ? images.map((image) => ({
        kind: 'file',
        type: 'image/png',
        // A platform may return a fresh File wrapper for the same clipboard
        // item. The adapter must not mistake that projection for a second
        // image, while still retaining distinct entries in `files`.
        getAsFile: () => fakeImageFile(image.bytes, image.name),
      }))
    : []
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    configurable: true,
    value: { files, items },
  })
  target.dispatchEvent(event)
  return event
}

function pasteImage(target: HTMLElement, bytes = [1, 2, 3]): Event {
  return pasteImages(target, [{ bytes }])
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function waitForRevision(
  store: DocumentStore,
  locator: ReturnType<typeof documentById>,
  revision: number,
): Promise<void> {
  if (store.getRevision(locator) >= revision) return Promise.resolve()
  return new Promise((resolve) => {
    const stop = store.subscribe(locator, (event) => {
      if (event.type !== 'changed' || event.document.revision < revision) return
      stop()
      resolve()
    })
  })
}

afterEach(() => {
  for (const projection of mountedViews.splice(0)) projection.destroy()
})

describe('CM6 image attachment paste', () => {
  it('persists image bytes first and commits only a relative Markdown reference', async () => {
    const { store, locator, projection, rawView, fileSystem } = makeView()
    rawView.dispatch({ selection: { anchor: rawView.state.doc.length } })

    const event = pasteImage(rawView.contentDOM)
    await flush()

    expect(event.defaultPrevented).toBe(true)
    expect(store.get(locator)?.markdown).toBe(
      'before![clipboard](./images/capture.png)',
    )
    expect(store.get(locator)?.revision).toBe(1)
    expect(projection.view.state.doc.toString()).toBe(
      'before![clipboard](./images/capture.png)',
    )
    expect(
      [...await fileSystem.readBinary(createWorkspacePath('notes/images/capture.png'))],
    ).toEqual([1, 2, 3])
  })

  it('claims one paste event, de-duplicates bridge projections, and preserves explicit multi-image input', async () => {
    const single = makeView()
    single.rawView.dispatch({ selection: { anchor: single.rawView.state.doc.length } })

    const singleApplied = waitForRevision(single.store, single.locator, 1)
    const event = pasteImages(
      single.rawView.contentDOM,
      [{ bytes: [1, 2, 3] }],
      true,
    )
    // Re-dispatching the same DOM event models a duplicate bridge/late event.
    single.rawView.contentDOM.dispatchEvent(event)
    await singleApplied

    expect(single.store.get(single.locator)?.markdown).toBe(
      'before![clipboard](./images/capture.png)',
    )
    expect(single.store.get(single.locator)?.revision).toBe(1)
    expect(single.store.getHistory(single.locator).undo).toHaveLength(1)
    expect(single.fileSystem.snapshotBinary().size).toBe(1)

    const multiple = makeView()
    multiple.rawView.dispatch({ selection: { anchor: multiple.rawView.state.doc.length } })
    const multipleApplied = waitForRevision(multiple.store, multiple.locator, 1)
    pasteImages(
      multiple.rawView.contentDOM,
      [{ bytes: [4, 5, 6] }, { bytes: [4, 5, 6] }],
      true,
    )
    await multipleApplied

    const multipleDocument = multiple.store.get(multiple.locator)
    expect(multipleDocument?.markdown.match(/!\[/gu)).toHaveLength(2)
    expect(multipleDocument?.revision).toBe(1)
    expect(multiple.store.getHistory(multiple.locator).undo).toHaveLength(1)
    expect(multiple.fileSystem.snapshotBinary().size).toBe(2)
  })

  it('keeps source, history and attachment bytes after a successful mutation', async () => {
    const { store, locator, projection, rawView, fileSystem } = makeView()
    rawView.dispatch({ selection: { anchor: rawView.state.doc.length } })

    pasteImage(rawView.contentDOM, [4, 5, 6])
    await flush()

    const documentState = store.get(locator)
    expect(documentState).toMatchObject({
      markdown: 'before![clipboard](./images/capture.png)',
      revision: 1,
      persistedRevision: 0,
      dirty: true,
    })
    expect(store.getHistory(locator).undo).toHaveLength(1)
    expect(
      [...await fileSystem.readBinary(createWorkspacePath('notes/images/capture.png'))],
    ).toEqual([4, 5, 6])

    const resolver = new WorkspaceImageProjectionResolver({ reader: fileSystem })
    await expect(
      resolver.resolve('./images/capture.png', 'notes/image-paste-0.md'),
    ).resolves.toMatchObject({
      path: 'notes/images/capture.png',
      status: 'ready',
    })

    projection.destroy()
    const reopened = mountSingleDocumentView({
      store,
      locator,
      parent: document.body,
      projectionId: 'image-paste-reopened-editor',
      editable: false,
    })
    mountedViews.push(reopened)
    expect(reopened.view.state.doc.toString()).toBe(
      'before![clipboard](./images/capture.png)',
    )
    reopened.destroy()
    resolver.dispose()
  })

  it('compensates a file when a revision race rejects the Store mutation', async () => {
    const fileSystem = new MemoryFileSystem()
    const service = new ImageAttachmentService({
      fileSystem,
      nameGenerator: () => 'capture.png',
    })
    let store!: DocumentStore
    let locator!: ReturnType<typeof documentById>
    const harness = makeView('before', {
      service,
      handle: async (images, context) => {
        const result = await service.paste({
          images,
          mode: 'file-images',
          hostPath: context.documentPath,
        })
        store.applyChange(locator, {
          markdown: 'external source',
          origin: { kind: 'test', source: 'revision-race' },
        })
        return result
      },
    })
    store = harness.store
    locator = harness.locator
    harness.rawView.dispatch({ selection: { anchor: harness.rawView.state.doc.length } })

    pasteImage(harness.rawView.contentDOM)
    await flush()

    expect(store.get(locator)?.markdown).toBe('external source')
    expect(store.get(locator)?.revision).toBe(1)
    expect(fileSystem.hasFile(createDocumentPath('notes/images/capture.png'))).toBe(false)
  })

  it('compensates when the projection is destroyed after the binary write', async () => {
    const fileSystem = new MemoryFileSystem()
    const service = new ImageAttachmentService({
      fileSystem,
      nameGenerator: () => 'capture.png',
    })
    let projection: SingleDocumentView | undefined
    const harness = makeView('before', {
      service,
      handle: async (images, context) => {
        const result = await service.paste({
          images,
          mode: 'file-images',
          hostPath: context.documentPath,
        })
        projection?.destroy()
        return result
      },
    })
    projection = harness.projection
    harness.rawView.dispatch({ selection: { anchor: harness.rawView.state.doc.length } })

    pasteImage(harness.rawView.contentDOM)
    await flush()

    expect(harness.store.get(harness.locator)?.markdown).toBe('before')
    expect(harness.store.get(harness.locator)?.revision).toBe(0)
    expect(fileSystem.hasFile(createDocumentPath('notes/images/capture.png'))).toBe(false)
  })

  it('compensates when reference validation fails after the binary write', async () => {
    const fileSystem = new MemoryFileSystem()
    const service = new ImageAttachmentService({
      fileSystem,
      nameGenerator: () => 'capture.png',
    })
    const harness = makeView('before', {
      service,
      handle: async (images, context) => {
        const result = await service.paste({
          images,
          mode: 'file-images',
          hostPath: context.documentPath,
        })
        return { ...result, references: [] }
      },
    })
    harness.rawView.dispatch({ selection: { anchor: harness.rawView.state.doc.length } })

    pasteImage(harness.rawView.contentDOM)
    await flush()

    expect(harness.store.get(harness.locator)?.markdown).toBe('before')
    expect(fileSystem.hasFile(createDocumentPath('notes/images/capture.png'))).toBe(false)
  })

  it('reports an orphan diagnostic when compensation fails without deleting bytes', async () => {
    class CleanupFailureFileSystem extends MemoryFileSystem {
      override async deleteBinaryIfUnchanged(): Promise<never> {
        throw new Error('cleanup permission denied')
      }
    }

    const fileSystem = new CleanupFailureFileSystem()
    const service = new ImageAttachmentService({
      fileSystem,
      nameGenerator: () => 'capture.png',
    })
    const diagnostics: ImagePasteOrphanDiagnostic[] = []
    let resolveDiagnostic!: () => void
    const diagnosticReported = new Promise<void>((resolve) => {
      resolveDiagnostic = resolve
    })
    const harness = makeView('before', {
      service,
      handle: async (images, context) => {
        const result = await service.paste({
          images,
          mode: 'file-images',
          hostPath: context.documentPath,
        })
        return { ...result, references: [] }
      },
      onDiagnostic: (diagnostic) => {
        diagnostics.push(diagnostic)
        resolveDiagnostic()
      },
    })
    harness.rawView.dispatch({ selection: { anchor: harness.rawView.state.doc.length } })

    pasteImage(harness.rawView.contentDOM)
    await diagnosticReported

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({
      kind: 'orphan-attachment',
      path: 'notes/images/capture.png',
      operation: 'image-paste',
      documentPath: 'notes/image-paste-0.md',
    })
    expect(fileSystem.hasFile(createDocumentPath('notes/images/capture.png'))).toBe(true)
    expect(harness.store.get(harness.locator)?.markdown).toBe('before')
  })

  it('does not mutate Markdown when a readonly projection receives an image paste', async () => {
    const store = new DocumentStore()
    const id = createDocumentId('image-paste-readonly')
    const path = createDocumentPath('readonly.md')
    const locator = documentById(id)
    store.load({ id, path, markdown: 'source' })
    const projection = mountSingleDocumentView({
      store,
      locator,
      parent: document.body,
      projectionId: 'image-paste-readonly-editor',
      editable: false,
      extensions: [
        createImagePasteExtension({
          handle: async () => ({
            references: [],
            savedPaths: [],
            createdAttachments: [],
            inlinedCount: 0,
            fallbacks: [],
          }),
        }),
      ],
    })
    mountedViews.push(projection)
    projection.view.dom.dispatchEvent(pasteImage(projection.view.dom))
    await flush()

    expect(store.get(locator)?.markdown).toBe('source')
    expect(store.get(locator)?.revision).toBe(0)
  })
})
