import { describe, expect, it, vi } from 'vitest'
import {
  CreateFromTemplateService,
  TemplateCreationValidationError,
  TemplateNotFoundError,
  TemplateProviderError,
  TemplateProviderUnavailableError,
  TemplateSourceValidationError,
} from '../../../../src/application/workspace'
import { createDocumentPath } from '../../../../src/core/document'
import {
  createWorkspacePath,
  findWorkspaceNode,
} from '../../../../src/core/workspace'
import {
  MemoryFileSystem,
  WorkspaceInvalidOperationError,
} from '../../../../src/platform/filesystem'
import type { TemplateProvider } from '../../../../src/application/workspace'
import { WorkspaceTreeService } from '../../../../src/application/workspace'

async function createFixture(provider?: TemplateProvider) {
  const fileSystem = new MemoryFileSystem({ directories: ['drafts'] })
  const workspaceTree = new WorkspaceTreeService(fileSystem)
  await workspaceTree.refresh()
  const service = new CreateFromTemplateService(workspaceTree, { provider })
  return { fileSystem, workspaceTree, service }
}

describe('CreateFromTemplateService', () => {
  it('resolves a provider source and creates an exact Markdown file through the tree service', async () => {
    const markdown = 'doctype: meeting\r\n\n:::unknown-template-markup\r\n'
    const resolve = vi.fn<TemplateProvider['resolve']>(async (context) => {
      expect(context).toEqual({
        templateId: 'meeting',
        parentPath: 'drafts',
        name: 'standup.md',
        targetPath: 'drafts/standup.md',
      })
      return { markdown }
    })
    const { fileSystem, workspaceTree, service } = await createFixture({ resolve })

    const result = await service.createFromTemplate({
      templateId: 'meeting',
      parentPath: 'drafts',
      name: 'standup.md',
    })

    expect(result).toEqual({
      templateId: 'meeting',
      path: 'drafts/standup.md',
    })
    expect(await fileSystem.readFile(createDocumentPath('drafts/standup.md'))).toBe(
      markdown,
    )
    expect(
      findWorkspaceNode(
        workspaceTree.getTree(),
        createWorkspacePath('drafts/standup.md'),
      ),
    ).toMatchObject({ kind: 'file', name: 'standup.md' })
    expect(workspaceTree.getSnapshot().revision).toBe(2)
    expect(resolve).toHaveBeenCalledOnce()
  })

  it('exposes a function-shaped hook without making callers depend on the class method', async () => {
    const { fileSystem, service } = await createFixture({
      resolve: () => ({ markdown: '# Hook\n' }),
    })

    const result = await service.create({
      templateId: 'hook',
      parentPath: '',
      name: 'hook.md',
    })

    expect(result.path).toBe('hook.md')
    expect(await fileSystem.readFile(createDocumentPath('hook.md'))).toBe(
      '# Hook\n',
    )
  })

  it('does not mutate the filesystem when no provider or template is available', async () => {
    const withoutProvider = await createFixture()
    const before = withoutProvider.workspaceTree.getSnapshot()

    expect(withoutProvider.service.isAvailable()).toBe(false)
    await expect(
      withoutProvider.service.createFromTemplate({
        templateId: 'missing',
        parentPath: '',
        name: 'missing.md',
      }),
    ).rejects.toBeInstanceOf(TemplateProviderUnavailableError)
    expect(withoutProvider.fileSystem.hasFile(createDocumentPath('missing.md'))).toBe(
      false,
    )
    expect(withoutProvider.workspaceTree.getSnapshot()).toBe(before)

    const resolve = vi.fn<TemplateProvider['resolve']>(() => undefined)
    const unavailable = await createFixture({ resolve })
    const unavailableBefore = unavailable.workspaceTree.getSnapshot()
    await expect(
      unavailable.service.createFromTemplate({
        templateId: 'missing',
        parentPath: '',
        name: 'missing.md',
      }),
    ).rejects.toEqual(new TemplateNotFoundError('missing'))
    expect(resolve).toHaveBeenCalledOnce()
    expect(unavailable.fileSystem.hasFile(createDocumentPath('missing.md'))).toBe(
      false,
    )
    expect(unavailable.workspaceTree.getSnapshot()).toBe(unavailableBefore)
  })

  it('validates the target before calling the provider and preserves provider failures', async () => {
    const resolve = vi.fn<TemplateProvider['resolve']>(() => ({ markdown: '' }))
    const { service } = await createFixture({ resolve })

    await expect(
      service.createFromTemplate({
        templateId: 'invalid',
        parentPath: '',
        name: 'nested/name.md',
      }),
    ).rejects.toBeInstanceOf(TemplateCreationValidationError)
    expect(resolve).not.toHaveBeenCalled()

    const restrictedFileSystem = new MemoryFileSystem({
      directories: ['workspace'],
    })
    const restrictedTree = new WorkspaceTreeService(restrictedFileSystem, {
      rootPath: 'workspace',
    })
    await restrictedTree.refresh()
    const restrictedService = new CreateFromTemplateService(restrictedTree, {
      provider: { resolve },
    })
    await expect(
      restrictedService.createFromTemplate({
        templateId: 'invalid',
        parentPath: '',
        name: 'name.md',
      }),
    ).rejects.toBeInstanceOf(WorkspaceInvalidOperationError)
    expect(resolve).not.toHaveBeenCalled()

    const cause = new Error('catalog read failed')
    const failing = await createFixture({
      resolve: async () => {
        throw cause
      },
    })
    await expect(
      failing.service.createFromTemplate({
        templateId: 'broken',
        parentPath: '',
        name: 'broken.md',
      }),
    ).rejects.toEqual(new TemplateProviderError('broken', cause))
    expect(failing.fileSystem.hasFile(createDocumentPath('broken.md'))).toBe(
      false,
    )
  })

  it('rejects malformed provider source and never silently serializes or trims it', async () => {
    const malformed = await createFixture({
      resolve: () => ({ markdown: 42 } as never),
    })
    await expect(
      malformed.service.createFromTemplate({
        templateId: 'malformed',
        parentPath: '',
        name: 'malformed.md',
      }),
    ).rejects.toEqual(new TemplateSourceValidationError('malformed'))
    expect(malformed.fileSystem.hasFile(createDocumentPath('malformed.md'))).toBe(
      false,
    )
  })

  it('rejects invalid provider contracts at the seam', async () => {
    const { workspaceTree } = await createFixture()
    expect(
      () => new CreateFromTemplateService(undefined as never, {}),
    ).toThrow(TemplateCreationValidationError)
    expect(
      () => new CreateFromTemplateService(workspaceTree, {
        provider: { resolve: undefined } as never,
      }),
    ).toThrow(TemplateCreationValidationError)
  })
})
