import type { WorkspacePath } from '../../core/workspace'
import type { FileSystemPort, FileVersionToken } from './port'

export interface ExclusiveBinaryCreateSuccess {
  readonly status: 'created'
  /** Exclusive creation is atomic at the adapter boundary. */
  readonly atomicity: 'strong'
  /** Opaque version proving ownership of the created bytes. */
  readonly version: FileVersionToken
}

export interface ExclusiveBinaryCreateCollision {
  readonly status: 'exists'
}

export type ExclusiveBinaryCreateResult =
  | ExclusiveBinaryCreateSuccess
  | ExclusiveBinaryCreateCollision

export interface ConditionalBinaryDeleteSuccess {
  readonly status: 'deleted'
}

export interface ConditionalBinaryDeleteNotOwned {
  readonly status: 'not-owned'
  readonly reason: 'changed' | 'missing'
  readonly actualVersion?: FileVersionToken
}

export type ConditionalBinaryDeleteResult =
  | ConditionalBinaryDeleteSuccess
  | ConditionalBinaryDeleteNotOwned

/**
 * Binary filesystem boundary used by attachments and image projections.
 * Paths are canonical workspace-relative paths, just like workspace tree
 * entries. Adapters must preserve bytes exactly and create parent directories
 * when necessary; they must not normalize or decode image data.
 *
 * Attachment transactions use `createBinaryExclusive`, never `writeBinary`:
 * a collision is reported without changing the existing entry. The returned
 * opaque version is then required for conditional compensation so a later
 * external replacement cannot be deleted as if it were the pasted image.
 */
export interface BinaryFileSystemPort {
  readBinary(path: WorkspacePath): Promise<Uint8Array>
  /** Low-level overwrite operation retained for explicit adapter/test use. */
  writeBinary(path: WorkspacePath, data: Uint8Array): Promise<void>
  createBinaryExclusive(
    path: WorkspacePath,
    data: Uint8Array,
  ): Promise<ExclusiveBinaryCreateResult>
  deleteBinaryIfUnchanged(
    path: WorkspacePath,
    expectedVersion: FileVersionToken,
  ): Promise<ConditionalBinaryDeleteResult>
  /** Unconditional deletion remains available only to workspace operations. */
  deleteBinary?(path: WorkspacePath): Promise<void>
}

/** Explicit combined boundary for adapters that support text and binaries. */
export type AttachmentFileSystemPort = FileSystemPort & BinaryFileSystemPort

/** Compatibility alias for callers that name the capability after its data. */
export type BinaryFileSystem = BinaryFileSystemPort
