import type { CommandRegistry, UnregisterCommand } from './registry'
import type { QuickInsertCommand, QuickInsertReplacement } from './quick-insert'

interface MermaidTemplateSpec {
  readonly id: string
  readonly label: string
  readonly keywords: readonly string[]
  readonly source: string
  readonly cursorOffset: number
}

const MERMAID_TEMPLATE_SPECS: readonly MermaidTemplateSpec[] = Object.freeze([
  {
    id: 'mermaid.flowchart',
    label: 'Mermaid flowchart',
    keywords: ['mermaid', 'flowchart', 'diagram', '流程图'],
    source: '```mermaid\nflowchart LR\n  A[Start] --> B[End]\n```',
    cursorOffset: 31,
  },
  {
    id: 'mermaid.sequence',
    label: 'Mermaid sequence diagram',
    keywords: ['mermaid', 'sequence', 'diagram', '时序图'],
    source: '```mermaid\nsequenceDiagram\n  Alice->>Bob: Hello\n```',
    cursorOffset: 35,
  },
  {
    id: 'mermaid.state',
    label: 'Mermaid state diagram',
    keywords: ['mermaid', 'state', 'diagram', '状态图'],
    source: '```mermaid\nstateDiagram-v2\n  [*] --> Idle\n```',
    cursorOffset: 34,
  },
])

function createMermaidTemplateCommand(spec: MermaidTemplateSpec): QuickInsertCommand {
  const replacement: QuickInsertReplacement = {
    text: spec.source,
    cursorOffset: spec.cursorOffset,
  }
  return {
    id: spec.id,
    label: spec.label,
    group: 'Mermaid',
    keywords: spec.keywords,
    availability: () => true,
    execute: (context) => context.replace(replacement),
  }
}

export function createMermaidQuickInsertCommands(): readonly QuickInsertCommand[] {
  return Object.freeze(MERMAID_TEMPLATE_SPECS.map(createMermaidTemplateCommand))
}

export function registerMermaidQuickInsertCommands(
  registry: CommandRegistry<import('./quick-insert').QuickInsertContext>,
): readonly UnregisterCommand[] {
  return Object.freeze(
    createMermaidQuickInsertCommands().map((command) => registry.register(command)),
  )
}
