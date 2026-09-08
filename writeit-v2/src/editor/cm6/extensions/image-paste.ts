import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  createImagePasteResult,
  createDocumentOrigin,
  type ImagePasteInput,
  type ImagePasteResult,
  type Revision,
} from '../../../core'
import {
  getProjectionMutationCapability,
  type ProjectionMutationCapability,
} from '../projection/mutation-capability'
import { projectMarkdownSource } from '../projection/source-fidelity'

export interface ImagePasteHandlerContext {
  /** Host document path captured before asynchronous clipboard work starts. */
  readonly documentPath: string | null
  readonly expectedRevision: Revision
  /** Selection boundaries in the normalized CM6 document. */
  readonly from: number
  readonly to: number
  readonly projectedSource: string
}

export type ImagePasteHandler = (
  images: readonly ImagePasteInput[],
  context: ImagePasteHandlerContext,
) => ImagePasteResult | Promise<ImagePasteResult>

export interface ImagePasteExtensionOptions {
  readonly handle: ImagePasteHandler
  /** Optional for direct EditorView mounts; projections inject this facet. */
  readonly mutation?: ProjectionMutationCapability
  /** Workspace-relative path of the Document currently projected by the view. */
  readonly getDocumentPath?: () => string | null
  /** Called after the references have been committed through DocumentStore. */
  readonly onApplied?: (
    result: ImagePasteResult,
    context: ImagePasteHandlerContext,
  ) => void
  /** A filesystem policy may remove files when a revision race rejects apply. */
  readonly cleanupSavedPaths?: (
    paths: readonly string[],
  ) => void | Promise<void>
  /** Errors are reported without changing the authoritative Markdown. */
  readonly onError?: (error: unknown) => void
  readonly originSource?: string
}

function formatError(error: unknown): string {
  try {
    const text = String(error)
    return text.length > 0 ? text : 'Image paste failed'
  } catch {
    return 'Image paste failed'
  }
}

function isEditable(view: EditorView): boolean {
  return !view.state.readOnly && view.state.facet(EditorView.editable)
}

function imageFilesFromClipboard(
  clipboardData: DataTransfer | null,
): File[] {
  if (!clipboardData) return []
  const files: File[] = []
  const seen = new Set<File>()

  for (const file of Array.from(clipboardData.files)) {
    if (file.type.startsWith('image/') && !seen.has(file)) {
      seen.add(file)
      files.push(file)
    }
  }

  // Chromium and some native clipboard providers expose the image through an
  // item but leave DataTransfer.files empty. Keep both paths and de-duplicate
  // object identities so one paste cannot produce the same image twice.
  for (const item of Array.from(clipboardData.items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file && !seen.has(file)) {
      seen.add(file)
      files.push(file)
    }
  }

  return files
}

async function readClipboardImages(
  files: readonly File[],
): Promise<{ readonly images: readonly ImagePasteInput[]; readonly failures: readonly Error[] }> {
  const images: ImagePasteInput[] = []
  const failures: Error[] = []

  for (const file of files) {
    try {
      images.push({
        name: file.name,
        mimeType: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
      })
    } catch (error) {
      failures.push(new Error(`Could not read pasted image ${file.name || 'image'}: ${formatError(error)}`))
    }
  }

  return Object.freeze({
    images: Object.freeze(images),
    failures: Object.freeze(failures),
  })
}

function normalizeResult(result: ImagePasteResult): ImagePasteResult {
  if (result === null || typeof result !== 'object') {
    throw new TypeError('Image paste handler must return a result object')
  }
  return createImagePasteResult(result)
}

function notifyError(
  callback: ImagePasteExtensionOptions['onError'],
  error: unknown,
): void {
  if (!callback) return
  try {
    callback(error)
  } catch {
    // Error presentation is not allowed to break the editor event path.
  }
}

/**
 * CM6-only clipboard adapter. Clipboard/File/DOM concerns stop here; the
 * application handler decides whether bytes become workspace files or data
 * URIs, and this adapter commits only the returned Markdown through the
 * projection mutation capability.
 */
export function createImagePasteExtension(
  options: ImagePasteExtensionOptions,
): Extension {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('Image paste extension options are required')
  }
  if (typeof options.handle !== 'function') {
    throw new TypeError('Image paste extension handle must be a function')
  }

  return EditorView.domEventHandlers({
    paste(event, view) {
      if (!isEditable(view)) return false
      if (view.composing || event.defaultPrevented) return false

      const files = imageFilesFromClipboard(event.clipboardData)
      if (files.length === 0) return false

      const mutation =
        options.mutation ?? getProjectionMutationCapability(view.state)
      if (!mutation) return false

      let snapshot: ReturnType<ProjectionMutationCapability['snapshot']>
      try {
        snapshot = mutation.snapshot()
      } catch {
        return false
      }

      const projectedSource = projectMarkdownSource(snapshot.markdown).projected
      if (view.state.doc.toString() !== projectedSource) {
        event.preventDefault()
        notifyError(
          options.onError,
          new Error('Image paste was rejected because the editor projection is stale'),
        )
        return true
      }

      const selection = view.state.selection.main
      const context: ImagePasteHandlerContext = Object.freeze({
        documentPath: options.getDocumentPath?.() ?? null,
        expectedRevision: snapshot.revision,
        from: selection.from,
        to: selection.to,
        projectedSource,
      })

      event.preventDefault()
      void applyPastedImages(files, view, mutation, options, context)
      return true
    },
  })
}

async function applyPastedImages(
  files: readonly File[],
  view: EditorView,
  mutation: ProjectionMutationCapability,
  options: ImagePasteExtensionOptions,
  context: ImagePasteHandlerContext,
): Promise<void> {
  const read = await readClipboardImages(files)
  for (const failure of read.failures) notifyError(options.onError, failure)
  if (read.images.length === 0) return

  let result: ImagePasteResult
  try {
    result = normalizeResult(await options.handle(read.images, context))
  } catch (error) {
    notifyError(options.onError, error)
    return
  }

  if (result.references.length === 0) {
    if (result.savedPaths.length > 0 && options.cleanupSavedPaths) {
      try {
        await options.cleanupSavedPaths(result.savedPaths)
      } catch (cleanupError) {
        notifyError(options.onError, cleanupError)
      }
    }
    notifyError(options.onError, new Error('Image paste produced no Markdown references'))
    return
  }

  let inserted: string
  try {
    inserted = result.references.map((reference) => {
      if (
        reference === null ||
        typeof reference !== 'object' ||
        typeof reference.markdown !== 'string'
      ) {
        throw new TypeError('Image paste reference Markdown must be a string')
      }
      return reference.markdown
    }).join('\n')
  } catch (error) {
    notifyError(options.onError, error)
    return
  }
  const nextProjectedSource =
    context.projectedSource.slice(0, context.from) +
    inserted +
    context.projectedSource.slice(context.to)

  try {
    mutation.applyChange({
      markdown: nextProjectedSource,
      origin: createDocumentOrigin(
        'editor',
        options.originSource ?? 'image-paste',
      ),
      expectedRevision: context.expectedRevision,
    })
  } catch (error) {
    if (result.savedPaths.length > 0 && options.cleanupSavedPaths) {
      try {
        await options.cleanupSavedPaths(result.savedPaths)
      } catch (cleanupError) {
        notifyError(options.onError, cleanupError)
      }
    }
    notifyError(options.onError, error)
    return
  }

  // The Store event synchronously updates the projection. Selection is local
  // view state, so restoring the caret does not create another source revision.
  try {
    const nextCursor = context.from + inserted.length
    view.dispatch({ selection: { anchor: nextCursor } })
  } catch (error) {
    // A view can be torn down by an application callback during the Store
    // fan-out. The source commit has already succeeded; report no new error.
    void error
  }

  if (options.onApplied) {
    try {
      options.onApplied(result, context)
    } catch {
      // Observing a successful paste must not turn it into a failed mutation.
    }
  }
}
