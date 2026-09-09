import type { DocumentLocator, DocumentStore } from '../../core/document'
import { docxExporter, markdownExporter, pdfExporter } from './builtin'
import type { DocumentSnapshot, ExportContext, Exporter, ExportFormat, ExportResult } from './types'

export interface BatchExportItem { readonly snapshot: DocumentSnapshot; readonly context: ExportContext }

export class ExportService {
  private readonly exporters = new Map<ExportFormat, Exporter>()
  constructor(exporters: readonly Exporter[] = [markdownExporter, pdfExporter, docxExporter]) { for (const exporter of exporters) this.exporters.set(exporter.format, exporter) }
  register(exporter: Exporter): void { this.exporters.set(exporter.format, exporter) }
  snapshot(store: DocumentStore, locator: DocumentLocator): DocumentSnapshot {
    const document = store.get(locator); if (!document) throw new Error('Export document is unavailable')
    return Object.freeze({ id: document.id, path: document.path, markdown: document.markdown, revision: document.revision })
  }
  async export(snapshot: DocumentSnapshot, context: ExportContext): Promise<ExportResult> {
    const exporter = this.exporters.get(context.format)
    if (!exporter) return Object.freeze({ success: false, failure: { path: String(snapshot.path), format: context.format, message: `No exporter for ${context.format}` } })
    try { return Object.freeze({ success: true, output: await exporter.export(Object.freeze({ ...snapshot }), Object.freeze({ ...context })) }) }
    catch (error) { return Object.freeze({ success: false, failure: { path: String(snapshot.path), format: context.format, message: error instanceof Error ? error.message : String(error) } }) }
  }
  async batch(items: readonly BatchExportItem[]): Promise<readonly ExportResult[]> { return Object.freeze(await Promise.all(items.map((item) => this.export(item.snapshot, item.context)))) }
}
