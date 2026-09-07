import {
  CommandRegistry,
  type Command,
  type UnregisterCommand,
} from './registry'

export interface QuickInsertRange {
  readonly from: number
  readonly to: number
}

export interface QuickInsertReplacement {
  readonly text: string
  /** Cursor offset from the beginning of the inserted text. */
  readonly cursorOffset?: number
}

export type QuickInsertReplacementInput = string | QuickInsertReplacement

/**
 * Source mutation bridge supplied by the editor adapter.
 *
 * Commands describe an insertion, but the adapter owns the bridge that
 * commits it through DocumentStore. This keeps providers independent from
 * CM6 and makes every quick insert follow the normal source mutation path.
 */
export interface QuickInsertContext {
  readonly source: string
  readonly query: string
  readonly range: QuickInsertRange
  readonly replace: (
    replacement: QuickInsertReplacementInput,
  ) => void | Promise<void>
}

export type QuickInsertCommand = Command<QuickInsertContext, void>

function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase()
}

/** Returns the searchable command metadata used by the surface filter. */
type QuickInsertCommandMetadata = Pick<
  QuickInsertCommand,
  'id' | 'label' | 'group' | 'keywords'
>

export function quickInsertSearchText<CommandType extends QuickInsertCommandMetadata>(
  command: CommandType,
): string {
  return normalizeSearchText(
    [command.id, command.label, command.group, ...command.keywords].join(' '),
  )
}

export function matchesQuickInsertQuery<CommandType extends QuickInsertCommandMetadata>(
  command: CommandType,
  query: string,
): boolean {
  if (typeof query !== 'string') return false
  const normalizedQuery = normalizeSearchText(query.trim())
  if (normalizedQuery.length === 0) return true
  return quickInsertSearchText(command).includes(normalizedQuery)
}

export function filterQuickInsertCommands<CommandType extends QuickInsertCommandMetadata>(
  commands: readonly CommandType[],
  query: string,
): readonly CommandType[] {
  return commands.filter((command) => matchesQuickInsertQuery(command, query))
}

interface BasicMarkdownCommandSpec {
  readonly id: string
  readonly label: string
  readonly keywords: readonly string[]
  readonly replacement: QuickInsertReplacement
}

const BASIC_MARKDOWN_COMMAND_SPECS: readonly BasicMarkdownCommandSpec[] =
  Object.freeze([
    {
      id: 'markdown.heading-1',
      label: 'Heading 1',
      keywords: ['heading', 'title', 'h1', '标题'],
      replacement: { text: '# ' },
    },
    {
      id: 'markdown.heading-2',
      label: 'Heading 2',
      keywords: ['heading', 'subtitle', 'h2', '标题'],
      replacement: { text: '## ' },
    },
    {
      id: 'markdown.heading-3',
      label: 'Heading 3',
      keywords: ['heading', 'h3', '标题'],
      replacement: { text: '### ' },
    },
    {
      id: 'markdown.bullet-list',
      label: 'Bullet list',
      keywords: ['bullet', 'bulleted', 'unordered', 'list', '无序列表'],
      replacement: { text: '- ' },
    },
    {
      id: 'markdown.numbered-list',
      label: 'Numbered list',
      keywords: ['numbered', 'ordered', 'list', '有序列表'],
      replacement: { text: '1. ' },
    },
    {
      id: 'markdown.task-list',
      label: 'Task list',
      keywords: ['task', 'todo', 'checkbox', 'list', '任务'],
      replacement: { text: '- [ ] ' },
    },
    {
      id: 'markdown.quote',
      label: 'Quote',
      keywords: ['blockquote', 'quote', '引用'],
      replacement: { text: '> ' },
    },
    {
      id: 'markdown.code-block',
      label: 'Code block',
      keywords: ['code', 'fence', 'preformatted', '代码'],
      replacement: { text: '```\n\n```', cursorOffset: 4 },
    },
    {
      id: 'markdown.divider',
      label: 'Divider',
      keywords: ['horizontal rule', 'separator', 'hr', '分隔线'],
      replacement: { text: '---' },
    },
  ])

function createBasicMarkdownCommand(
  spec: BasicMarkdownCommandSpec,
): QuickInsertCommand {
  return {
    id: spec.id,
    label: spec.label,
    group: 'Markdown',
    keywords: spec.keywords,
    availability: () => true,
    execute: (context) => context.replace(spec.replacement),
  }
}

/**
 * Creates the initial built-in provider. Template and Mermaid providers can
 * register additional commands later without changing the surface contract.
 */
export function createBasicMarkdownCommands(): readonly QuickInsertCommand[] {
  return Object.freeze(BASIC_MARKDOWN_COMMAND_SPECS.map(createBasicMarkdownCommand))
}

export function registerBasicMarkdownCommands(
  registry: CommandRegistry<QuickInsertContext>,
): readonly UnregisterCommand[] {
  return Object.freeze(
    createBasicMarkdownCommands().map((command) => registry.register(command)),
  )
}

export function createBasicMarkdownCommandRegistry(): CommandRegistry<QuickInsertContext> {
  const registry = new CommandRegistry<QuickInsertContext>()
  registerBasicMarkdownCommands(registry)
  return registry
}
