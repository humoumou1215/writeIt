# Spec：运行态文档层（Runtime Document Layer）

> 状态：**草案 v1（待评审）**
> 作者：huyongsheng + Pi
> 关联文档：无前置 spec；实现参考 `src/editor/ref/registry.ts`（P2/P3）、`src/editor/ref/writeback.ts`、`src/editor/render-diff.ts`、`src/editor/diff/prefetch.ts`、`src/editor/manager.ts`
> 术语约定：本文档中「文档层」= 本 spec 定义的运行态文档层；「registry」= 现有 P2/P3 的字符串级事实源实现。

---

## 0. 一句话

**应用内所有需要"某文件当前内容"的消费者，都从一个全局文档层取数：内容在内存中每个文件只有一份（模型），编辑必须先提交模型，所有视图（嵌入块、源文件标签、diff 渲染、CLI 查询）都是模型的投影。磁盘 .md 文件仍是唯一的持久真源。**

---

## 1. 背景与问题

### 1.1 现状

编辑器（Tauri2 + Vue3 + Milkdown/Crepe）的实时同步现状（P2/P3 架构）：

- `registry.ts` 以 **realPath → 整文件字符串** 为粒度持有内存真相（truth）；
- 视图（宿主文档中的 `file_block` 嵌入块、以标签打开的源文档）注册进 registry，各自持有内容副本；
- 编辑 → `markdownUpdated` 防抖 200ms → `setTruth` → 广播防抖 400ms → 其他视图用 `fillBlockContent` / `replaceAll`（整块/整文档替换）刷新；
- 同步语义靠五套基线支撑：`blockSnapshot`、`lastSyncBlocks`、`view.lastContent`、`tab.userEditedAt`、`tab.lastExternalSyncAt`，加上 `suppressing` 标志与 setTimeout 时序守卫；
- 保存触发写回事务（`writeBackBlocks`）：逐块序列化、同源多块一致性判定、源标签编辑判定，任一不满足则跳过 + toast。

### 1.2 问题（按用户报告归纳）

| # | 问题 | 根因 |
|---|---|---|
| P-1 | A.md 嵌入 B.md 两次 + 打开 B.md 标签，编辑任一处，其余两处不实时同步；时间差内两边都可能被改 | 最坏 ~600ms 的双防抖链路 + 视图间内容副本窗口期 |
| P-2 | 同步语义复杂、bug 反复（保存后块内容消失/被替换等，见代码内注释标注的历次根因） | 五套基线 + suppressing 时序 + replaceAll 整体替换，同步正确性依赖多处时序约定 |
| P-3 | diff 渲染视图是第二条数据通路：prefetch 直接读 git/磁盘、绕开 registry，进入前必须强制保存 | 没有"内存当前内容"的统一出处，diff 只能依赖磁盘 |
| P-4 | Agent 调试通道（已落地）需要"当前所有文档的真实内容"，目前要钻进各编辑器实例抠取 | 同上——运行态内容没有单一查询点 |

### 1.3 已确认的环境事实

- Agent 调试通道**已实现**（writeit 工具，TCP/中继命令集：tabs / doc.markdown / refs.registry / dom.snapshot / action.run 等）。本 spec 将其列为文档层的消费场景之一，并把文档层快照暴露为新的查询命令。
- e2e 测试资产（50+ 套件，ego-browser 驱动）是本重构的安全网，全程必须保绿。embed-sync 系列（p1/p2/composite/realinput/caret-regress）为同步链路的直接回归网。

---

## 2. 目标与非目标

### 2.1 目标

- **G1 单一真相**：每个 realPath 在内存中只有一份模型（DocModel）；A 中的两个嵌入块与 B 的标签，读的都是同一模型。
- **G2 即时同步**：任一视图的编辑**在同一 tick 内**提交模型并反映到所有其他视图；视图间同步不再有防抖（防抖只保留给落盘）。
- **G3 增量更新**：视图应用同步不再整块/整文档替换，而以 ProseMirror steps（增量事务）方式应用，保持光标、选区、撤销历史、滚动位置。
- **G4 语义收敛**：五套基线与 suppressing 时序守卫大部分删除；脏检测退化为「视图 rev vs 模型 rev」「模型 rev vs 磁盘 rev」两级比较。
- **G5 全局取数**：diff 渲染、Agent CLI、（后续）搜索/校验/导出，统一从文档层取数，消除第二条数据通路。
- **G6 平滑迁移**：分阶段落地，每阶段结束全量 e2e 保绿、用户可见行为不回退。

### 2.2 非目标（本期不做）

- **N1 不改 Markdown 文件格式**：不向 md 写入块 ID、锚点等元数据；磁盘文件与今天完全兼容。
- **N2 不做多用户协作**：单进程单用户；网络同步、OT/CRDT 不在范围。
- **N3 不做跨视图共享撤销历史**：每个编辑器实例保留独立 undo（现状行为），只保证外部同步的步进不污染本地 undo（见 §5.5）。
- **N4 不改 Git 层 / FS 层接口**：`GitBackend` / `FileSystem` 抽象保持不变；diff 的 git 数据获取仍走 git 层。
- **N5 不做虚拟滚动 / 大文档性能专项**：文档层不得引入新的性能回退（验收含性能门槛），但大文档优化另立 spec。

---

## 3. 术语表

| 术语 | 定义 |
|---|---|
| **realPath** | 规范化后的真实文件路径（含扩展名，Obsidian 风格补全规则沿用 `resolveRealPath`） |
| **DocStore** | 全局单例：realPath → DocModel 的注册表，事务与订阅的调度中枢 |
| **DocModel** | 一个文件的运行态模型：块序列 + rev 版本 + 磁盘基线 + 订阅者集合 |
| **BlockModel** | DocModel 内的一个块（逻辑单位，与 PM doc 的顶层子节点对齐），持有模型内稳定的 `blockId` |
| **编辑事务** | 对 DocModel 的一次原子变更，携带 PM steps + 元信息（来源视图、原因） |
| **投影** | 由 DocModel 派生并随其更新的展示：PM doc 中的嵌入块内容、源文件标签的编辑器、diff 只读快照、CLI 查询结果 |
| **活跃订阅者** | 可编辑的投影（源文件标签、可编辑嵌入块），编辑即时提交模型 |
| **快照订阅者** | 只读、固定版本的投影（diff 渲染视图）：订阅某个 rev，此后不跟随更新 |
| **rev** | DocModel 的单调递增版本号；每次提交事务 +1 |
| **diskRev** | 模型最后一次与磁盘对账成功时的 rev；`rev > diskRev` 即脏 |
| **canonical md** | 模型序列化为 markdown 的规范形式（round-trip 稳定，见 §5.6） |

---

## 4. 总体架构

```
┌────────────────────────────────────────────────────────────────┐
│                        DocStore（全局单例）                       │
│  realPath → DocModel                                            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ DocModel(B.md)                                            │  │
│  │   blocks: [BlockModel(blockId, kind, content…)]           │  │
│  │   doc: PM Doc（模型文档树，与 blocks 对齐）                 │  │
│  │   rev: 42  diskRev: 41  diskHash: 0x…                     │  │
│  │   subscribers: Set<Subscription>                          │  │
│  └──────────────────────────────────────────────────────────┘  │
│  职责：事务串行化执行 / rev 分发 / 惰性加载 / 磁盘对账 / 快照导出    │
└───────┬──────────────┬───────────────┬───────────────┬────────┘
        │ 活跃订阅       │ 活跃订阅        │ 快照订阅        │ 查询
        ▼              ▼               ▼               ▼
   A.md 标签的      A.md 标签的      diff 渲染视图     Agent CLI
   嵌入块 #b1       嵌入块 #b2      (rev=N 定格)    docstore.snapshot
        ▲              ▲
        │ 编辑：steps → DocStore.apply()（同一 tick 内分发）
   B.md 标签（DocModel 的"本体视图"，也是订阅者）

持久层：.md 文件 = 唯一持久真源；DocStore 是工作副本；
        落盘（防抖）与磁盘对账（freshToken/hash）沿用现有机制。
```

**不变式（整个 spec 的骨架，任何实现细节让位于这四条）：**

- **I1**：DocModel 是运行态内容的唯一可写点。任何视图不得私改后"稍后上报"——编辑产生的 PM steps 必须在 dispatch 的同一步同步提交 DocStore。
- **I2**：`rev` 单调递增；订阅者每收到一次分发，其基线要么前进到新 rev（应用成功），要么显式进入"失步"状态（应用失败），**绝不静默停在旧 rev 而不标记**。
- **I3**：磁盘是持久真源。模型的 `diskRev` 之前的内容必须等于磁盘文件内容（或磁盘外部变更被对账机制捕获，见 §7.3）；进程退出丢模型不丢数据。
- **I4**：快照订阅者拿到的是不可变数据（rev 定格），不因后续事务失效——diff 视图的 write-once 语义保留。

---

## 5. 核心设计

### 5.1 DocModel 数据结构

```ts
// src/editor/docstore/model.ts（新模块，见 §8 模块划分）

interface DocModel {
  readonly realPath: string

  /** 模型文档树：用应用统一 schema 解析 canonical md 得到的 PM Doc。
   *  所有编辑以 steps 应用于此树；blocks 是其顶层子节点的逻辑视图。 */
  doc: PMNode

  /** 顶层块序列（逻辑视图）。blockId 在模型生命周期内稳定（见 §5.4）。 */
  blocks: BlockModel[]

  /** 内容版本；每次成功事务 +1 */
  rev: number
  /** 最后一次磁盘对账（加载/落盘/外部变更确认）时的 rev */
  diskRev: number
  /** 磁盘内容 hash（对账与 freshToken 用） */
  diskHash: string | null

  /** 序列化缓存：rev → canonical md（失效即重算；只有保存/diff/CLI 用） */
  private serialized: string | null

  subscribers: Set<Subscription>
}

interface BlockModel {
  /** 模型内稳定 ID（DocStore 分配；不落盘、不跨会话） */
  blockId: string
  /** 块类型标记：heading / paragraph / fence / table / file_block-marker …（诊断与嵌入定位用） */
  kind: string
  /** 内容指纹（hash of canonical serialization；rev 间未变则跳过分发，性能闸门） */
  fingerprint: string
}
```

**要点：**

- **模型内部持有 PM Doc 而非字符串**。这是本 spec 最重要的实现决策：编辑 = steps 应用（廉价、精确、可 rebase 给其他视图），序列化只在保存 / diff / CLI 导出时发生（且按 rev 缓存）。现有 registry 的"整文件字符串 truth"被替换。
- 模型 doc 与编辑器实例的 doc **共享同一 schema**（同一套 ref/annotation 节点注册），保证 steps 可直接互通。
- 嵌入 marker（`![[path]]` 行）在模型 doc 中就是一个 `file_block` 容器节点（未物化形态），与其他块平权。

### 5.2 订阅协议

```ts
type SubscriptionKind =
  | { kind: 'doc'; tabId: string }                        // 源文件标签（本体视图）
  | { kind: 'block'; tabId: string; blockId: string }     // 宿主标签内的嵌入块
  | { kind: 'snapshot'; token: string; rev: number }      // 快照订阅（diff 渲染）

interface Subscription {
  key: string                       // 同现有 registry 的 view key 约定，便于迁移
  source: SubscriptionKind
  /** 该订阅当前基线 rev；落后 = 待刷新 */
  rev: number
  /** 一次性句柄 */
  unsubscribe(): void
}

interface DocStore {
  /** 惰性加载：磁盘 → 解析 → 模型（已加载则直接返回） */
  load(realPath: string): Promise<DocModel>

  /** 编辑事务唯一入口。同步执行：steps 应用 → rev++ → 逐订阅者分发。
   *  originKey = 发起编辑的订阅；分发时跳过 origin。 */
  apply(realPath: string, steps: Step[], originKey: string, meta: TxMeta): void

  /** 快照订阅：导出 rev 定格的 canonical md + 块结构（不可变副本） */
  snapshot(realPath: string, rev?: number): Snapshot

  /** 订阅变更流（rev 推进 + steps 流；快照订阅者用不到，但 CLI/诊断可全量订阅） */
  subscribe(realPath: string, sub: SubscriptionInit): Subscription

  /** 脏态查询：模型级 */
  isDirty(realPath: string): boolean   // rev > diskRev

  /** 落盘（防抖调度由保存循环调用，见 §7.2） */
  flush(realPath: string): Promise<void>

  /** 磁盘对账（外部变更检测，见 §7.3） */
  reconcile(realPath: string): Promise<'clean' | 'external-change' | 'gone'>

  /** 诊断/CLI：全 store 快照（§9.3） */
  inspect(): StoreSnapshot
}
```

**分发语义（`apply` 内部，同步执行）：**

```
for sub of model.subscribers:
  if sub.key === originKey: sub.rev = newRev; continue
  if sub 是快照订阅: continue                      // I4：rev 定格
  if sub 是 block 订阅:
      steps' = rebase(steps, sub 的宿主 doc 内块位置映射)   // §5.4.3
      ok = 宿主视图.applyExternal(steps')
  else:  // doc 订阅（源文件标签）
      ok = 标签视图.applyExternal(steps)                    // steps 同构，直接应用
  if !ok: sub.stale = true; 标记失步（I2），UI 呈现并允许重置对齐
```

**为什么可以同步执行**：steps 应用与 rebase 是纯内存运算（微秒~亚毫秒级），不存在今天"整文档替换 + 重新物化 + resolveRefs 读盘"的异步链路。今天必须防抖的根源是 replaceAll 代价高 + 触发二次 markdownUpdated，两者在增量事务方案中都不存在。

### 5.3 编辑事务流（用户案例走读）

以用户报告的 P-1 场景为验收用例：

**场景**：A.md 嵌入 B.md 两次（块 #b1、#b2），同时打开 B.md 标签。用户在 A.md 的 #b1 中键入"X"。

```
1. #b1 所在 Crepe 实例 dispatch 一个 PM transaction（插入 "X"）
2. 宿主视图的 transaction-dispatch 拦截器（新）：
   a. 提取 steps 中落在 #b1 内容范围内的部分
   b. 反向映射到 B.md 模型 doc 坐标（块内 pos → 模型 pos）
   c. DocStore.apply('B.md', steps, origin='tabA#b1')
3. apply 同步执行：
   - B.md 模型 doc 应用 steps → rev 41→42
   - 分发给 #b2：rebase（宿主 A doc 内 #b2 块的位置映射）→ 宿主 A 实例
     dispatch 一个带 "external-sync" meta 的 transaction → 光标不在 #b2，无感刷新
   - 分发给 B.md 标签：steps 同构直通 → B 标签编辑器 dispatch external transaction
   - 跳过 origin #b1（它的 PM doc 本来就是编辑发生地）
4. 同一 tick 内：#b2、B 标签已显示 "X"；B.md 模型 rev=42、标记脏（42 > diskRev 41）
5. 自动保存循环（防抖，现状机制）择机 flush('B.md')：序列化 canonical md →
   fs.writeFile → diskRev=42 → 通知 A.md 模型重算嵌入块的序列化缓存（如果 A 也要保存）
```

关键差异对照：

| | 现状 | 文档层 |
|---|---|---|
| 编辑感知 | markdownUpdated 防抖 200ms | transaction dispatch 即时 |
| 提交 | serialize 整块内容 → setTruth(字符串) | steps 直提模型 |
| 分发 | 防抖 400ms → replaceAll/fillBlockContent | 同 tick，steps rebase |
| "两边都改" | 时间差内可能 | 结构上不可能（事务串行化，I1） |
| 光标/undo | 需 suppressing + setTimeout 守卫 | external meta 的 transaction 不进本地 undo 栈（§5.5） |

### 5.4 块身份与位置映射（本 spec 最大的难点，三个子问题）

#### 5.4.1 blockId 的稳定性边界

**决策：blockId 是模型生命周期内的稳定 ID，不跨会话、不落盘（维持现状的语义边界，符合 N1）。**

理由：
- 同步只发生在运行态；跨会话的一致性由"重新解析 md → 重建模型"保证，不需要身份延续。
- 落盘 ID（如 `![[path|id:xxx]]`）会污染 md、产生 diff 噪音、且与用户手写 md 的兼容性风险不成比例（正是 N1 排除项）。

分配规则：DocStore.load 解析 md 建 DocModel 时，按顶层子节点顺序分配 blockId。嵌入块视图初次物化时从模型取 blockId 写入 PM node attrs（替代现在的 `genBlockId()` 随机分配）。

#### 5.4.2 块内容范围跟踪

嵌入块可以是**整文件**或**标题片段**（`![[path#heading]]`，沿用现有 fragment 语义）。模型侧：

```ts
interface EmbedRange {
  /** 嵌入目标：whole-doc 或 heading 锚定范围 */
  target: { kind: 'whole' } | { kind: 'heading'; fragment: string }
  /** 模型 doc 内的 [from, to]（顶层块对齐，闭环到块边界） */
  from: number
  to: number
}
```

- `whole` 嵌入：range = 模型 doc 全部顶层块；
- `heading` 嵌入：range = 标题块到下一同级/更高级标题前的块序列；
- **range 的漂移是常态**：模型事务可能增删块。每条事务分发时，DocStore 用 steps 的 mapping 更新各 EmbedRange（PM 的 `StepMap` 天然提供位置映射）。heading 锚本身被删/改名 → 该订阅进入 `stale` + 显式提示（复用现有断链 UI），不静默。

#### 5.4.3 宿主 doc ↔ 模型 doc 的位置映射

宿主 A 的 PM doc 中，#b1 的内容子树 = B 模型 doc 的 EmbedRange 子树（同一 schema，节点同构）。映射是**纯偏移量**：

```
host_pos = block_content_start(#b1) + (model_pos - range.from)
```

实现为一个小型纯函数模块 `posmap.ts`：`modelStepsToHost(steps, range, blockContentStart) → Step[]`。维护点只有一处：块内容起点的跟踪（块在宿主 doc 中的 pos 会被宿主自身的编辑移动——用 PM decorations 的 position mapping 或在宿主事务拦截器中同步更新，不再遍历全 doc 查找）。

> 备选方案（已否决）：宿主块与模型共享同一 PM 节点对象。共享节点在多编辑器实例间会造成事务状态污染（PM doc 是不可变的，但各实例的 state 更新路径不同步），且宿主对块内容的局部编辑（如块内删一个字）产生的 steps 需要重新定位，本质仍要 posmap。偏移映射方案复杂度更低且可单测。

### 5.5 撤销历史与光标（G3 的落实）

- **外部同步事务**：宿主/标签视图应用外部 steps 时，dispatch 的 transaction 携带 `meta.docstoreExternal = true`；两处消费：
  - Crepe 的 history 插件配置过滤该 meta（不进 undo 栈——外部变更不可被本地 Ctrl+Z 撤销，否则会回滚别人的编辑造成再同步）；
  - 光标/选区由 PM 的 `prosemirror-state` selection mapping 自动跟随（steps 应用后 selection 被映射，这是 PM 原生行为，光标不跳）。
- **本地 undo 重放**：用户在本地 Ctrl+Z 时，undo 产生的 steps 同样走 §5.3 事务流提交模型（undo 也是编辑）。所有视图一致回退——这是现状做不到的（现状 undo 只回退本地视图，registry truth 不回退，立刻失步）。

### 5.6 序列化规范（canonical md）

模型 → 磁盘/CLI/diff 的唯一序列化出口：

```
canonical(model) = serializer(model.doc)
```

- **round-trip 稳定化一次性做对**：`parse(canonical) → doc'` 必须满足 `serializer(doc') === canonical`。现有 writeback.ts 的 round-trip 修补（重解析再序列化）作为 canonical 计算的一部分收编进 `docstore/serialize.ts`，diff 侧与保存侧共用。
- 序列化结果按 rev 缓存；只有 rev 推进才重算。
- 现状中 `savedContent = crepe.getMarkdown()` 作为"编辑器视角的磁盘基线"的做法废除：基线统一为模型的 `diskRev` 对应的 canonical（磁盘 hash 验证）。

### 5.7 模型加载与失效生命周期

```
                    ┌─ 标签打开该文件 ─┐
load 触发:  ─────────┤ 被任一宿主嵌入    ├────→ 磁盘读 → 解析 → DocModel(rev=1, diskRev=1)
                    └─ diff/CLI 显式请求 ┘
保留条件:   有订阅者 或 脏（未落盘）
回收:       订阅者清零且 rev==diskRev → 释放模型（内存回收，下次用再加载）
失效:       reconcile 检测到磁盘外部变更且模型未脏 → 重建模型 + 通知所有订阅者重投影
            （模型已脏的外部变更 → 冲突处理，§7.3）
```

折叠（环/超深治理）与只读嵌入维持现有语义：**折叠块与只读块不注册为活跃订阅者**（沿用 registry 现状规则——折叠卡是治理态，不接收任何内容更新；只读变体是物化时的固定快照）。判定逻辑唯一实现仍在 `ref/embed-chain.ts`，文档层只消费。

---

## 6. 消费场景改造

### 6.1 嵌入实时同步（主场景）

**改造点：**

| 现有模块 | 命运 |
|---|---|
| `ref/registry.ts` | 被 DocStore 替代；`setTruth`/`scheduleBroadcast`/`flushBroadcast`/`viewIsStale` 全部删除 |
| `manager.ts` 中 `setRegistryBroadcastHandler` 装配段、`applyBlockBroadcast`、`applyDocBroadcast` | 删除；分发逻辑收进 DocStore + 视图适配器（§8） |
| `propagateBlockEdits`、`propagateDocEdit` | 删除（编辑在事务拦截器即时提交，无传播函数） |
| `writeback.ts` 的 `writeBackBlocks` 写回事务 | **整体删除**：嵌入块编辑已即时进模型，保存 = flush 各脏模型，无"从宿主收集内容写回源"这一步 |
| `hasBlockChanges` / `blockSnapshot` / `lastSyncBlocks` | 删除（脏 = 模型 rev > diskRev） |
| `tab.userEditedAt` / `lastExternalSyncAt` | 删除（无"用户编辑 vs 程序刷新"的区分需求——都走同一条事务流） |
| `refreshTabToContent`（replaceAll 联动） | 删除；失步恢复改为按 rev 对齐（见下） |
| `inst.suppressing` 标志 | 删除（external meta 事务天然不会被误判为用户编辑） |

**失步恢复**（I2 的落地）：视图 applyExternal 失败（steps 无法干净 rebase，如宿主块正处于编辑中间态）→ `sub.stale=true`，UI 在块上显示"失步"徽标，提供「对齐到最新」操作（将该块内容用模型当前子树整体替换——此时才允许 replaceAll 式刷新，因为是用户显式动作）。**这与现状的本质区别：失步是罕见的异常态且永远可见，而不是正常链路里的时序赌博。**

**readonly / 折叠语义**：只读嵌入块在物化时从模型取快照（rev 定格的一次性投影，等价于快照订阅）；折叠块不订阅。两者都不产生反向事务。

### 6.2 Diff 渲染管线（P-3 的解法）

**数据来源重定向：**

```
现状:  newMd = git.showFile / readWorktreeFile（磁盘）
目标:  newMd = DocStore.load(realPath).snapshot()   ← 有未保存编辑也正确
       （模型未加载时 load 内部读磁盘，行为等价）
oldMd = git 层照旧（git show HEAD:… 等四种 base 取法不变）
```

**prefetch 简化：**

```
现状:  prefetchEmbedSources 递归批量 showFiles 读所有嵌入源的 old/new
目标:  new 版内容 → 查 DocStore（已加载直接用；未加载的仍批量读，读后注册进
       DocStore 供后续复用）
       old 版内容 → 仍走 git 批量端点（git 是旧版本的唯一出处，这条 IO 保留）
```

- 「强制保存才能进 diff」的约束拆除：worktree 基准的 diff 变成「模型当前内容 vs git 版本」，**未保存编辑直接出现在 diff 里**（功能增强，需在 GitPanel/diff 入口文案上区分"含未保存改动"）。
- 但**只读快照语义（write-once）严格保留**（I4）：diff 渲染管线内部取 `snapshot(rev)` 定格数据，挂载后模型继续变不影响已渲染的 diff 视图；用户刷新 diff 才取新快照。`prefillDoc` / 装饰坐标稳定的前提不受影响。
- `recheckDiffFreshness`（磁盘外部变化复核）保留，改为对账 DocStore（`reconcile`）+ rev 比较。
- `loadRenderData` 中 `newMd` 的三种取法收敛为一行 `snapshot()`；`renderData.freshToken` 改存 `(rev, diskHash)`。
- 用户在 diff 视图里「丢弃改动/丢弃单个 hunk」等回写操作（`discardFileDiff`/`discardHunkDiff`）：改为构造 DocStore 事务（旧内容片段替换新内容），经统一事务流生效——现状的"读盘-拼接-写盘"旁路删除。

### 6.3 Agent 调试通道（P-4）

通道已存在（writeit 工具）。文档层提供两个新查询命令（走现有命令注册机制接入）：

- `docstore.inspect`：全量模型快照——每个 realPath 的 rev/diskRev/dirty、块列表（blockId/kind/fingerprint）、订阅者及其基线 rev/stale 标记。**取代现有 `refs.registry` 命令**（迁移期两者并存，后者标记 deprecated）。
- `docstore.doc <path>`：canonical md 导出（等价现有 `doc.markdown`，但未加载文件也可查询，且保证与模型一致）。

**调试体验升级**：现在诊断"引用不同步"要看五套基线互相印证；文档层下，`inspect` 一次回答——哪个订阅者 rev 落后、是否 stale，一目了然。重构期间（§9.4 M1 影子模式）这也是一致性验证的取证来源。

### 6.4 后续消费场景（列为方向，不在本期实施范围）

搜索（扫描改订阅模型 + rev 增量索引）、校验（模型事务后按块增量重校验）、导出（直接从模型导出）、Outline。这些在 M4 完成后逐个迁移，各自小步走。

---

## 7. 真源、落盘与冲突

### 7.1 真源模型

```
持久真源:  .md 文件
运行态:    DocModel（工作副本；进程内权威）
关系:      flush = 模型 → 磁盘；load = 磁盘 → 模型；reconcile = 双向对账
```

I3 的表述精确化：任何时刻，`model.rev == model.diskRev` ⇒ `canonical(model)` 与磁盘内容逐字节一致（flush 原子写保证）；`rev > diskRev` ⇒ 磁盘是旧值、模型是新值（唯一的"新"在模型，视图无分歧）。

### 7.2 落盘（flush）

- 触发：沿用现有自动保存循环 + Ctrl+S（保存语义升级为"flush 所有相关脏模型"：当前标签模型 + 它作为宿主引用的各源模型）。
- 快照基线：`tab.savedContent` 字段废除；标签的脏标记 = 其模型 `isDirty()`。
- 文件树/其他视图的角标（dirty 徽标）改为订阅模型脏态。
- **严格校验门禁（M5 strict 确认弹窗）照旧**，检查对象从编辑器实例换成模型 canonical。

### 7.3 磁盘外部变更（唯一残余的冲突类别）

有了文档层，"两边都改"只剩一种可能：**应用外进程改磁盘**。处理沿用并简化现有 freshToken 机制：

```
reconcile(realPath):
  disk = fs.readFile
  if hash(disk) == model.diskHash:      return 'clean'          // 磁盘没变
  if model.rev == model.diskRev:                                     // 本地无未保存编辑
      rebuild model from disk; notify subscribers(重投影); return 'external-change'
  else:                                                              // 真冲突：双方都有变化
      → 冲突 UI（现状是静默 toast + 各种跳过；目标是一次性的显式选择：
        「保留内存版（flush 覆盖磁盘）/ 采用磁盘版（重建模型，本地编辑进撤销栈）/ 导出副本」）
```

对账触发点：标签激活时、进入 diff 前、自动保存循环的轻量 hash 轮询（低功耗模式停轮询，沿用现状）。

---

## 8. 模块划分

```
src/editor/docstore/            ← 新增（纯逻辑层，无 Vue/无 DOM，可单测）
  store.ts        DocStore 单例：load/apply/snapshot/subscribe/flush/reconcile/inspect
  model.ts        DocModel/BlockModel/EmbedRange 数据结构与不变式
  posmap.ts       模型坐标 ↔ 宿主块内坐标 的 steps 映射（纯函数）
  serialize.ts    canonical md（round-trip 稳定化收编于此）
  adapters.ts     订阅者视图适配协议：applyExternal(steps) 接口约定

src/editor/ref/                 ← 收缩
  （resolve.ts/nodes.ts/… 引用解析、节点 schema、菜单、tooltip 保留）
  registry.ts     → 删除（M4）
  writeback.ts    → 拆解：round-trip 部分并入 serialize.ts，写回事务删除

src/editor/manager.ts           ← 同步装配段大幅缩减（~800 行预算内缩减）
  （事务拦截器注册、订阅者生命周期挂接、失步徽标 UI 挂接）

src/editor/diff/prefetch.ts     ← 按消费 DocStore 改造（§6.2）
```

**依赖方向**：`docstore` 不 import `manager`/组件/诊断（纯状态模块，同 registry 现状承诺）；`manager` 与视图适配器单向依赖 docstore。装配通过回调注入（沿用 registry 的 handler 注入模式，但注入面小得多——只有视图适配器）。

---

## 9. 迁移路线（每步 e2e 全绿为闸门）

### M1：DocStore 骨架 + 影子模式（不改任何用户可见行为）

> ✅ **M1 已完成（2026-08-28 实现）**
> 交付件：`src/editor/docstore/{model,serialize,posmap,store,bridge}.ts`；
> manager.ts 六处挂接（管线/IO 注入 + syncTab 影子登记 + 三处真相变更钩子 + 关闭清理）；
> CLI `docstore.inspect` + `window.__docstoreInspect/__docstoreConsistency` 钩子；
> 单测 21 个（vitest，全绿）；构建通过；影子数据现场验证（writeit 实连确认模型/块/订阅者正确）。
> 回归：embed-sync-p1 19/19、embed-sync-p2 16/16 全绿；ref-e2e 1 个 doctype 计数时序竞态（物化快于 3s 断言窗口，非本层回归）。

- 实现 `docstore/` 全部模块；`load/apply/snapshot/inspect` 可用。
- 接入点：`syncTabViewsToRegistry` 在注册 registry 视图的同时向 DocStore 建模型/建订阅（**影子**：DocStore 只跟随现有链路记录 rev，不分发）。
- CLI `docstore.inspect` 上线；影子一致性断言：每次 registry 广播后，DocStore canonical 与 truth 字符串必须一致（不一致 = 影子 bug，不影响用户，修复后继续）。
- **产出物**：posmap/serialize 的完整单测（vitest，纯函数层正合适）；影子期跑 1~2 周（含日常使用 + e2e 全量）。

### M2：doc 视图切换（源文件标签成为模型本体视图）

> ✅ **M2 已完成（2026-08-28 实现）**
> 交付：①**事务拦截器**（包装 PM `view.dispatch`，非 dispatchTransaction——PM 的 dispatch 只读构造时 `_props.dispatchTransaction`，实例覆盖无效）：块外正文编辑 → `mapDocStepsToModel` 消膨胀映射 → `docStore.apply`（同名 tick、同步推进 rev）；块内编辑与 suppressing 期（广播/物化/保存）跳过；
> ②**消膨胀映射** `posmap.mapDocStepsToModel`：宿主 doc 的已物化 file_block 与模型 marker 尺寸差按位置累计补偿（顶层块配对；嵌套块属物化内容不参与）；重建 Replace/AddMark/RemoveMark 步；跨界（slice 含块）丢弃 + miss 记账；
> ③**下行过渡桥**：`applyDocBroadcast` 内容源改为模型 snapshot（未加载回退 registry truth）；
> 遗留（M2 已知简化）：doc 视图的 steps 增量直通（spec §5.3 理想形态）未落地——当前下行仍为 replaceAll 快照对齐（`refreshTabToContent` 保留），steps 直通与 posmap 的块内容映射留给 M3；registry 中 doc 视图物理下线推迟到 M4（registry 整体删除时）。
> 验证：单测 29（含 4 个映射用例）全绿（全套 75）；现场（mock 实例）：块内编辑宿主 rev 恒定、块外编辑 rev 即时+1、下行刷新内容来自模型 snapshot；回归 embed-sync-p1 19/19；source-e2e 3 个失败为 Mac 平台 Ctrl≠Mod(⌘) 的既有用例问题（目标平台 Windows）；realinput 1 个失败经「屏蔽 apply 对比」判定与 docstore 无关（CDP 超时类环境抖动）。

- 标签编辑器的事务拦截器上线：编辑即时 `apply` 到模型；标签自身内容不再由 `replaceAll` 联动（由 steps 直通）。
- registry 中 doc 视图路径下线；块视图仍走旧路（跨层混合：块内容更新时，宿主块填充仍由旧广播执行，但内容源改为模型 snapshot——过渡桥）。
- 验证套件：source-e2e、tabbar、保存链路 e2e。

### M3：块视图切换 + 写回事务删除（P-1/P-2 的收官）

> ✅ **M3a 已完成（2026-08-28 实现）——块内编辑即时进源模型（steps 直通核心闭环）**
> 交付：
> ①**块内编辑上行**：拦截器对「单块内编辑」的批次同步置 `m3aHandled`（消费 markdownUpdated 的 propagateBlockEdits 防双路）→ microtask 内 `commitBlockSteps`：resolve 源 realPath（`probeRealPath` 宿主相对）→ 模型惰性 load（含影子 ensure 空模型补解析）→ **同构门禁**（`model.doc.type.schema === hostSchema`，跨编辑器实例 schema 单例不同则回退旧路）→ `mapBlockStepsToModel` 消形体映射（块内容坐标 → 模型坐标）→ `docStore.apply`（模型 rev++ + registry 双写 setTruth 兼容层）。
> ②**下行分发**：`store.apply` 将本次 steps + originKey 交给注入的 Dispatcher → 各宿主块订阅者按 blockId 定位 → `mapStepsToHost`（模型坐标 → 宿主块内偏移）重建步骤 → `tr.setMeta('docstoreExternal')` 增量 dispatch（interceptor 跳过不回传）；doc 视图订阅者（源标签）走快照对齐（M2 过渡桥 guard + refreshTabToContent）。origin 块跳过不重复接收。
> ③**失败恢复统一**：commit 内所有失败出口（schema 不符 / 映射空 / 应用抛错）都执行 `m3aHandled=false + propagateBlockEdits`（恢复旧路）——不能依赖调用方 `.catch`（函数 try/catch 吞 throw 后 resolve）。
> ④**物化期抑制**：`resolveRefs` 期间置 `m3aSuppressed`，fill 物化事务不被误判为用户编辑（修环折叠回归）。
> 验证：单测 79（含映射/重建用例）全绿；`_m3check` 6/0（A 嵌 B 两次单实例：块1 编辑 → B 模型 rev++、兄弟块 steps 增量同步、宿主不变）；embed-sync-p1 19/19、p2 16/16、composite 24/24；realinput 的 Q1 断言已按新语义更新（块2 与块1 同模型投影同步增长），P3（源编辑→块）经定向 mini 验证 1/0；composite 并发断言按 spec 模型层语义更新（收敛一致/不静默丢编辑）。
> 已知限制（spec §11 R1）：跨实例 schema 场景 steps 直通自动回退整串旧路（内容不丢；并发窗口仍可能 last-wins，composite 断言已按数据安全语义放宽）；环/嵌套场景由物化抑制护栏保证不误入 M3a。
>
> ✅ **M3b 已完成（2026-08-28）——跨 schema 对齐兜底 + 保存链路 flush**
> ①**M3b-1 Dispatcher 降级对齐**：块分发加同构门禁——跨实例 schema（单例不同）或 steps 应用失败时，自动降级为 `alignHostBlockFromModel`（模型 canonical 整块 fillBlockContent，suppressing 内 + 块快照对齐 + `updateViewContent` 基线），不再静默丢同步；同构路径保留 steps 增量。
> ②**M3b-2 保存链路 flush**：`saveTab` 新增 `flushDirtyModelsForTab`——先 flush 本标签模型 + 引用源脏模型（canonical 写盘 + `markDiskSynced` 脏灭）；`writeBackBlocks` 加 `skipPaths` 防双写（模型已覆盖的源不再走旧序列化写回）；flush 的源并入广播①（源标签脏灭/刷新语义同 written）；**最后保存者胜守卫保留**（源标签有真实未保存编辑 → 不 flush，交给 writeBackBlocks 守卫 toast）；顺带修复 `writeBackBlocks`/`collectSourcePaths` 的宿主相对解析（`probeRealPath(cfg, path, cfg.hostPath)`，此前 `M3B` 类同目录相对路径解析失败）。
> 验证：p1 19/19、p2 16/16、composite 24/24、_m3check 8/8（含保存段：模型脏灭 + 磁盘含模型内容）、单测 79 全绿。
> 遗留（M4 范围）：五套基线（blockSnapshot/lastSyncBlocks/userEditedAt/lastExternalSyncAt/suppressing）物理删除、registry 整体下线、saveTab 从 ~250 行缩到 <80 行的彻底重写——需在 M4 与 registry 删除一并做（混合期双轨仍有价值）。

- 嵌入块（活跃订阅者）切到 steps 增量流；`propagateBlockEdits`/`applyBlockBroadcast`/`writeBackBlocks`/五套基线/suppressing 删除。
- 保存语义切换为 flush 脏模型；`saveTab` 重写（预期从 ~250 行缩到 <80 行）。
- 验证套件：embed-sync 全系列（p1/p2/composite/realinput/caret-regress）+ ref-e2e + nested-ref + paste-ref。**这是风险最高的一步，必要时再拆两半（先只读块、后可编辑块）。**

### M4：Diff 接入 + 旧路拆除

- `loadRenderData`/`prefetch` 改造（§6.2）；强制保存约束拆除（含 UI 文案）；discard 系列改走事务。
- registry.ts 删除；CLI `refs.registry` 标记 deprecated → `docstore.inspect` 接管。
- 验证套件：git-m11a/m18、diffcomplex、export-e2e、全量。

### M5：冲突 UI + 收尾

- §7.3 的三方选择冲突 UI；搜索/校验/导出的迁移另立后续任务（§6.4）。

### 回滚策略

M1/M2 影子与并存期随时可退；M3 起旧代码删除前保留 feature flag（`settings.experimentalDocstore`，默认开，出问题可关回旧链路一个版本周期）。

---

## 10. 测试策略

| 层 | 手段 |
|---|---|
| 纯函数层（posmap/serialize/model） | vitest 单测（新增，docstore 纯逻辑模块天然可测；覆盖：steps rebase 各种边界、EmbedRange 漂移、round-trip 稳定性、undo 重放） |
| 影子一致性 | M1 影子断言（§9.4）+ CLI `docstore.inspect` 取证 |
| 集成回归 | 现有 50+ e2e 全量保绿；embed-sync 系列为 M3 的专项闸门 |
| 新增 e2e | ① P-1 用户案例场景化用例（两嵌入块+源标签，三处编辑三处同步，断言同 tick 生效——用事件序断言而非 sleep）② 失步恢复用例 ③ 未保存 diff 用例 ④ 外部磁盘变更冲突用例 |
| 性能 | 软渲染 VM 环境下：连续输入 60s 的 CPU 采样不高于现状基线（文档层不得新增渲染/序列化负担——steps 路径按设计比 replaceAll 更便宜，但要实测确认） |

---

## 11. 风险与开放问题

| # | 风险 | 缓解 |
|---|---|---|
| R1 | **steps rebase 的边角**：宿主块正被编辑时外部 steps 到达（同一 tick 串行化避免了大部分，但块内选区中间态仍在） | 失步显式化（I2）+ 用户对齐操作兜底；影子期单测穷举边界 |
| R2 | **宿主 doc 与模型 doc 的 schema 漂移**（宿主 Crepe 实例的插件配置差异导致节点不同构） | 统一 schema 构造函数（features.ts 收口）；M2 加同构性启动断言 |
| R3 | **undo 栈与外部事务的互斥**（history 插件 meta 过滤的插件顺序问题） | 早做技术验证（M1 期间 spike），是 M2 前置条件 |
| R4 | **大文档性能**（每 keystroke 一次事务分发，订阅者多时 rebase 成本） | fingerprint 闸门（块未变跳过分发）+ 性能门槛实测；必要时对非活跃标签做合并分发（一次 rAF） |
| R5 | **迁移期双链路并存**的复杂度 | 影子模式设计目标就是压缩并存复杂度；每步闸门全绿才前进 |
| R6 | 片段嵌入（`#heading`）范围漂移的用户感知 | 显式 stale UI；与现有断链提示共用交互语言 |

**开放问题（评审时定）：**

1. M3 的混合过渡桥（§9.4）中"块内容源改为模型 snapshot"是否值得做，还是 M2+M3 合并为一步（更陡但并存期更短）？
2. 冲突 UI 的三方选择中「本地编辑进撤销栈」的交互细节（PM undo 不支持跨文档事务，可能降级为"导出差异副本"）。
3. `docstore` 是否纳入 worker（大文档序列化不阻塞 UI）——倾向否（序列化只在 flush，本就异步），留 M4 后再议。

---

## 12. 验收标准

1. **P-1 场景验收**：A.md 嵌入 B.md ×2 + B.md 标签；在任一处连续输入，其余两处在同一输入事件的处理周期内更新（e2e 以事件序断言）；全程无冲突 toast、无光标跳动、无内容消失。
2. **代码量**：同步链路相关代码（registry+writeback+manager 装配段+基线字段）净缩减 ≥ 40%（当前约 1500 行 + 五个字段族，目标 ≤ 900 行且全部集中在 `docstore/`）。
3. **语义收敛**：全库检索 `suppressing`、`blockSnapshot`、`lastSyncBlocks`、`userEditedAt`、`lastExternalSyncAt`、`scheduleBroadcast` 无残留（M4 完成时）。
4. **diff 增强**：含未保存编辑的文件可进 diff 视图且正确渲染（新 e2e 通过）。
5. **CLI**：`docstore.inspect` 可用，输出含每个模型的 rev/dirty/订阅者基线。
6. **全量 e2e 绿** + 性能门槛（§10）不回退。
7. **数据安全**：迁移各阶段任意时点强杀进程，磁盘文件不坏（flush 原子写维持现状）；影子期与切换期各做一次手工破坏性测试清单。

---

## 附录 A：现状代码 → 目标模块映射总表

| 现状 | 位置 | 目标 |
|---|---|---|
| truth 字符串 + setTruth/commit | ref/registry.ts | DocModel.doc + apply/flush |
| 视图注册/views Map | ref/registry.ts | Subscription/subscribers |
| 广播防抖 scheduleBroadcast/flushBroadcast | ref/registry.ts | 删除（同步分发） |
| viewIsStale / registryDiag | ref/registry.ts | sub.stale / inspect() |
| serializeBlockContent round-trip 修补 | ref/writeback.ts | docstore/serialize.ts |
| writeBackBlocks 写回事务 | ref/writeback.ts | 删除 |
| hasBlockChanges 脏检测 | ref/writeback.ts | isDirty(rev 对比) |
| propagateBlockEdits / propagateDocEdit | manager.ts | 事务拦截器（adapters） |
| applyBlockBroadcast / applyDocBroadcast | manager.ts | DocStore.apply 分发循环 |
| refreshTabToContent（replaceAll 联动） | manager.ts | steps 直通；失步对齐操作 |
| suppressing 标志 | manager.ts | external meta 事务 |
| blockSnapshot/lastSyncBlocks/userEditedAt/lastExternalSyncAt | state/store.ts | 删除 |
| tab.savedContent | state/store.ts | 模型 diskRev（脏态角标订阅之） |
| diff newMd 取磁盘 | manager.loadRenderData | DocStore snapshot |
| prefetch new 版内容 | diff/prefetch.ts | DocStore（未加载批量读后注册） |
| 强制保存进 diff | manager.openGitDiff | 拆除（含 UI 区分） |
| discard 系列读盘拼接 | manager.discard*Diff | DocStore 事务 |
| CLI refs.registry | Agent 通道 | docstore.inspect（旧命令 deprecated） |

## 附录 B：不变式速查（评审用）

- **I1** 编辑唯一入口：任何视图的修改必须当 tick 提交 DocStore，无私改后补报。
- **I2** rev 只进不退：订阅者要么跟上新 rev，要么显式 stale，无静默滞后。
- **I3** 磁盘是持久真源：rev==diskRev ⇒ 模型 canonical ≡ 磁盘字节；丢模型不丢数据。
- **I4** 快照不可变：diff 等快照订阅者拿到 rev 定格数据，后续事务不影响。
