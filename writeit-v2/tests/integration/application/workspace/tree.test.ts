import { describe, expect, it } from 'vitest'
import {
  createWorkspacePath,
  findWorkspaceNode,
} from '../../../../src/core/workspace'
import { createDocumentPath } from '../../../../src/core/document'
import { WorkspaceTreeService } from '../../../../src/application/workspace'
import {
  MemoryFileSystem,
  WorkspaceInvalidOperationError,
} from '../../../../src/platform/filesystem'

const root = createWorkspacePath('')

function childPaths(service: WorkspaceTreeService): readonly string[] {
  return service.getTree().root.children.map((child) => child.path)
}

describe('WorkspaceTreeService', () => {
  it('refreshes a recursive, deterministic projection of the filesystem', async () => {
    const fileSystem = new MemoryFileSystem({
      files: {
        'welcome.md': '# welcome\n',
        'notes/deep/todo.md': 'todo\n',
      },
      directories: ['empty'],
    })
    const service = new WorkspaceTreeService(fileSystem)
    const generations: number[] = []
    service.subscribe((snapshot) => generations.push(snapshot.revision))

    const snapshot = await service.refresh()

    expect(snapshot.revision).toBe(1)
    expect(generations).toEqual([1])
    expect(childPaths(service)).toEqual(['empty', 'notes', 'welcome.md'])
    expect(
      findWorkspaceNode(snapshot.tree, createWorkspacePath('notes/deep/todo.md')),
    ).toMatchObject({ kind: 'file', name: 'todo.md' })
    expect(findWorkspaceNode(snapshot.tree, root)?.kind).toBe('directory')
  })

  it('publishes only after successful create, rename, move and delete operations', async () => {
    const fileSystem = new MemoryFileSystem({
      files: { 'notes/todo.md': 'todo\r\n' },
      directories: ['archive'],
    })
    const service = new WorkspaceTreeService(fileSystem)
    await service.refresh()
    const revisions: number[] = []
    service.subscribe(({ revision }) => revisions.push(revision))

    const folder = await service.createDirectory(root, 'drafts')
    const created = await service.createFile(folder, 'new.md', 'new\n')
    expect(created).toBe('drafts/new.md')

    const renamed = await service.rename(created, 'renamed.md')
    expect(renamed).toBe('drafts/renamed.md')
    const moved = await service.move(
      renamed,
      createWorkspacePath('archive'),
    )
    expect(moved).toBe('archive/renamed.md')
    await service.delete(createWorkspacePath('archive'))

    expect(revisions).toEqual([2, 3, 4, 5, 6])
    expect(fileSystem.hasFile(createDocumentPath('drafts/renamed.md'))).toBe(false)
    expect(findWorkspaceNode(service.getTree(), createWorkspacePath('archive'))).toBeUndefined()
  })

  it('keeps the previous tree on failed mutations and rejects paths outside the root', async () => {
    const fileSystem = new MemoryFileSystem({
      files: { 'workspace/notes/todo.md': 'todo' },
    })
    const service = new WorkspaceTreeService(fileSystem, {
      rootPath: 'workspace',
    })
    await service.refresh()
    const before = service.getSnapshot()

    await expect(
      service.createFile(createWorkspacePath('workspace/missing'), 'new.md'),
    ).rejects.toThrow()
    expect(service.getSnapshot()).toBe(before)

    await expect(
      service.move(
        createWorkspacePath('workspace/notes/todo.md'),
        createWorkspacePath('outside'),
      ),
    ).rejects.toBeInstanceOf(WorkspaceInvalidOperationError)
    expect(service.getSnapshot()).toBe(before)
  })
})
