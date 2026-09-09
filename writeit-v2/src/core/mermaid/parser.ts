import type {
  MermaidBlock,
  MermaidEdge,
  MermaidNode,
  MermaidParseResult,
} from './types'

interface LineRecord { readonly text: string; readonly from: number; readonly to: number }

function records(source: string): readonly LineRecord[] {
  const result: LineRecord[] = []
  let from = 0
  while (from < source.length) {
    const newline = source.indexOf('\n', from)
    if (newline < 0) {
      result.push({ text: source.slice(from), from, to: source.length })
      break
    }
    const crlf = newline > from && source[newline - 1] === '\r'
    result.push({ text: source.slice(from, crlf ? newline - 1 : newline), from, to: newline + 1 })
    from = newline + 1
  }
  return result
}

/** Finds Mermaid fenced source without parsing or rewriting any Markdown. */
export function parseMermaidBlocks(source: string): readonly MermaidBlock[] {
  if (typeof source !== 'string') throw new TypeError('Mermaid Markdown source must be a string')
  const lines = records(source)
  const blocks: MermaidBlock[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const opener = lines[index].text.match(/^\s*(`{3,}|~{3,})\s*mermaid(?:\s+[^\n]*)?$/iu)
    if (!opener) continue
    const fenceChar = opener[1][0]
    let close = index + 1
    while (close < lines.length && !new RegExp(`^\\s*${fenceChar}{${opener[1].length},}\\s*$`, 'u').test(lines[close].text)) close += 1
    if (close >= lines.length) continue
    const sourceFrom = lines[index].to
    const sourceTo = lines[close].from
    const range = Object.freeze({
      from: lines[index].from,
      to: lines[close].to,
      sourceFrom,
      sourceTo,
      source: source.slice(sourceFrom, sourceTo).replace(/^(?:\r?\n)+|(?:\r?\n)+$/gu, ''),
      fence: (fenceChar === '`' ? '```' : '~~~') as '```' | '~~~',
      info: 'mermaid',
      startLine: index,
      endLine: close,
    })
    blocks.push(range)
    index = close
  }
  return Object.freeze(blocks)
}

function addNode(nodes: Map<string, MermaidNode>, id: string, label?: string): void {
  const normalized = id.trim()
  if (!normalized) return
  const existing = nodes.get(normalized)
  nodes.set(normalized, { id: normalized, label: label?.trim() || existing?.label || normalized })
}

function parseFlowchart(lines: readonly string[], kind: 'flowchart'): MermaidParseResult {
  const header = lines.find((line) => line.trim() !== '')?.trim().match(/^(?:flowchart|graph)\s+([A-Za-z]{1,8})$/iu)
  if (!header) return Object.freeze({ ok: false, error: 'Mermaid source must begin with flowchart/graph and a direction' })
  const nodes = new Map<string, MermaidNode>()
  const edges: MermaidEdge[] = []
  for (const raw of lines.slice(1)) {
    const line = raw.replace(/%%.*$/u, '').trim()
    if (!line) continue
    const edge = line.match(/^(.+?)\s*(-->|---|-.->|==>|-->|->>)\s*(?:\|([^|]*)\|\s*)?(.+)$/u)
    if (edge) {
      const left = parseNode(edge[1])
      const right = parseNode(edge[4])
      addNode(nodes, left.id, left.label)
      addNode(nodes, right.id, right.label)
      edges.push({ from: left.id, to: right.id, ...(edge[3] ? { label: edge[3].trim() } : {}) })
      continue
    }
    const standalone = parseNode(line)
    addNode(nodes, standalone.id, standalone.label)
  }
  if (nodes.size === 0) return Object.freeze({ ok: false, error: 'Mermaid flowchart contains no nodes' })
  return Object.freeze({ ok: true, diagram: Object.freeze({ kind, direction: header[1].toUpperCase(), nodes: Object.freeze([...nodes.values()]), edges: Object.freeze(edges) }) })
}

function parseNode(source: string): { id: string; label?: string } {
  const match = source.trim().match(/^([A-Za-z_][\w-]*)(?:\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\})?$/u)
  return match ? { id: match[1], label: match[2] ?? match[3] ?? match[4] } : { id: source.trim().split(/\s+/u)[0] }
}

export function parseMermaidSource(source: string): MermaidParseResult {
  if (typeof source !== 'string') throw new TypeError('Mermaid source must be a string')
  const lines = source.split(/\r?\n/u)
  const first = lines.find((line) => line.trim() !== '')?.trim() ?? ''
  if (/^(?:flowchart|graph)\b/iu.test(first)) return parseFlowchart(lines, 'flowchart')
  if (/^sequenceDiagram\b/iu.test(first)) return Object.freeze({ ok: true, diagram: Object.freeze({ kind: 'sequence', nodes: Object.freeze([]), edges: Object.freeze([]) }) })
  if (/^stateDiagram(?:-v2)?\b/iu.test(first)) return Object.freeze({ ok: true, diagram: Object.freeze({ kind: 'state', nodes: Object.freeze([]), edges: Object.freeze([]) }) })
  return Object.freeze({ ok: false, error: 'Unsupported or missing Mermaid diagram header' })
}
