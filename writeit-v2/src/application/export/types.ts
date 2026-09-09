import type { DocumentPath } from '../../core/document'

export type ExportFormat = 'markdown' | 'pdf' | 'docx' | 'custom'

export interface DocumentSnapshot {
  readonly id: string
  readonly path: DocumentPath | string
  readonly markdown: string
  readonly revision: number
}

export interface ExportContext {
  readonly format: ExportFormat
  readonly outputPath?: string
  readonly title?: string
  readonly includeReferences?: boolean
}

export interface ExportOutput {
  readonly path: string
  readonly format: ExportFormat
  readonly mimeType: string
  readonly bytes: Uint8Array
}

export interface ExportFailure { readonly path: string; readonly format: ExportFormat; readonly message: string }
export interface ExportResult { readonly success: boolean; readonly output?: ExportOutput; readonly failure?: ExportFailure }
export interface Exporter { readonly format: ExportFormat; export(snapshot: DocumentSnapshot, context: ExportContext): Promise<ExportOutput> | ExportOutput }
