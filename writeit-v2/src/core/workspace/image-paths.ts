import type { WorkspacePath } from './types'
import { createWorkspacePath, workspaceParent } from './types'

/**
 * Image destinations that are already browser-loadable and do not name a
 * workspace file. They remain external projection data, never a workspace
 * path or a Markdown rewrite candidate.
 */
export function isExternalImageSource(source: string): boolean {
  const normalized = source.trim().toLowerCase()
  return (
    normalized.startsWith('data:') ||
    normalized.startsWith('blob:') ||
    normalized.startsWith('http://') ||
    normalized.startsWith('https://') ||
    source.trim().startsWith('//')
  )
}

function sourceWithoutQueryOrFragment(source: string): string {
  const query = source.indexOf('?')
  const fragment = source.indexOf('#')
  const cutAt = [query, fragment]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0]
  return cutAt === undefined ? source : source.slice(0, cutAt)
}

function decodePathSegment(segment: string): string | undefined {
  try {
    const decoded = decodeURIComponent(segment)
    // An encoded separator would make one source spelling address more than
    // one workspace path shape. Keep resolution fail-closed instead of
    // silently interpreting it as a different path.
    if (decoded.includes('/') || decoded.includes('\\')) return undefined
    return decoded
  } catch {
    return undefined
  }
}

function encodeSourceSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

function requireDocumentFilePath(value: string, name: string): WorkspacePath {
  if (typeof value !== 'string') {
    throw new TypeError(`${name} must be a string`)
  }
  const path = createWorkspacePath(value)
  if (path === '') {
    throw new TypeError(`${name} must identify a document file`)
  }
  return path
}

/**
 * Converts a canonical workspace destination into the canonical Markdown
 * source spelling relative to the containing directory of the document.
 *
 * The returned value is intentionally an ordinary relative URL path rather
 * than a WorkspacePath: `..` is valid in a document-relative source but is
 * not valid in a canonical workspace path.
 */
export function documentRelativeImageSourcePath(
  destinationPath: WorkspacePath | string,
  documentPath: WorkspacePath | string,
): string {
  const destination = requireDocumentFilePath(destinationPath, 'Image destination')
  const document = requireDocumentFilePath(documentPath, 'Document path')
  const baseSegments = workspaceParent(document)
    .split('/')
    .filter((segment) => segment.length > 0)
  const destinationSegments = destination.split('/')

  let commonLength = 0
  while (
    commonLength < baseSegments.length &&
    commonLength < destinationSegments.length &&
    baseSegments[commonLength] === destinationSegments[commonLength]
  ) {
    commonLength += 1
  }

  const upward = Array.from(
    { length: baseSegments.length - commonLength },
    () => '..',
  )
  const downward = destinationSegments
    .slice(commonLength)
    .map(encodeSourceSegment)
  const relativePath = [...upward, ...downward].join('/')
  if (relativePath.length === 0) {
    throw new TypeError('Image destination cannot be the document directory')
  }
  // Keep same-directory sources explicitly relative. This avoids allowing a
  // consumer with a private workspace-root convention to reinterpret a
  // canonical `images/file.png` source.
  return upward.length === 0 ? `./${relativePath}` : relativePath
}

/**
 * Resolves one Markdown image source against the current document directory.
 * This is deliberately a single document-relative interpretation: a missing
 * document-relative file is unavailable, not a signal to try workspace-root
 * semantics. The optional host path is required for workspace resolution.
 */
export function resolveDocumentRelativeImagePath(
  source: string,
  documentPath?: string | null,
): WorkspacePath | undefined {
  if (typeof source !== 'string') {
    throw new TypeError('Image source must be a string')
  }
  const normalizedSource = source.trim()
  const normalizedSeparators = normalizedSource.replaceAll('\\', '/')
  if (
    normalizedSource === '' ||
    isExternalImageSource(normalizedSource) ||
    normalizedSeparators.startsWith('/') ||
    /^[a-z][a-z\d+.-]*:/iu.test(normalizedSource)
  ) {
    return undefined
  }

  if (documentPath === null || documentPath === undefined) return undefined

  let document: WorkspacePath
  try {
    document = requireDocumentFilePath(documentPath, 'Document path')
  } catch {
    return undefined
  }

  const pathPart = sourceWithoutQueryOrFragment(normalizedSource)
  if (
    pathPart === '' ||
    pathPart.replaceAll('\\', '/').startsWith('/')
  ) {
    return undefined
  }

  const result = workspaceParent(document)
    .split('/')
    .filter((segment) => segment.length > 0)
  // Backslashes were accepted by the workspace adapter as a platform-input
  // convenience. Normalize them only for this path interpretation; emitted
  // Markdown remains slash-separated and canonical.
  const rawSegments = pathPart.replaceAll('\\', '/').split('/')

  for (const rawSegment of rawSegments) {
    if (rawSegment === '') continue
    const segment = decodePathSegment(rawSegment)
    if (segment === undefined || segment === '') return undefined
    if (segment === '.') continue
    if (segment === '..') {
      if (result.length === 0) return undefined
      result.pop()
      continue
    }
    result.push(segment)
  }

  if (result.length === 0) return undefined
  try {
    return createWorkspacePath(result.join('/'))
  } catch {
    return undefined
  }
}
