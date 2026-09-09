import { parseReferences } from '../reference'
import { parseOutline, type OutlineHeading } from '../outline'
import type { ComposedContentReader, ComposedContentStats } from './types'

export type { ComposedContentReader, ComposedContentStats } from './types'

function countWords(source: string): number {
  return source.trim() === '' ? 0 : source.trim().split(/\s+/u).length
}

/**
 * Computes user-visible content without materializing it into the DocumentStore.
 * Every embed occurrence is visited independently; a cycle is represented by a
 * diagnostic and traversal stops at that edge.
 */
export function composedContentStats(rootPath: string, rootSource: string, reader: ComposedContentReader): ComposedContentStats {
  if (typeof rootPath !== 'string' || typeof rootSource !== 'string') throw new TypeError('Composed content root is invalid')
  const circularEmbeds: string[] = []
  let wordCount = 0
  let referenceCount = 0
  let embedCount = 0
  const outline: OutlineHeading[] = []
  const visit = (path: string, source: string, trail: readonly string[]) => {
    wordCount += countWords(source)
    const refs = parseReferences(source)
    referenceCount += refs.length
    outline.push(...parseOutline(source))
    for (const ref of refs) {
      if (ref.kind !== 'embed') continue
      embedCount += 1
      const target = reader.read(ref.path)
      if (target === undefined) continue
      if (trail.includes(ref.path) || ref.path === rootPath) {
        circularEmbeds.push(`${path}→${ref.path}`)
        continue
      }
      visit(ref.path, target, [...trail, ref.path])
    }
  }
  visit(rootPath, rootSource, [rootPath])
  return Object.freeze({ wordCount, referenceCount, embedCount, outline: Object.freeze(outline), circularEmbeds: Object.freeze(circularEmbeds) })
}
