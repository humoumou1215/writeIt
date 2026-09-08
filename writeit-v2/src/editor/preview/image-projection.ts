import {
  createWorkspacePath,
  isExternalImageSource,
  resolveDocumentRelativeImagePath,
  workspaceName,
} from '../../core/workspace'
import type { WorkspacePath } from '../../core/workspace'

/** A minimal reader supplied by the application/platform adapter. */
export interface ImageProjectionFileReader {
  readBinary(path: WorkspacePath): Promise<Uint8Array>
}

export type ImageProjectionResourceStatus =
  | 'ready'
  | 'external'
  | 'unavailable'

export interface ImageProjectionResource {
  /** The exact image source spelling retained in the Markdown source. */
  readonly source: string
  /** Blob/data/external URL used by an image element, or an empty string. */
  readonly url: string
  /** Resolved workspace path, when the destination identifies one. */
  readonly path?: WorkspacePath
  readonly name: string
  readonly alt: string
  readonly mimeType: string
  readonly bytes?: Uint8Array
  readonly status: ImageProjectionResourceStatus
  /** Human-readable read/decode reason; never written into Markdown. */
  readonly error?: string
}

export interface ImageProjectionResolver {
  resolve(
    source: string,
    hostPath?: string | null,
  ): Promise<ImageProjectionResource>
  invalidate(path?: WorkspacePath | string): void
  dispose(): void
}

export interface ImageProjectionResolverOptions {
  readonly reader?: ImageProjectionFileReader
  readonly maxCachedImages?: number
  readonly createObjectUrl?: (blob: Blob) => string
  readonly revokeObjectUrl?: (url: string) => void
}

export interface ImageProjectionCallbacks {
  readonly onPreview?: (resource: ImageProjectionResource) => void
  readonly onCopy?: (
    resource: ImageProjectionResource,
  ) => void | Promise<void>
  readonly onReveal?: (path: WorkspacePath) => void
}

export interface ImageProjectionRenderOptions
  extends ImageProjectionCallbacks {
  readonly imageResolver?: ImageProjectionResolver
  readonly documentPath?: string | null
}

const DEFAULT_IMAGE_MIME = 'image/png'
const DEFAULT_CACHE_SIZE = 64

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  webp: 'image/webp',
})

function formatError(error: unknown, fallback: string): string {
  try {
    const value = String(error)
    return value.length > 0 ? value : fallback
  } catch {
    return fallback
  }
}

function requireSource(source: string): string {
  if (typeof source !== 'string') {
    throw new TypeError('Image source must be a string')
  }
  return source.trim()
}

function decodePathPart(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function sourceWithoutQueryOrFragment(source: string): string {
  const query = source.indexOf('?')
  const fragment = source.indexOf('#')
  const cutAt = [query, fragment]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0]
  return cutAt === undefined ? source : source.slice(0, cutAt)
}

/**
 * Returns the one workspace path represented by a Markdown image source.
 * Every source spelling is interpreted relative to the current document's
 * containing directory; workspace-root-first fallback is intentionally not a
 * valid compatibility rule.
 */
export function resolveWorkspaceImageCandidates(
  source: string,
  hostPath?: string | null,
): readonly WorkspacePath[] {
  const resolved = resolveDocumentRelativeImagePath(source, hostPath)
  return resolved === undefined
    ? Object.freeze([])
    : Object.freeze([resolved])
}

/**
 * Returns the workspace destination addressed by the document-relative source,
 * if one can be formed.
 */
export function resolveWorkspaceImagePath(
  source: string,
  hostPath?: string | null,
): WorkspacePath | undefined {
  return resolveWorkspaceImageCandidates(source, hostPath)[0]
}

export function mimeTypeForImagePath(path: string): string {
  const normalized = path.replaceAll('\\', '/').split(/[?#]/u)[0] ?? ''
  const name = normalized.slice(normalized.lastIndexOf('/') + 1)
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  return MIME_BY_EXTENSION[extension] ?? DEFAULT_IMAGE_MIME
}

export const mimeForPath = mimeTypeForImagePath

function imageName(source: string, path?: WorkspacePath): string {
  if (path !== undefined) return workspaceName(path)
  const normalized = sourceWithoutQueryOrFragment(source)
    .replaceAll('\\', '/')
    .replace(/\/$/u, '')
  const lastSegment = normalized.slice(normalized.lastIndexOf('/') + 1)
  return decodePathPart(lastSegment) || 'image'
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes)
}

/** Encodes bytes without requiring Buffer or a browser-only base64 helper. */
export function imageBytesToBase64(bytes: Uint8Array): string {
  const source = copyBytes(bytes)
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let encoded = ''

  for (let index = 0; index < source.length; index += 3) {
    const first = source[index] ?? 0
    const second = source[index + 1]
    const third = source[index + 2]
    encoded += alphabet[first >> 2]
    encoded += alphabet[((first & 0x03) << 4) | ((second ?? 0) >> 4)]
    encoded += second === undefined
      ? '='
      : alphabet[((second & 0x0f) << 2) | ((third ?? 0) >> 6)]
    encoded += third === undefined ? '=' : alphabet[third & 0x3f]
  }

  return encoded
}

export function imageBytesToDataUri(
  bytes: Uint8Array,
  mimeType = DEFAULT_IMAGE_MIME,
): string {
  return `data:${mimeType};base64,${imageBytesToBase64(bytes)}`
}

/**
 * Returns a self-contained URL for a source-backed resource when its current
 * URL is a revocable/host-provided URL. Preview projections use this after a
 * browser decode error so an object URL lifecycle problem cannot turn valid
 * bytes into a false unavailable state.
 */
export function imageResourceDataUriFallback(
  resource: Pick<ImageProjectionResource, 'bytes' | 'mimeType' | 'url'>,
): string | undefined {
  if (!(resource.bytes instanceof Uint8Array)) return undefined
  const dataUri = imageBytesToDataUri(resource.bytes, resource.mimeType)
  return dataUri === resource.url ? undefined : dataUri
}

function decodeDataUri(source: string): {
  readonly bytes?: Uint8Array
  readonly mimeType: string
} {
  const match = source.match(/^data:([^;,\s]+)?(;base64)?,([\s\S]*)$/iu)
  if (!match) return { mimeType: DEFAULT_IMAGE_MIME }

  const mimeType = match[1]?.toLowerCase() ?? DEFAULT_IMAGE_MIME
  const payload = match[3] ?? ''
  if (match[2]) {
    // atob is intentionally optional: the browser can display the URI even
    // when a host test environment has no base64 decoder.
    try {
      if (typeof globalThis.atob === 'function') {
        const binary = globalThis.atob(payload)
        const bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index)
        }
        return { bytes, mimeType }
      }
    } catch {
      return { mimeType }
    }
  }

  try {
    const decoded = decodeURIComponent(payload)
    const bytes = new TextEncoder().encode(decoded)
    return { bytes, mimeType }
  } catch {
    return { mimeType }
  }
}

function passthroughResource(
  source: string,
  alt: string,
): ImageProjectionResource {
  const data = source.toLowerCase().startsWith('data:')
    ? decodeDataUri(source)
    : undefined
  return Object.freeze({
    source,
    url: source,
    name: imageName(source),
    alt,
    mimeType: data?.mimeType ?? mimeTypeForImagePath(source),
    ...(data?.bytes === undefined ? {} : { bytes: data.bytes }),
    status: 'external' as const,
  })
}

function unavailableResource(
  source: string,
  alt: string,
  path: WorkspacePath | undefined,
  reason: string,
): ImageProjectionResource {
  return Object.freeze({
    source,
    url: '',
    ...(path === undefined ? {} : { path }),
    name: imageName(source, path),
    alt,
    mimeType: mimeTypeForImagePath(path ?? source),
    status: 'unavailable' as const,
    error: reason,
  })
}

interface CachedImage {
  readonly url: string
  readonly bytes: Uint8Array
  readonly mimeType: string
  readonly isObjectUrl: boolean
}

/**
 * Resolves document-relative Markdown image destinations to browser-loadable
 * URLs. It is an editor projection helper: it reads bytes but never mutates a
 * DocumentStore or changes the Markdown source after a read failure.
 */
export class WorkspaceImageProjectionResolver
  implements ImageProjectionResolver
{
  private readonly reader: ImageProjectionFileReader | undefined
  private readonly maxCachedImages: number
  private readonly createObjectUrl: (blob: Blob) => string
  private readonly revokeObjectUrl: (url: string) => void
  private readonly canCreateObjectUrl: boolean
  private readonly cache = new Map<WorkspacePath, CachedImage>()
  /** Shares one read/URL creation among concurrent projections of one path. */
  private readonly pendingReads = new Map<WorkspacePath, Promise<CachedImage>>()
  private disposed = false

  constructor(options: ImageProjectionResolverOptions = {}) {
    if (options === null || typeof options !== 'object') {
      throw new TypeError('Image projection resolver options are required')
    }
    this.reader = options.reader
    this.maxCachedImages =
      options.maxCachedImages === undefined
        ? DEFAULT_CACHE_SIZE
        : options.maxCachedImages
    if (
      !Number.isSafeInteger(this.maxCachedImages) ||
      this.maxCachedImages < 1
    ) {
      throw new RangeError('Image projection cache size must be at least one')
    }

    this.canCreateObjectUrl =
      options.createObjectUrl !== undefined ||
      typeof globalThis.URL?.createObjectURL === 'function'
    this.createObjectUrl =
      options.createObjectUrl ?? ((blob) => URL.createObjectURL(blob))
    this.revokeObjectUrl =
      options.revokeObjectUrl ?? ((url) => URL.revokeObjectURL(url))
  }

  async resolve(
    source: string,
    hostPath: string | null | undefined,
  ): Promise<ImageProjectionResource> {
    const normalizedSource = requireSource(source)
    const alt = imageName(normalizedSource)
    if (isExternalImageSource(normalizedSource)) {
      return passthroughResource(normalizedSource, alt)
    }

    const candidates = resolveWorkspaceImageCandidates(
      normalizedSource,
      hostPath,
    )
    const firstCandidate = candidates[0]
    if (firstCandidate === undefined) {
      return unavailableResource(
        normalizedSource,
        alt,
        undefined,
        'Image destination is not a document-relative path',
      )
    }
    if (this.reader === undefined) {
      return unavailableResource(
        normalizedSource,
        alt,
        firstCandidate,
        'Binary image reader is unavailable',
      )
    }

    let lastError: unknown
    for (const candidate of candidates) {
      if (this.disposed) {
        return unavailableResource(
          normalizedSource,
          alt,
          firstCandidate,
          'Image projection was disposed',
        )
      }

      const cached = this.cache.get(candidate)
      if (cached !== undefined) {
        this.cache.delete(candidate)
        this.cache.set(candidate, cached)
        return this.readyResource(normalizedSource, alt, candidate, cached)
      }

      let pendingRead = this.pendingReads.get(candidate)
      if (pendingRead === undefined) {
        pendingRead = this.readAndCache(candidate)
        this.pendingReads.set(candidate, pendingRead)
      }

      try {
        const cachedImage = await pendingRead
        if (this.disposed) {
          return unavailableResource(
            normalizedSource,
            alt,
            firstCandidate,
            'Image projection was disposed',
          )
        }
        return this.readyResource(
          normalizedSource,
          alt,
          candidate,
          cachedImage,
        )
      } catch (error) {
        lastError = error
      } finally {
        if (this.pendingReads.get(candidate) === pendingRead) {
          this.pendingReads.delete(candidate)
        }
      }
    }

    return unavailableResource(
      normalizedSource,
      alt,
      firstCandidate,
      `Could not read image ${firstCandidate}: ${formatError(
        lastError,
        'unknown read error',
      )}`,
    )
  }

  invalidate(path?: WorkspacePath | string): void {
    if (path === undefined) {
      this.clearCache()
      return
    }
    let normalized: WorkspacePath
    try {
      normalized = createWorkspacePath(path)
    } catch {
      return
    }
    const cached = this.cache.get(normalized)
    if (cached === undefined) return
    this.cache.delete(normalized)
    if (cached.isObjectUrl) this.revokeSafely(cached.url)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.pendingReads.clear()
    this.clearCache()
  }

  private readAndCache(path: WorkspacePath): Promise<CachedImage> {
    if (this.reader === undefined) {
      return Promise.reject(new Error('Binary image reader is unavailable'))
    }

    let read: Promise<Uint8Array>
    try {
      read = this.reader.readBinary(path)
    } catch (error) {
      return Promise.reject(error)
    }

    return read.then((bytes) => {
      if (!(bytes instanceof Uint8Array)) {
        throw new TypeError('Binary image reader must return Uint8Array')
      }
      if (this.disposed) {
        throw new Error('Image projection was disposed')
      }

      return this.cacheImage(
        path,
        bytes,
        mimeTypeForImagePath(path),
      )
    })
  }

  private cacheImage(
    path: WorkspacePath,
    bytes: Uint8Array,
    mimeType: string,
  ): CachedImage {
    const copied = copyBytes(bytes)
    let url = ''
    let isObjectUrl = false

    try {
      if (
        typeof globalThis.Blob === 'function' &&
        this.canCreateObjectUrl
      ) {
        url = this.createObjectUrl(
          new Blob([copied.buffer as ArrayBuffer], { type: mimeType }),
        )
        isObjectUrl = typeof url === 'string' && url.length > 0
      }
    } catch {
      // Test hosts and restricted webviews may not expose object URLs. The
      // portable data URI is a display fallback, not a source rewrite.
      url = ''
    }

    if (!isObjectUrl) url = imageBytesToDataUri(copied, mimeType)

    const cached: CachedImage = Object.freeze({
      url,
      bytes: copied,
      mimeType,
      isObjectUrl,
    })
    const previous = this.cache.get(path)
    if (previous?.isObjectUrl && previous.url !== cached.url) {
      this.revokeSafely(previous.url)
    }
    this.cache.delete(path)
    this.cache.set(path, cached)
    while (this.cache.size > this.maxCachedImages) {
      const oldest = this.cache.keys().next().value as WorkspacePath | undefined
      if (oldest === undefined) break
      const old = this.cache.get(oldest)
      this.cache.delete(oldest)
      if (old?.isObjectUrl) this.revokeSafely(old.url)
    }
    return cached
  }

  private readyResource(
    source: string,
    alt: string,
    path: WorkspacePath,
    cached: CachedImage,
  ): ImageProjectionResource {
    return Object.freeze({
      source,
      url: cached.url,
      path,
      name: imageName(source, path),
      alt,
      mimeType: cached.mimeType,
      bytes: copyBytes(cached.bytes),
      status: 'ready' as const,
    })
  }

  private clearCache(): void {
    for (const cached of this.cache.values()) {
      if (cached.isObjectUrl) this.revokeSafely(cached.url)
    }
    this.cache.clear()
  }

  private revokeSafely(url: string): void {
    try {
      this.revokeObjectUrl(url)
    } catch {
      // Revocation is cleanup only and must not affect source display/state.
    }
  }
}

/**
 * Copies decoded image bytes, rather than the Markdown path, through the
 * browser Clipboard API. Unsupported permissions/capabilities are reported
 * as false and never affect the document source.
 */
export async function copyImageToClipboard(
  resource: ImageProjectionResource,
  clipboard?: Pick<Clipboard, 'write'>,
): Promise<boolean> {
  if (
    resource === null ||
    typeof resource !== 'object' ||
    !(resource.bytes instanceof Uint8Array)
  ) {
    return false
  }

  const targetClipboard =
    clipboard ??
    (typeof globalThis.navigator !== 'undefined'
      ? globalThis.navigator.clipboard
      : undefined)
  const ClipboardItemConstructor = globalThis.ClipboardItem
  if (
    !targetClipboard ||
    typeof targetClipboard.write !== 'function' ||
    typeof ClipboardItemConstructor !== 'function' ||
    typeof globalThis.Blob !== 'function'
  ) {
    return false
  }

  try {
    const bytes = new Uint8Array(resource.bytes)
    const blob = new Blob([bytes.buffer as ArrayBuffer], {
      type: resource.mimeType,
    })
    const item = new ClipboardItemConstructor({
      [resource.mimeType]: blob,
    })
    await targetClipboard.write([item])
    return true
  } catch {
    return false
  }
}

export const ImageProjectionResolver = WorkspaceImageProjectionResolver