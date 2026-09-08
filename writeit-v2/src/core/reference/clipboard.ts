/**
 * Source-safe reference clipboard contracts.
 *
 * Clipboard events are handled by the editor/platform adapters, but the
 * payload grammar, file URI normalization, and Markdown edit plan live here
 * so they can be tested without a browser. No function in this module reads
 * or writes DocumentStore state.
 */

import {
  createWorkspacePath,
  workspaceName,
} from '../workspace'
import type { WorkspacePath } from '../workspace'
import { stringifyReference } from './syntax'

/** MIME used when WriteIt copies a workspace entry. */
export const REFERENCE_CLIPBOARD_MIME = 'application/x-writeit-node'
/** Compatibility name used by the platform/editor adapters. */
export const WRITEIT_NODE_MIME = REFERENCE_CLIPBOARD_MIME

export type ReferenceClipboardNodeKind = 'file' | 'directory'

/** Input accepted from an application or from the serialized MIME payload. */
export interface ReferenceClipboardNodeInput {
  readonly kind: ReferenceClipboardNodeKind | 'dir'
  readonly path: string
}

/** A validated, workspace-relative clipboard entry. */
export interface ReferenceClipboardNode {
  readonly kind: ReferenceClipboardNodeKind
  readonly path: WorkspacePath
}

export type ReferenceClipboardNodeValue =
  | ReferenceClipboardNode
  | ReferenceClipboardNodeInput

/** Legacy-shaped alias retained for adapters while the v2 model says directory. */
export type CopiedNode = ReferenceClipboardNodeInput

export interface ReferenceClipboardData {
  /** Kept structural so DOM DataTransfer and test doubles can both be used. */
  readonly types?: unknown
  readonly getData: (format: string) => string
}

export type ReferenceClipboardExternalFallback = 'basename' | 'none'

export interface ReferenceClipboardParseOptions {
  /**
   * Maps an absolute file-manager path into the current workspace. Returning
   * `null` rejects that path; returning `undefined` delegates to the fallback.
   */
  readonly resolveExternalPath?: (
    absolutePath: string,
  ) => string | null | undefined
  /** Optional absolute workspace root for a deterministic relative mapping. */
  readonly workspaceRootAbsolutePath?: string
  /** Outside-workspace file URLs fall back to their basename by default. */
  readonly externalFallback?: ReferenceClipboardExternalFallback
}

export interface ReferenceClipboardExtractOptions
  extends ReferenceClipboardParseOptions {
  /** Application-local fallback when the browser cannot expose clipboard data. */
  readonly store?: ReferenceClipboardStore
}

export interface ReferenceClipboardInsertItems {
  readonly files: readonly WorkspacePath[]
  readonly dirs: readonly WorkspacePath[]
  /** Original order, including files and directories. */
  readonly items: readonly ReferenceClipboardNode[]
}

/** Alias used by application adapters that describe directories as dirs. */
export type InsertItems = ReferenceClipboardInsertItems

export type ReferencePasteMode =
  | 'link'
  | 'embed'
  | 'embed-readonly'
  | 'embed-ro'

export interface ReferenceClipboardEdit {
  readonly from: number
  readonly to: number
  readonly insert: string
  readonly cursorOffset: number
}

export interface ReferenceClipboardEditOptions {
  readonly source: string
  readonly from: number
  readonly to: number
  readonly items: readonly ReferenceClipboardNodeValue[]
  readonly mode?: ReferencePasteMode
}

export interface ReferenceClipboardPayload {
  readonly mimeType: typeof REFERENCE_CLIPBOARD_MIME
  readonly json: string
  readonly text: string
  readonly nodes: readonly ReferenceClipboardNode[]
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`)
  return value
}

function normalizeNodeKind(value: unknown): ReferenceClipboardNodeKind {
  if (value === 'file') return 'file'
  if (value === 'directory' || value === 'dir') return 'directory'
  throw new TypeError('Clipboard node kind must be file or directory')
}

function normalizeNode(value: unknown, index: number): ReferenceClipboardNode {
  if (value === null || typeof value !== 'object') {
    throw new TypeError(`Clipboard node ${index} must be an object`)
  }
  const candidate = value as { readonly kind?: unknown; readonly path?: unknown }
  const kind = normalizeNodeKind(candidate.kind)
  const path = createWorkspacePath(requireString(candidate.path, `Clipboard node ${index} path`))
  if (path === '') {
    throw new TypeError(`Clipboard node ${index} must identify an entry`)
  }
  return Object.freeze({ kind, path })
}

/** Validates and canonicalizes workspace entries while preserving order. */
export function normalizeReferenceClipboardNodes(
  values: readonly unknown[],
): readonly ReferenceClipboardNode[] {
  if (!Array.isArray(values)) {
    throw new TypeError('Reference clipboard nodes must be an array')
  }
  return Object.freeze(values.map((value, index) => normalizeNode(value, index)))
}

function safeGetData(
  data: ReferenceClipboardData | null | undefined,
  format: string,
): string {
  if (!data || typeof data.getData !== 'function') return ''
  try {
    const value = data.getData(format)
    return typeof value === 'string' ? value : ''
  } catch {
    return ''
  }
}

function normalizedPathFromExternal(
  value: string | null | undefined,
): WorkspacePath | undefined {
  if (value === null || value === undefined) return undefined
  try {
    const path = createWorkspacePath(value)
    return path === '' ? undefined : path
  } catch {
    return undefined
  }
}

function normalizeAbsolutePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/+$/u, '')
}

function relativePathFromWorkspaceRoot(
  absolutePath: string,
  root: string | undefined,
): WorkspacePath | undefined {
  if (!root) return undefined
  const normalizedPath = normalizeAbsolutePath(absolutePath)
  const normalizedRoot = normalizeAbsolutePath(root)
  if (!normalizedRoot || !normalizedPath) return undefined

  const comparablePath = normalizedPath.toLocaleLowerCase('en-US')
  const comparableRoot = normalizedRoot.toLocaleLowerCase('en-US')
  if (comparablePath === comparableRoot) return undefined
  if (!comparablePath.startsWith(`${comparableRoot}/`)) return undefined

  const relative = normalizedPath.slice(normalizedRoot.length + 1)
  try {
    const path = createWorkspacePath(relative)
    return path === '' ? undefined : path
  } catch {
    return undefined
  }
}

function externalBasename(absolutePath: string): WorkspacePath | undefined {
  const normalized = normalizeAbsolutePath(absolutePath)
  if (!normalized) return undefined
  const lastSeparator = normalized.lastIndexOf('/')
  const name = lastSeparator < 0 ? normalized : normalized.slice(lastSeparator + 1)
  if (!name || name === '.' || name === '..') return undefined
  try {
    return createWorkspacePath(name)
  } catch {
    return undefined
  }
}

function resolveExternalPath(
  absolutePath: string,
  options: ReferenceClipboardParseOptions,
): WorkspacePath | undefined {
  if (options.resolveExternalPath) {
    let mapped: string | null | undefined
    try {
      mapped = options.resolveExternalPath(absolutePath)
    } catch {
      mapped = null
    }
    if (mapped === null) return undefined
    const explicit = normalizedPathFromExternal(mapped)
    if (explicit) return explicit
    if (mapped !== undefined) return undefined
  }

  const relative = relativePathFromWorkspaceRoot(
    absolutePath,
    options.workspaceRootAbsolutePath,
  )
  if (relative) return relative
  if (options.externalFallback === 'none') return undefined
  return externalBasename(absolutePath)
}

/** Converts a file:// URL (or an absolute path test double) to an absolute path. */
export function fileUriToAbsolute(uri: string): string | null {
  if (typeof uri !== 'string') return null
  const value = uri.trim()
  if (!value) return null

  let absolute: string
  if (/^file:/iu.test(value)) {
    try {
      const url = new URL(value)
      if (url.protocol.toLowerCase() !== 'file:') return null
      const pathname = decodeURIComponent(url.pathname)
      if (!pathname) return null
      absolute = url.hostname && url.hostname.toLowerCase() !== 'localhost'
        ? `//${url.hostname}${pathname}`
        : pathname
    } catch {
      return null
    }
  } else {
    // Plain paths are accepted only when they look absolute. Ordinary text
    // must continue through the browser's normal paste pipeline.
    if (
      !value.startsWith('/') &&
      !/^\\\\/u.test(value) &&
      !/^[A-Za-z]:[\\/]/u.test(value)
    ) {
      return null
    }
    absolute = value
  }

  const normalized = normalizeAbsolutePath(absolute)
  if (/^\/[A-Za-z]:\//u.test(normalized)) return normalized.slice(1)
  return normalized || null
}

/** Parses text/uri-list, ignoring comments and non-file schemes. */
export function parseFileUriList(raw: string): string[] {
  if (typeof raw !== 'string') return []
  const paths: string[] = []
  for (const line of raw.split(/\r?\n/u)) {
    const value = line.trim()
    if (!value || value.startsWith('#')) continue
    const absolute = fileUriToAbsolute(value)
    if (absolute) paths.push(absolute)
  }
  return paths
}

function parseSerializedNodes(raw: string): readonly ReferenceClipboardNode[] | undefined {
  if (!raw.trim()) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) return undefined
    const nodes = normalizeReferenceClipboardNodes(parsed)
    return nodes.length > 0 ? nodes : undefined
  } catch {
    return undefined
  }
}

function externalNodesFromText(
  raw: string,
  options: ReferenceClipboardParseOptions,
): readonly ReferenceClipboardNode[] | undefined {
  const absolutePaths = parseFileUriList(raw)
  if (absolutePaths.length === 0) return undefined
  const nodes: ReferenceClipboardNode[] = []
  for (const absolutePath of absolutePaths) {
    const path = resolveExternalPath(absolutePath, options)
    if (path) nodes.push(Object.freeze({ kind: 'file', path }))
  }
  return nodes.length > 0 ? Object.freeze(nodes) : undefined
}

/**
 * Extracts only recognized file-reference clipboard data. Ordinary text,
 * HTML, and image clipboard payloads return undefined so native paste can run.
 */
export function parseReferenceClipboardData(
  data: ReferenceClipboardData | null | undefined,
  options: ReferenceClipboardParseOptions = {},
): readonly ReferenceClipboardNode[] | undefined {
  const custom = parseSerializedNodes(safeGetData(data, REFERENCE_CLIPBOARD_MIME))
  if (custom) return custom

  const uriList = externalNodesFromText(
    safeGetData(data, 'text/uri-list'),
    options,
  )
  if (uriList) return uriList

  // Some file managers expose a single file URL only as text/plain. Do not
  // treat arbitrary paths as references; fileUriToAbsolute enforces the URL
  // or absolute-path shape first.
  return externalNodesFromText(safeGetData(data, 'text/plain'), options)
}

/** Extracts clipboard data and then uses the app-local copy fallback. */
export function extractReferenceClipboardItems(
  data: ReferenceClipboardData | null | undefined,
  options: ReferenceClipboardExtractOptions = {},
): readonly ReferenceClipboardNode[] | undefined {
  const parsed = parseReferenceClipboardData(data, options)
  if (parsed) {
    options.store?.set(parsed)
    return parsed
  }
  return options.store?.get()
}

/** Splits a copy payload while retaining the original order separately. */
export function splitReferenceClipboardItems(
  values: readonly ReferenceClipboardNodeValue[],
): ReferenceClipboardInsertItems {
  const items = Object.freeze(normalizeReferenceClipboardNodes(values))
  return Object.freeze({
    items,
    files: Object.freeze(
      items.filter((item) => item.kind === 'file').map((item) => item.path),
    ),
    dirs: Object.freeze(
      items
        .filter((item) => item.kind === 'directory')
        .map((item) => item.path),
    ),
  })
}

/** Compatibility alias for callers that use the legacy helper name. */
export const splitCopied = splitReferenceClipboardItems

/** Builds the browser/platform-neutral clipboard payload. */
export function createReferenceClipboardPayload(
  values: readonly ReferenceClipboardNodeValue[],
): ReferenceClipboardPayload {
  const nodes = normalizeReferenceClipboardNodes(values)
  return Object.freeze({
    mimeType: REFERENCE_CLIPBOARD_MIME,
    json: JSON.stringify(
      nodes.map((node) => ({ kind: node.kind, path: node.path })),
    ),
    text: nodes.map((node) => node.path).join('\n'),
    nodes,
  })
}

function normalizePasteMode(mode: ReferencePasteMode | undefined): Exclude<ReferencePasteMode, 'embed-ro'> {
  if (mode === undefined || mode === 'link') return 'link'
  if (mode === 'embed' || mode === 'embed-readonly') return mode
  if (mode === 'embed-ro') return 'embed-readonly'
  throw new TypeError(`Unknown reference paste mode: ${String(mode)}`)
}

function referenceText(
  node: ReferenceClipboardNode,
  mode: Exclude<ReferencePasteMode, 'embed-ro'>,
): string {
  if (node.kind === 'directory') return node.path
  return stringifyReference({
    kind: mode === 'link' ? 'link' : 'embed',
    path: node.path,
    readonly: mode === 'embed-readonly',
  })
}

/**
 * Creates the exact Markdown replacement for a clipboard paste. A single
 * link is inline; every multi-entry paste is newline-separated in clipboard
 * order, and directories are always plain workspace path text.
 */
export function createReferenceClipboardEdit(
  options: ReferenceClipboardEditOptions,
): ReferenceClipboardEdit | undefined
export function createReferenceClipboardEdit(
  source: string,
  from: number,
  to: number,
  items: readonly ReferenceClipboardNodeValue[],
  mode?: ReferencePasteMode,
): ReferenceClipboardEdit | undefined
export function createReferenceClipboardEdit(
  optionsOrSource: ReferenceClipboardEditOptions | string,
  from?: number,
  to?: number,
  items?: readonly ReferenceClipboardNodeValue[],
  mode?: ReferencePasteMode,
): ReferenceClipboardEdit | undefined {
  const options: ReferenceClipboardEditOptions =
    typeof optionsOrSource === 'string'
      ? {
          source: optionsOrSource,
          from: from as number,
          to: to as number,
          items: items ?? [],
          mode,
        }
      : optionsOrSource
  if (typeof options.source !== 'string') {
    throw new TypeError('Reference clipboard edit source must be a string')
  }
  if (
    !Number.isSafeInteger(options.from) ||
    !Number.isSafeInteger(options.to) ||
    options.from < 0 ||
    options.to < options.from ||
    options.to > options.source.length
  ) {
    throw new RangeError('Reference clipboard edit range must be inside the source')
  }
  const normalized = normalizeReferenceClipboardNodes(options.items)
  if (normalized.length === 0) return undefined

  const normalizedMode = normalizePasteMode(options.mode)
  const texts = normalized.map((node) => referenceText(node, normalizedMode))
  const insert =
    normalized.length === 1 && normalized[0]?.kind === 'file' && normalizedMode === 'link'
      ? texts[0]
      : texts.join('\n')
  return Object.freeze({
    from: options.from,
    to: options.to,
    insert,
    cursorOffset: insert.length,
  })
}

/** Compatibility alias for editor/application adapters. */
export const createReferencePasteEdit = createReferenceClipboardEdit

/** A small application-local fallback for platforms that reject clipboard.write. */
export class ReferenceClipboardStore {
  private itemsValue: readonly ReferenceClipboardNode[] | undefined

  set(values: readonly ReferenceClipboardNodeValue[]): readonly ReferenceClipboardNode[] {
    this.itemsValue = Object.freeze(normalizeReferenceClipboardNodes(values))
    return this.itemsValue
  }

  get(): readonly ReferenceClipboardNode[] | undefined {
    return this.itemsValue
  }

  clear(): void {
    this.itemsValue = undefined
  }
}

/** Shared only as a fallback; DocumentStore remains the source authority. */
export const defaultReferenceClipboardStore = new ReferenceClipboardStore()

/** A descriptive alias for callers that model a copy operation as a node list. */
export type ReferenceClipboardItems = readonly ReferenceClipboardNode[]

/** Returns the display name used by status/UI adapters. */
export function referenceClipboardItemName(
  item: ReferenceClipboardNode,
): string {
  return workspaceName(item.path)
}
