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
    lastRootName = dir.split(/[\\/]/).filter(Boolean).pop() || '工作区'
    return true
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
