import type { ValidationIssue } from '../../core/validation'

export interface TemplateRecord {
  readonly id: string
  readonly name: string
  readonly markdown: string
  readonly doctype?: string
  readonly scope: 'workspace' | 'global'
  readonly path: string
}

export interface TemplateScanner {
  list(scope: 'workspace' | 'global'): Promise<readonly { readonly path: string; readonly content: string }[]>
}

export interface TemplateSuggestContext {
  readonly documentPath: string
  readonly from: number
  readonly to: number
  readonly paragraph?: string
  readonly heading?: string
  readonly task?: string
  readonly table?: string
  readonly fileReference?: string
}

export interface TemplateProviderRuntimePort {
  readonly enabled: boolean
  rules?(template: TemplateRecord, source: string): Promise<readonly ValidationIssue[]>
  objectsFor?(template: TemplateRecord, context: TemplateSuggestContext): Promise<readonly { readonly id: string; readonly label: string; readonly insert: string }[]>
  exportMetadata?(template: TemplateRecord): Promise<Readonly<Record<string, unknown>>>
}

export interface TemplatePlaceholder { readonly from: number; readonly to: number; readonly label: string }
