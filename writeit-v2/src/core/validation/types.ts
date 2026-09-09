export type ValidationSeverity = 'error' | 'warning' | 'info'

export interface ValidationIssue {
  readonly ruleId: string
  readonly message: string
  readonly severity: ValidationSeverity
  readonly from?: number
  readonly to?: number
}

export interface ValidationRule {
  readonly id: string
  readonly validate: (source: string) => readonly ValidationIssue[] | ValidationIssue[]
}

export interface ValidationResult {
  readonly issues: readonly ValidationIssue[]
  readonly failedRuleIds: readonly string[]
}
