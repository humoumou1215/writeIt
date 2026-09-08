import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  createDocumentOrigin,
  createImagePasteResult,
  createWorkspacePath,
  type ImagePasteAttachmentReceipt,
  type ImagePasteCleanupContext,
  type ImagePasteCleanupResult,
  type ImagePasteInput,
  type ImagePasteOrphanDiagnostic,
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
  /** Compensates only receipts created by this paste operation. */
  readonly cleanupAttachments?: (
    attachments: readonly ImagePasteAttachmentReceipt[],
    context: ImagePasteCleanupContext,
  ) => ImagePasteCleanupResult | Promise<ImagePasteCleanupResult>
  /** Explicitly surfaces an attachment that could not be compensated. */
  readonly onDiagnostic?: (diagnostic: ImagePasteOrphanDiagnostic) => void
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

/**
 * A single DOM paste event can be observed through both DataTransfer.files and
 * DataTransfer.items. Some platforms return a different File object for the
 * item projection, so object identity alone is not enough to de-duplicate it.
 *
 * The files list is the primary projection. Item files are only added when
 * they are not already represented by that list. Counting a stable metadata
 * key, rather than collapsing all equal files, preserves an explicit batch of
 * two images with the same name/type/size.
 */
function clipboardFileKey(file: File): string {
  return `${file.name}\u0000${file.type.toLowerCase()}\u0000${file.size}`
}

function imageFilesFromClipboard(
  clipboardData: DataTransfer | null,
): File[] {
  if (!clipboardData) return []

  const files: File[] = []
  const seenFiles = new Set<File>()
  const representedByFiles = new Map<string, number>()

  for (const file of Array.from(clipboardData.files)) {
    if (!file.type.startsWith('image/') || seenFiles.has(file)) continue
    seenFiles.add(file)
    files.push(file)
    const key = clipboardFileKey(file)
    representedByFiles.set(key, (representedByFiles.get(key) ?? 0) + 1)
  }

  // Chromium and some native clipboard providers expose an image through an
  // item while leaving DataTransfer.files empty. Conversely, some providers
  // return a fresh File wrapper from getAsFile(). Consume one matching files
  // projection for each item before appending an unrepresented item. This
  // prevents one image from becoming two while retaining explicit multi-image
  // batches, including two equal-looking images.
  const seenItemFiles = new Set<File>()
  for (const item of Array.from(clipboardData.items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (!file || seenItemFiles.has(file)) continue
    seenItemFiles.add(file)

    const key = clipboardFileKey(file)
    const represented = representedByFiles.get(key) ?? 0
    if (represented > 0) {
      representedByFiles.set(key, represented - 1)
      continue
    }

    files.push(file)
  }

  return files
}

/**
 * CM6 may run more than one DOM-event bridge for the same native event. The
 * claim is module-scoped so separate image-paste extension instances in one
 * editor still share the same once-only boundary. A WeakSet avoids retaining
 * completed browser events and deliberately does not deduplicate separate
 * events: two explicit paste actions remain two user intents.
 */
const claimedImagePasteEvents = new WeakSet<Event>()

function claimImagePasteEvent(event: Event): boolean {
  if (claimedImagePasteEvents.has(event)) return false
  claimedImagePasteEvents.add(event)
  return true
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

function diagnosticMessage(diagnostic: ImagePasteOrphanDiagnostic): string {
  const document = diagnostic.documentPath
    ? ` for ${diagnostic.documentPath}`
    : ''
  return `Orphan attachment ${diagnostic.path}${document}: ${diagnostic.reason}`
}

function notifyDiagnostic(
  options: ImagePasteExtensionOptions,
  diagnostic: ImagePasteOrphanDiagnostic,
): void {
  if (options.onDiagnostic) {
    try {
      options.onDiagnostic(diagnostic)
    } catch {
      // Diagnostics must not interrupt cleanup or source mutation handling.
    }
    return
  }
  notifyError(options.onError, new Error(diagnosticMessage(diagnostic)))
}

function diagnosticForPath(
  path: string,
  context: ImagePasteCleanupContext,
  reason: string,
  cause?: unknown,
): ImagePasteOrphanDiagnostic | undefined {
  let normalizedPath: ReturnType<typeof createWorkspacePath>
  try {
    normalizedPath = createWorkspacePath(path)
  } catch {
    return undefined
  }
  return Object.freeze({
    kind: 'orphan-attachment' as const,
    path: normalizedPath,
    reason,
    triggerReason: context.reason,
    operation: context.operation,
    documentPath: context.documentPath,
    ...(cause === undefined
      ? {}
      : { cause: formatError(cause) }),
  })
}

async function compensatePastedAttachments(
  result: ImagePasteResult,
  context: ImagePasteHandlerContext,
  options: ImagePasteExtensionOptions,
  reason: string,
): Promise<readonly ImagePasteOrphanDiagnostic[]> {
  const cleanupContext: ImagePasteCleanupContext = Object.freeze({
    operation: 'image-paste',
    reason,
    documentPath: context.documentPath,
  })
  const diagnostics: ImagePasteOrphanDiagnostic[] = []
  const receipts = result.createdAttachments ?? []
  const ownedPaths = new Set<string>(
    receipts.map((attachment) => attachment.path),
  )

  // A handler that reports a saved path without an ownership receipt cannot be
  // safely compensated. Report it rather than falling back to path deletion.
  for (const path of result.savedPaths) {
    if (ownedPaths.has(path)) continue
    const diagnostic = diagnosticForPath(
      path,
      cleanupContext,
      'attachment was reported as saved without an ownership receipt; no deletion attempted',
    )
    if (diagnostic) diagnostics.push(diagnostic)
  }

  if (receipts.length > 0) {
    if (!options.cleanupAttachments) {
      for (const attachment of receipts) {
        const diagnostic = diagnosticForPath(
          attachment.path,
          cleanupContext,
          'attachment cleanup capability is unavailable; no deletion attempted',
        )
        if (diagnostic) diagnostics.push(diagnostic)
      }
    } else {
      try {
        const cleanup = await options.cleanupAttachments(receipts, cleanupContext)
        if (cleanup === null || typeof cleanup !== 'object') {
          throw new TypeError('Attachment cleanup did not return a result')
        }
        diagnostics.push(...cleanup.diagnostics)
        const diagnosedPaths = new Set(
          cleanup.diagnostics.map((diagnostic) => diagnostic.path),
        )
        for (const path of cleanup.failedPaths) {
          if (diagnosedPaths.has(path)) continue
          const diagnostic = diagnosticForPath(
            path,
            cleanupContext,
            'attachment cleanup failed without a diagnostic',
          )
          if (diagnostic) diagnostics.push(diagnostic)
        }
      } catch (error) {
        for (const attachment of receipts) {
          const diagnostic = diagnosticForPath(
            attachment.path,
            cleanupContext,
            'attachment cleanup callback failed; bytes may remain orphaned',
            error,
          )
          if (diagnostic) diagnostics.push(diagnostic)
        }
      }
    }
  }

  return Object.freeze(diagnostics)
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

      // Claim before starting any asynchronous clipboard read or attachment
      // write. A second bridge seeing this exact event must not start another
      // pipeline, even if it is a separate extension instance.
      if (!claimImagePasteEvent(event)) return false

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
    const diagnostics = await compensatePastedAttachments(
      result,
      context,
      options,
      'Image paste produced no Markdown references',
    )
    notifyError(options.onError, new Error('Image paste produced no Markdown references'))
    for (const diagnostic of diagnostics) notifyDiagnostic(options, diagnostic)
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
    const diagnostics = await compensatePastedAttachments(
      result,
      context,
      options,
      `Image paste Markdown reference validation failed: ${formatError(error)}`,
    )
    notifyError(options.onError, error)
    for (const diagnostic of diagnostics) notifyDiagnostic(options, diagnostic)
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
    const diagnostics = await compensatePastedAttachments(
      result,
      context,
      options,
      `Image paste Markdown mutation failed: ${formatError(error)}`,
    )
    notifyError(options.onError, error)
    for (const diagnostic of diagnostics) notifyDiagnostic(options, diagnostic)
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
