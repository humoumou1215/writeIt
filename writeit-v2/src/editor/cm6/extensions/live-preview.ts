import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from '@codemirror/state'
import {
  Decoration,
  EditorView,
  keymap,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'

/** The two presentations share one CM6 document and one source authority. */
export type PresentationMode = 'source' | 'live-preview'

export const DEFAULT_PRESENTATION_MODE: PresentationMode = 'source'

const setPresentationModeEffect = StateEffect.define<PresentationMode>()

/**
 * Stores presentation only. It does not contain Markdown and is deliberately
 * not part of the DocumentStore source model.
 */
export const presentationModeField = StateField.define<PresentationMode>({
  create: () => DEFAULT_PRESENTATION_MODE,
  update: (mode, transaction) => {
    let next = mode
    for (const effect of transaction.effects) {
      if (effect.is(setPresentationModeEffect)) next = effect.value
    }
    return next
  },
})

function requirePresentationMode(mode: PresentationMode): PresentationMode {
  if (mode !== 'source' && mode !== 'live-preview') {
    throw new TypeError(
      'Presentation mode must be either source or live-preview',
    )
  }
  return mode
}

function readMode(state: EditorState): PresentationMode | undefined {
  return state.field(presentationModeField, false)
}

/** Returns the current presentation without reading or serializing the DOM. */
export function getPresentationMode(
  state: EditorState,
): PresentationMode {
  return readMode(state) ?? DEFAULT_PRESENTATION_MODE
}

/**
 * Changes only the CM6 presentation state. The transaction has no document
 * changes, so it cannot create a DocumentStore revision or a source-history
 * entry.
 */
export function setPresentationMode(
  view: EditorView,
  mode: PresentationMode,
): boolean {
  const current = readMode(view.state)
  if (current === undefined) return false

  const next = requirePresentationMode(mode)
  if (current === next) return true

  view.dispatch({ effects: setPresentationModeEffect.of(next) })
  return true
}

/** CM6 key command for the legacy Ctrl/Cmd+E presentation toggle. */
export function togglePresentationMode(view: EditorView): boolean {
  const current = readMode(view.state)
  if (current === undefined) return false
  return setPresentationMode(
    view,
    current === 'source' ? 'live-preview' : 'source',
  )
}

/**
 * Purely source-positioned description of the small Markdown presentation
 * subset. Unknown syntax deliberately produces no entries and remains plain
 * source text.
 */
export type LivePreviewDecorationKind =
  | 'hidden-syntax'
  | 'heading'
  | 'strong'
  | 'emphasis'
  | 'link'
  | 'code'

export interface LivePreviewDecorationSpec {
  readonly from: number
  readonly to: number
  readonly kind: LivePreviewDecorationKind
}

const inlinePattern =
  /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|_([^_\n]+)_|\[([^\]\n]+)\]\(([^)\s]+)\)/g

function isSafeHref(href: string): boolean {
  const normalized = href.trim().toLowerCase()
  return (
    normalized.startsWith('#') ||
    normalized.startsWith('/') ||
    normalized.startsWith('./') ||
    normalized.startsWith('../') ||
    normalized.startsWith('http://') ||
    normalized.startsWith('https://') ||
    normalized.startsWith('mailto:')
  )
}

function addSpec(
  output: LivePreviewDecorationSpec[],
  from: number,
  to: number,
  kind: LivePreviewDecorationKind,
): void {
  if (to <= from) return
  output.push({ from, to, kind })
}

function collectInlineSpecs(
  line: string,
  lineStart: number,
  output: LivePreviewDecorationSpec[],
): void {
  inlinePattern.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = inlinePattern.exec(line)) !== null) {
    const start = lineStart + match.index
    const end = start + match[0].length

    if (match[1] !== undefined) {
      const contentStart = start + 2
      const contentEnd = contentStart + match[1].length
      addSpec(output, start, contentStart, 'hidden-syntax')
      addSpec(output, contentStart, contentEnd, 'strong')
      addSpec(output, contentEnd, end, 'hidden-syntax')
      continue
    }

    if (match[2] !== undefined) {
      const contentStart = start + 1
      const contentEnd = contentStart + match[2].length
      addSpec(output, start, contentStart, 'hidden-syntax')
      addSpec(output, contentStart, contentEnd, 'emphasis')
      addSpec(output, contentEnd, end, 'hidden-syntax')
      continue
    }

    if (match[3] !== undefined) {
      const contentStart = start + 1
      const contentEnd = contentStart + match[3].length
      addSpec(output, start, contentStart, 'hidden-syntax')
      addSpec(output, contentStart, contentEnd, 'emphasis')
      addSpec(output, contentEnd, end, 'hidden-syntax')
      continue
    }

    const label = match[4]
    const href = match[5]
    if (label === undefined || href === undefined || !isSafeHref(href)) {
      continue
    }

    const labelStart = start + 1
    const labelEnd = labelStart + label.length
    addSpec(output, start, labelStart, 'hidden-syntax')
    addSpec(output, labelStart, labelEnd, 'link')
    addSpec(output, labelEnd, end, 'hidden-syntax')
  }
}

/**
 * Finds presentation ranges while retaining the original UTF-16 offsets.
 * These ranges are never serialized back into Markdown.
 */
export function findLivePreviewDecorations(
  markdownSource: string,
): readonly LivePreviewDecorationSpec[] {
  if (typeof markdownSource !== 'string') {
    throw new TypeError('Live preview source must be a string')
  }

  const output: LivePreviewDecorationSpec[] = []
  const lines = markdownSource.split('\n')
  let offset = 0
  let inFence = false

  for (const line of lines) {
    const lineStart = offset
    const lineEnd = lineStart + line.length
    const fence = line.match(/^```[^\s]*\s*$/)

    if (fence) {
      addSpec(output, lineStart, lineEnd, 'hidden-syntax')
      inFence = !inFence
      offset = lineEnd + 1
      continue
    }

    if (inFence) {
      addSpec(output, lineStart, lineEnd, 'code')
      offset = lineEnd + 1
      continue
    }

    const heading = line.match(/^(#{1,6})([ \t]+)(.*?)(\r?)$/)
    if (heading) {
      const contentStart =
        lineStart + heading[1].length + heading[2].length
      const contentEnd = lineEnd - heading[4].length
      addSpec(output, lineStart, contentStart, 'hidden-syntax')
      addSpec(output, contentStart, contentEnd, 'heading')
    }

    collectInlineSpecs(line, lineStart, output)
    offset = lineEnd + 1
  }

  return Object.freeze(output)
}

const hiddenSyntaxDecoration = Decoration.replace({})
const headingDecoration = Decoration.mark({
  class: 'cm-writeit-live-preview-heading',
})
const strongDecoration = Decoration.mark({
  class: 'cm-writeit-live-preview-strong',
})
const emphasisDecoration = Decoration.mark({
  class: 'cm-writeit-live-preview-emphasis',
})
const linkDecoration = Decoration.mark({
  class: 'cm-writeit-live-preview-link',
})
const codeDecoration = Decoration.mark({
  class: 'cm-writeit-live-preview-code',
})

class LivePreviewLinkWidget extends WidgetType {
  constructor(private readonly href: string) {
    super()
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof LivePreviewLinkWidget && other.href === this.href
    )
  }

  toDOM(view: EditorView): HTMLElement {
    const icon = view.dom.ownerDocument.createElement('span')
    icon.className = 'cm-writeit-live-preview-link-widget'
    icon.setAttribute('aria-hidden', 'true')
    icon.title = this.href
    icon.textContent = '↗'
    return icon
  }

  ignoreEvent(): boolean {
    return true
  }
}

function decorationForSpec(spec: LivePreviewDecorationSpec): Decoration {
  if (spec.kind === 'hidden-syntax') return hiddenSyntaxDecoration
  if (spec.kind === 'heading') return headingDecoration
  if (spec.kind === 'strong') return strongDecoration
  if (spec.kind === 'emphasis') return emphasisDecoration
  if (spec.kind === 'code') return codeDecoration
  return linkDecoration
}

function buildDecorations(markdownSource: string): DecorationSet {
  const specs = findLivePreviewDecorations(markdownSource)
  const ranges: Range<Decoration>[] = specs.map((spec) => ({
    from: spec.from,
    to: spec.to,
    value: decorationForSpec(spec),
  }))

  // Link widgets are zero-width additions at the end of safe link labels. A
  // separate pass keeps the source-position parser independent from DOM.
  const lines = markdownSource.split('\n')
  let offset = 0
  let inFence = false
  for (const line of lines) {
    const lineStart = offset
    const lineEnd = lineStart + line.length
    if (/^```[^\s]*\s*$/.test(line)) {
      inFence = !inFence
      offset = lineEnd + 1
      continue
    }
    if (!inFence) {
      inlinePattern.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = inlinePattern.exec(line)) !== null) {
        const href = match[5]
        if (href === undefined || !isSafeHref(href)) continue
        const label = match[4]
        if (label === undefined) continue
        const labelEnd = lineStart + match.index + 1 + label.length
        ranges.push({
          from: labelEnd,
          to: labelEnd,
          value: Decoration.widget({
            widget: new LivePreviewLinkWidget(href),
            side: 1,
          }),
        })
      }
    }
    offset = lineEnd + 1
  }

  return Decoration.set(ranges, true)
}

class LivePreviewController {
  decorations: DecorationSet = Decoration.none

  private mode: PresentationMode

  constructor(private readonly view: EditorView) {
    this.mode = getPresentationMode(view.state)
    this.refresh()
  }

  update(update: ViewUpdate): void {
    const nextMode = getPresentationMode(update.state)
    if (update.docChanged || nextMode !== this.mode) {
      this.mode = nextMode
      this.refresh()
    }
  }

  destroy(): void {
    delete this.view.dom.dataset.presentationMode
    delete this.view.dom.dataset.livePreview
  }

  private refresh(): void {
    this.decorations =
      this.mode === 'live-preview'
        ? buildDecorations(this.view.state.doc.toString())
        : Decoration.none
    this.view.dom.dataset.presentationMode = this.mode
    this.view.dom.dataset.livePreview = String(this.mode === 'live-preview')
  }
}

export interface LivePreviewExtensionOptions {
  readonly initialMode?: PresentationMode
}

const livePreviewExtensionMarker = Symbol('writeit-live-preview-extension')
type MarkedLivePreviewExtension = readonly Extension[] & {
  readonly [livePreviewExtensionMarker]: true
}

/**
 * Extension values are nested arrays in CM6. The marker lets the projection
 * install its default presentation once while still allowing callers to pass
 * `createLivePreviewExtension()` explicitly in `extensions`.
 */
export function containsLivePreviewExtension(
  extensions: readonly Extension[],
): boolean {
  const contains = (extension: Extension): boolean => {
    if (Array.isArray(extension)) {
      if (
        (extension as unknown as MarkedLivePreviewExtension)[
          livePreviewExtensionMarker
        ] === true
      ) {
        return true
      }
      return extension.some((child) => contains(child))
    }
    if (
      extension !== null &&
      typeof extension === 'object' &&
      'extension' in extension
    ) {
      const nested = extension.extension
      return nested !== extension && contains(nested)
    }
    return false
  }

  return extensions.some((extension) => contains(extension))
}

/**
 * Adds source/live presentation to one CM6 state. The extension never creates
 * another editor or textarea; live mode only changes decorations/widgets.
 */
export function createLivePreviewExtension(
  options: LivePreviewExtensionOptions = {},
): Extension {
  const initialMode = requirePresentationMode(
    options.initialMode ?? DEFAULT_PRESENTATION_MODE,
  )
  const extension = [
    presentationModeField.init(() => initialMode),
    ViewPlugin.define(
      (view) => new LivePreviewController(view),
      { decorations: (controller) => controller.decorations },
    ),
    keymap.of([{ key: 'Mod-e', run: togglePresentationMode }]),
  ] as unknown as MarkedLivePreviewExtension
  Object.defineProperty(extension, livePreviewExtensionMarker, {
    value: true,
    enumerable: false,
  })
  return extension
}

export interface LivePreviewSurface {
  readonly mode: PresentationMode
  setMode(mode: PresentationMode): void
  toggle(): PresentationMode
}

/** Convenience surface for callers that own an EditorView directly. */
export function createLivePreviewSurface(
  view: EditorView,
): LivePreviewSurface {
  return Object.freeze({
    get mode(): PresentationMode {
      return getPresentationMode(view.state)
    },
    setMode(mode: PresentationMode): void {
      if (!setPresentationMode(view, mode)) {
        throw new Error('Live preview presentation extension is not installed')
      }
    },
    toggle(): PresentationMode {
      if (!togglePresentationMode(view)) {
        throw new Error('Live preview presentation extension is not installed')
      }
      return getPresentationMode(view.state)
    },
  })
}
