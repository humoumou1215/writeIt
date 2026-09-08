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
