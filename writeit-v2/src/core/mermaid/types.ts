export interface MermaidBlock {
  readonly from: number
  readonly to: number
  readonly sourceFrom: number
  readonly sourceTo: number
  readonly source: string
  readonly fence: '```' | '~~~'
  readonly info: string
  readonly startLine: number
  readonly endLine: number
}

export interface MermaidNode {
  readonly id: string
  readonly label: string
}

export interface MermaidEdge {
  readonly from: string
  readonly to: string
  readonly label?: string
}

export interface MermaidDiagram {
  readonly kind: 'flowchart' | 'sequence' | 'state'
  readonly direction?: string
  readonly nodes: readonly MermaidNode[]
  readonly edges: readonly MermaidEdge[]
}

export interface MermaidParseError {
  readonly ok: false
  readonly error: string
}

export interface MermaidParseSuccess {
  readonly ok: true
  readonly diagram: MermaidDiagram
}

export type MermaidParseResult = MermaidParseSuccess | MermaidParseError

