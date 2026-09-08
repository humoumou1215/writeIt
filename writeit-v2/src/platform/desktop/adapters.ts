import type { DesktopDialogAdapter, DesktopInvoker, DesktopPathAdapter, DesktopWindowAdapter } from './types'

/** Thin command adapter; all policy remains in application services. */
export class TauriPathAdapter implements DesktopPathAdapter {
  constructor(private readonly invoker: DesktopInvoker) {}
  readText(path: string): Promise<string> { return this.invoker.invoke('fs_read_text', { path }) }
  async writeText(path: string, content: string): Promise<void> { await this.invoker.invoke('fs_write_text', { path, content }) }
  async reveal(path: string): Promise<void> { await this.invoker.invoke('window_reveal_path', { path }) }
}
export class TauriWindowAdapter implements DesktopWindowAdapter {
  constructor(private readonly invoker: DesktopInvoker) {}
  async setTitle(title: string): Promise<void> { await this.invoker.invoke('window_set_title', { title }) }
  async close(): Promise<void> { await this.invoker.invoke('window_close') }
}
export class TauriDialogAdapter implements DesktopDialogAdapter {
  constructor(private readonly invoker: DesktopInvoker) {}
  confirm(message: string): Promise<boolean> { return this.invoker.invoke('dialog_confirm', { message }) }
  async alert(message: string): Promise<void> { await this.invoker.invoke('dialog_alert', { message }) }
}
