import type { DocumentPath } from '../../core/document'

declare const fileVersionTokenBrand: unique symbol

/**
 * An opaque version of one logical workspace file (text or binary).
 *
 * Tokens are immutable primitive values produced by the filesystem adapter.
 * Callers may only compare a token for exact equality; they must not parse,
 * manufacture, or use it as a timestamp/content hash. A workspace move that
 * preserves file content preserves the logical file token.
 */
export type FileVersionToken = string & {
  readonly [fileVersionTokenBrand]: true
}

export function isFileVersionToken(value: unknown): value is FileVersionToken {
  return typeof value === 'string' && value.length > 0
}

/** Content and its corresponding adapter version read as one snapshot. */
export interface TextFileSnapshot {
  readonly content: string
  readonly version: FileVersionToken
}

export interface ConditionalWriteSuccess {
  readonly status: 'written'
  /** This result is safe only because compare-and-write was atomic. */
  readonly atomicity: 'strong'
  readonly version: FileVersionToken
}

export type ConditionalWriteConflictReason = 'changed' | 'deleted'

export interface ConditionalWriteConflict {
  readonly status: 'conflict'
  readonly reason: ConditionalWriteConflictReason
  readonly expectedVersion: FileVersionToken
  readonly actualVersion?: FileVersionToken
  /** Available when the current entry is a readable text file. */
  readonly actualContent?: string
}

export type ConditionalWriteDegradedReason =
  | 'atomicity-unavailable'
  | 'version-unavailable'

export interface ConditionalWriteDegraded {
  readonly status: 'degraded'
  readonly reason: ConditionalWriteDegradedReason
  readonly expectedVersion: FileVersionToken
  readonly message: string
}

/**
 * Conditional writes report expected races as data, rather than throwing.
 * Adapter failures unrelated to the expected version may still reject.
 */
export type ConditionalWriteResult =
  | ConditionalWriteSuccess
  | ConditionalWriteConflict
  | ConditionalWriteDegraded

/**
 * Text persistence boundary for Markdown documents.
 *
 * `writeFile` is intentionally retained for creation, explicit low-level
 * operations, and test/external-mutation simulation. Application save and
 * reference-rewrite paths must use `writeTextIfUnchanged`; an adapter that
 * cannot provide strong compare-and-write must return `degraded` without
 * mutating.
 */
export interface FileSystemPort {
  readFile(path: DocumentPath): Promise<string>
  readTextSnapshot(path: DocumentPath): Promise<TextFileSnapshot>
  writeFile(path: DocumentPath, content: string): Promise<void>
  writeTextIfUnchanged(
    path: DocumentPath,
    expectedVersion: FileVersionToken,
    content: string,
  ): Promise<ConditionalWriteResult>
}
