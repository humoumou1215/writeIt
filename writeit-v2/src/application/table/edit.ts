import {
  createDocumentOrigin,
  createSourceChangeSetFromChanges,
  type DocumentLocator,
  type DocumentOrigin,
  type DocumentState,
  type DocumentStore,
} from '../../core/document'
import { parseMarkdownTableAt, tableRegionEdit, type MarkdownTable } from '../../core/table'

export type TableMutation = (table: MarkdownTable) => MarkdownTable

export interface ApplyTableMutationOptions {
  readonly origin?: DocumentOrigin
}

/** Applies one pure Table Core mutation through the authoritative DocumentStore. */
export function applyTableMutation(
  store: DocumentStore,
  locator: DocumentLocator,
  tableOffset: number,
  mutation: TableMutation,
  options: ApplyTableMutationOptions = {},
): DocumentState {
  const document = store.get(locator)
  if (!document) throw new Error('Cannot edit a table in an unloaded document')
  const table = parseMarkdownTableAt(document.markdown, tableOffset)
  if (!table) throw new Error('No valid Markdown table exists at the requested source offset')
  const edited = mutation(table)
  if (edited === table) return document
  const region = tableRegionEdit(table, edited)
  const change = createSourceChangeSetFromChanges(document.markdown, [
    { from: region.from, to: region.to, insert: region.inserted },
  ])
  return store.applySourceChange(locator, {
    change,
    expectedRevision: document.revision,
    origin: options.origin ?? createDocumentOrigin('table', 'table-core'),
  })
}

