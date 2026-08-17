// 数据后端选择（M15）：vite dev **默认真实仓库**（内容库 + 真实 git CLI，Vite Node 中间件直连），
//   仅在设置（或 URL ?backend=mock）中显式切换为 Mock 演示（内置 Git演示 假仓库）。
//   Tauri / 生产构建不受影响（isDevRepoMode 仅在 import.meta.env.DEV 下返回 true）。

export type BackendChoice = 'dev' | 'mock'

const KEY = 'writeit.backend'
const DEFAULT: BackendChoice = 'dev'

function remember(kind: BackendChoice) {
  try {
    localStorage.setItem(KEY, kind)
  } catch {
    /* 隐私模式等忽略 */
  }
}

/** 当前选择：URL ?backend=dev|mock 立即生效并记住；否则读 localStorage；都没有 → 默认 dev（真实仓库） */
export function backendChoice(): BackendChoice {
  if (typeof window === 'undefined') return DEFAULT
  const q = new URLSearchParams(window.location.search)
  const v = q.get('backend')
  if (v === 'dev' || v === 'mock') {
    remember(v)
    return v
  }
  try {
    const saved = localStorage.getItem(KEY) as BackendChoice | null
    if (saved === 'dev' || saved === 'mock') return saved
  } catch {
    /* ignore */
  }
  return DEFAULT
}

/** 设置数据源（设置页切换；对 dev server 立即重载生效） */
export function setBackendChoice(kind: BackendChoice) {
  remember(kind)
}

/** 是否走 dev（真实仓库）后端：仅 vite dev 且选择 dev */
export function isDevRepoMode(): boolean {
  if (!import.meta.env.DEV) return false
  return backendChoice() === 'dev'
}

/** 是否走 Mock 演示：仅 vite dev 且显式选择 mock（生产构建无中间件，永不 dev） */
export function isMockChoice(): boolean {
  if (!import.meta.env.DEV) return false
  return backendChoice() === 'mock'
}

/** 真实仓库的根目录显示名 */
export function devRepoRootName(): string {
  return '消金业务合作平台'
}