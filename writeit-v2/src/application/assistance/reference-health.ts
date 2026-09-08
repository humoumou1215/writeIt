import {
  createReferenceObjectCandidate,
} from '../../core/reference'
import type {
  ReferenceFragmentCandidate,
  ReferenceObjectResolver,
} from '../../core/reference'
import {
  createSuggestionDocumentContext,
  resolveSuggestionObjects,
} from './suggestion'
import type { SuggestionProviderLike } from './suggestion'

/**
 * Adapts the editor-independent template suggestion contract to the Core
 * reference-health contract. This keeps dynamic object discovery reusable for
 * navigation without making Core depend on the P8/application implementation.
 */
export function createReferenceHealthObjectResolver(
  provider: SuggestionProviderLike,
): ReferenceObjectResolver {
  if (
    provider === null ||
    (typeof provider !== 'object' && typeof provider !== 'function')
  ) {
    throw new TypeError('Reference health suggestion provider is invalid')
  }

  return async ({ path, source }): Promise<readonly ReferenceFragmentCandidate[]> => {
    const objects = await resolveSuggestionObjects(
      provider,
      createSuggestionDocumentContext(path, source),
    )
    return Object.freeze(
      objects.map((object) =>
        createReferenceObjectCandidate({
          id: object.id,
          label: object.label,
          fragment: object.fragment,
        }),
      ),
    )
  }
}
