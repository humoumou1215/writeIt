// 文件系统抽象 —— 同一套接口，四种宿主实现：
//   mock  → 浏览器内 localStorage 模拟（Vite 调试 / Demo）
//   web   → File System Access API（Chrome 直接打开真实目录）
//   tauri → Rust 命令（打包后的独立应用）
//   dev   → Vite Node 中间件（?repo=1 真实仓库模式：真实目录 + 真实 git）

export interface FsEntry {
  name: string
  /** 相对根目录的路径，始终用 `/` 分隔 */
  path: string
  kind: 'file' | 'dir'
  children?: FsEntry[]
}

export type FsBackendKind = 'mock' | 'web' | 'tauri' | 'dev'

export interface FileSystem {
  readonly kind: FsBackendKind
  /** 当前根目录的显示名（目录名或示例名） */
  readonly rootName: string
  /** 打开一个目录。返回 false 表示用户取消 */
  openDirectory(): Promise<boolean>
  /** 读取整棵文件树 */
  readTree(showAll: boolean): Promise<FsEntry[]>
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  createFile(path: string): Promise<void>
  createDir(path: string): Promise<void>
  rename(oldPath: string, newPath: string): Promise<void>
  remove(path: string): Promise<void>
}

export function isEditableFile(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.txt')
}

/**
 * 文件树展示：全部文件类型都展示（非可编辑文件仅展示，不支持打开/编辑）。
 * 参数保留仅为兼容既有调用（mock/web 的 readTree 签名）。
 */
export function shouldShowInTree(_path: string, _name: string, _showAll: boolean): boolean {
  return true
}

export function joinPath(dir: string, name: string): string {
  return dir ? `${dir.replace(/\/+$/, '')}/${name}` : name
}

export function dirName(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

export function baseName(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? path : path.slice(i + 1)
}
