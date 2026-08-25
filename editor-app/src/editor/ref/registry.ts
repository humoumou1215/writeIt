// registry.ts —— 嵌入内容单一事实来源（P2/P3 架构核心）
//
// 设计目标：源文件内容只存一份（内存应然 content + 最近落盘 diskContent），所有视图
// （各宿主文档中的 file_block、以标签打开的源文档自身）都是它的投影：
//   · 编辑 = 提交到 registry（setTruth）→ 防抖广播（scheduleBroadcast）→ 除编辑源外的视图刷新
//   · 保存 = commit（content → 磁盘）
//   · 冲突 = 广播到达时视图已有未传播的自身编辑 → 显式标记（视图 lastContent ≠ 应然），绝不静默覆盖
//   · 物化 = 读 truth（未初始化才落盘惰性读）→ 视图与 truth 一致
//
// 纯状态模块（P0）：不 import app 模块。广播的执行由装配层注入 onBroadcast 回调
// （manager 提供：遍历 instances、按 (tabId, blockId) 定位块并填充）。realPath 为
// 已解析的真实路径（含扩展名）——调用方（resolve/writeback/manager）负责归一。
import type { Editor } from '@milkdown/kit/core'
import type { RefConfig } from './config'

export type ViewKind = 'block' | 'doc'

/** 一个视图：渲染某 realPath 内容的消费者（宿主内的嵌入块 / 打开的源文档标签） */
export interface ViewRef {
  /** 视图唯一键：block=`${tabId}#${blockId}`；doc=`doc:${tabId}` */
  key: string
  tabId: string
  kind: ViewKind
  blockId: string | null
  readonly: boolean
  /** 该视图最近一次成功渲染/同步的内容（脏与冲突检测基线） */
  lastContent: string | null
}

export interface SourceEntry {
  realPath: string
  /** 内存应然内容（唯一真相；null = 尚未初始化，物化时从磁盘惰性读） */
  content: string | null
  /** 最近一次 commit 的磁盘内容（null = 未落盘） */
  diskContent: string | null
  /** 内容版本号（每次 setTruth/commit 递增；调试/冲突诊断用） */
  version: number
  views: Map<string, ViewRef>
}

const registry = new Map<string, SourceEntry>()

/** 广播执行器（装配层注入；见 manager.setRegistryBroadcastHandler） */
type BroadcastHandler = (realPath: string, originKey: string | null, entry: SourceEntry) => void
let broadcastHandler: BroadcastHandler | null = null

/** 广播防抖定时器（realPath → timer） */
const pendingBroadcasts = new Map<string, ReturnType<typeof setTimeout>>()
const BROADCAST_DELAY = 400

export function setRegistryBroadcastHandler(fn: BroadcastHandler | null): void {
  broadcastHandler = fn
}

// ---------- 条目 ----------

export function ensureEntry(realPath: string): SourceEntry {
  let e = registry.get(realPath)
  if (!e) {
    e = { realPath, content: null, diskContent: null, version: 0, views: new Map() }
    registry.set(realPath, e)
  }
  return e
}

export function getEntry(realPath: string): SourceEntry | undefined {
  return registry.get(realPath)
}

export function getTruth(realPath: string): string | null {
  return registry.get(realPath)?.content ?? null
}

/** 提交编辑（唯一写入入口）：content = 应然内容，version++；返回新版本号 */
export function setTruth(realPath: string, content: string): number {
  const e = ensureEntry(realPath)
  e.content = content
  e.version++
  return e.version
}

/** 提交落盘：commit 后 diskContent 追平 content（磁盘 = 应然） */
export function commit(realPath: string, diskContent: string): number {
  const e = ensureEntry(realPath)
  e.content = diskContent
  e.diskContent = diskContent
  e.version++
  return e.version
}

// ---------- 视图注册 ----------

export function registerView(
  realPath: string,
  view: { tabId: string; kind: ViewKind; blockId?: string | null; readonly?: boolean },
  lastContent: string | null
): string {
  const e = ensureEntry(realPath)
  const key = view.kind === 'block' ? `${view.tabId}#${view.blockId}` : `doc:${view.tabId}`
  e.views.set(key, {
    key,
    tabId: view.tabId,
    kind: view.kind,
    blockId: view.blockId ?? null,
    readonly: Boolean(view.readonly),
    lastContent,
  })
  return key
}

export function unregisterView(realPath: string, key: string): void {
  const e = registry.get(realPath)
  if (!e) return
  e.views.delete(key)
  if (e.views.size === 0) registry.delete(realPath)
}

/** 标签关闭/销毁时清理其全部视图（块视图 + 文档视图） */
export function unregisterTab(tabId: string): void {
  for (const [realPath, e] of registry) {
    let touched = false
    for (const [key, v] of e.views) {
      if (v.tabId === tabId) {
        e.views.delete(key)
        touched = true
      }
    }
    if (touched && e.views.size === 0) registry.delete(realPath)
  }
}

/** 视图渲染完成后的内容回写（同步脏检测基线；仅在真实应用/由应用自行回写时调用） */
export function updateViewContent(realPath: string, key: string, content: string): void {
  const e = registry.get(realPath)
  const v = e?.views.get(key)
  if (v) v.lastContent = content
}

export function getView(realPath: string, key: string): ViewRef | undefined {
  return registry.get(realPath)?.views.get(key)
}

// ---------- 广播 ----------

/** 防抖调度广播：originKey = 编辑源视图键（跳过；null = 全量）。\n
 *  onBroadcast 回调内由装配层实际执行视图刷新（定位块 / replaceAll 等）。 */
export function scheduleBroadcast(realPath: string, originKey: string | null): void {
  const prev = pendingBroadcasts.get(realPath)
  if (prev) clearTimeout(prev)
  pendingBroadcasts.set(
    realPath,
    setTimeout(() => {
      pendingBroadcasts.delete(realPath)
      const e = registry.get(realPath)
      if (!e || !broadcastHandler) return
      try {
        broadcastHandler(realPath, originKey, e)
      } catch (err) {
        console.warn('[registry] 广播执行失败:', realPath, err)
      }
    }, BROADCAST_DELAY)
  )
}

/** 立即广播（保存后等场景）；返回本次触发的版本 */
export function flushBroadcast(realPath: string, originKey: string | null): void {
  const prev = pendingBroadcasts.get(realPath)
  if (prev) {
    clearTimeout(prev)
    pendingBroadcasts.delete(realPath)
  }
  const e = registry.get(realPath)
  if (!e || !broadcastHandler) return
  try {
    broadcastHandler(realPath, originKey, e)
  } catch (err) {
    console.warn('[registry] 广播执行失败:', realPath, err)
  }
}

// ---------- 冲突 / 脏 ----------

/** 视图是否有未传播的自身编辑（其渲染内容 ≠ 应然真相） */
export function viewIsStale(realPath: string, view: ViewRef): boolean {
  const truth = registry.get(realPath)?.content
  if (truth == null) return false
  return view.lastContent != null && view.lastContent !== truth
}

/** 诊断：全 registry 快照（块数量/版本/各视图状态） */
export function registryDiag(): unknown {
  const out: Record<string, unknown> = {}
  for (const [p, e] of registry) {
    out[p] = {
      version: e.version,
      truthLen: e.content?.length ?? -1,
      diskLen: e.diskContent?.length ?? -1,
      views: [...e.views.values()].map((v) => ({
        tab: v.tabId,
        kind: v.kind,
        block: v.blockId,
        lastLen: v.lastContent?.length ?? -1,
        stale: v.lastContent != null && e.content != null && v.lastContent !== e.content,
      })),
    }
  }
  return out
}

/** 供 resolve/materialize 使用的类型引用（避免循环 import 时 Editor 未用告警） */
export type { Editor, RefConfig }
