import type { DiagnosticError, DiagnosticEvent, DiagnosticsSnapshot } from './types'
export type { DiagnosticError, DiagnosticEvent, DiagnosticsSnapshot } from './types'

function safeError(error: unknown): DiagnosticError {
  if (error instanceof Error) return Object.freeze({ name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) })
  if (error && typeof error === 'object') return Object.freeze({ name: 'UnknownError', message: String((error as { message?: unknown }).message ?? error) })
  return Object.freeze({ name: 'UnknownError', message: String(error) })
}

export class DiagnosticsRing {
  private readonly events: DiagnosticEvent[] = []
  private readonly errors: DiagnosticError[] = []
  private readonly performance: { name: string; durationMs: number }[] = []
  constructor(private readonly maxEntries = 200) { if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new RangeError('Diagnostics maxEntries must be positive') }
  record(kind: string, data: Readonly<Record<string, unknown>> = {}): void { this.events.push(Object.freeze({ kind, at: Date.now(), data: Object.freeze({ ...data }) })); this.trim(this.events) }
  recordError(error: unknown, kind = 'error'): void { this.errors.push(safeError(error)); this.trim(this.errors); this.record(kind, { message: this.errors[this.errors.length - 1]?.message ?? '' }) }
  recordPerformance(name: string, durationMs: number): void { if (!Number.isFinite(durationMs)) return; this.performance.push({ name, durationMs }); this.trim(this.performance) }
  snapshot(): DiagnosticsSnapshot { return Object.freeze({ generatedAt: Date.now(), events: Object.freeze([...this.events]), errors: Object.freeze([...this.errors]), performance: Object.freeze(this.performance.map((item) => Object.freeze({ ...item }))) }) }
  private trim<T>(items: T[]): void { if (items.length > this.maxEntries) items.splice(0, items.length - this.maxEntries) }
}
