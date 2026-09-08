import { describe, expect, it, vi } from 'vitest'
import { ImageAttachmentService } from '../../../../src/application/attachments'
import {
  bytesToBase64,
  bytesToDataUri,
  computeImageAttachmentPath,
  computeImageAttachmentSourcePath,
} from '../../../../src/application/attachments'
import { createDocumentPath } from '../../../../src/core/document'
import { createWorkspacePath } from '../../../../src/core/workspace'
import { MemoryFileSystem } from '../../../../src/platform/filesystem'
import type {
  BinaryFileSystemPort,
  FileVersionToken,
} from '../../../../src/platform/filesystem'

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

  it.each([
    ['root-images', 'images/capture.png', '../images/capture.png'],
    ['same-dir', 'notes/capture.png', './capture.png'],
    ['file-images', 'notes/images/capture.png', './images/capture.png'],
  ] as const)(
    'persists %s at a workspace destination but stores a document-relative source',
    async (mode, savedPath, sourcePath) => {
      const fileSystem = new MemoryFileSystem({ directories: ['notes'] })
      const result = await service(fileSystem).paste({
        images: [image],
        mode,
        hostPath: 'notes/readme.md',
      })

      expect(result).toMatchObject({
        savedPaths: [savedPath],
        inlinedCount: 0,
        fallbacks: [],
      })
      expect(result.references).toEqual([
        {
          markdown: `![clipboard](${sourcePath})`,
          source: 'file',
          path: savedPath,
          inputName: 'clipboard.png',
        },
      ])
      expect(
        [...(await fileSystem.readBinary(createWorkspacePath(savedPath)))],
      ).toEqual([...image.bytes])
    },
  )

  it('computes document-relative paths for nested destinations', () => {
    expect(
      computeImageAttachmentSourcePath(
        'root-images',
        createWorkspacePath('notes/deep/readme.md'),
        'capture.png',
      ),
    ).toBe('../../images/capture.png')
    expect(
      computeImageAttachmentSourcePath(
        'same-dir',
        createWorkspacePath('notes/deep/readme.md'),
        'capture.png',
      ),
    ).toBe('./capture.png')
    expect(
      computeImageAttachmentSourcePath(
        'file-images',
        createWorkspacePath('notes/deep/readme.md'),
        'capture.png',
      ),
    ).toBe('./images/capture.png')
  })

  it('keeps inline mode explicit and does not touch the binary filesystem', async () => {
    const createBinaryExclusive = vi.fn<BinaryFileSystemPort['createBinaryExclusive']>(
      async () => ({
        status: 'created',
        atomicity: 'strong',
        version: 'test:inline' as FileVersionToken,
      }),
    )
    const result = await service({
      writeBinary: vi.fn<BinaryFileSystemPort['writeBinary']>(),
      createBinaryExclusive,
      deleteBinaryIfUnchanged: vi.fn<BinaryFileSystemPort['deleteBinaryIfUnchanged']>(),
      readBinary: vi.fn<BinaryFileSystemPort['readBinary']>(),
    }).paste({
      images: [image],
      mode: 'inline',
      hostPath: 'readme.md',
    })

    expect(createBinaryExclusive).not.toHaveBeenCalled()
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

    const createBinaryExclusive = vi.fn(async () => {
      throw new Error('read-only workspace')
    })
    const failedWrite = await service({
      writeBinary: vi.fn<BinaryFileSystemPort['writeBinary']>(),
      createBinaryExclusive,
      deleteBinaryIfUnchanged: vi.fn<BinaryFileSystemPort['deleteBinaryIfUnchanged']>(),
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

  it('uses timestamp-first names and collision suffixes for repeated pastes', async () => {
    const fileSystem = new MemoryFileSystem()
    const attachmentService = new ImageAttachmentService({
      fileSystem,
      now: () => new Date(2026, 8, 8, 12, 34, 56, 789),
      random: () => 'same-entropy',
    })

    const first = await attachmentService.paste({
      images: [image],
      mode: 'root-images',
      hostPath: 'readme.md',
    })
    const second = await attachmentService.paste({
      images: [image],
      mode: 'root-images',
      hostPath: 'readme.md',
    })

    expect(first.savedPaths[0]).toMatch(/^images\/20260908-123456789-sameentr\.png$/u)
    expect(second.savedPaths[0]).toBe(`${first.savedPaths[0]?.replace('.png', '')}-1.png`)
    expect(first.createdAttachments).toHaveLength(1)
    expect(second.createdAttachments).toHaveLength(1)
  })

  it('never overwrites a pre-existing candidate when the exclusive create collides', async () => {
    const fileSystem = new MemoryFileSystem({
      binaryFiles: {
        'images/20260908-123456789-fixed.png': new Uint8Array([9, 9]),
      },
    })
    const result = await new ImageAttachmentService({
      fileSystem,
      nameGenerator: () => '20260908-123456789-fixed.png',
    }).paste({
      images: [image],
      mode: 'root-images',
      hostPath: 'readme.md',
    })

    expect(result.savedPaths).toEqual(['images/20260908-123456789-fixed-1.png'])
    expect(result.references[0]?.markdown).toBe(
      '![clipboard](./images/20260908-123456789-fixed-1.png)',
    )
    expect(
      [...await fileSystem.readBinary(createWorkspacePath('images/20260908-123456789-fixed.png'))],
    ).toEqual([9, 9])
  })

  it('reports an orphan and preserves replacement bytes when ownership is lost', async () => {
    const fileSystem = new MemoryFileSystem()
    const attachmentService = service(fileSystem)
    const result = await attachmentService.paste({
      images: [image],
      mode: 'root-images',
      hostPath: 'readme.md',
    })
    const path = result.createdAttachments[0]
    if (!path) throw new Error('expected an attachment receipt')

    await fileSystem.writeBinary(path.path, new Uint8Array([7, 7]))
    const cleanup = await attachmentService.cleanup(result.createdAttachments, {
      operation: 'image-paste',
      reason: 'Markdown mutation failed',
      documentPath: 'readme.md',
    })

    expect(cleanup.deletedPaths).toEqual([])
    expect(cleanup.failedPaths).toEqual([path.path])
    expect(cleanup.diagnostics).toMatchObject([
      {
        kind: 'orphan-attachment',
        path: path.path,
        operation: 'image-paste',
        documentPath: 'readme.md',
      },
    ])
    expect([...await fileSystem.readBinary(path.path)]).toEqual([7, 7])
  })

  it('records cleanup failure with path, document and operation', async () => {
    class CleanupFailureFileSystem extends MemoryFileSystem {
      override async deleteBinaryIfUnchanged(
        path: Parameters<MemoryFileSystem['deleteBinaryIfUnchanged']>[0],
        version: Parameters<MemoryFileSystem['deleteBinaryIfUnchanged']>[1],
      ): Promise<never> {
        void path
        void version
        throw new Error('permission denied')
      }
    }

    const fileSystem = new CleanupFailureFileSystem()
    const attachmentService = service(fileSystem)
    const result = await attachmentService.paste({
      images: [image],
      mode: 'root-images',
      hostPath: 'readme.md',
    })
    const cleanup = await attachmentService.cleanup(result.createdAttachments, {
      operation: 'image-paste',
      reason: 'projection destroyed',
      documentPath: 'readme.md',
    })

    expect(cleanup.failedPaths).toEqual(['images/capture.png'])
    expect(cleanup.diagnostics).toMatchObject([
      {
        path: 'images/capture.png',
        reason: 'conditional attachment cleanup failed',
        operation: 'image-paste',
        documentPath: 'readme.md',
        cause: 'Error: permission denied',
      },
    ])
    expect(fileSystem.hasFile(createDocumentPath('images/capture.png'))).toBe(true)
  })

  it('cleans up files when a later editor mutation is rejected', async () => {
    const fileSystem = new MemoryFileSystem()
    const attachmentService = service(fileSystem)
    const result = await attachmentService.paste({
      images: [image],
      mode: 'root-images',
      hostPath: 'readme.md',
    })

    const cleanup = await attachmentService.cleanup(
      result.createdAttachments,
      {
        operation: 'image-paste',
        reason: 'revision race',
        documentPath: 'readme.md',
      },
    )
    expect(cleanup.deletedPaths).toEqual(['images/capture.png'])
    expect(cleanup.diagnostics).toEqual([])
    expect(fileSystem.hasFile(createDocumentPath('images/capture.png'))).toBe(false)
  })
})
