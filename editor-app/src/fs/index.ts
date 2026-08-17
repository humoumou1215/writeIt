// 文件系统抽象 —— 同一套接口，三种宿主实现：
//   mock    → 浏览器内置演示（Vite 调试 / Demo，数据来自内容库 sync）
//   web     → File System Access API（浏览器点「打开目录」）
//   tauri   → Rust 命令（打包后的独立应用）
//   dev     → Vite Node 中间件（?repo=1 真实仓库模式：真实读取内容库）
import type { FileSystem } from './types'
import { mockFs } from './mock'
import { webFs } from './web'
import { tauriFs } from './tauri'
import { devFs } from './dev'
import { disableGitForRealDir } from '../git'
import { isDevRepoMode } from '../dev-repo'

export type { FileSystem, FsEntry, FsBackendKind } from './types'
export { isEditableFile, joinPath, dirName, baseName } from './types'

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

// 可切换的文件系统代理：
//   Tauri 环境 → tauri 实现
//   浏览器     → 默认 mock（Demo 开箱即用）；openDirectory 时切到 web；?repo=1 时切到 dev（真实仓库）
let backend: FileSystem = isTauri() ? tauriFs : isDevRepoMode() ? devFs : mockFs

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

/** 浏览器点「打开目录」时从 mock 切换到 web 实现（git 随之禁用） */
export function useRealDirFs(): boolean {
  if (backend.kind !== 'mock') {
    if (backend.kind === 'web') disableGitForRealDir()
    return backend.kind === 'web' || backend.kind === 'tauri'
  }
  if (canOpenRealDir()) {
    backend = webFs
    disableGitForRealDir()
    return true
  }
  return false
}
