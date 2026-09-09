import type {
  Annotation,
  AnnotationComment,
  AnnotationThread,
  ResolvedState,
} from './types'

function requireText(value: string, name: string): void {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} must be non-empty`)
}

function freezeThread(thread: AnnotationThread): AnnotationThread {
  return Object.freeze({ comments: Object.freeze(thread.comments.map((comment) => Object.freeze({ ...comment }))), resolved: thread.resolved })
}

export function createAnnotation(input: {
  id: string
  documentPath: string
  anchor: Annotation['anchor']
  comment: AnnotationComment
  createdAt: string
}): Annotation {
  requireText(input.id, 'Annotation id')
  requireText(input.documentPath, 'Annotation documentPath')
  requireText(input.comment.id, 'Comment id')
  requireText(input.comment.author, 'Comment author')
  requireText(input.comment.body, 'Comment body')
  requireText(input.comment.createdAt, 'Comment createdAt')
  requireText(input.createdAt, 'Annotation createdAt')
  const thread = freezeThread({ comments: [input.comment], resolved: 'open' })
  return Object.freeze({ id: input.id, documentPath: input.documentPath, anchor: input.anchor, anchorResolution: Object.freeze({ status: 'resolved' as const, from: input.anchor.from, to: input.anchor.to, text: input.anchor.selectedText }), thread, createdAt: input.createdAt, updatedAt: input.createdAt })
}

export function replyToAnnotation(annotation: Annotation, comment: AnnotationComment): Annotation {
  requireText(comment.id, 'Comment id')
  requireText(comment.author, 'Comment author')
  requireText(comment.body, 'Comment body')
  requireText(comment.createdAt, 'Comment createdAt')
  if (annotation.thread.comments.some((existing) => existing.id === comment.id)) throw new Error(`Comment id already exists: ${comment.id}`)
  return Object.freeze({ ...annotation, thread: freezeThread({ ...annotation.thread, comments: [...annotation.thread.comments, comment] }), updatedAt: comment.createdAt })
}

export function setAnnotationResolved(annotation: Annotation, resolved: ResolvedState, updatedAt: string): Annotation {
  requireText(updatedAt, 'Annotation updatedAt')
  return Object.freeze({ ...annotation, thread: freezeThread({ ...annotation.thread, resolved }), updatedAt })
}
