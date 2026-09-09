import type { TemplateCatalog } from './catalog'
import type { TemplateSuggestContext, TemplatePlaceholder, TemplateProviderRuntimePort, TemplateRecord } from './types'

export class TemplateService {
  constructor(private readonly catalog: TemplateCatalog, private readonly runtime: TemplateProviderRuntimePort = { enabled: false }) {}
  async refresh(): Promise<readonly TemplateRecord[]> { return this.catalog.rescan() }
  list(): readonly TemplateRecord[] { return this.catalog.list() }
  get(id: string): TemplateRecord | undefined { return this.catalog.get(id) }
  placeholders(source: string): readonly TemplatePlaceholder[] {
    const result: TemplatePlaceholder[] = []
    const matcher = /\{\{\s*([^{}]+?)\s*\}\}/gu
    let match: RegExpExecArray | null
    while ((match = matcher.exec(source))) result.push(Object.freeze({ from: match.index, to: match.index + match[0].length, label: match[1].trim() }))
    return Object.freeze(result)
  }
  insert(source: string, at: number, template: TemplateRecord): { readonly source: string; readonly from: number; readonly to: number } {
    if (!Number.isSafeInteger(at) || at < 0 || at > source.length) throw new RangeError('Template insertion offset is invalid')
    const next = `${source.slice(0, at)}${template.markdown}${source.slice(at)}`
    return Object.freeze({ source: next, from: at, to: at + template.markdown.length })
  }
  async suggestions(template: TemplateRecord, context: TemplateSuggestContext) {
    if (!this.runtime.enabled || !this.runtime.objectsFor) return Object.freeze([])
    try { return Object.freeze(await this.runtime.objectsFor(template, Object.freeze({ ...context }))) }
    catch { return Object.freeze([]) }
  }
  async exportContract(template: TemplateRecord): Promise<Readonly<Record<string, unknown>>> {
    if (!this.runtime.enabled || !this.runtime.exportMetadata) return Object.freeze({ templateId: template.id })
    try { return Object.freeze(await this.runtime.exportMetadata(template)) }
    catch { return Object.freeze({ templateId: template.id, providerFailed: true }) }
  }
}
