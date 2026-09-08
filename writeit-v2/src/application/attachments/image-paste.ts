import {
  createImagePasteResult,
  createWorkspacePath,
  DEFAULT_IMAGE_PASTE_MODE,
  documentRelativeImageSourcePath,
  requireImagePasteMode,
  workspaceJoin,
  workspaceParent,
} from '../../core/workspace'
import type {
  ImagePasteFallback,
  ImagePasteInput,
  ImagePasteReference,
  ImagePasteResult,
  ImagePasteMode,
  WorkspacePath,
} from '../../core/workspace'
import type { BinaryFileSystemPort } from '../../platform/filesystem'

export const IMAGE_PASTE_MODE_OPTIONS = Object.freeze([
  Object.freeze({
    id: 'root-images' as const,
    label: 'Workspace images/',
    description: 'Store pasted images in images/ at the workspace root; Markdown uses a document-relative path.',
  }),
  Object.freeze({
    id: 'same-dir' as const,
    label: 'Same directory',
    description: 'Store pasted images next to the Markdown document and reference them relatively.',
  }),
  Object.freeze({
    id: 'file-images' as const,
    label: 'Document images/',
    description: 'Store pasted images in an images/ child of the document directory.',
  }),
  Object.freeze({
    id: 'inline' as const,
    label: 'Inline base64',
    description: 'Keep the image as an explicit data URI in Markdown.',
  }),
])

export interface ImagePasteRequest {
  readonly images: readonly ImagePasteInput[]
  readonly mode?: ImagePasteMode
  /** Workspace-relative Markdown document path; null means no file host. */
  readonly hostPath?: WorkspacePath | string | null
}

export type ImageAttachmentNameGenerator = (
  input: ImagePasteInput,
  index: number,
) => string

export interface ImageAttachmentServiceOptions {
  readonly fileSystem?: BinaryFileSystemPort
  readonly nameGenerator?: ImageAttachmentNameGenerator
  readonly now?: () => Date
  readonly random?: () => string
}

export interface ImageAttachmentCleanupResult {
  readonly deletedPaths: readonly WorkspacePath[]
  readonly failedPaths: readonly WorkspacePath[]
}

const MIME_EXTENSIONS: Readonly<Record<string, string>> = Object.freeze({
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/tiff': 'tiff',
  'image/webp': 'webp',
  'image/x-icon': 'ico',
})

const DEFAULT_MIME_TYPE = 'image/png'

function normalizeMimeType(value: string): string {
  if (typeof value !== 'string') return DEFAULT_MIME_TYPE
  const mimeType = value.trim().toLowerCase().split(';', 1)[0] ?? ''
  return /^image\/[a-z0-9][a-z0-9.+-]*$/u.test(mimeType)
    ? mimeType
    : DEFAULT_MIME_TYPE
}

function requireBytes(bytes: Uint8Array): Uint8Array {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('Image paste bytes must be a Uint8Array')
  }
  return new Uint8Array(bytes)
}

function normalizeInput(
  input: ImagePasteInput,
  index: number,
): ImagePasteInput {
  if (input === null || typeof input !== 'object') {
    throw new TypeError(`Image paste input ${index} must be an object`)
  }
  if (input.name !== undefined && typeof input.name !== 'string') {
    throw new TypeError(`Image paste input ${index} name must be a string`)
  }
  return Object.freeze({
    ...(input.name === undefined ? {} : { name: input.name }),
    mimeType: normalizeMimeType(input.mimeType),
    bytes: requireBytes(input.bytes),
  })
}

function normalizeHostPath(
  hostPath: WorkspacePath | string | null | undefined,
): WorkspacePath | undefined {
  if (hostPath === null || hostPath === undefined) return undefined
  if (typeof hostPath !== 'string' || hostPath.trim().length === 0) {
    return undefined
  }
  try {
    return createWorkspacePath(hostPath)
  } catch {
    return undefined
  }
}

function normalizedFileName(value: string): string {
  const withoutPath = value.replaceAll('\\', '/').split('/').at(-1) ?? ''
  const cleaned = withoutPath
    .replace(/[\u0000-\u001f\u007f]/gu, '')
    .replace(/[\[\]()<>{}:;"'`]/gu, '-')
    .trim()
  return cleaned.length > 0 ? cleaned : 'image'
}

function extensionForMime(mimeType: string): string {
  return MIME_EXTENSIONS[mimeType] ?? 'png'
}

function timestampFor(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '00000000-000000'
  }
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function defaultNameGenerator(
  input: ImagePasteInput,
  index: number,
  now: () => Date,
  random: () => string,
): string {
  const token = random()
    .replace(/[^a-z0-9]/giu, '')
    .slice(0, 8)
    .padEnd(4, String(index % 10))
  return `Pasted-${timestampFor(now())}-${token}.${extensionForMime(input.mimeType)}`
}

function altTextFor(input: ImagePasteInput): string {
  const candidate = normalizedFileName(input.name ?? 'image')
    .replace(/\.[a-z0-9]+$/iu, '')
    .replace(/[\r\n\]]/gu, ' ')
    .trim()
  return candidate.length > 0 ? candidate : 'image'
}

/** Encodes bytes without relying on browser globals or Node Buffer. */
export function bytesToBase64(bytes: Uint8Array): string {
  const source = requireBytes(bytes)
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let encoded = ''

  for (let index = 0; index < source.length; index += 3) {
    const first = source[index] ?? 0
    const second = source[index + 1]
    const third = source[index + 2]
    const hasSecond = second !== undefined
    const hasThird = third !== undefined

    encoded += alphabet[first >> 2]
    encoded += alphabet[((first & 0x03) << 4) | ((second ?? 0) >> 4)]
    encoded += hasSecond
      ? alphabet[((second! & 0x0f) << 2) | ((third ?? 0) >> 6)]
      : '='
    encoded += hasThird ? alphabet[third! & 0x3f] : '='
  }

  return encoded
}

export function bytesToDataUri(bytes: Uint8Array, mimeType = DEFAULT_MIME_TYPE): string {
  return `data:${normalizeMimeType(mimeType)};base64,${bytesToBase64(bytes)}`
}

/**
 * Computes the canonical workspace destination written to the binary port.
 * Markdown uses `computeImageAttachmentSourcePath` below instead of this
 * workspace path.
 */
export function computeImageAttachmentPath(
  mode: ImagePasteMode,
  hostPath: WorkspacePath | string | null | undefined,
  fileName: string,
): WorkspacePath | undefined {
  const normalizedMode = requireImagePasteMode(mode)
  if (normalizedMode === 'inline') return undefined

  const host = normalizeHostPath(hostPath)
  if (host === undefined || host === '') return undefined

  const name = normalizedFileName(fileName)
  const parent = workspaceParent(host)
  switch (normalizedMode) {
    case 'same-dir':
      return workspaceJoin(parent, name)
    case 'root-images':
      return workspaceJoin(createWorkspacePath('images'), name)
    case 'file-images':
      return workspaceJoin(workspaceJoin(parent, 'images'), name)
  }
}

/**
 * Computes the Markdown source spelling for an attachment destination. The
 * destination remains a canonical workspace path for filesystem operations;
 * only the persisted source is relative to the current document directory.
 */
export function computeImageAttachmentSourcePath(
  mode: ImagePasteMode,
  hostPath: WorkspacePath | string | null | undefined,
  fileName: string,
): string | undefined {
  const target = computeImageAttachmentPath(mode, hostPath, fileName)
  const host = normalizeHostPath(hostPath)
  if (target === undefined || host === undefined) return undefined
  return documentRelativeImageSourcePath(target, host)
}

export function imageMarkdownReference(
  input: ImagePasteInput,
  source: string,
): string {
  const alt = altTextFor(input).replace(/\[/gu, '(')
  return `![${alt}](${source})`
}

function safeReason(error: unknown, fallback: string): string {
  try {
    const text = String(error)
    return text.length > 0 ? text : fallback
  } catch {
    return fallback
  }
}

function fallback(
  input: ImagePasteInput,
  reason: string,
): ImagePasteFallback {
  return Object.freeze({
    ...(input.name === undefined ? {} : { inputName: input.name }),
    reason,
  })
}

function inlineReference(
  input: ImagePasteInput,
  reason: string,
): { readonly reference: ImagePasteReference; readonly fallback: ImagePasteFallback } {
  const reference = Object.freeze({
    markdown: imageMarkdownReference(
      input,
      bytesToDataUri(input.bytes, input.mimeType),
    ),
    source: 'inline' as const,
    ...(input.name === undefined ? {} : { inputName: input.name }),
  })
  return Object.freeze({ reference, fallback: fallback(input, reason) })
}

/**
 * Application policy for clipboard images. It owns persistence/fallback
 * decisions but never mutates a DocumentStore; an editor adapter applies the
 * returned Markdown references through its projection mutation capability.
 */
export class ImageAttachmentService {
  private readonly fileSystem: BinaryFileSystemPort | undefined
  private readonly nameGenerator: ImageAttachmentNameGenerator
  private readonly now: () => Date
  private readonly random: () => string

  constructor(options: ImageAttachmentServiceOptions = {}) {
    if (options === null || typeof options !== 'object') {
      throw new TypeError('Image attachment service options are required')
    }
    this.fileSystem = options.fileSystem
    this.now = options.now ?? (() => new Date())
    this.random = options.random ?? (() => Math.random().toString(36))
    this.nameGenerator =
      options.nameGenerator ?? ((input, index) =>
        defaultNameGenerator(input, index, this.now, this.random))
  }

  async paste(request: ImagePasteRequest): Promise<ImagePasteResult> {
    if (request === null || typeof request !== 'object') {
      throw new TypeError('Image paste request is required')
    }
    if (!Array.isArray(request.images)) {
      throw new TypeError('Image paste request images must be an array')
    }

    const mode = requireImagePasteMode(
      request.mode ?? DEFAULT_IMAGE_PASTE_MODE,
    )
    const hostPath = normalizeHostPath(request.hostPath)
    const normalizedInputs = request.images.map(normalizeInput)
    const references: ImagePasteReference[] = []
    const savedPaths: WorkspacePath[] = []
    const fallbacks: ImagePasteFallback[] = []

    for (const [index, input] of normalizedInputs.entries()) {
      if (mode === 'inline') {
        const inlined = inlineReference(input, 'inline image paste mode')
        references.push(inlined.reference)
        continue
      }

      let target: WorkspacePath | undefined
      let sourcePath: string | undefined
      try {
        const generatedName = this.nameGenerator(input, index)
        if (typeof generatedName !== 'string' || generatedName.length === 0) {
          throw new TypeError('Image attachment name must be non-empty')
        }
        target = computeImageAttachmentPath(mode, hostPath, generatedName)
        sourcePath = computeImageAttachmentSourcePath(
          mode,
          hostPath,
          generatedName,
        )
      } catch (error) {
        const inlined = inlineReference(
          input,
          `attachment path unavailable: ${safeReason(error, 'invalid path')}`,
        )
        references.push(inlined.reference)
        fallbacks.push(inlined.fallback)
        continue
      }

      if (target === undefined || sourcePath === undefined) {
        const reason =
          hostPath === undefined
            ? 'document has no workspace path'
            : 'document-relative image path is unavailable'
        const inlined = inlineReference(input, reason)
        references.push(inlined.reference)
        fallbacks.push(inlined.fallback)
        continue
      }

      if (this.fileSystem === undefined) {
        const inlined = inlineReference(input, 'binary filesystem is unavailable')
        references.push(inlined.reference)
        fallbacks.push(inlined.fallback)
        continue
      }

      try {
        await this.fileSystem.writeBinary(target, input.bytes)
        references.push(
          Object.freeze({
            markdown: imageMarkdownReference(input, sourcePath),
            source: 'file' as const,
            path: target,
            ...(input.name === undefined ? {} : { inputName: input.name }),
          }),
        )
        savedPaths.push(target)
      } catch (error) {
        const inlined = inlineReference(
          input,
          `binary write failed: ${safeReason(error, 'unknown filesystem error')}`,
        )
        references.push(inlined.reference)
        fallbacks.push(inlined.fallback)
      }
    }

    return createImagePasteResult({
      references,
      savedPaths,
      fallbacks,
    })
  }

  /** Alias emphasizing that this operation prepares an editor paste batch. */
  async process(request: ImagePasteRequest): Promise<ImagePasteResult> {
    return this.paste(request)
  }

  /** Removes files written by a batch that could not be committed to Markdown. */
  async cleanup(paths: readonly string[]): Promise<ImageAttachmentCleanupResult> {
    const deletedPaths: WorkspacePath[] = []
    const failedPaths: WorkspacePath[] = []
    if (this.fileSystem?.deleteBinary === undefined) {
      return Object.freeze({ deletedPaths, failedPaths: paths.map((path) => {
        try {
          return createWorkspacePath(path)
        } catch {
          return undefined
        }
      }).filter((path): path is WorkspacePath => path !== undefined) })
    }

    for (const path of paths) {
      let normalized: WorkspacePath
      try {
        normalized = createWorkspacePath(path)
      } catch {
        continue
      }
      try {
        await this.fileSystem.deleteBinary(normalized)
        deletedPaths.push(normalized)
      } catch {
        failedPaths.push(normalized)
      }
    }
    return Object.freeze({
      deletedPaths: Object.freeze(deletedPaths),
      failedPaths: Object.freeze(failedPaths),
    })
  }
}

/** Descriptive alias for code that calls the policy a paste service. */
export const ImagePasteService = ImageAttachmentService

export async function persistImagePaste(
  request: ImagePasteRequest,
  options: ImageAttachmentServiceOptions = {},
): Promise<ImagePasteResult> {
  return new ImageAttachmentService(options).paste(request)
}
