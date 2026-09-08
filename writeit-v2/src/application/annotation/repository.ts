import type { Annotation } from '../../core/annotation'

export const ANNOTATION_SCHEMA_VERSION = 1

export interface AnnotationRepositoryPort {
  load(documentPath: string): Promise<readonly Annotation[]>
  save(documentPath: string, annotations: readonly Annotation[]): Promise<void>
  delete(documentPath: string): Promise<void>
}

/** Browser/test sidecar adapter. A desktop adapter can back the same port with .writeit/annotations/. */
export class MemoryAnnotationRepository implements AnnotationRepositoryPort {
  private readonly records = new Map<string, readonly Annotation[]>()
  private failNextWrite: unknown | undefined

  constructor(initial: Readonly<Record<string, readonly Annotation[]>> = {}) {
    for (const [path, annotations] of Object.entries(initial)) this.records.set(path, freezeRecords(annotations))
  }

  failNextSave(error: unknown = new Error('annotation sidecar write failed')): void {
    this.failNextWrite = error
  }

  async load(documentPath: string): Promise<readonly Annotation[]> {
    return this.records.get(documentPath) ?? Object.freeze([])
  }

  async save(documentPath: string, annotations: readonly Annotation[]): Promise<void> {
    if (this.failNextWrite !== undefined) {
      const error = this.failNextWrite
      this.failNextWrite = undefined
      throw error
    }
    this.records.set(documentPath, freezeRecords(annotations))
  }

  async delete(documentPath: string): Promise<void> {
    this.records.delete(documentPath)
  }
}

function freezeRecords(annotations: readonly Annotation[]): readonly Annotation[] {
  return Object.freeze(annotations.map((annotation) => Object.freeze({
    ...annotation,
    thread: Object.freeze({
      ...annotation.thread,
      comments: Object.freeze(annotation.thread.comments.map((comment) => Object.freeze({ ...comment }))),
    }),
  })))
}

