export type DebugMode = 'off' | 'local' | 'lan'
export type DebugAction = 'diagnostics.read' | 'document.write' | 'exec'

export class DesktopDebugPolicy {
  constructor(private readonly mode: DebugMode = 'off') {}
  allows(action: DebugAction, authenticated: boolean): boolean {
    if (this.mode === 'off' || !authenticated) return false
    if (this.mode === 'lan' && action === 'exec') return false
    return action === 'diagnostics.read'
  }
  getMode(): DebugMode { return this.mode }
}
