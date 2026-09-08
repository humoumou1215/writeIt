import {
  createAnnotation,
  createRangeAnchor,
  mapRangeAnchorThroughChange,
  replyToAnnotation,
  setAnnotationResolved,
  type Annotation,
  type AnnotationComment,
} from '../../core/annotation'
import type { DocumentState, SourceChangeSet } from '../../core/document'
import type { AnnotationRepositoryPort } from './repository'

export class AnnotationService {
  private readonly cache = new Map<string, readonly Annotation[]>()

  constructor(private readonly repository: AnnotationRepositoryPort) {}

  async list(documentPath: string): Promise<readonly Annotation[]> {
    const cached = this.cache.get(documentPath)
    if (cached) return cached
    const loaded = await this.repository.load(documentPath)
    const frozen = Object.freeze([...loaded])
    this.cache.set(documentPath, frozen)
    return frozen
  }

  async create(input: {
    id: string
    comment: AnnotationComment
    document: DocumentState
    from: number
    to: number
  }): Promise<Annotation> {
    const anchor = createRangeAnchor(input.document.markdown, input.document.path, input.from, input.to)
    const annotation = createAnnotation({ id: input.id, documentPath: input.document.path, anchor, comment: input.comment, createdAt: input.comment.createdAt })
    const current = await this.list(input.document.path)
    await this.persist(input.document.path, [...current, annotation])
    return annotation
  }

  async reply(documentPath: string, annotationId: string, comment: AnnotationComment): Promise<Annotation> {
    const current = await this.require(documentPath, annotationId)
    const next = replyToAnnotation(current, comment)
    await this.persist(documentPath, (await this.list(documentPath)).map((item) => item.id === annotationId ? next : item))
    return next
  }

  async setResolved(documentPath: string, annotationId: string, resolved: 'open' | 'resolved', updatedAt: string): Promise<Annotation> {
    const current = await this.require(documentPath, annotationId)
    const next = setAnnotationResolved(current, resolved, updatedAt)
    await this.persist(documentPath, (await this.list(documentPath)).map((item) => item.id === annotationId ? next : item))
    return next
  }

  async reanchor(documentPath: string, next: DocumentState, change: SourceChangeSet): Promise<readonly Annotation[]> {
    const current = await this.list(documentPath)
    const mapped = current.map((annotation) => {
      const resolution = mapRangeAnchorThroughChange(annotation.anchor, next.markdown, change.changes)
      if (resolution.status === 'resolved') {
        const anchor = createRangeAnchor(next.markdown, documentPath, resolution.from, resolution.to)
        return Object.freeze({ ...annotation, anchor, anchorResolution: resolution, updatedAt: new Date().toISOString() })
      }
      return Object.freeze({ ...annotation, anchorResolution: resolution, updatedAt: new Date().toISOString() })
    })
    await this.persist(documentPath, mapped)
    return mapped
  }

  private async require(documentPath: string, annotationId: string): Promise<Annotation> {
    const annotation = (await this.list(documentPath)).find((item) => item.id === annotationId)
    if (!annotation) throw new Error(`Annotation not found: ${annotationId}`)
    return annotation
  }

  private async persist(documentPath: string, annotations: readonly Annotation[]): Promise<void> {
    await this.repository.save(documentPath, annotations)
    this.cache.set(documentPath, Object.freeze([...annotations]))
  }
}

