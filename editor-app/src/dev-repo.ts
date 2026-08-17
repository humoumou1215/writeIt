// 真实仓库模式开关（M15）：vite dev + ?repo=1 → 文件系统/git 走 Vite Node 中间件
//   中间件实现：vite-plugins/dev-repo.ts（真实读取内容库 + 真实 git CLI）
//   浏览器演示模式（无开关）仍走 mock：mockFs + mockGit

const KEY = 'writeit.repo'

/** 是否处于真实仓库调试模式（URL ?repo=1 开启并记住；?repo=0 关闭） */
export function isDevRepoMode(): boolean {
  if (!import.meta.env.DEV) return false
  if (typeof window === 'undefined') return false
  const q = new URLSearchParams(window.location.search)
  const v = q.get('repo')
  try {
    if (v === '1') localStorage.setItem(KEY, '1')
    else if (v !== null) localStorage.removeItem(KEY)
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/** 真实仓库的根目录显示名 */
export function devRepoRootName(): string {
  return '消金业务合作平台'
}