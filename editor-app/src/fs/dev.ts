// dev 文件系统后端（M15）：真实仓库模式 —— 全部操作转发给 Vite Node 中间件
//   /__repo/fs/*（node:fs 直连内容库），语义与 tauriFs 一致
import type { FileSystem, FsEntry } from './types'
import { devRepoRootName } from '../dev-repo'

async function call<T>(action: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`/__repo/fs/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = (await res.json()) as { ok: boolean; data?: T; error?: string }
  if (!json.ok) throw new Error(json.error || `dev fs ${action} 失败`)
  return json.data as T
}

export const devFs: FileSystem = {
  kind: 'dev',
  get rootName() {
    return devRepoRootName()
  },

  async openDirectory() {
    return true // 真实仓库模式根目录固定（中间件侧 REPO_ROOT）
  },

  readTree(showAll) {
    return call<FsEntry[]>('tree', { showAll })
  },
  readFile(path) {
    return call<string>('read', { path })
  },
  writeFile(path, content) {
    return call<void>('write', { path, content })
  },
  createFile(path) {
    return call<void>('create', { path })
  },
  createDir(path) {
    return call<void>('create-dir', { path })
  },
  rename(oldPath, newPath) {
    return call<void>('rename', { oldPath, newPath })
  },
  remove(path) {
    return call<void>('remove', { path })
  },
}