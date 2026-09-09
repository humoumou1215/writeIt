import { DocumentStore, type DocumentLocator } from '../../core/document'
import { validateMarkdown, type ValidationResult, type ValidationRule } from '../../core/validation'

export interface ValidationPolicy { readonly strict?: boolean }

export class ValidationService {
  private readonly cache = new Map<string, ValidationResult>()
  constructor(private readonly rules: readonly ValidationRule[] = []) {}
  validate(source: string, revision = 0): ValidationResult {
    const key = `${revision}:${source}`
    const cached = this.cache.get(key)
    if (cached) return cached
    const result = validateMarkdown(source, this.rules.length > 0 ? this.rules : undefined)
    this.cache.set(key, result)
    return result
  }
  invalidate(): void { this.cache.clear() }
  canSave(source: string, revision = 0, policy: ValidationPolicy = {}): boolean {
    const result = this.validate(source, revision)
    return policy.strict !== true || !result.issues.some((issue) => issue.severity === 'error')
  }
  validateDocument(store: DocumentStore, locator: DocumentLocator, _policy: ValidationPolicy = {}): ValidationResult {
    const document = store.get(locator)
    if (!document) throw new Error('Document is unavailable')
    return this.validate(document.markdown, document.revision)
  }
}

export function canSaveWithValidation(result: ValidationResult, strict = false): boolean {
  return !strict || !result.issues.some((issue) => issue.severity === 'error')
}
