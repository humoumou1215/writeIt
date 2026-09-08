import type { TemplateRecord, TemplateScanner } from './types'

function parseTemplate(path: string, content: string, scope: 'workspace' | 'global'): TemplateRecord | undefined {
  if (!/\.md(?:own)?$/iu.test(path)) return undefined
  const first = content.match(/^(?:---\s*\n)?(?:doctype|type)\s*:\s*([^\n]+)\n/iu)
  const id = path.replace(/^.*\//u, '').replace(/\.md(?:own)?$/iu, '')
  return Object.freeze({ id, name: first?.[1]?.trim() || id, markdown: content, scope, path, ...(first?.[1] ? { doctype: first[1].trim() } : {}) })
}

export class TemplateCatalog {
  private records: readonly TemplateRecord[] = []
  private failure: string | null = null
  constructor(private readonly scanner: TemplateScanner) {}
  async rescan(): Promise<readonly TemplateRecord[]> {
    try {
      const [global, workspace] = await Promise.all([this.scanner.list('global'), this.scanner.list('workspace')])
      const byId = new Map<string, TemplateRecord>()
      for (const item of global) { const record = parseTemplate(item.path, item.content, 'global'); if (record) byId.set(record.id, record) }
      for (const item of workspace) { const record = parseTemplate(item.path, item.content, 'workspace'); if (record) byId.set(record.id, record) }
      this.records = Object.freeze([...byId.values()].sort((a, b) => a.name.localeCompare(b.name)))
      this.failure = null
    } catch (error) {
      this.failure = error instanceof Error ? error.message : String(error)
      this.records = Object.freeze([])
    }
    return this.records
  }
  list(): readonly TemplateRecord[] { return this.records }
  getFailure(): string | null { return this.failure }
  get(id: string): TemplateRecord | undefined { return this.records.find((record) => record.id === id) }
}
