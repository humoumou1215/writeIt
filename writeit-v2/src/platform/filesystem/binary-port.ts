import type { WorkspacePath } from '../../core/workspace'
import type { FileSystemPort } from './port'

/**
 * Binary filesystem boundary used by attachments and image projections.
 * Paths are canonical workspace-relative paths, just like workspace tree
 * entries. Adapters must preserve bytes exactly and create parent directories
 * when necessary; they must not normalize or decode image data.
 */
export interface BinaryFileSystemPort {
  readBinary(path: WorkspacePath): Promise<Uint8Array>
  writeBinary(path: WorkspacePath, data: Uint8Array): Promise<void>
  /** Best-effort cleanup hook for an attachment whose Document mutation races. */
  deleteBinary?(path: WorkspacePath): Promise<void>
}

/** Explicit combined boundary for adapters that support text and binaries. */
export type AttachmentFileSystemPort = FileSystemPort & BinaryFileSystemPort

/** Compatibility alias for callers that name the capability after its data. */
export type BinaryFileSystem = BinaryFileSystemPort
