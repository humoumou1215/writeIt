import type { FileSystem } from './types'
import { mockFs } from './mock'
import { webFs } from './web'
import { tauriFs } from './tauri'

export type { FileSystem, FsEntry, FsBackendKind } from './types'
export { isEditableFile, joinPath, dirName, baseName } from './types'

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

// 可切换的文件系统代理：
//   Tauri 环境 → tauri 实现
//   浏览器     → 默认 mock（Demo 开箱即用），点「打开目录」时切到 web 实现
let backend: FileSystem = isTauri() ? tauriFs : mockFs

export const fs = new Proxy({} as FileSystem, {
  get: (_target, prop: string | symbol) => {
    const b = backend
    const v = (b as unknown as Record<string | symbol, unknown>)[prop]
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(b) : v
  },
})

/** 浏览器环境是否支持打开真实目录（File System Access API） */
export function canOpenRealDir(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

/** 浏览器点「打开目录」时从 mock 切换到 web 实现 */
export function useRealDirFs(): boolean {
  if (backend.kind !== 'mock') return backend.kind === 'web' || backend.kind === 'tauri'
  if (canOpenRealDir()) {
    backend = webFs
    return true
  }
  return false
}
