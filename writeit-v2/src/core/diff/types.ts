export type RawDiffLineKind = 'context' | 'added' | 'removed'

export interface RawDiffLine {
  readonly kind: RawDiffLineKind
  readonly text: string
  readonly oldLine?: number
  readonly newLine?: number
}

export interface RawDiffHunk {
  readonly id: string
  readonly oldStart: number
  readonly oldCount: number
  readonly newStart: number
  readonly newCount: number
  readonly lines: readonly RawDiffLine[]
}

export interface RawDiffResult {
  readonly before: string
  readonly after: string
  readonly hunks: readonly RawDiffHunk[]
  readonly rawChangeCount: number
  readonly representedChangeCount: number
}

export interface DiffRenderModel {
  readonly kind: 'raw' | 'semantic'
  readonly raw: RawDiffResult
  readonly semantic?: unknown
  readonly degradedReason?: string
}
