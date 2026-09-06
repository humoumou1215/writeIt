import type { ChangeSet } from '@codemirror/state'

export interface AnnotationRange {
  from: number
  to: number
}

/** CM6 ChangeSet range mapping proof: the annotation follows the same text. */
export function mapAnnotationRange(range: AnnotationRange, changes: ChangeSet): AnnotationRange {
  return {
    from: changes.mapPos(range.from, 1),
    to: changes.mapPos(range.to, -1),
  }
}
