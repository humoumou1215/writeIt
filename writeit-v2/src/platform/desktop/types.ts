export interface DesktopInvoker {
  invoke<T>(command: string, payload?: Readonly<Record<string, unknown>>): Promise<T>
}
export interface DesktopPathAdapter { readText(path: string): Promise<string>; writeText(path: string, content: string): Promise<void>; reveal(path: string): Promise<void> }
export interface DesktopWindowAdapter { setTitle(title: string): Promise<void>; close(): Promise<void> }
export interface DesktopDialogAdapter { confirm(message: string): Promise<boolean>; alert(message: string): Promise<void> }
