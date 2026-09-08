import type { DocumentSnapshot, ExportContext, Exporter } from './types'

const encoder = new TextEncoder()
function pathFor(snapshot: DocumentSnapshot, context: ExportContext, extension: string): string {
  if (context.outputPath) return context.outputPath
  return String(snapshot.path).replace(/\.[^.\/]+$/u, '') + extension
}

export const markdownExporter: Exporter = { format: 'markdown', export: (snapshot, context) => Object.freeze({ path: pathFor(snapshot, context, '.md'), format: 'markdown', mimeType: 'text/markdown', bytes: encoder.encode(snapshot.markdown) }) }
export const pdfExporter: Exporter = { format: 'pdf', export: (snapshot, context) => {
  const body = snapshot.markdown.replace(/[()\\]/gu, '\\$&').replace(/\r?\n/gu, ' ')
  const content = `BT /F1 10 Tf 40 760 Td (${body.slice(0, 4000)}) Tj ET`
  const pdf = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0>>endobj\n3 0 obj<</Length ${content.length}>>stream\n${content}\nendstream endobj\n%%EOF`
  return Object.freeze({ path: pathFor(snapshot, context, '.pdf'), format: 'pdf', mimeType: 'application/pdf', bytes: encoder.encode(pdf) })
} }
export const docxExporter: Exporter = { format: 'docx', export: (snapshot, context) => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><document><body>${snapshot.markdown.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')}</body></document>`
  return Object.freeze({ path: pathFor(snapshot, context, '.docx'), format: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: encoder.encode(xml) })
} }
