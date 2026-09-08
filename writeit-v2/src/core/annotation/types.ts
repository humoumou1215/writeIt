export type AnnotationId = string
export type CommentId = string
export type ResolvedState = 'open' | 'resolved'

export interface RangeAnchor {
  readonly documentPath: string
  readonly from: number
  readonly to: number
  readonly selectedText: string
  readonly beforeContext: string
  readonly afterContext: string
  readonly codeBlockIdentity?: string
}

export interface ResolvedAnchor {
  readonly status: 'resolved'
  readonly from: number
  readonly to: number
  readonly text: string
}

export interface UnresolvedAnchor {
  readonly status: 'unresolved'
  readonly reason: 'deleted' | 'ambiguous' | 'context-mismatch' | 'code-block-changed' | 'invalid-range'
}

export type AnchorResolution = ResolvedAnchor | UnresolvedAnchor

export interface AnnotationComment {
  readonly id: CommentId
  readonly author: string
  readonly body: string
  readonly createdAt: string
}

export interface AnnotationThread {
  readonly comments: readonly AnnotationComment[]
  readonly resolved: ResolvedState
}

export interface Annotation {
  readonly id: AnnotationId
  readonly documentPath: string
  readonly anchor: RangeAnchor
  readonly anchorResolution: AnchorResolution
  readonly thread: AnnotationThread
  readonly createdAt: string
  readonly updatedAt: string
}
