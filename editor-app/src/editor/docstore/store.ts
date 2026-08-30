// ============================================================
// docstore/store.ts —— 运行态文档层：全局 DocStore 单例（spec §4 / §5.2）
// 纯状态模块（P0）：不 import app 模块。三件事由装配层注入：
//   · IO（读盘/写盘）→ setDocStoreIo
//   · 解析管线（parser/serializer）→ setDocStorePipeline
//   · 分发执行器 → setDocStoreDispatcher（M1 影子模式不分发，M2/M3 注入视图适配器）
//
// M1（影子模式）语义：
//   · store 只记录、不分发——registry 仍在执掌真相（用户行为零变化）
//   · record() 沿 registry 真相变更点被调用（manager 桥），维护模型 rev 单调
//   · 一致性断言：canonical(record 内容) 与模型 doc hash 对齐（inspect 暴露）
//   · apply()/snapshot()/subscribe() 已按 spec 接口实现，供单测与 M2/M3 使用
// ============================================================
import type { Step } from '@milkdown/kit/prose/transform'
import { EditorState } from '@milkdown/kit/prose/state'
import { contentHash } from '../../git/hash'
import type { DocModel, Subscription, SubscriptionKind } from './model'
import { docHash, extractBlocks, makeSubscriptionKey, modelIsDirty } from './model'
import { canonicalOf, type DocPipeline } from './serialize'

export interface DocStoreIo {
  readFile(path: string): Promise<string | null>
  writeFile(path: string, content: string): Promise<void>
}

export interface ApplyMeta {
  originKey: string | null
  reason: 'user' | 'external' | 'discard' | 'reconcile'
}

/** 分发执行器（M3 起装配层注入：把本次 steps 映射到各视图）。
 *  M2 前为空（doc 视图走快照对齐）；M3 块视图订阅者用它做 steps 增量直通。
 *  originKey：编辑源订阅 key（分发时跳过，防回环/双写）。 */
export type Dispatcher = (
  realPath: string,
  model: DocModel,
  steps: Step[],
  fromRev: number,
  toRev: number,
  originKey: string | null
) => void

let io: DocStoreIo | null = null
let pipeline: DocPipeline | null = null
let dispatcher: Dispatcher | null = null

export function setDocStoreIo(v: DocStoreIo | null): void {
  io = v
}
export function setDocStorePipeline(v: DocPipeline | null): void {
  pipeline = v
}
export function setDocStoreDispatcher(v: Dispatcher | null): void {
  dispatcher = v
}

export interface StoreSnapshot {
  mode: 'shadow'
  models: Array<{
    realPath: string
    rev: number
    diskRev: number
    dirty: boolean
    loaded: boolean
    parseDegraded: boolean
    consistent: boolean
    diskAligned: boolean
    blocks: Array<{ blockId: string; kind: string; fingerprint: string; size: number; preview: string }>
    subscribers: Array<{ key: string; kind: string; tabId: string | null; blockId: string | null; rev: number; stale: boolean }>
  }>
}

class DocStore {
  private models = new Map<string, DocModel>()

  // ---------- 模型生命周期 ----------

  /** 惰性加载：磁盘 → 解析 → 模型（已加载直接返回；影子 ensure 的空模型补解析） */
  async load(realPath: string): Promise<DocModel> {
    const existing = this.models.get(realPath)
    if (existing) {
      // 已有模型但未解析（影子 ensure 创建/无 record）→ 补解析（IO 就绪时）
      if (!existing.doc && io && pipeline) {
        try {
          const disk = await io.readFile(realPath)
          if (disk != null) {
            // 统一解析 canonical：模型 doc 的序列化原像 = 磁盘 canonical（I3 断言前提）
            const canonical = canonicalOf(pipeline, disk)
            existing.doc = pipeline.parse(canonical)
            existing.blocks = extractBlocks(existing.doc)
            existing.diskHash = contentHash(canonical)
            existing.lastHash = docHash(existing.doc)
          }
        } catch {
          /* 保持空模型降级 */
        }
      }
      return existing
    }
    const m = this.createModel(realPath)
    this.models.set(realPath, m)
    if (io && pipeline) {
      try {
        const disk = await io.readFile(realPath)
        if (disk != null) {
          const canonical = canonicalOf(pipeline, disk)
          m.doc = pipeline.parse(canonical)
          m.blocks = extractBlocks(m.doc)
          m.diskHash = contentHash(canonical)
          m.lastHash = docHash(m.doc) ?? contentHash('')
        }
      } catch {
        /* 读失败：保持空模型（degraded），不阻塞调用方 */
      }
    }
    return m
  }

  private createModel(realPath: string): DocModel {
    return {
      realPath,
      doc: null,
      blocks: [],
      rev: 1,
      diskRev: 1,
      diskHash: null,
      lastHash: contentHash(''),
      userDirty: false,
      subscribers: new Map(),
    }
  }

  private ensure(realPath: string): DocModel {
    let m = this.models.get(realPath)
    if (!m) {
      m = this.createModel(realPath)
      this.models.set(realPath, m)
    }
    return m
  }

  // ---------- 内容指纹（统一 canonical 语义；I3 判定的同维度基础） ----------

  /** 磁盘内容的指纹：canonical md 的 hash（load/flush/reconcile/markDiskSynced 共用）。
   *  不能用原始磁盘文本 hash——模型侧比较的是序列化后的 canonical，维度必须一致。 */
  private canonicalHashOf(md: string): string {
    return pipeline ? contentHash(canonicalOf(pipeline, md)) : contentHash(md)
  }

  /** 模型当前 doc 的指纹：canonicalOf(serialize(doc)) 的 hash（幂等不动点，与磁盘侧恒可比） */
  private modelHash(m: DocModel): string {
    if (!pipeline || !m.doc) return contentHash('')
    return contentHash(canonicalOf(pipeline, pipeline.serialize(m.doc)))
  }

  /** I3：rev==diskRev 时，模型 canonical 必须等于磁盘 canonical（或磁盘基线未知）；脏态允许超前 */
  private modelIsConsistent(m: DocModel): boolean {
    if (m.rev !== m.diskRev) return true // 脏：磁盘是旧值、模型是新值，无冲突（flush 落盘后回转）
    if (m.diskHash == null) return true
    return this.modelHash(m) === m.diskHash
  }

  /** 模型是否已加载（含降级空模型） */
  has(realPath: string): boolean {
    return this.models.has(realPath)
  }

  /** 只读取模型引用（M2 视图适配器 / 测试用） */
  getModel(realPath: string): DocModel | undefined {
    return this.models.get(realPath)
  }

  // ---------- 真相写入（唯一入口族，I1） ----------

  /**
   * [影子] 记录 registry 真相变更（字符串级，M1 专用）。
   * 解析 → 覆盖模型 doc → rev++；不分发（影子）。
   * 之后会立即调 updateShadowSubscribers 对齐影子订阅元数据。
   */
  record(realPath: string, content: string): number {
    const m = this.ensure(realPath)
    if (pipeline) {
      const parsed = pipeline.parse(content)
      m.doc = parsed
      m.blocks = extractBlocks(parsed)
    }
    m.lastHash = docHash(m.doc)
    m.rev++
    return m.rev
  }

  /**
   * [M4] canonical 整块替换 + 分发（跨 schema 块编辑兜底）。
   * 块内编辑的序列化内容（宿主 schema）经模型侧 pipeline 解析为模型 doc（schema 自然一致）→
   * 整体覆盖模型 doc → rev++ → 照常分发（dispatcher 内部按各订阅者 schema 决定 steps/align）。
   * 等价 record 的覆盖语义 + apply 的分发语义（spec I1：编辑必须经模型，不旁路）。
   */
  replaceFromCanonical(realPath: string, canonical: string, originKey: string | null): number {
    const m = this.ensure(realPath)
    if (!pipeline) throw new Error(`[docstore] replaceFromCanonical without pipeline: ${realPath}`)
    const parsed = pipeline.parse(canonical)
    if (!parsed) throw new Error(`[docstore] replaceFromCanonical parse failed: ${realPath}`)
    // 内容幂等：同内容替换（外部刷新/同源 publish 双发）不推进 rev——
    // 否则同内容 rev++ 会制造假脏（rev > diskRev）且触发无意义分发
    if (m.doc && docHash(m.doc) === docHash(parsed)) return m.rev
    const fromRev = m.rev
    m.doc = parsed
    m.blocks = extractBlocks(parsed)
    m.lastHash = docHash(parsed)
    m.rev++
    if (dispatcher) dispatcher(realPath, m, [], fromRev, m.rev, originKey)
    return m.rev
  }

  apply(realPath: string, steps: Step[], meta: ApplyMeta): number {
    const m = this.ensure(realPath)
    if (!m.doc) throw new Error(`[docstore] apply on unparsed model: ${realPath}`)
    const st = EditorState.create({ doc: m.doc })
    const tr = st.tr
    for (const s of steps) tr.step(s)
    const prevHash = docHash(m.doc)
    const newHash = docHash(tr.doc)
    // 幂等：steps 应用后内容未变（结构边界/同内容重放）→ 不推进 rev（防假脏）
    if (prevHash === newHash) return m.rev
    const fromRev = m.rev
    m.doc = tr.doc
    m.blocks = extractBlocks(tr.doc)
    m.lastHash = newHash
    // userDirty 由 markUserDirty（DOM input 事件，见 manager onInput）置位——
    // apply 不置位：程序化事务（mount 初始化等）不可被误判为用户编辑
    void meta
    m.rev++
    if (dispatcher) dispatcher(realPath, m, steps, fromRev, m.rev, meta.originKey)
    return m.rev
  }

  // ---------- 订阅 ----------

  /** 订阅（M2/M3 起为视图适配器；M1 影子仅登记元数据） */
  subscribe(realPath: string, source: SubscriptionKind): { key: string; unsubscribe: () => void } {
    const m = this.ensure(realPath)
    const key = makeSubscriptionKey(source)
    m.subscribers.set(key, { key, source, rev: m.rev, stale: false })
    return {
      key,
      unsubscribe: () => {
        m.subscribers.delete(key)
        this.gc(realPath)
      },
    }
  }

  /** 影子订阅登记（M1：视图注册时同步登记；rev 追平模型，见 store 顶部 M1 语义注） */
  subscribeShadow(realPath: string, source: SubscriptionKind): string {
    const m = this.ensure(realPath)
    const key = makeSubscriptionKey(source)
    m.subscribers.set(key, { key, source, rev: m.rev, stale: false })
    return key
  }

  /** 订阅同步确认：视图已追平 toRev（分发/对齐成功后调用，I2 前进侧）。
   *  同时清除失步标记（I2 恢复侧）。 */
  markSubSynced(realPath: string, key: string, toRev: number): void {
    const m = this.models.get(realPath)
    const s = m?.subscribers.get(key)
    if (!s) return
    s.stale = false
    if (toRev > s.rev) s.rev = toRev
  }

  /** 失步：视图无法跟上分发（I2：显式 stale，绝不静默停在旧 rev）。
   *  由分发失败 + 对齐兜底也失败的路径调用（spec §6.1）。 */
  markSubStale(realPath: string, key: string): void {
    const m = this.models.get(realPath)
    const s = m?.subscribers.get(key)
    if (s) s.stale = true
  }

  /** 查询某标签（作为宿主）内失步的块订阅——失步徽标渲染的数据源（spec §6.1）。 */
  getStaleBlockSubs(tabId: string): Array<{ realPath: string; blockId: string; key: string }> {
    const out: Array<{ realPath: string; blockId: string; key: string }> = []
    for (const [realPath, m] of this.models) {
      for (const [key, s] of m.subscribers) {
        if (s.stale && s.source.kind === 'block' && s.source.tabId === tabId) {
          out.push({ realPath, blockId: s.source.blockId, key })
        }
      }
    }
    return out
  }

  /** 标签关闭清理（对齐 registry.unregisterTab） */
  unregisterTab(tabId: string): void {
    for (const [realPath, m] of this.models) {
      let touched = false
      for (const [key, s] of m.subscribers) {
        const src = s.source
        if (src.kind === 'doc' && src.tabId === tabId) {
          m.subscribers.delete(key)
          touched = true
        } else if (src.kind === 'block' && src.tabId === tabId) {
          m.subscribers.delete(key)
          touched = true
        }
      }
      if (touched) this.gc(realPath)
    }
  }

  /** 无订阅且不脏 → 释放模型（内存回收，spec §5.7） */
  private gc(realPath: string): void {
    const m = this.models.get(realPath)
    if (m && m.subscribers.size === 0 && !modelIsDirty(m)) {
      this.models.delete(realPath)
    }
  }

  // ---------- 快照 / 落盘 / 对账 ----------

  /**
   * 快照：rev 定格的不可变数据（I4）。
   * M1 不保留历史版本：请求 rev ≠ 当前 rev 时返回 null（M3 后按需加历史）。
   */
  snapshot(realPath: string, rev?: number): {
    realPath: string
    rev: number
    canonical: string | null
    blocks: DocModel['blocks']
    dirty: boolean
    diskHash: string | null
  } | null {
    const m = this.models.get(realPath)
    if (!m) return null
    const targetRev = rev ?? m.rev
    if (targetRev !== m.rev) return null // 历史未保留
    return {
      realPath,
      rev: m.rev,
      canonical: pipeline && m.doc ? pipeline.serialize(m.doc) : null,
      blocks: m.blocks,
      dirty: m.userDirty,
      diskHash: m.diskHash,
    }
  }

  /** 磁盘已由外部写好（写回/保存事务直写 fs）→ 仅对齐 diskRev/diskHash，不重复写盘 */
  markDiskSynced(realPath: string, diskContent: string): void {
    const m = this.models.get(realPath)
    if (!m) return
    m.diskRev = m.rev
    m.diskHash = this.canonicalHashOf(diskContent)
    m.userDirty = false
  }

  /** 落盘：canonical → 写盘 → diskRev/diskHash 追平（I3）。返回写入的 canonical（失败 null）。 */
  async flush(realPath: string): Promise<string | null> {
    const m = this.models.get(realPath)
    if (!m || !io || !pipeline || !m.doc) return null
    const canonical = canonicalOf(pipeline, pipeline.serialize(m.doc))
    try {
      await io.writeFile(realPath, canonical)
    } catch {
      return null
    }
    m.diskRev = m.rev
    m.diskHash = contentHash(canonical)
    m.userDirty = false
    return canonical
  }

  /** 磁盘对账（spec §7.3；M1 只返回状态，冲突 UI 属于 M5） */
  async reconcile(realPath: string): Promise<'clean' | 'external-change' | 'conflict' | 'gone' | 'no-io'> {
    const m = this.models.get(realPath)
    if (!m) return 'clean'
    if (!io) return 'no-io'
    let disk: string | null
    try {
      disk = await io.readFile(realPath)
    } catch {
      disk = null
    }
    if (disk == null) return 'gone'
    // 磁盘指纹统一为 canonical 语义（load/flush/对账共用同一维度）
    const diskCanonical = pipeline ? canonicalOf(pipeline, disk) : disk
    const diskHash = contentHash(diskCanonical)
    if (diskHash === m.diskHash) return 'clean'
    if (!modelIsDirty(m)) {
      // 本地无未保存编辑 → 采用磁盘版（重解析模型；订阅者重投影）
      if (pipeline) {
        m.doc = pipeline.parse(diskCanonical)
        m.blocks = extractBlocks(m.doc)
      }
      m.lastHash = docHash(m.doc)
      m.diskHash = diskHash
      m.diskRev = m.rev
      m.userDirty = false
      m.rev++
      // M5 §7.3：notify subscribers（重投影——canonical 分发到各视图）
      if (dispatcher) dispatcher(realPath, m, [], m.rev - 1, m.rev, null)
      return 'external-change'
    }
    return 'conflict' // 真冲突：双方都有变化（M5 三方选择 UI）
  }

  /** 是否脏（模型级：rev > diskRev，含消歧/外部对齐等未落盘变更——flush 依据） */
  isDirty(realPath: string): boolean {
    const m = this.models.get(realPath)
    return m ? modelIsDirty(m) : false
  }

  /** 用户编辑标志（M4：UI 脏点——仅 DOM 用户输入置位；保存/落盘/外部对齐清除） */
  isUserDirty(realPath: string): boolean {
    const m = this.models.get(realPath)
    return m ? m.userDirty : false
  }

  /** 用户真实输入标记（manager onInput 在 DOM input 事件中调用——程序化 dispatch 不触发） */
  markUserDirty(realPath: string): void {
    const m = this.ensure(realPath)
    if (m.doc || m.rev > 0) m.userDirty = true
  }

  /** 对给定内容做一致性核对（影子断言）：模型 canonical 与磁盘基线是否对齐（I3） */
  assertConsistent(realPath: string): { ok: boolean; meta: string } | null {
    const m = this.models.get(realPath)
    if (!m) return null
    const ok = this.modelIsConsistent(m)
    const h = this.modelHash(m)
    return { ok, meta: `rev=${m.rev} diskRev=${m.diskRev} model=${h.slice(0, 8)} disk=${(m.diskHash ?? 'null').slice(0, 8)}` }
  }

  // ---------- 诊断 ----------

  /** 测试专用：清空全部模型（生产代码不调用） */
  resetForTest(): void {
    this.models.clear()
  }

  inspect(): StoreSnapshot {
    const models = []
    for (const m of this.models.values()) {
      models.push({
        realPath: m.realPath,
        rev: m.rev,
        diskRev: m.diskRev,
        dirty: m.userDirty,
        revDirty: modelIsDirty(m),
        loaded: m.doc != null,
        parseDegraded: m.doc == null && m.rev > 0,
        consistent: this.modelIsConsistent(m),
        diskAligned: m.diskHash != null && m.diskHash === this.modelHash(m),
        blocks: m.blocks,
        subscribers: [...m.subscribers.values()].map((s) => ({
          key: s.key,
          kind: s.source.kind,
          tabId: s.source.kind === 'doc' ? s.source.tabId : s.source.kind === 'block' ? s.source.tabId : null,
          blockId: s.source.kind === 'block' ? s.source.blockId : null,
          rev: s.rev,
          stale: s.stale,
        })),
      })
    }
    return { mode: 'shadow', models }
  }
}

export const docStore = new DocStore()