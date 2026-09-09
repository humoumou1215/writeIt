import { parseMermaidSource, type MermaidDiagram } from '../mermaid'
import type { DiffRenderModel, RawDiffResult } from './types'

export interface MermaidSemanticDiff {
  readonly kind: 'mermaid'
  readonly diagramKind: MermaidDiagram['kind']
  readonly addedNodes: readonly string[]
  readonly removedNodes: readonly string[]
  readonly addedEdges: readonly string[]
  readonly removedEdges: readonly string[]
}

function edgeKey(from: string, to: string, label?: string): string {
  return `${from}->${to}${label ? `|${label}` : ''}`
}

export function diffMermaidDiagrams(before: string, after: string): MermaidSemanticDiff {
  const beforeResult = parseMermaidSource(before)
  const afterResult = parseMermaidSource(after)
  if (!beforeResult.ok || !afterResult.ok) throw new Error('Mermaid semantic diff unavailable for invalid source')
  if (beforeResult.diagram.kind !== afterResult.diagram.kind) throw new Error('Mermaid diagram types do not match')
  if (beforeResult.diagram.kind !== 'flowchart' || afterResult.diagram.kind !== 'flowchart') {
    throw new Error(`Mermaid semantic diff does not support ${beforeResult.diagram.kind} diagrams`)
  }
  const beforeNodes = new Map(beforeResult.diagram.nodes.map((node) => [node.id, node]))
  const afterNodes = new Map(afterResult.diagram.nodes.map((node) => [node.id, node]))
  const beforeEdges = new Set(beforeResult.diagram.edges.map((edge) => edgeKey(edge.from, edge.to, edge.label)))
  const afterEdges = new Set(afterResult.diagram.edges.map((edge) => edgeKey(edge.from, edge.to, edge.label)))
  return Object.freeze({
    kind: 'mermaid',
    diagramKind: 'flowchart',
    addedNodes: Object.freeze([...afterNodes.keys()].filter((id) => !beforeNodes.has(id))),
    removedNodes: Object.freeze([...beforeNodes.keys()].filter((id) => !afterNodes.has(id))),
    addedEdges: Object.freeze([...afterEdges].filter((edge) => !beforeEdges.has(edge))),
    removedEdges: Object.freeze([...beforeEdges].filter((edge) => !afterEdges.has(edge))),
  })
}

export function buildDiffRenderModel(
  raw: RawDiffResult,
  semanticEnhancer?: () => unknown,
): DiffRenderModel {
  if (!semanticEnhancer) return Object.freeze({ kind: 'raw', raw })
  try {
    return Object.freeze({ kind: 'semantic', raw, semantic: semanticEnhancer() })
  } catch (error) {
    return Object.freeze({ kind: 'raw', raw, degradedReason: error instanceof Error ? error.message : String(error) })
  }
}
