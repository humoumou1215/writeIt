import { Facet, type EditorState } from '@codemirror/state'
import {
  DocumentRevisionConflictError,
  DocumentStore,
  type DocumentLocator,
  type DocumentOrigin,
  type DocumentState,
  type ProjectionId,
  type Revision,
} from '../../../core/document'
import {
  applyProjectedMarkdownToSource,
  projectMarkdownSource,
} from './source-fidelity'

/**
 * The only source mutation shape exposed to CM6 popup projections. `markdown`
 * is the current normalized CM6 projection; the capability maps it back to
 * authoritative source before committing it.
 */
export interface ProjectionMutationChange {
  readonly markdown: string
  readonly origin: DocumentOrigin
  readonly expectedRevision: Revision
}

/**
 * A narrowly scoped source-mutation capability for one live CM6 projection.
 *
 * Popup adapters can read the current authority and commit an expected-revision
 * change, but they cannot obtain a store or locator from this interface. The
 * capability is invalidated before projection teardown and rejects readonly,
 * stale, detached, and revision-raced mutations.
 */
export interface ProjectionMutationCapability {
  readonly projectionId: ProjectionId
  snapshot(): DocumentState
  applyChange(change: ProjectionMutationChange): DocumentState
}

export interface ProjectionMutationCapabilityController {
  readonly capability: ProjectionMutationCapability
  invalidate(): void
}

export interface ProjectionMutationCapabilityOptions {
  readonly store: DocumentStore
  readonly locator: DocumentLocator
  readonly projectionId: ProjectionId
  readonly editable: boolean
  /**
   * Allows the projection adapter to reject a capability after a runtime
   * readonly transition. It is evaluated at every snapshot/mutation attempt.
   */
  readonly isEditable?: () => boolean
}

export class ProjectionMutationUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectionMutationUnavailableError'
  }
}

function requireChange(change: ProjectionMutationChange): ProjectionMutationChange {
  if (change === null || typeof change !== 'object') {
    throw new TypeError('Projection mutation change is required')
  }
  if (typeof change.markdown !== 'string') {
    throw new TypeError('Projection mutation markdown must be a string')
  }
  if (change.origin === null || typeof change.origin !== 'object') {
    throw new TypeError('Projection mutation origin is required')
  }
  if (!Number.isSafeInteger(change.expectedRevision) || change.expectedRevision < 0) {
    throw new TypeError('Projection mutation expectedRevision must be valid')
  }
  return change
}

/**
 * Creates the lifecycle-owned capability used by `mountSingleDocumentView`.
 * The controller is intentionally the only holder of invalidation authority.
 */
export function createProjectionMutationCapability(
  options: ProjectionMutationCapabilityOptions,
): ProjectionMutationCapabilityController {
  let live = true

  const requireCurrent = (): DocumentState => {
    if (!live) {
      throw new ProjectionMutationUnavailableError(
        'Projection mutation capability is no longer live',
      )
    }
    if (!options.editable || options.isEditable?.() === false) {
      throw new ProjectionMutationUnavailableError(
        'Projection is readonly and cannot mutate the document',
      )
    }

    const document = options.store.get(options.locator)
    if (!document) {
      throw new ProjectionMutationUnavailableError(
        'Projection document is no longer loaded',
      )
    }

    let projection
    try {
      projection = options.store.getProjection(
        options.locator,
        options.projectionId,
      )
    } catch (error) {
      throw new ProjectionMutationUnavailableError(
        `Projection is no longer attached: ${String(error)}`,
      )
    }

    if (projection.stale) {
      throw new ProjectionMutationUnavailableError(
        `Projection is stale at revision ${projection.revision}; current revision is ${document.revision}`,
      )
    }
    if (projection.revision !== document.revision) {
      throw new ProjectionMutationUnavailableError(
        `Projection revision ${projection.revision} is not current at ${document.revision}`,
      )
    }
    return document
  }

  const capability: ProjectionMutationCapability = Object.freeze({
    projectionId: options.projectionId,
    snapshot(): DocumentState {
      return requireCurrent()
    },
    applyChange(change: ProjectionMutationChange): DocumentState {
      const normalized = requireChange(change)
      const current = requireCurrent()
      if (normalized.expectedRevision !== current.revision) {
        throw new DocumentRevisionConflictError(
          normalized.expectedRevision,
          current.revision,
        )
      }
      const authoritativeMarkdown = applyProjectedMarkdownToSource(
        projectMarkdownSource(current.markdown),
        normalized.markdown,
      )
      return options.store.applyChange(options.locator, {
        ...normalized,
        markdown: authoritativeMarkdown,
      })
    },
  })

  return Object.freeze({
    capability,
    invalidate(): void {
      live = false
    },
  })
}

const unavailableCapability: ProjectionMutationCapability = Object.freeze({
  projectionId: 'unbound-projection',
  snapshot(): DocumentState {
    throw new ProjectionMutationUnavailableError(
      'Popup surface is not bound to a live SingleDocumentView projection',
    )
  },
  applyChange(): DocumentState {
    throw new ProjectionMutationUnavailableError(
      'Popup surface is not bound to a live SingleDocumentView projection',
    )
  },
})

/** Private-to-the-editor injection point for popup extensions. */
export const projectionMutationFacet = Facet.define<
  ProjectionMutationCapability,
  ProjectionMutationCapability
>({
  combine: (values) => values.at(-1) ?? unavailableCapability,
})

export function getProjectionMutationCapability(
  state: EditorState,
): ProjectionMutationCapability | undefined {
  const capability = state.facet(projectionMutationFacet)
  return capability === unavailableCapability ? undefined : capability
}
