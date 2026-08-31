// Tauri 实现 —— 独立应用模式，走 Rust 命令
import type { FileSystem, FsEntry } from './types'

// 惰性引入，浏览器环境不加载 Tauri 相关代码
async function core() {
  return await import('@tauri-apps/api/core')
}

export const tauriFs: FileSystem = {
  kind: 'tauri',
  get rootName() {
    // 根目录名由 Rust 侧提供，这里缓存最近一次树根
    return lastRootName
  },

  async openDirectory() {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const dir = await open({ directory: true, title: '选择工作目录' })
    if (typeof dir !== 'string' || !dir) return false
    await (await core()).invoke('set_root', { path: dir })
    currentRootPath = dir
    lastRootName = dir.split(/[\\/]/).filter(Boolean).pop() || '工作区'
    return true
  },

  async setRootFromPath(path: string) {
    if (!path) return false
    try {
      await (await core()).invoke('set_root', { path })
      currentRootPath = path
      lastRootName = path.split(/[\\/]/).filter(Boolean).pop() || '工作区'
      return true
    } catch {
      return false
    }
  },

  async appDir() {
    try {
      const dir = await (await core()).invoke<string>('app_dir')
      return dir || null
    } catch {
      return null
    }
  },

  rootPath() {
    return currentRootPath
  },

  async readTree(showAll) {
    return (await (await core()).invoke<FsEntry[]>('read_tree', { showAll }))
  },

  async readFile(path) {
    return await (await core()).invoke<string>('read_file', { path })
  },

  async writeFile(path, content) {
    await (await core()).invoke('write_file', { path, content })
  },

  /** 图片等二进制落盘：前端 Uint8Array → base64 → Rust 解码写盘 */
  async writeBinary(path, data) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
    await (await core()).invoke('write_file_binary', { path, base64: bytesToBase64(bytes) })
  },

  async readBinary(path) {
    const b64 = await (await core()).invoke<string>('read_file_binary', { path })
    return base64ToBytes(b64)
  },

  async createFile(path) {
    await (await core()).invoke('create_file', { path })
  },

  async createDir(path) {
    await (await core()).invoke('create_dir', { path })
  },

  async rename(oldPath, newPath) {
    await (await core()).invoke('rename', { oldPath, newPath })
  },

  async remove(path) {
    await (await core()).invoke('remove', { path })
  },

  async revealInExplorer(path) {
    await (await core()).invoke('reveal_in_explorer', { path })
  },
}

let lastRootName = '工作区'
let currentRootPath: string | null = null

// ---------- base64 编解码（前端侧，浏览器环境内置） ----------

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
