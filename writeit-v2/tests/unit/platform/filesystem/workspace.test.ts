import { describe, expect, it } from 'vitest'
import {
  createWorkspacePath,
} from '../../../../src/core/workspace'
import type { DocumentPath } from '../../../../src/core/document'
import {
  WorkspaceDirectoryNotEmptyError,
  WorkspaceEntryAlreadyExistsError,
  MemoryFileSystem,
} from '../../../../src/platform/filesystem'

const root = createWorkspacePath('')

async function paths(
  fileSystem: MemoryFileSystem,
  path = root,
): Promise<readonly string[]> {
  return (await fileSystem.listDirectory(path)).map((entry) => entry.path)
}

describe('MemoryFileSystem workspace operations', () => {
  it('lists recursive entries and preserves empty directories', async () => {
    const fileSystem = new MemoryFileSystem({
      files: {
        'notes/todo.md': 'todo\r\n',
        'welcome.md': '# welcome\n',
      },
      directories: ['empty'],
    })

    expect(await paths(fileSystem)).toEqual(['empty', 'notes', 'welcome.md'])
    expect(await paths(fileSystem, createWorkspacePath('notes'))).toEqual([
      'notes/todo.md',
    ])
    expect(fileSystem.hasDirectory(createWorkspacePath('empty'))).toBe(true)
    expect(
      await fileSystem.readFile('notes/todo.md' as DocumentPath),
    ).toBe('todo\r\n')
  })

  it('creates, renames and moves files/directories without changing content', async () => {
    const fileSystem = new MemoryFileSystem({ directories: ['notes', 'archive'] })
    await fileSystem.createFile(createWorkspacePath('notes/todo.md'), 'a\r\nb')
    await fileSystem.createDirectory(createWorkspacePath('notes/drafts'))

    const renamed = await fileSystem.renameEntry(
      createWorkspacePath('notes/todo.md'),
      'done.md',
    )
    expect(renamed).toBe('notes/done.md')

    const movedDirectory = await fileSystem.moveEntry(
      createWorkspacePath('notes'),
      createWorkspacePath('archive'),
    )
    expect(movedDirectory).toBe('archive/notes')
    expect(fileSystem.hasDirectory(createWorkspacePath('archive/notes/drafts'))).toBe(true)
    expect(await fileSystem.readFile('archive/notes/done.md' as DocumentPath)).toBe(
      'a\r\nb',
    )
    expect(fileSystem.hasDirectory(createWorkspacePath('notes'))).toBe(false)
  })

  it('rejects collisions, non-empty non-recursive deletion, and self moves', async () => {
    const fileSystem = new MemoryFileSystem({
      files: { 'notes/todo.md': 'todo' },
      directories: ['archive'],
    })

    await expect(
      fileSystem.createFile(createWorkspacePath('notes/todo.md'), 'again'),
    ).rejects.toBeInstanceOf(WorkspaceEntryAlreadyExistsError)
    await expect(
      fileSystem.deleteEntry(createWorkspacePath('notes')),
    ).rejects.toBeInstanceOf(WorkspaceDirectoryNotEmptyError)
    await expect(
      fileSystem.moveEntry(
        createWorkspacePath('notes'),
        createWorkspacePath('notes'),
      ),
    ).resolves.toBe('notes')

    await fileSystem.deleteEntry(createWorkspacePath('notes'), { recursive: true })
    expect(fileSystem.hasFile('notes/todo.md' as DocumentPath)).toBe(false)
  })
})
