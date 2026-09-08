import type { DiagnosticsService } from './service'
import type { DocumentStore } from '../../core/document'

export type DebugPermission = 'read-diagnostics'
export interface DebugRequest { readonly method: 'diagnostics.get'; readonly permission?: DebugPermission }
export interface DebugTransport { send(payload: unknown): Promise<void> | void }
export class DebugApi {
  constructor(private readonly store: DocumentStore, private readonly diagnostics: DiagnosticsService, private readonly transport: DebugTransport) {}
  async handle(request: DebugRequest): Promise<void> {
    if (request.permission !== 'read-diagnostics') throw new Error('Debug permission denied')
    if (request.method !== 'diagnostics.get') throw new Error('Unknown debug method')
    await this.transport.send(this.diagnostics.report(this.store))
  }
}
