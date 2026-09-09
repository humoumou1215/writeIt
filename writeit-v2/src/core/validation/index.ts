import type { ValidationIssue, ValidationResult, ValidationRule } from './types'
export type { ValidationIssue, ValidationResult, ValidationRule, ValidationSeverity } from './types'

export const defaultValidationRules: readonly ValidationRule[] = Object.freeze([
  { id: 'markdown.trailing-whitespace', validate: (source) => {
    const issues: ValidationIssue[] = []
    const matcher = /[^\S\r\n]+$/gmu
    let match: RegExpExecArray | null
    while ((match = matcher.exec(source))) issues.push({ ruleId: 'markdown.trailing-whitespace', severity: 'warning', message: 'Trailing whitespace', from: match.index, to: match.index + match[0].length })
    return issues
  } },
  { id: 'markdown.unclosed-fence', validate: (source) => {
    const fences = source.match(/^ {0,3}(`{3,}|~{3,})/gmu) ?? []
    return fences.length % 2 === 0 ? [] : [{ ruleId: 'markdown.unclosed-fence', severity: 'error', message: 'Code fence is not closed' }]
  } },
])

export function validateMarkdown(source: string, rules: readonly ValidationRule[] = defaultValidationRules): ValidationResult {
  if (typeof source !== 'string') throw new TypeError('Validation source must be a string')
  const issues: ValidationIssue[] = []
  const failedRuleIds: string[] = []
  for (const rule of rules) {
    try {
      const result = rule.validate(source)
      for (const issue of result ?? []) issues.push(Object.freeze({ ...issue, ruleId: issue.ruleId || rule.id }))
    } catch (error) {
      failedRuleIds.push(rule.id)
      issues.push(Object.freeze({ ruleId: rule.id, severity: 'error', message: `Validation rule failed: ${error instanceof Error ? error.message : String(error)}` }))
    }
  }
  return Object.freeze({ issues: Object.freeze(issues), failedRuleIds: Object.freeze(failedRuleIds) })
}
