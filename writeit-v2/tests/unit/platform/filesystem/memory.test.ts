import { describe, expect, it } from 'vitest'
import {
  createDocumentPath,
} from '../../../../src/core/document'
import { createWorkspacePath } from '../../../../src/core/workspace'
import {
  FileNotFoundError,
  MemoryFileSystem,
} from '../../../../src/platform/filesystem'

const notePath = createDocumentPath('notes/readme.md')


describe('MemoryFileSystem', () => {
  it('reads and writes exact Markdown source without normalizing it', async () => {
    const fileSystem = new MemoryFileSystem({
      'notes/readme.md': '# title\n\n未知语法 :::keep-me\n',
    })

    expect(await fileSystem.readFile(notePath)).toBe(
      '# title\n\n未知语法 :::keep-me\n',
    )

    await fileSystem.writeFile(notePath, 'changed\n\n  preserve whitespace  ')
    expect(await fileSystem.readFile(notePath)).toBe(
      'changed\n\n  preserve whitespace  ',
    )
    expect(fileSystem.hasFile(notePath)).toBe(true)
  })

  it('reports missing files and keeps instances isolated', async () => {
    const first = new MemoryFileSystem()
    const second = new MemoryFileSystem()

    await first.writeFile(notePath, 'only in first')
    expect(await first.readFile(notePath)).toBe('only in first')
    expect(second.hasFile(notePath)).toBe(false)
    await expect(second.readFile(notePath)).rejects.toBeInstanceOf(
      FileNotFoundError,
    )
  })

  it('conditionally writes only when the coherent version still matches', async () => {
    const fileSystem = new MemoryFileSystem({ 'notes/readme.md': 'one' })
    const initial = await fileSystem.readTextSnapshot(notePath)

    const written = await fileSystem.writeTextIfUnchanged(
      notePath,
      initial.version,
      'two',
    )
    expect(written).toMatchObject({ status: 'written', atomicity: 'strong' })
    if (written.status !== 'written') throw new Error('expected a write')

    const stale = await fileSystem.writeTextIfUnchanged(
      notePath,
      initial.version,
      'stale local content',
    )
    expect(stale).toMatchObject({
      status: 'conflict',
      reason: 'changed',
      expectedVersion: initial.version,
      actualVersion: written.version,
      actualContent: 'two',
    })
    expect(await fileSystem.readFile(notePath)).toBe('two')

    await fileSystem.writeFile(notePath, 'same bytes')
    const sameBytes = await fileSystem.writeTextIfUnchanged(
      notePath,
      written.version,
      'would overwrite',
    )
    expect(sameBytes).toMatchObject({ status: 'conflict', reason: 'changed' })

    const current = await fileSystem.readTextSnapshot(notePath)
    await fileSystem.deleteEntry(createWorkspacePath(notePath))
    await expect(
      fileSystem.writeTextIfUnchanged(notePath, current.version, 'recreated'),
    ).resolves.toMatchObject({ status: 'conflict', reason: 'deleted' })
  })

  it('preserves a logical text version when a file is moved', async () => {
    const fileSystem = new MemoryFileSystem({ 'notes/readme.md': 'one' })
    const before = await fileSystem.readTextSnapshot(notePath)

    await fileSystem.renameEntry(createWorkspacePath(notePath), 'renamed.md')

    const moved = await fileSystem.readTextSnapshot(
      createDocumentPath('notes/renamed.md'),
    )
    expect(moved.version).toBe(before.version)
    await expect(
      fileSystem.writeTextIfUnchanged(
        createDocumentPath('notes/renamed.md'),
        before.version,
        'two',
      ),
    ).resolves.toMatchObject({ status: 'written', atomicity: 'strong' })
  })

  it('returns a defensive map snapshot', async () => {
    const fileSystem = new MemoryFileSystem({ 'notes/readme.md': 'one' })
    const snapshot = fileSystem.snapshot()

    await fileSystem.writeFile(notePath, 'two')

    expect(snapshot.get(notePath)).toBe('one')
    expect((await fileSystem.readFile(notePath))).toBe('two')
  })
})
