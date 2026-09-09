export interface SearchQuery {
  readonly text: string
  readonly caseSensitive?: boolean
  readonly useRegex?: boolean
}

export interface SearchMatch {
  readonly path: string
  readonly from: number
  readonly to: number
  readonly line: number
  readonly column: number
  readonly preview: string
}

export interface SearchFileResult {
  readonly path: string
  readonly matches: readonly SearchMatch[]
}
