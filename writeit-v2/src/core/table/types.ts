export type TableAlignment = 'left' | 'center' | 'right' | null

export interface TableCell {
  /** Inline Markdown source with structural escapes decoded for table editing. */
  readonly value: string
}

export interface TableSourceRange {
  readonly from: number
  readonly to: number
  readonly startLine: number
  readonly endLine: number
}

export interface MarkdownTable {
  /** Row zero is the header. The separator is represented by `alignments`. */
  readonly rows: readonly (readonly TableCell[])[]
  readonly alignments: readonly TableAlignment[]
  readonly range: TableSourceRange
  /** Exact source slice. Returning this is the no-edit round trip. */
  readonly source: string
  readonly lineEnding: '\n' | '\r\n'
}

export type TableRejectionReason =
  | 'invalid-separator'
  | 'column-count-mismatch'
  | 'unterminated-code-span'

export interface RejectedTableCandidate {
  readonly range: TableSourceRange
  readonly source: string
  readonly reason: TableRejectionReason
}

export interface MarkdownTableScan {
  readonly tables: readonly MarkdownTable[]
  readonly rejected: readonly RejectedTableCandidate[]
}

export interface SerializeTableOptions {
  readonly lineEnding?: '\n' | '\r\n'
  readonly trailingLineEnding?: boolean
}

export interface TableSelection {
  readonly anchorRow: number
  readonly anchorColumn: number
  readonly headRow: number
  readonly headColumn: number
}

export interface TableSelectionBounds {
  readonly top: number
  readonly left: number
  readonly bottom: number
  readonly right: number
}

export interface TableRegionEdit {
  readonly from: number
  readonly to: number
  readonly deleted: string
  readonly inserted: string
}
