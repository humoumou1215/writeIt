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
  writeBinary(path, data) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
    return call<void>('write-binary', { path, base64: bytesToBase64(bytes) })
  },
  readBinary(path) {
    return call<string>('read-binary', { path }).then((b64) => base64ToBytes(b64))
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

  revealInExplorer() {
    return Promise.reject(new Error('该功能仅在桌面应用中可用'))
  },
}

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