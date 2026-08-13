// 批注用户名解析：
//   Tauri 下目录是 git 仓库 → 读 git user.name；否则用设置的用户名
//   web/mock → 设置的用户名（默认「我」）
import { settings } from '../state/settings'
import { fs } from '../fs'

let cached: string | null = null
let cacheTime = 0
const CACHE_MS = 60_000

export async function resolveUserName(): Promise<string> {
  const now = Date.now()
  if (cached && now - cacheTime < CACHE_MS) return cached
  cached = await resolveUserNameInner()
  cacheTime = now
  return cached
}

async function resolveUserNameInner(): Promise<string> {
  // Tauri：git 仓库检测 + user.name
  if (fs.kind === 'tauri') {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const name = (await invoke('git_user_name')) as string | null
      if (name) return name
    } catch {
      /* 无 git 或命令失败 → 设置值 */
    }
  }
  return settings.annotationUsername || '我'
}
