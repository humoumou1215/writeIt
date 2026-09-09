// @vitest-environment jsdom

import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it, vi } from 'vitest'
import {
  createDocumentId,
  createDocumentPath,
  createDocumentState,
  createRevision,
} from '../../../../src/core/document'
import {
  createImagePasteExtension,
  projectionMutationFacet,
  type ImagePasteHandler,
  type ProjectionMutationCapability,
} from '../../../../src/editor/cm6'

function fakeImageFile(bytes: readonly number[]): File {
  return {
    name: 'child.png',
    type: 'image/png',
    size: bytes.length,
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  } as unknown as File
}

describe('CM6 image paste child bridge', () => {
  it('captures the target path and applies one mutation for one event', async () => {
    const snapshot = createDocumentState({
      id: createDocumentId('child-image-paste'),
      path: createDocumentPath('notes/deep/Target.md'),
      markdown: 'target',
      revision: createRevision(4),
      persistedRevision: createRevision(4),
    })
    let appliedResolve!: () => void
    const appliedPromise = new Promise<void>((resolve) => {
      appliedResolve = resolve
    })
    const applied = vi.fn((_change: unknown) => {
      appliedResolve()
      return snapshot
    })
    const mutation = {
      projectionId: 'child-image-paste-projection',
      snapshot: vi.fn(() => snapshot),
      applyChange: applied,
    } as unknown as ProjectionMutationCapability
    const handle = vi.fn(async (..._args: Parameters<ImagePasteHandler>) => ({
      references: [{
        markdown: '![child](./images/capture.png)',
        source: 'inline' as const,
      }],
      savedPaths: [],
      createdAttachments: [],
      inlinedCount: 1,
      fallbacks: [],
    }))
    const parent = document.createElement('div')
    document.body.append(parent)
    const view = new EditorView({
      state: EditorState.create({
        doc: 'target',
        extensions: [
          EditorView.editable.of(true),
          projectionMutationFacet.of(mutation),
          createImagePasteExtension({
            getDocumentPath: () => snapshot.path,
            handle,
          }),
        ],
      }),
      parent,
    })

    try {
      view.dispatch({ selection: { anchor: view.state.doc.length } })
      const file = fakeImageFile([1, 2, 3])
      const event = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', {
        configurable: true,
        value: {
          files: [file],
          items: [{
            kind: 'file',
            type: 'image/png',
            getAsFile: () => fakeImageFile([1, 2, 3]),
          }],
        },
      })
      view.contentDOM.dispatchEvent(event)
      view.contentDOM.dispatchEvent(event)
      await appliedPromise

      expect(event.defaultPrevented).toBe(true)
      expect(handle).toHaveBeenCalledTimes(1)
      expect(handle.mock.calls[0]?.[1]).toMatchObject({
        documentPath: 'notes/deep/Target.md',
        expectedRevision: 4,
      })
      expect(applied).toHaveBeenCalledTimes(1)
      expect(applied.mock.calls[0]?.[0]).toMatchObject({
        expectedRevision: 4,
        markdown: 'target![child](./images/capture.png)',
      })
    } finally {
      view.destroy()
      parent.remove()
    }
  })
})
