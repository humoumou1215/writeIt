// ============================================================
// docstore/bridge.ts —— 装配层 ↔ docstore 影子桥（spec §9.1 M1）
// manager 在 registry 真相变更点调用本桥，docstore 保持零反向依赖。
// 影子模式不改任何用户可见行为：只做「记录 + 元数据登记」，
// 供一致性断言与 CLI docstore.inspect 取证。
//
// 挂接点（manager.ts）：
//   · syncTabViewsToRegistry 块/文档视图注册后 → registerBlockShadow / registerDocShadow
//   · publishDocToSubscribers 的 setTruth 之后 → onTruthChanged
//   · saveTab 落盘之后 → onCommitted（内容已写盘）
//   · unmountEditor 的 registryUnregisterTab 之后 → onTabClosed
// ============================================================
import { docStore, setDocStoreIo, setDocStorePipeline } from './store'
import { canonicalOf, type DocPipeline } from './serialize'

/** 解析管线配置（幂等；运行时从任一编辑器 ctx 取 parser/serializer） */
export function configureDocStorePipeline(p: DocPipeline): void {
  setDocStorePipeline(p)
}

/** IO 注入（fs 抽象代理） */
export function configureDocStoreIo(fs: {
  readFile: (p: string) => Promise<string>
  writeFile: (p: string, c: string) => Promise<void>
}): void {
  setDocStoreIo({
    readFile: async (p) => {
      try {
        return await fs.readFile(p)
      } catch {
        return null
      }
    },
    writeFile: (p, c) => fs.writeFile(p, c),
  })
}

/** [影子] registry 真相变更（setTruth 之后；内容未落盘） */
export function onTruthChanged(realPath: string, content: string): void {
  docStore.record(realPath, content)
}

/** [影子] 内容已写盘（writeback 写回 / saveTab 落盘之后）→ record + 对齐磁盘基线 */
export function onCommitted(realPath: string, diskContent: string): void {
  docStore.record(realPath, diskContent)
  docStore.markDiskSynced(realPath, diskContent)
}

/** [影子] 块视图注册登记 */
export function registerBlockShadow(realPath: string, view: { tabId: string; blockId: string }): void {
  docStore.subscribeShadow(realPath, { kind: 'block', tabId: view.tabId, blockId: view.blockId })
}

/** [影子] 文档视图注册登记（标签自身 = realPath 的投影） */
export function registerDocShadow(realPath: string, tabId: string): void {
  docStore.subscribeShadow(realPath, { kind: 'doc', tabId })
}

/** [影子] 标签关闭清理 */
export function onTabClosed(tabId: string): void {
  docStore.unregisterTab(tabId)
}

/** [影子] 一致性断言（诊断/CLI + 影子期回归网） */
export function shadowConsistencyCheck(realPath: string): { ok: boolean; meta: string } | null {
  return docStore.assertConsistent(realPath)
}

/** [影子] 全量快照（CLI docstore.inspect） */
export function inspectDocStore(): ReturnType<typeof docStore.inspect> {
  return docStore.inspect()
}

/** (内部/测试) 影子一致性：canonical(record 内容) 与模型 hash 对齐（串起 canonical 与模型） */
export function shadowRoundTripStable(p: DocPipeline, md: string): boolean {
  return canonicalOf(p, md) === md
}

// ---------- window 调试钩子（与 __editorDebug 同模式） ----------
// 诊断/CLI/现场勘查共用；模块加载即注册（与 diagnostics 的桥同副作用风格）
if (typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>
  w.__docstoreInspect = () => inspectDocStore()
  w.__docstoreConsistency = (paths?: string[]) => {
    const list = paths && paths.length ? paths : inspectDocStore().models.map((m) => m.realPath)
    return list.map((p) => ({ path: p, ...(shadowConsistencyCheck(p) ?? { ok: null }) }))
  }
  // M4：registry 已下线——__registryDiag 保留为兼容钩子（e2e/工具仍在用），
  // 输出结构从 docstore.inspect 派生（realPath → { version, truthLen, views }，deprecated）
  w.__registryDiag = () => registryDiagCompat()
}

/** 兼容旧 registryDiag 结构的派生输出（registry.ts 已删除；供 e2e/CLI 过渡） */
export function registryDiagCompat(): Record<string, unknown> {
  const snap = inspectDocStore()
  const out: Record<string, unknown> = {}
  for (const m of snap.models) {
    const s = docStore.snapshot(m.realPath)
    out[m.realPath] = {
      version: m.rev,
      truthLen: s && s.canonical != null ? s.canonical.length : -1,
      diskLen: -1,
      views: m.subscribers.map((sub) => ({
        tab: sub.kind === 'doc' || sub.kind === 'block' ? sub.tabId : null,
        kind: sub.kind,
        block: sub.kind === 'block' ? sub.blockId : null,
        lastLen: -1,
        stale: sub.stale,
      })),
    }
  }
  return out
}