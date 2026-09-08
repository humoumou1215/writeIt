import { Transaction, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import { parseMermaidBlocks, parseMermaidSource, type MermaidBlock, type MermaidDiagram } from '../../../../core/mermaid'

export interface MermaidRenderResult {
  readonly diagram?: MermaidDiagram
  readonly error?: string
}

export interface MermaidRenderer {
  render(source: string): MermaidRenderResult | Promise<MermaidRenderResult>
}

export interface MermaidWidgetOptions {
  readonly renderer?: MermaidRenderer
  readonly onOpenReference?: (path: string, event: MouseEvent) => void
  readonly isReferenceAvailable?: (path: string) => boolean
}

const defaultRenderer: MermaidRenderer = Object.freeze({
  render(source: string): MermaidRenderResult {
    const result = parseMermaidSource(source)
    return result.ok ? { diagram: result.diagram } : { error: result.error }
  },
})

function referencesIn(source: string): readonly string[] {
  return Object.freeze([...source.matchAll(/!?\[\[([^\]]+)\]\]/gu)].map((match) => match[1] ?? '').filter((path) => path.length > 0))
}

function renderDiagram(document: Document, parent: HTMLElement, diagram: MermaidDiagram): void {
  parent.replaceChildren()
  if (diagram.kind !== 'flowchart' || diagram.nodes.length === 0) {
    const pre = document.createElement('pre')
    pre.className = 'cm-writeit-mermaid__text-diagram'
    pre.textContent = `${diagram.kind} diagram source is preserved; rich geometry is not available in this renderer.`
    parent.append(pre)
    return
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.classList.add('cm-writeit-mermaid__svg')
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', 'Mermaid flowchart')
  const width = Math.max(320, diagram.nodes.length * 150)
  svg.setAttribute('viewBox', `0 0 ${width} 150`)
  diagram.edges.forEach((edge) => {
    const from = diagram.nodes.findIndex((node) => node.id === edge.from)
    const to = diagram.nodes.findIndex((node) => node.id === edge.to)
    if (from < 0 || to < 0) return
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    line.setAttribute('x1', String(60 + from * 150))
    line.setAttribute('y1', '75')
    line.setAttribute('x2', String(60 + to * 150))
    line.setAttribute('y2', '75')
    line.setAttribute('stroke', '#8290b7')
    line.setAttribute('stroke-width', '2')
    svg.append(line)
    if (edge.label) {
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      label.setAttribute('x', String((120 + (from + to) * 75) / 2))
      label.setAttribute('y', '58')
      label.setAttribute('text-anchor', 'middle')
      label.textContent = edge.label
      svg.append(label)
    }
  })
  diagram.nodes.forEach((node, index) => {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    group.setAttribute('data-mermaid-node', node.id)
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('x', String(index * 150 + 10))
    rect.setAttribute('y', '48')
    rect.setAttribute('width', '100')
    rect.setAttribute('height', '54')
    rect.setAttribute('rx', '8')
    rect.setAttribute('fill', '#eef1ff')
    rect.setAttribute('stroke', '#536dfe')
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    label.setAttribute('x', String(index * 150 + 60))
    label.setAttribute('y', '80')
    label.setAttribute('text-anchor', 'middle')
    label.textContent = node.label
    group.append(rect, label)
    svg.append(group)
  })
  parent.append(svg)
}

class MermaidWidget extends WidgetType {
  private renderSerial = 0

  constructor(private readonly block: MermaidBlock, private readonly options: MermaidWidgetOptions) { super() }

  eq(other: WidgetType): boolean {
    return other instanceof MermaidWidget && other.block.source === this.block.source
  }

  toDOM(view: EditorView): HTMLElement {
    const document = view.dom.ownerDocument
    const shell = document.createElement('section')
    shell.className = 'cm-writeit-mermaid'
    shell.dataset.mermaidFrom = String(this.block.from)
    shell.dataset.mermaidTo = String(this.block.to)
    shell.tabIndex = 0
    shell.setAttribute('aria-label', 'Mermaid diagram preview')
    const header = document.createElement('div')
    header.className = 'cm-writeit-mermaid__header'
    const title = document.createElement('span')
    title.textContent = 'Mermaid'
    const edit = document.createElement('button')
    edit.type = 'button'
    edit.className = 'cm-writeit-mermaid__action'
    edit.textContent = 'Edit source'
    const fit = document.createElement('button')
    fit.type = 'button'
    fit.className = 'cm-writeit-mermaid__action'
    fit.textContent = 'Fit'
    header.append(title, edit, fit)
    const status = document.createElement('div')
    status.className = 'cm-writeit-mermaid__status'
    status.textContent = 'Rendering Mermaid…'
    const diagram = document.createElement('div')
    diagram.className = 'cm-writeit-mermaid__diagram'
    const sourceDetails = document.createElement('details')
    sourceDetails.className = 'cm-writeit-mermaid__source'
    const sourceSummary = document.createElement('summary')
    sourceSummary.textContent = 'Show source'
    const textarea = document.createElement('textarea')
    textarea.className = 'cm-writeit-mermaid__editor'
    textarea.value = this.block.source
    textarea.hidden = true
    textarea.setAttribute('aria-label', 'Edit Mermaid source')
    sourceDetails.append(sourceSummary, textarea)
    shell.append(header, status, diagram, sourceDetails)

    const sourceText = this.block.source
    const serial = ++this.renderSerial
    const renderer = this.options.renderer ?? defaultRenderer
    Promise.resolve(renderer.render(sourceText)).then((result) => {
      if (serial !== this.renderSerial || !shell.isConnected) return
      if (result.error || !result.diagram) {
        shell.dataset.mermaidStatus = 'error'
        status.textContent = result.error ?? 'Mermaid renderer failed'
        status.classList.add('cm-writeit-mermaid__status--error')
        sourceDetails.open = true
        textarea.hidden = false
        return
      }
      shell.dataset.mermaidStatus = 'ready'
      status.hidden = true
      renderDiagram(document, diagram, result.diagram)
      const refs = referencesIn(sourceText)
      if (refs.length > 0) {
        const references = document.createElement('div')
        references.className = 'cm-writeit-mermaid__references'
        refs.forEach((path) => {
          const button = document.createElement('button')
          button.type = 'button'
          button.dataset.mermaidReference = path
          const available = this.options.isReferenceAvailable?.(path) ?? true
          button.textContent = available ? `Open ${path}` : `Missing ${path}`
          if (!available) {
            button.disabled = true
            button.classList.add('cm-writeit-mermaid__reference--missing')
            button.title = 'Referenced workspace file is unavailable'
          }
          button.addEventListener('click', (event) => this.options.onOpenReference?.(path, event))
          references.append(button)
        })
        shell.append(references)
      }
    }).catch((error: unknown) => {
      if (serial !== this.renderSerial || !shell.isConnected) return
      shell.dataset.mermaidStatus = 'error'
      status.textContent = `Mermaid renderer failed: ${String(error)}`
      sourceDetails.open = true
      textarea.hidden = false
    })

    edit.addEventListener('click', () => {
      sourceDetails.open = true
      textarea.hidden = false
      textarea.focus()
    })
    fit.addEventListener('click', () => {
      shell.dataset.mermaidFit = shell.dataset.mermaidFit === 'true' ? 'false' : 'true'
    })
    shell.addEventListener('click', (event) => {
      if (event.target === shell || event.target === diagram) {
        shell.dataset.mermaidFocused = 'true'
        shell.focus()
      }
    })
    let composing = false
    textarea.addEventListener('compositionstart', () => { composing = true })
    textarea.addEventListener('compositionend', () => { composing = false; commitSource(textarea, view, this.block) })
    textarea.addEventListener('input', () => { if (!composing) commitSource(textarea, view, this.block) })
    return shell
  }

  ignoreEvent(): boolean { return true }
}

function commitSource(textarea: HTMLTextAreaElement, view: EditorView, block: MermaidBlock): void {
  const current = view.state.doc.toString()
  const rawBody = current.slice(block.sourceFrom, block.sourceTo)
  const leading = rawBody.match(/^\r?\n/u)?.[0] ?? ''
  const trailing = rawBody.match(/\r?\n$/u)?.[0] ?? ''
  const nextBody = `${leading}${textarea.value}${trailing}`
  if (nextBody === rawBody) return
  view.dispatch({
    changes: { from: block.from, to: block.to, insert: `${current.slice(block.from, block.sourceFrom)}${nextBody}${current.slice(block.sourceTo, block.to)}` },
    annotations: Transaction.userEvent.of('input.mermaid'),
  })
}

export function mermaidDecorationRanges(markdownSource: string, options: MermaidWidgetOptions = {}): readonly Range<Decoration>[] {
  return parseMermaidBlocks(markdownSource).map((block) => ({
    from: block.from,
    to: block.to,
    value: Decoration.replace({ widget: new MermaidWidget(block, options), block: true, inclusive: false }),
  }))
}

export function mermaidSourceRanges(markdownSource: string): readonly { from: number; to: number }[] {
  return parseMermaidBlocks(markdownSource).map((block) => ({ from: block.from, to: block.to }))
}
