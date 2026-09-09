import type { OutlineHeading } from '../outline'

export interface ComposedContentStats {
  readonly wordCount: number
  readonly referenceCount: number
  readonly embedCount: number
  readonly outline: readonly OutlineHeading[]
  readonly circularEmbeds: readonly string[]
}

export interface ComposedContentReader {
  read(path: string): string | undefined
}
