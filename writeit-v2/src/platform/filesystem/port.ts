import type { DocumentPath } from '../../core/document'

/**
 * Minimal persistence boundary for Markdown documents.
 *
 * Implementations may use Tauri, the File System Access API, a server, or an
 * in-memory map. Core document code depends only on its own state and the
 * application decides when a successfully written revision is acknowledged.
 */
export interface FileSystemPort {
  readFile(path: DocumentPath): Promise<string>
  writeFile(path: DocumentPath, content: string): Promise<void>
}
