# 多层块嵌入渲染治理（编辑视图 × Git Diff 共用）

> 状态：**设计定稿（2026-08-23，从 [`git-render-arch-m18.md`](git-render-arch-m18.md) 第六轮评审 G2 拆出独立成文）**
> 背景：多层嵌套的视觉规模 / 循环 / 超深问题**不是 git diff 视图独有**——常规编辑视图（`resolveRefs` 物化）同样展开多层嵌入。两个视图必须共享同一套判定语义与折叠视觉，否则同一文档在两处呈现不同的展开形态。
> **用户裁决（本文件的最高约束）**：
> 1. **循环嵌套**：感知并对循环内容**提示，不渲染**；
> 2. **多层嵌套**：支持渲染到 **10 层**；第 11 层起**提示，不渲染**。
>
> 关联：[git-render-arch-m18.md](git-render-arch-m18.md)（diff 侧消费方，其 §4.4 / §4.4.1-a / P3a 按本文件语义消费）· `ref/resolve.ts` / `ref/file-block-view.ts` / `ref/nodes.ts`（编辑侧现状实现）· `doc/git-diff-rules.md` 规则 6（嵌入 = 源文件的分身）。

---

## 1. 现状与问题（代码事实）

| # | 现状（`ref/resolve.ts` 及配套） | 问题 |
|---|---|---|
| N1 | `MAX_DEPTH=10` 多轮物化；`depth >= MAX_DEPTH` 的块不物化 + 一次性 toast「引用深度超过 10 层，已截断」 | 超深块保持**空容器**（空卡片，无任何解释）——用户看到的是"嵌入坏了"而不是"已折叠" |
| N2 | **无环检测**：A 嵌 B、B 嵌 A 时，多轮物化逐层展开重复内容，直到撞上 N1 的深度上限才停 | 循环内容被渲染约 10 份；违反裁决 1 |
| N3 | `collectBlocks` 的 depth 按 **doc 结构深度**计（walk 对每个块级子节点 +1，列表/引用/表格嵌套也计入） | 「10 层」语义失真：结构嵌套会提前触发截断；**嵌入链深度与结构深度混用**，与"支持 10 层嵌入"的用户语义不符 |
| N4 | 深度判定只看块自身，**不知道祖先路径链** | 无法区分「环」与「重复兄弟嵌入」（A 嵌 B 两次是合法的，不该折叠） |
| N5 | diff 侧（m18 原稿）为「全局访问集」防环语义 | 会把重复兄弟嵌入误折叠（m18 第六轮 G3 已修正；本文件给出两视图统一语义） |

## 2. 设计原则

1. **单一语义，双视图共享**：链判定逻辑收敛为一个纯模块 `ref/embed-chain.ts`；`resolveRefs`（编辑视图）与 `diff/prefetch.ts`（diff 视图）都是消费者，不允许各自实现（两处实现 = 语义漂移的开端）。
2. **深度 = 嵌入链深度，与结构深度解耦**：宿主正文里的 `![[B]]` 是第 1 层，B 内容里的 `![[C]]` 是第 2 层，以此类推；列表/引用/表格等结构嵌套**不计入**（修复 N3）。
3. **环 = 路径在自身祖先链中再次出现**（realPath 精确比较）：A 嵌 A、A 嵌 B 嵌 A、A 嵌 B 嵌 C 嵌 B 都是环；**兄弟重复不是环**（A 嵌 B 两次、B 与 C 都嵌 D 均正常渲染）。
4. **折叠必可见**：不渲染 ≠ 什么都不显示——原地渲染一张不可编辑**提示卡**，说明原因与当前链路；静默截断 / 空卡片视为 bug（对齐 m18 原则 6「降级可见」）。
5. **不污染数据**：折叠态只存在于运行时 attrs（md 序列化不输出），round-trip 无损；折叠块不物化、不参与写回（现有 `materialized` 语义已保证，无数据丢失风险）。
6. **可观测**：折叠事件 `diagEvent('embed:collapse', { reason, chain })` 落盘，诊断包可见。

## 3. 核心机制

### 3.1 embed-chain 纯模块（判定唯一实现）

```ts
// src/editor/ref/embed-chain.ts —— 无 DOM 无 IO 纯函数，双视图共用
export const MAX_EMBED_DEPTH = 10   // 支持渲染的最大嵌入链层数

export type ChainVerdict =
  | { kind: 'ok' }                              // 正常物化 / 预填充
  | { kind: 'cycle'; hit: string }              // 环：realPath 命中祖先链
  | { kind: 'too-deep'; limit: number }         // 第 limit+1 层起折叠

/**
 * ancestors：宿主文件 realPath 在前，其后为各级父嵌入块 realPath
 * （长度 = 父块链深 + 1；第 1 层块 ancestors = [宿主]，长度 1）——不含本块自身。。
 */
export function classifyEmbed(ancestors: string[], realPath: string): ChainVerdict
// 判定顺序（互斥，短路）：
//   cycle    : ancestors.includes(realPath)           —— 先环，无论深度
//   too-deep : ancestors.length - 1 >= MAX_EMBED_DEPTH —— 当前块为第 11 层及更深
//   ok       : 其余
```

**realPath 归一**：比较用解析后的真实路径（编辑侧 `readRefFile` 候选扩展名机制 / diff 侧后端 `ls-files` 解析），**精确相等**——禁止 `endsWith` / `includes` 前缀匹配（M16 路径匹配事故的教训；`数据/需求` 与 `数据/需求表` 是两个文件）。别名写法（`![[B]]` vs `![[folder/B.md]]`）解析到同一 realPath → 正确判环。

**链根 = 宿主文件**：检测 A 嵌 B 嵌 A（内层 A 与宿主同名同文件）必须把宿主路径放进链——`RefConfig` 新增 `hostPath`（manager 打开 tab 时注入；diff 侧 base 文件路径天然已知）。

### 3.2 编辑视图（resolve.ts 改造）

- `collectBlocks` 的 walk 携带**祖先 realPath 栈**（进入 file_block content 时 push 该块的 realPath）；realPath 由批量预解析 pass 产出（复用 `readRefFile` 既有 LRU 缓存，断链路径只解析一次）；
- 每个未物化块过 `classifyEmbed` 分流：
  - `ok` → 物化（现状路径完全不变）；
  - `cycle` / `too-deep` → 不物化，`setNodeMarkup` 写入折叠态属性：

    ```ts
    // file_block attrs 新增（nodes.ts）
    collapsed: { default: null }   // null | { reason: 'cycle' | 'depth'; chain: string[] }
    ```

    attrs 仅运行时：`toDOM` 输出 `data-collapsed`（诊断/测试选择器），**序列化器不输出该属性**（md round-trip 无损，重新打开文档后重新判定）；
- 多轮物化循环：折叠块不再进入物化队列 → round 自然收敛，**不再依赖"跑满 MAX_DEPTH 轮才停"**（每轮重新 collect 的成本同步消失）；
- toast 保留一次性行为，但降级为辅助——**inline 提示卡是主表达**（修复 N1）。

### 3.3 折叠提示卡（FileBlockView 改造）

`collapsed` 非空时，内容区渲染提示卡（不可编辑；样式与嵌入卡片同族，编辑 / diff 两视图共用同一组 class）：

| 场景 | 卡片内容 | 交互 |
|---|---|---|
| 环 | `↻ 循环引用：[[B]] 已在上级层级出现`（副行：链路 `A › B › [[B]]`） | 点击路径 → 打开该源文件 |
| 超深 | `⤓ 嵌套层级超过 10 层，已折叠`（副行：链路 `A › B › … › K`） | 同上 |

- 折叠卡本身**不产批注、不参与写回、不可编辑**；
- `setNodeMarkup(collapsed)` 触发 NodeView 重建（现有 `update()` 返回 false 语义），新 `FileBlockView` 按 attrs 渲染提示卡；
- diff 视图中同一位置出现时**视觉一致**（数据层额外产一条保证层 record，见 3.4）。

### 3.4 Git Diff 视图（m18 消费侧）

- `diff/prefetch.ts` 递归收集时逐层调用 `classifyEmbed`（同一模块、同一语义、同一份判定矩阵单测）：
  - `ok` → 正常取 old/new/merged 入 source map；
  - **全局源去重（与环检测分离）**：同一 realPath 多次合法出现（兄弟重复 / 菱形引用）→ source map 只 diff 一次，**每个出现处都正常预填充渲染**；
  - `cycle` / `too-deep` → 该处记折叠标记（不入 source map）；预填充填入与编辑视图同款的提示卡；该处产一条 `ChangeRecord { kind: 'embed', summary: '循环引用：[[path]]，已折叠' / '嵌套超过 10 层，已折叠' }`（保证层卡，m18 §4.4）。
- m18 第五轮「访问集防环」表述按本文件修正为**祖先链环检测 × 全局源去重**两个概念（m18 第六轮 G3）。

### 3.5 与断链的边界

- 文件不存在（读失败）→ **断链**（现有行为：卡片警告态），不是环、不是折叠——三者互斥，判定顺序：**断链（读失败）→ 环 → 超深**。

## 4. 文件级改造清单

| 文件 | 改动 |
|---|---|
| `src/editor/ref/embed-chain.ts`（新增） | 纯判定模块（classifyEmbed + MAX_EMBED_DEPTH）；判定矩阵 node 单测直接覆盖 |
| `src/editor/ref/config.ts` | `RefConfig` 增 `hostPath`（环检测链根；manager 打开 tab 时注入） |
| `src/editor/ref/resolve.ts` | walk 携带祖先 realPath 栈；realPath 批量预解析 pass；分类分流（物化 / 折叠标记）；折叠块跳过物化队列 |
| `src/editor/ref/nodes.ts` | file_block attrs 增 `collapsed`；toDOM 增 `data-collapsed`；序列化不输出 |
| `src/editor/ref/file-block-view.ts` | `collapsed` 非空 → 渲染折叠提示卡（禁编辑、点击跳源文件） |
| `references.css` / `diff.css` | 提示卡样式（两视图共用同一组 class） |
| `src/editor/diff/prefetch.ts`（m18 P3a，本文件 E2） | 递归收集接入 classifyEmbed + 全局源去重 + 折叠标记；预填充折叠卡 |
| 测试 | `tests/unit/ref/embed-chain.test.ts`（判定矩阵）；e2e：编辑视图折叠卡可见/可跳转、diff 视图折叠卡 + 保证层卡（扩展 `tests/e2e/nested-ref-e2e.js`） |

## 5. 测试矩阵（判定矩阵是主判）

| 用例 | 期望 |
|---|---|
| A 嵌 A（自嵌） | 内层 A 折叠（cycle，链 `A › A`） |
| A 嵌 B 嵌 A | 内层 A 折叠（cycle，链 `A › B › A`——**链根含宿主**的用例） |
| A 嵌 B 嵌 C 嵌 B | 内层 B 折叠（cycle 命中祖先，非宿主） |
| A 嵌 B ×2（兄弟重复） | 两处 B 均正常渲染；diff 侧 source map 仅一份（去重不折叠） |
| A 嵌 B、B 嵌 C、A 也直接嵌 C（菱形） | 三处均正常（C 非自身祖先） |
| 链 A›B›…›J（共 10 层嵌入） | 第 10 层正常渲染 |
| 链 11 层 | 第 11 层折叠（too-deep），链路完整显示 |
| 结构深度干扰：B 内容含 5 层列表/引用后再嵌 C | C 链深度 = 2（结构深度不计入），正常渲染（**N3 回归用例**） |
| 别名写法：`![[B]]` 与 `![[folder/B.md]]` 互嵌 | 解析同 realPath → 正确判环 |
| 路径互为前缀：`数据/需求` 与 `数据/需求表` | 精确匹配，互不误判 |
| 断链：`![[不存在]]` | 断链警告（现有行为），不折叠 |
| 折叠块保存 / 重开 | md 无折叠残留（序列化不输出）；重开重新判定结果一致 |
| 折叠块写回 | 不参与写回（materialized=false 既有语义），源文件不被写空（回归 248a2ab 数据丢失事故的语义） |

## 6. 分阶段实施

| 阶段 | 内容 | 依赖 | 验收 |
|---|---|---|---|
| **E1 编辑视图治理** | embed-chain + RefConfig.hostPath + resolve.ts 分类 + FileBlockView 折叠卡 + 单测/e2e | **无**（不依赖 m18 任何阶段，可先行，与 m18 Spike 0 并行） | §5 矩阵中非 diff 项全绿；折叠事件进诊断；round-trip 无损 |
| **E2 diff 视图接入** | prefetch 递归接入（classifyEmbed + 全局源去重 + 折叠标记 + 折叠卡预填充）+ embed 保证层 record | m18 P1（write-once 预填充）；**与 m18 P3a 同批交付** | §5 矩阵 diff 项全绿；多层嵌套各层 records 正确 + 折叠处保证层卡 |

## 7. 风险与回滚

| 风险 | 缓解 |
|---|---|
| realPath 预解析 pass 增加解析开销 | 复用 `readRefFile` 既有 LRU 缓存（60 条）；断链路径只解析一次；diff 侧由批量端点一次 `ls-files` 完成 |
| attrs 变更影响既有 schema 消费方（写回/序列化/批注） | `collapsed` 默认 null、序列化不输出；写回只收集 materialized 块（折叠块天然排除）——e2e 加 round-trip + 写回不写空断言 |
| 10 层正常渲染本身的性能/视觉压力 | 层数上限是用户裁决；**内容量护栏由 m18 §4.4.1-d 资源预算承担**（records/字节/eager 上限，超预算降级浅层说明卡）——两层上限各司其职：层数管结构、预算管体量 |
| diff 侧与编辑侧语义漂移 | 判定只有 embed-chain 一处实现；两视图共用同一判定矩阵单测（§5） |
| 回滚 | E1 独立 feature flag（`ref.embedChain`）；折叠块回退为现状空容器 + toast（行为不劣于现状） |

## 8. 与其他文档的关系

- [`git-render-arch-m18.md`](git-render-arch-m18.md)：本文件从其第六轮评审 G2 拆出；其 §4.4 嵌入递归、§4.4.1-a 预取层、P3a 按本文件语义消费；其第五轮「访问集防环」表述已被本文件 3.4 修正；
- `doc/git-diff-rules.md` 规则 6（嵌入 = 源文件的分身）：折叠卡是规则 6 的边界补充——环 / 超深时「分身」不再无限展开，以提示卡表达；
- `doc/annotation.md`：折叠卡不进入批注体系（保证层 record 仅 diff 视图产出，编辑视图折叠卡不产批注卡）。
