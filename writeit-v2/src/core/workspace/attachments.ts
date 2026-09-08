import type { WorkspacePath } from './types'

/**
 * Where pasted image bytes are stored. The value is a data contract shared by
 * the application policy and editor adapter; it does not imply a particular
 * filesystem or UI implementation.
 */
export type ImagePasteMode =
  | 'root-images'
  | 'same-dir'
  | 'file-images'
  | 'inline'

export const DEFAULT_IMAGE_PASTE_MODE: ImagePasteMode = 'root-images'

export const IMAGE_PASTE_MODE_IDS: readonly ImagePasteMode[] = Object.freeze([
  'root-images',
  'same-dir',
  'file-images',
  'inline',
])

export function isImagePasteMode(value: unknown): value is ImagePasteMode {
  return (
    value === 'root-images' ||
    value === 'same-dir' ||
    value === 'file-images' ||
    value === 'inline'
  )
}

export function requireImagePasteMode(value: unknown): ImagePasteMode {
  if (!isImagePasteMode(value)) {
    throw new TypeError(
      'Image paste mode must be root-images, same-dir, file-images, or inline',
    )
  }
  return value
}

/** Bytes and metadata extracted from a clipboard image by an editor adapter. */
export interface ImagePasteInput {
  readonly name?: string
  readonly mimeType: string
  readonly bytes: Uint8Array
}

export type ImagePasteReferenceSource = 'file' | 'inline'

/** One Markdown image token produced by the attachment pipeline. */
export interface ImagePasteReference {
  readonly markdown: string
  readonly source: ImagePasteReferenceSource
  /** Workspace-relative attachment path when source is `file`. */
  readonly path?: string
  readonly inputName?: string
}

/**
 * Transient ownership proof for one binary created by an image paste. The
 * version is supplied by the binary filesystem and is never persisted in
 * Markdown; it lets compensation delete only the bytes created by this paste.
 */
export interface ImagePasteAttachmentReceipt {
  readonly path: WorkspacePath
  readonly version: string
}

export interface ImagePasteCleanupContext {
  readonly operation: string
  readonly reason: string
  readonly documentPath?: string | null
}

/** A visible diagnostic when a newly-created attachment could not be removed. */
export interface ImagePasteOrphanDiagnostic {
  readonly kind: 'orphan-attachment'
  readonly path: WorkspacePath
  readonly reason: string
  /** Why the compensation path was entered (for example a revision race). */
  readonly triggerReason: string
  readonly operation: string
  readonly documentPath?: string | null
  readonly cause?: string
}

export interface ImagePasteCleanupResult {
  readonly deletedPaths: readonly WorkspacePath[]
  readonly failedPaths: readonly WorkspacePath[]
  readonly diagnostics: readonly ImagePasteOrphanDiagnostic[]
}

export interface ImagePasteFallback {
  readonly inputName?: string
  /** A diagnostic reason; it is never used as Markdown content. */
  readonly reason: string
}

/** Result of persisting a clipboard batch before it is applied to a Document. */
export interface ImagePasteResult {
  readonly references: readonly ImagePasteReference[]
  readonly savedPaths: readonly string[]
  /** Receipts for files created by this paste and safe to compensate. */
  readonly createdAttachments: readonly ImagePasteAttachmentReceipt[]
  readonly inlinedCount: number
  readonly fallbacks: readonly ImagePasteFallback[]
}

export function createImagePasteResult(
  input: Omit<ImagePasteResult, 'inlinedCount' | 'createdAttachments'> & {
    readonly createdAttachments?: readonly ImagePasteAttachmentReceipt[]
    readonly inlinedCount?: number
  },
): ImagePasteResult {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('Image paste result must be an object')
  }
  if (!Array.isArray(input.references)) {
    throw new TypeError('Image paste result references must be an array')
  }
  if (!Array.isArray(input.savedPaths)) {
    throw new TypeError('Image paste result savedPaths must be an array')
  }
  if (
    input.createdAttachments !== undefined &&
    !Array.isArray(input.createdAttachments)
  ) {
    throw new TypeError('Image paste result createdAttachments must be an array')
  }
  if (!Array.isArray(input.fallbacks)) {
    throw new TypeError('Image paste result fallbacks must be an array')
  }
  const inlinedCount = input.inlinedCount ?? input.references.filter(
    (reference) => reference.source === 'inline',
  ).length
  if (!Number.isSafeInteger(inlinedCount) || inlinedCount < 0) {
    throw new RangeError('Image paste result inlinedCount must be non-negative')
  }

  const createdAttachments = (input.createdAttachments ?? []).map(
    (attachment) =>
      Object.freeze({
        path: attachment.path,
        version: attachment.version,
      }),
  )

  return Object.freeze({
    references: Object.freeze([...input.references]),
    savedPaths: Object.freeze([...input.savedPaths]),
    createdAttachments: Object.freeze(createdAttachments),
    inlinedCount,
    fallbacks: Object.freeze([...input.fallbacks]),
  })
}
