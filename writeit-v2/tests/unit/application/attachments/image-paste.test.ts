import { describe, expect, it, vi } from 'vitest'
import { ImageAttachmentService } from '../../../../src/application/attachments'
import {
  bytesToBase64,
  bytesToDataUri,
  computeImageAttachmentPath,
} from '../../../../src/application/attachments'
import { createDocumentPath } from '../../../../src/core/document'
import { createWorkspacePath } from '../../../../src/core/workspace'
import { MemoryFileSystem } from '../../../../src/platform/filesystem'
import type { BinaryFileSystemPort } from '../../../../src/platform/filesystem'

const image = {
  name: 'clipboard.png',
  mimeType: 'image/png',
  bytes: new Uint8Array([72, 101, 108, 108, 111]),
}

function service(fileSystem?: BinaryFileSystemPort): ImageAttachmentService {
  return new ImageAttachmentService({
    fileSystem,
    nameGenerator: () => 'capture.png',
  })
}

describe('ImageAttachmentService', () => {
  it('encodes clipboard bytes as a portable data URI', () => {
    expect(bytesToBase64(image.bytes)).toBe('SGVsbG8=')
    expect(bytesToDataUri(image.bytes, image.mimeType)).toBe(
      'data:image/png;base64,SGVsbG8=',
    )
  })

  it.each([
    ['root-images', 'images/capture.png'],
    ['same-dir', 'notes/capture.png'],
    ['file-images', 'notes/images/capture.png'],
  ] as const)('computes the %s workspace target', (mode, expected) => {
    expect(
      computeImageAttachmentPath(
        mode,
        createWorkspacePath('notes/readme.md'),
        'capture.png',
      ),
    ).toBe(expected)
  })

  it('writes a relative workspace path and preserves the exact bytes', async () => {
    const fileSystem = new MemoryFileSystem({ directories: ['notes'] })
    const result = await service(fileSystem).paste({
      images: [image],
      mode: 'file-images',
      hostPath: 'notes/readme.md',
    })

    expect(result).toMatchObject({
      savedPaths: ['notes/images/capture.png'],
      inlinedCount: 0,
      fallbacks: [],
    })
    expect(result.references).toEqual([
      {
        markdown: '![clipboard](notes/images/capture.png)',
        source: 'file',
        path: 'notes/images/capture.png',
        inputName: 'clipboard.png',
      },
    ])
    expect(
      [...(await fileSystem.readBinary(createWorkspacePath('notes/images/capture.png')))],
    ).toEqual([...image.bytes])
  })

  it('keeps inline mode explicit and does not touch the binary filesystem', async () => {
    const writeBinary = vi.fn<BinaryFileSystemPort['writeBinary']>()
    const result = await service({
      writeBinary,
      readBinary: vi.fn<BinaryFileSystemPort['readBinary']>(),
    }).paste({
      images: [image],
      mode: 'inline',
      hostPath: 'readme.md',
    })

    expect(writeBinary).not.toHaveBeenCalled()
    expect(result.inlinedCount).toBe(1)
    expect(result.references[0]?.markdown).toBe(
      '![clipboard](data:image/png;base64,SGVsbG8=)',
    )
    expect(result.fallbacks).toEqual([])
  })

  it('falls back to inline data when the host or binary write is unavailable', async () => {
    const noHost = await service().paste({
      images: [image],
      mode: 'root-images',
      hostPath: null,
    })
    expect(noHost.savedPaths).toEqual([])
    expect(noHost.references[0]?.source).toBe('inline')
    expect(noHost.fallbacks[0]?.reason).toBe('document has no workspace path')

    const writeBinary = vi.fn(async () => {
      throw new Error('read-only workspace')
    })
    const failedWrite = await service({
      writeBinary,
      readBinary: vi.fn<BinaryFileSystemPort['readBinary']>(),
    }).paste({
      images: [image],
      mode: 'root-images',
      hostPath: 'readme.md',
    })
    expect(failedWrite.savedPaths).toEqual([])
    expect(failedWrite.references[0]?.source).toBe('inline')
    expect(failedWrite.references[0]?.markdown).toContain(
      'data:image/png;base64,SGVsbG8=',
    )
    expect(failedWrite.fallbacks[0]?.reason).toContain('binary write failed')
  })

  it('cleans up files when a later editor mutation is rejected', async () => {
    const fileSystem = new MemoryFileSystem()
    const attachmentService = service(fileSystem)
    await attachmentService.paste({
      images: [image],
      mode: 'root-images',
      hostPath: 'readme.md',
    })

    const cleanup = await attachmentService.cleanup(['images/capture.png'])
    expect(cleanup.deletedPaths).toEqual(['images/capture.png'])
    expect(fileSystem.hasFile(createDocumentPath('images/capture.png'))).toBe(false)
  })
})
