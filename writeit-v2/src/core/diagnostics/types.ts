export interface DiagnosticError { readonly name: string; readonly message: string; readonly stack?: string }
export interface DiagnosticEvent { readonly kind: string; readonly at: number; readonly data: Readonly<Record<string, unknown>> }
export interface DiagnosticsSnapshot { readonly generatedAt: number; readonly events: readonly DiagnosticEvent[]; readonly errors: readonly DiagnosticError[]; readonly performance: readonly { readonly name: string; readonly durationMs: number }[] }
