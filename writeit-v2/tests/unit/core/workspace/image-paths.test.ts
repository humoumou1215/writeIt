import { describe, expect, it } from 'vitest'
import {
  documentRelativeImageSourcePath,
  resolveDocumentRelativeImagePath,
} from '../../../../src/core/workspace'

describe('document-relative image paths', () => {
  it('computes canonical source paths across nested document directories', () => {
    expect(
      documentRelativeImageSourcePath('images/root.png', 'readme.md'),
    ).toBe('./images/root.png')
    expect(
      documentRelativeImageSourcePath(
        'images/root.png',
        'notes/deep/readme.md',
      ),
    ).toBe('../../images/root.png')
    expect(
      documentRelativeImageSourcePath(
        'notes/deep/images/file.png',
        'notes/deep/readme.md',
      ),
    ).toBe('./images/file.png')
    expect(
      documentRelativeImageSourcePath(
        'notes/deep/same.png',
        'notes/deep/readme.md',
      ),
    ).toBe('./same.png')
    expect(
      documentRelativeImageSourcePath(
        'notes/deep/photo one#.png',
        'notes/deep/readme.md',
      ),
    ).toBe('./photo%20one%23.png')
  })

  it('resolves relative, encoded and platform-input spellings from the document directory', () => {
    expect(
      resolveDocumentRelativeImagePath(
        'images/photo%20one.png?cache=1#preview',
        'notes/readme.md',
      ),
    ).toBe('notes/images/photo one.png')
    expect(
      resolveDocumentRelativeImagePath(
        '..\\images\\photo.png',
        'notes/deep/readme.md',
      ),
    ).toBe('notes/images/photo.png')
    expect(
      resolveDocumentRelativeImagePath('./photo.png', 'notes/readme.md'),
    ).toBe('notes/photo.png')
  })

  it('fails closed for non-file sources, missing hosts, and workspace escape', () => {
    expect(resolveDocumentRelativeImagePath('data:image/png;base64,AQ==', 'readme.md')).toBeUndefined()
    expect(resolveDocumentRelativeImagePath('/images/photo.png', 'readme.md')).toBeUndefined()
    expect(resolveDocumentRelativeImagePath('\\images\\photo.png', 'readme.md')).toBeUndefined()
    expect(resolveDocumentRelativeImagePath('../../photo.png', 'notes/readme.md')).toBeUndefined()
    expect(resolveDocumentRelativeImagePath('images/photo.png')).toBeUndefined()
  })
})
