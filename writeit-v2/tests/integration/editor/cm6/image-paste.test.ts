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
  type SingleDocumentView,
} from '../../../../src/editor/cm6'

const mountedViews: SingleDocumentView[] = []

function makeView(markdown = 'before'): {
  store: DocumentStore
  locator: ReturnType<typeof documentById>
  projection: SingleDocumentView
  rawView: EditorView
  fileSystem: MemoryFileSystem
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
  const service = new ImageAttachmentService({
    fileSystem,
    nameGenerator: () => 'capture.png',
  })
  const projection = mountSingleDocumentView({
    store,
    locator,
    parent: document.body,
    projectionId: `image-paste-editor-${mountedViews.length}`,
    editable: true,
    extensions: [
      captureView,
      createImagePasteExtension({
        getDocumentPath: () => path,
        handle: (images, context) =>
          service.paste({
            images,
            mode: 'file-images',
            hostPath: context.documentPath,
          }),
        cleanupSavedPaths: async (paths) => {
          await service.cleanup(paths)
        },
      }),
    ],
  })
  if (!rawView) throw new Error('CM6 view was not captured')
  mountedViews.push(projection)
  return { store, locator, projection, rawView, fileSystem }
}

function pasteImage(target: HTMLElement, bytes = [1, 2, 3]): Event {
  const file = {
    name: 'clipboard.png',
    type: 'image/png',
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  } as unknown as File
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    configurable: true,
    value: { files: [file], items: [] },
  })
  target.dispatchEvent(event)
  return event
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
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
      'before![clipboard](notes/images/capture.png)',
    )
    expect(store.get(locator)?.revision).toBe(1)
    expect(projection.view.state.doc.toString()).toBe(
      'before![clipboard](notes/images/capture.png)',
    )
    expect(
      [...await fileSystem.readBinary(createWorkspacePath('notes/images/capture.png'))],
    ).toEqual([1, 2, 3])
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
