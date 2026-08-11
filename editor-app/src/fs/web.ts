// File System Access API 实现（Chromium）——浏览器里也能打开真实目录
import type { FileSystem, FsEntry } from './types'
import { isEditableFile, joinPath } from './types'

let rootHandle: FileSystemDirectoryHandle | null = null
let rootName = ''

async function ensurePermission(): Promise<boolean> {
  if (!rootHandle) return false
  const opts = { mode: 'readwrite' as const }
  if ((await rootHandle.queryPermission(opts)) === 'granted') return true
  if ((await rootHandle.requestPermission(opts)) === 'granted') return true
  return false
}

async function walk(
  handle: FileSystemDirectoryHandle,
  root: FileSystemDirectoryHandle,
  showAll: boolean,
  parentPath = ''
): Promise<FsEntry[]> {
  const entries: FsEntry[] = []
  for await (const [name, h] of handle.entries()) {
    const path = joinPath(parentPath, name)
    if (h.kind === 'directory') {
      const dir = h as FileSystemDirectoryHandle
      entries.push({
        name,
        path,
        kind: 'dir',
        children: await walk(dir, root, showAll, path),
      })
    } else if (showAll || isEditableFile(name)) {
      entries.push({ name, path, kind: 'file' })
    }
  }
  entries.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1
  )
  return entries
}

async function pathToHandle(root: FileSystemDirectoryHandle, path: string): Promise<FileSystemHandle> {
  const parts = path.split('/').filter(Boolean)
  let cur: FileSystemHandle = root
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    const isLast = i === parts.length - 1
    if (cur.kind !== 'directory') throw new Error(`路径无效: ${path}`)
    const dir = cur as FileSystemDirectoryHandle
    cur = isLast ? await dir.getFileHandle(part) : await dir.getDirectoryHandle(part)
  }
  return cur
}

export const webFs: FileSystem = {
  kind: 'web',
  get rootName() {
    return rootName
  },

  async openDirectory() {
    if (!('showDirectoryPicker' in window)) return false
    try {
      rootHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
      rootName = rootHandle.name
      return true
    } catch {
      return false
    }
  },

  async readTree(showAll) {
    if (!rootHandle || !(await ensurePermission())) throw new Error('未授权访问目录')
    return walk(rootHandle, rootHandle, showAll)
  },

  async readFile(path) {
    if (!rootHandle || !(await ensurePermission())) throw new Error('未授权访问目录')
    const handle = await pathToHandle(rootHandle, path)
    if (handle.kind !== 'file') throw new Error(`不是文件: ${path}`)
    return (handle as FileSystemFileHandle).getFile().then((f) => f.text())
  },

  async writeFile(path, content) {
    if (!rootHandle || !(await ensurePermission())) throw new Error('未授权访问目录')
    const handle = await pathToHandle(rootHandle, path)
    if (handle.kind !== 'file') throw new Error(`不是文件: ${path}`)
    const w = await (handle as FileSystemFileHandle).createWritable()
    await w.write(content)
    await w.close()
  },

  async createFile(path) {
    if (!rootHandle || !(await ensurePermission())) throw new Error('未授权访问目录')
    const parts = path.split('/').filter(Boolean)
    let cur = rootHandle
    for (let i = 0; i < parts.length - 1; i++) cur = await cur.getDirectoryHandle(parts[i], { create: true })
    await cur.getFileHandle(parts[parts.length - 1], { create: true })
  },

  async createDir(path) {
    if (!rootHandle || !(await ensurePermission())) throw new Error('未授权访问目录')
    const parts = path.split('/').filter(Boolean)
    let cur = rootHandle
    for (const p of parts) cur = await cur.getDirectoryHandle(p, { create: true })
  },

  async rename(oldPath, newPath) {
    // File System Access API 不支持直接重命名，需要复制+删除
    if (oldPath === newPath) return
    const data = await this.readFile(oldPath)
    await this.createFile(newPath)
    await this.writeFile(newPath, data)
    await this.remove(oldPath)
  },

  async remove(path) {
    if (!rootHandle || !(await ensurePermission())) throw new Error('未授权访问目录')
    const parts = path.split('/').filter(Boolean)
    const name = parts.pop()!
    let cur = rootHandle
    for (const p of parts) cur = await cur.getDirectoryHandle(p)
    await cur.removeEntry(name, { recursive: true })
  },
}
