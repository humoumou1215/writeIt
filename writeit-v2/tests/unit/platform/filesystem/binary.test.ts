import { describe, expect, it } from 'vitest'
import { createDocumentPath } from '../../../../src/core/document'
import { createWorkspacePath } from '../../../../src/core/workspace'
import {
  FileNotFoundError,
  MemoryFileSystem,
  WorkspaceEntryAlreadyExistsError,
} from '../../../../src/platform/filesystem'

const imagePath = createWorkspacePath('images/clip.png')

describe('MemoryFileSystem binary port', () => {
  it('round-trips copied bytes and exposes binary files to the workspace tree', async () => {
    const source = new Uint8Array([0, 1, 2, 254, 255])
    const fileSystem = new MemoryFileSystem({
      files: { 'notes/readme.md': 'note' },
      binaryFiles: { 'images/seed.png': source },
    })

    source[0] = 99
    expect([...await fileSystem.readBinary(createWorkspacePath('images/seed.png'))]).toEqual([
      0, 1, 2, 254, 255,
    ])

    await fileSystem.writeBinary(imagePath, new Uint8Array([3, 4]))
    const entries = await fileSystem.listDirectory(createWorkspacePath('images'))
    expect(entries.map((entry) => entry.path)).toEqual([
      'images/clip.png',
      'images/seed.png',
    ])

    const bytes = await fileSystem.readBinary(imagePath)
    bytes[0] = 100
    expect([...await fileSystem.readBinary(imagePath)]).toEqual([3, 4])
  })

  it('creates binary files exclusively and returns an opaque ownership version', async () => {
    const fileSystem = new MemoryFileSystem({
      binaryFiles: { 'images/existing.png': new Uint8Array([8]) },
    })

    const collision = await fileSystem.createBinaryExclusive(
      createWorkspacePath('images/existing.png'),
      new Uint8Array([1]),
    )
    expect(collision).toEqual({ status: 'exists' })
    expect(
      [...await fileSystem.readBinary(createWorkspacePath('images/existing.png'))],
    ).toEqual([8])

    const created = await fileSystem.createBinaryExclusive(
      imagePath,
      new Uint8Array([2]),
    )
    expect(created).toMatchObject({ status: 'created', atomicity: 'strong' })
    if (created.status !== 'created') throw new Error('expected a create')

    await fileSystem.writeBinary(imagePath, new Uint8Array([3]))
    const changed = await fileSystem.deleteBinaryIfUnchanged(
      imagePath,
      created.version,
    )
    expect(changed).toMatchObject({ status: 'not-owned', reason: 'changed' })

    await fileSystem.deleteBinary(imagePath)
    const recreated = await fileSystem.createBinaryExclusive(
      imagePath,
      new Uint8Array([4]),
    )
    expect(recreated.status).toBe('created')
    if (recreated.status !== 'created') throw new Error('expected a recreate')
    await expect(
      fileSystem.deleteBinaryIfUnchanged(imagePath, recreated.version),
    ).resolves.toEqual({ status: 'deleted' })
  })

  it('uses one namespace when replacing a text file with binary content', async () => {
    const fileSystem = new MemoryFileSystem({ files: { 'readme.md': 'text' } })

    await fileSystem.writeBinary(
      createWorkspacePath('readme.md'),
      new Uint8Array([9]),
    )
    expect(await fileSystem.readBinary(createWorkspacePath('readme.md'))).toEqual(
      new Uint8Array([9]),
    )
  })

  it('reports missing binary files and removes them without affecting text files', async () => {
    const fileSystem = new MemoryFileSystem({ files: { 'readme.md': 'text' } })
    await expect(fileSystem.readBinary(imagePath)).rejects.toBeInstanceOf(
      FileNotFoundError,
    )

    await fileSystem.writeBinary(imagePath, new Uint8Array([7]))
    await fileSystem.deleteBinary(imagePath)
    expect(await fileSystem.readFile(createDocumentPath('readme.md'))).toBe('text')
    await expect(fileSystem.deleteBinary(imagePath)).rejects.toBeInstanceOf(
      FileNotFoundError,
    )
  })

  it('rejects a binary seed collision with a text file', () => {
    expect(
      () =>
        new MemoryFileSystem({
          files: { 'same.md': 'text' },
          binaryFiles: { 'same.md': new Uint8Array([1]) },
        }),
    ).toThrow(WorkspaceEntryAlreadyExistsError)
  })
})
