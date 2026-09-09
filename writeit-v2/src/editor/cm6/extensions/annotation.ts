import {
  StateEffect,
  StateField,
  type Extension,
  type Range,
} from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import type { Annotation } from '../../../core/annotation'

export interface AnnotationExtensionOptions {
  readonly annotations?: readonly Annotation[]
  readonly getAnnotations?: () => readonly Annotation[]
  readonly onActivate?: (annotation: Annotation, view: EditorView) => void
}

const setAnnotationsEffect = StateEffect.define<readonly Annotation[]>()

function rangesFor(annotations: readonly Annotation[]): DecorationSet {
  const ranges: Range<Decoration>[] = []
  annotations.forEach((annotation) => {
    const resolution = annotation.anchorResolution
    if (resolution.status !== 'resolved' || resolution.to <= resolution.from) return
    ranges.push({
      from: resolution.from,
      to: resolution.to,
      value: Decoration.mark({
        class: annotation.thread.resolved === 'resolved'
          ? 'cm-writeit-annotation-mark cm-writeit-annotation-mark--resolved'
          : 'cm-writeit-annotation-mark',
        attributes: { 'data-annotation-id': annotation.id },
      }),
    })
  })
  return Decoration.set(ranges, true)
}

export function updateAnnotations(view: EditorView, annotations: readonly Annotation[]): void {
  view.dispatch({ effects: setAnnotationsEffect.of(Object.freeze([...annotations])) })
}

export function createAnnotationExtension(options: AnnotationExtensionOptions = {}): Extension {
  const initial = Object.freeze([...(options.annotations ?? options.getAnnotations?.() ?? [])])
  const field = StateField.define<DecorationSet>({
    create: () => rangesFor(initial),
    update: (decorations, transaction) => {
      const effect = transaction.effects.find((candidate) => candidate.is(setAnnotationsEffect))
      if (effect) return rangesFor(effect.value)
      if (transaction.docChanged) return rangesFor(options.getAnnotations?.() ?? initial)
      return decorations
    },
    provide: (stateField) => EditorView.decorations.from(stateField),
  })
  return [
    field,
    EditorView.domEventHandlers({
      click(event, view) {
        const target = event.target instanceof HTMLElement
          ? event.target.closest<HTMLElement>('[data-annotation-id]')
          : null
        if (!target) return false
        const id = target.dataset.annotationId
        const annotation = (options.getAnnotations?.() ?? initial).find((item) => item.id === id)
        if (!annotation || !options.onActivate) return false
        options.onActivate(annotation, view)
        return true
      },
    }),
  ]
}
