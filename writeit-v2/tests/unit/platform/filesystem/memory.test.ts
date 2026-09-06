import { describe, expect, it } from 'vitest'
import {
  createDocumentPath,
} from '../../../../src/core/document'
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

  it('returns a defensive map snapshot', async () => {
    const fileSystem = new MemoryFileSystem({ 'notes/readme.md': 'one' })
    const snapshot = fileSystem.snapshot()

    await fileSystem.writeFile(notePath, 'two')

    expect(snapshot.get(notePath)).toBe('one')
    expect((await fileSystem.readFile(notePath))).toBe('two')
  })
})
