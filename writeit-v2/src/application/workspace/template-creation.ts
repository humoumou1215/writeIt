import {
  createWorkspacePath,
  isWorkspacePathWithin,
  workspaceJoin,
} from '../../core/workspace'
import type { WorkspacePath } from '../../core/workspace'
import { WorkspaceInvalidOperationError } from '../../platform/filesystem'
import { WorkspaceTreeService } from './tree'

export type MaybePromise<Value> = Value | PromiseLike<Value>

/**
 * The smallest source contract needed by the workspace create flow. A future
 * P8 catalog can adapt its richer template records to this boundary without
 * making the workspace tree know how templates are discovered or parsed.
 */
export interface TemplateSource {
  /** Markdown is copied byte-for-byte; no placeholder/rendering work happens here. */
  readonly markdown: string
}

/**
 * Context supplied to the deferred template provider. The target path is
 * computed and validated before the provider runs, so a provider cannot
 * accidentally create a file outside the managed workspace.
 */
export interface TemplateResolutionContext {
  readonly templateId: string
  readonly parentPath: WorkspacePath
  readonly name: string
  readonly targetPath: WorkspacePath
}

/**
 * Application seam for a catalog/provider that will be supplied in P8.
 * Returning `undefined` or `null` means that the selected template is not
 * available; throwing is reported as a provider failure.
 */
export interface TemplateProvider {
  resolve(
    context: TemplateResolutionContext,
  ): MaybePromise<TemplateSource | null | undefined>
}

export interface CreateFromTemplateInput {
  readonly templateId: string
  readonly parentPath: WorkspacePath | string
  readonly name: string
}

export interface CreateFromTemplateResult {
  readonly templateId: string
  readonly path: WorkspacePath
}

/** Function-shaped seam for UI/application callers that should not depend on the service class. */
export type CreateFromTemplateHook = (
  input: CreateFromTemplateInput,
) => Promise<CreateFromTemplateResult>

export class TemplateCreationValidationError extends TypeError {
  constructor(message: string) {
    super(message)
    this.name = 'TemplateCreationValidationError'
  }
}

export class TemplateProviderUnavailableError extends Error {
  constructor() {
    super('Template creation is unavailable until a template provider is registered')
    this.name = 'TemplateProviderUnavailableError'
  }
}

export class TemplateNotFoundError extends Error {
  readonly templateId: string

  constructor(templateId: string) {
    super(`Template is not available: ${templateId}`)
    this.name = 'TemplateNotFoundError'
    this.templateId = templateId
  }
}

export class TemplateProviderError extends Error {
  readonly templateId: string
  readonly cause: unknown

  constructor(templateId: string, cause: unknown) {
    super(`Template provider failed for ${templateId}`, { cause })
    this.name = 'TemplateProviderError'
    this.templateId = templateId
    this.cause = cause
  }
}

export class TemplateSourceValidationError extends TypeError {
  readonly templateId: string

  constructor(templateId: string) {
    super(`Template provider returned invalid Markdown for ${templateId}`)
    this.name = 'TemplateSourceValidationError'
    this.templateId = templateId
  }
}

export interface CreateFromTemplateServiceOptions {
  /** Optional until P8 supplies the real catalog-backed provider. */
  readonly provider?: TemplateProvider
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TemplateCreationValidationError(`${name} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireNonEmptyText(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TemplateCreationValidationError(`${name} must be a non-empty string`)
  }
  return value.trim()
}

function normalizeParentPath(value: unknown): WorkspacePath {
  if (typeof value !== 'string') {
    throw new TemplateCreationValidationError(
      'Template parentPath must be a workspace path',
    )
  }
  try {
    return createWorkspacePath(value)
  } catch (error) {
    throw new TemplateCreationValidationError(
      `Template parentPath is invalid: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function normalizeName(value: unknown): string {
  const name = requireNonEmptyText(value, 'Template file name')
  if (name === '.' || name === '..' || /[\\/]/u.test(name)) {
    throw new TemplateCreationValidationError(
      'Template file name must be a single path segment',
    )
  }
  return name
}

function normalizeInput(value: CreateFromTemplateInput): {
  readonly templateId: string
  readonly parentPath: WorkspacePath
  readonly name: string
} {
  const input = requireRecord(value, 'Create-from-template input')
  return {
    templateId: requireNonEmptyText(input.templateId, 'Template id'),
    parentPath: normalizeParentPath(input.parentPath),
    name: normalizeName(input.name),
  }
}

function normalizeProvider(
  provider: TemplateProvider | undefined,
): TemplateProvider | undefined {
  if (provider === undefined) return undefined
  if (
    provider === null ||
    typeof provider !== 'object' ||
    typeof provider.resolve !== 'function'
  ) {
    throw new TemplateCreationValidationError(
      'Template provider must expose a resolve function',
    )
  }
  return provider
}

function normalizeSource(
  templateId: string,
  source: TemplateSource | null | undefined,
): string {
  if (
    source === null ||
    typeof source !== 'object' ||
    Array.isArray(source) ||
    typeof source.markdown !== 'string'
  ) {
    throw new TemplateSourceValidationError(templateId)
  }
  return source.markdown
}

/**
 * Application service for creating a workspace file from a selected template.
 * It deliberately delegates the actual file mutation to WorkspaceTreeService;
 * the tree remains a filesystem projection and contains no template rules.
 */
export class CreateFromTemplateService {
  private readonly workspaceTree: WorkspaceTreeService

  private readonly provider: TemplateProvider | undefined

  constructor(
    workspaceTree: WorkspaceTreeService,
    options: CreateFromTemplateServiceOptions = {},
  ) {
    if (!(workspaceTree instanceof WorkspaceTreeService)) {
      throw new TemplateCreationValidationError(
        'Workspace tree service is required',
      )
    }
    if (options === null || typeof options !== 'object') {
      throw new TemplateCreationValidationError(
        'Create-from-template options must be an object',
      )
    }
    this.workspaceTree = workspaceTree
    this.provider = normalizeProvider(options.provider)
  }

  /** True when a P8-compatible provider has been attached. */
  isAvailable(): boolean {
    return this.provider !== undefined
  }

  /**
   * Resolves and writes one template file. The returned path is intended for
   * the caller to open through the normal workspace/document flow.
   */
  async createFromTemplate(
    input: CreateFromTemplateInput,
  ): Promise<CreateFromTemplateResult> {
    const normalized = normalizeInput(input)
    const rootPath = this.workspaceTree.getRootPath()
    if (!isWorkspacePathWithin(normalized.parentPath, rootPath)) {
      throw new WorkspaceInvalidOperationError(
        `Workspace path ${normalized.parentPath} is outside the workspace root`,
      )
    }

    const targetPath = workspaceJoin(normalized.parentPath, normalized.name)
    if (!isWorkspacePathWithin(targetPath, rootPath)) {
      throw new WorkspaceInvalidOperationError(
        `Workspace path ${targetPath} is outside the workspace root`,
      )
    }

    const provider = this.provider
    if (provider === undefined) {
      throw new TemplateProviderUnavailableError()
    }

    let source: TemplateSource | null | undefined
    try {
      source = await provider.resolve(
        Object.freeze({
          templateId: normalized.templateId,
          parentPath: normalized.parentPath,
          name: normalized.name,
          targetPath,
        }),
      )
    } catch (error) {
      throw new TemplateProviderError(normalized.templateId, error)
    }

    if (source === null || source === undefined) {
      throw new TemplateNotFoundError(normalized.templateId)
    }

    const markdown = normalizeSource(normalized.templateId, source)
    const path = await this.workspaceTree.createFile(
      normalized.parentPath,
      normalized.name,
      markdown,
    )
    return Object.freeze({
      templateId: normalized.templateId,
      path,
    })
  }

  /** Function-shaped adapter for UI/application callers. */
  readonly create: CreateFromTemplateHook = (input) =>
    this.createFromTemplate(input)
}