import type { DocumentStore } from '../../core/document'
import { DiagnosticsRing, type DiagnosticsSnapshot } from '../../core/diagnostics'

export interface DiagnosticPrivacyOptions { readonly includeDocumentContent?: boolean; readonly includeAbsolutePaths?: boolean; readonly includeScreenshot?: boolean; readonly includeDom?: boolean }
export interface DiagnosticReport { readonly version: 1; readonly generatedAt: number; readonly privacy: Required<DiagnosticPrivacyOptions>; readonly diagnostics: DiagnosticsSnapshot; readonly documents?: readonly { path: string; revision: number; markdown: string }[] }

export class DiagnosticsService {
  readonly ring: DiagnosticsRing
  constructor(maxEntries = 200) { this.ring = new DiagnosticsRing(maxEntries) }
  captureDocumentState(store: DocumentStore): void { this.ring.record('documents.snapshot', { count: store.getAll().length, revisions: store.getAll().map((document) => document.revision) }) }
  report(store: DocumentStore, options: DiagnosticPrivacyOptions = {}): DiagnosticReport {
    const privacy = { includeDocumentContent: options.includeDocumentContent === true, includeAbsolutePaths: options.includeAbsolutePaths === true, includeScreenshot: options.includeScreenshot === true, includeDom: options.includeDom === true }
    const documents = privacy.includeDocumentContent ? store.getAll().map((document) => ({ path: privacy.includeAbsolutePaths ? String(document.path) : String(document.path).split('/').pop() ?? '', revision: document.revision, markdown: document.markdown })) : undefined
    return Object.freeze({ version: 1, generatedAt: Date.now(), privacy, diagnostics: this.ring.snapshot(), ...(documents ? { documents: Object.freeze(documents) } : {}) })
  }
}
