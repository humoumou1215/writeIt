import {
  createDocumentPath,
  isDocumentPath,
} from '../../core/document'
import type { DocumentPath } from '../../core/document'
import type { FileSystemPort } from './port'

export class FileNotFoundError extends Error {
  readonly path: DocumentPath

  constructor(path: DocumentPath) {
    super(`File not found: ${path}`)
    this.name = 'FileNotFoundError'
    this.path = path
  }
}

function requirePath(path: DocumentPath): DocumentPath {
  if (!isDocumentPath(path)) {
    throw new TypeError('File path must be a non-empty DocumentPath')
  }
  return createDocumentPath(path)
}

function requireContent(content: string): string {
  if (typeof content !== 'string') {
    throw new TypeError('File content must be a string')
  }
  return content
}

/**
 * Deterministic FileSystemPort implementation for unit and integration tests.
 * It has no browser, Tauri, localStorage, or filesystem dependencies.
 */
export class MemoryFileSystem implements FileSystemPort {
  private readonly files = new Map<DocumentPath, string>()

  constructor(initial: Readonly<Record<string, string>> = {}) {
    for (const [path, content] of Object.entries(initial)) {
      this.files.set(
        requirePath(path as DocumentPath),
        requireContent(content),
      )
    }
  }

  async readFile(path: DocumentPath): Promise<string> {
    const normalizedPath = requirePath(path)
    const content = this.files.get(normalizedPath)
    if (content === undefined) {
      throw new FileNotFoundError(normalizedPath)
    }
    return content
  }

  async writeFile(path: DocumentPath, content: string): Promise<void> {
    this.files.set(requirePath(path), requireContent(content))
  }

  hasFile(path: DocumentPath): boolean {
    return this.files.has(requirePath(path))
  }

  snapshot(): ReadonlyMap<DocumentPath, string> {
    return new Map(this.files)
  }
}
