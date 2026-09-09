import { StateEffect, StateField, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'

export interface BlameLine {
  readonly line: number
  readonly kind: 'committed' | 'uncommitted' | 'unknown'
  readonly commitId?: string
  readonly authorName?: string
  readonly authorTime?: string
  readonly summary?: string
}

export interface BlameExtensionOptions {
  readonly lines?: readonly BlameLine[]
  readonly getLines?: () => readonly BlameLine[]
  readonly onActivate?: (line: BlameLine) => void
}

const setBlameEffect = StateEffect.define<readonly BlameLine[]>()

class BlameMarkerWidget extends WidgetType {
  constructor(private readonly line: BlameLine, private readonly onActivate?: (line: BlameLine) => void) { super() }

  eq(other: WidgetType): boolean {
    return other instanceof BlameMarkerWidget && other.line.line === this.line.line && other.line.commitId === this.line.commitId && other.line.kind === this.line.kind
  }

  toDOM(): HTMLElement {
    const marker = document.createElement('button')
    marker.type = 'button'
    marker.className = `cm-writeit-blame cm-writeit-blame--${this.line.kind}`
    marker.dataset.blameLine = String(this.line.line)
    marker.textContent = this.line.kind === 'uncommitted' ? 'Local' : this.line.authorName ?? 'Unknown'
    marker.title = this.line.commitId ? `${this.line.commitId} · ${this.line.summary ?? ''}` : 'Local or unknown provenance'
    marker.addEventListener('click', () => this.onActivate?.(this.line))
    return marker
  }

  ignoreEvent(): boolean { return false }
}

function rangesFor(state: { doc: { lines: number; line(number: number): { from: number } } }, options: BlameExtensionOptions, lines: readonly BlameLine[]): DecorationSet {
  const ranges: Range<Decoration>[] = []
  for (const line of lines) {
    if (!Number.isSafeInteger(line.line) || line.line < 1 || line.line > state.doc.lines) continue
    ranges.push({ from: state.doc.line(line.line).from, to: state.doc.line(line.line).from, value: Decoration.widget({ widget: new BlameMarkerWidget(line, options.onActivate), side: -1 }) })
  }
  return Decoration.set(ranges, true)
}

export function updateBlame(view: EditorView, lines: readonly BlameLine[]): void {
  view.dispatch({ effects: setBlameEffect.of(Object.freeze([...lines])) })
}

export function createBlameExtension(options: BlameExtensionOptions = {}): Extension {
  const initial = Object.freeze([...(options.lines ?? options.getLines?.() ?? [])])
  const field = StateField.define<DecorationSet>({
    create: (state) => rangesFor(state, options, initial),
    update: (decorations, transaction) => {
      const effect = transaction.effects.find((candidate) => candidate.is(setBlameEffect))
      if (effect) return rangesFor(transaction.state, options, effect.value)
      if (transaction.docChanged) return decorations.map(transaction.changes)
      return decorations
    },
    provide: (stateField) => EditorView.decorations.from(stateField),
  })
  return field
}
