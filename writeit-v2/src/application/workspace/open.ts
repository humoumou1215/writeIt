import type { DocumentId } from '../../core/document'

export interface WorkspaceOpenDecisionInput {
  /** A DocumentStore identity found by stable workspace path, if loaded. */
  readonly loadedDocumentId?: DocumentId
  /** Dirty is read from the loaded DocumentStore snapshot. */
  readonly dirty: boolean
  /** Whether the identity already has a workspace tab. */
  readonly tabOpen: boolean
}

export type WorkspaceOpenDecision =
  | { readonly kind: 'load' }
  | { readonly kind: 'activate-existing'; readonly documentId: DocumentId }
  | { readonly kind: 'reopen-clean'; readonly documentId: DocumentId }

/**
 * Selects the application action for an explicit workspace Open.
 *
 * A loaded dirty Document is never reopened from the filesystem: the caller
 * must bind/activate a tab to the existing DocumentId. An already-open tab is
 * activated regardless of dirty state. Only a loaded clean Document without a
 * tab retains the pre-existing clean reopen/reconciliation behavior.
 */
export function decideWorkspaceOpen(
  input: WorkspaceOpenDecisionInput,
): WorkspaceOpenDecision {
  const documentId = input.loadedDocumentId
  if (documentId === undefined) return { kind: 'load' }
  if (input.tabOpen || input.dirty) {
    return Object.freeze({ kind: 'activate-existing', documentId })
  }
  return Object.freeze({ kind: 'reopen-clean', documentId })
}
