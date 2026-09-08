import { DocumentStore, type DocumentLocator } from '../../core/document'
import { searchSources, type SearchFileResult, type SearchQuery } from '../../core/search'

export interface SearchDocumentReader {
  list(): readonly { readonly path: string; readonly markdown: string }[]
}

export class SearchService {
  private cache = new Map<string, readonly SearchFileResult[]>()

  constructor(private readonly reader: SearchDocumentReader) {}

  search(query: SearchQuery, cacheKey = JSON.stringify(query)): readonly SearchFileResult[] {
    const cached = this.cache.get(cacheKey)
    if (cached) return cached
    const result = searchSources(this.reader.list(), query)
    this.cache.set(cacheKey, result)
    return result
  }

  invalidate(): void { this.cache.clear() }

  replaceInDocument(
    store: DocumentStore,
    locator: DocumentLocator,
    from: number,
    to: number,
    replacement: string,
  ): void {
    const document = store.get(locator)
    if (!document) throw new Error('Search replace target document is unavailable')
    if (from < 0 || to < from || to > document.markdown.length) throw new RangeError('Search replace range is invalid')
    store.applyChange(locator, {
      markdown: `${document.markdown.slice(0, from)}${replacement}${document.markdown.slice(to)}`,
      origin: { kind: 'search.replace' },
      expectedRevision: document.revision,
    })
    this.invalidate()
  }
}
