/// <reference types="vite/client" />

// 诊断包：vite.config.ts define 注入（编译期内联）
declare const __APP_VERSION__: string
declare const __BUILD_TIME__: string

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

// Tauri v2 注入到 window 的标记
interface Window {
  __TAURI_INTERNALS__?: unknown
}

// TS 5.9 lib.dom 未收录的 File System Access API 成员（接口合并）
interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>
  queryPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
}
interface Window {
  showDirectoryPicker(options?: {
    mode?: 'read' | 'readwrite'
    startIn?: string | FileSystemHandle
    id?: string
  }): Promise<FileSystemDirectoryHandle>
}

declare module '@milkdown/crepe/theme/*.css?raw' {
  const css: string
  export default css
}

declare module '*.md?raw' {
  const md: string
  export default md
}
