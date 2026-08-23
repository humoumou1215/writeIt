# Git Diff 渲染架构重构（M18）— 最终设计方案

> 状态：**设计定稿（2026-08-23，两轮评审 + 第三轮实现核对 + 第四轮架构自审 + 第五轮架构裁决 + 第六轮外部评审采纳；修订均已并入正文，记录见 §11 / §12 / §13 / §14）**
> 背景：渲染模式（M13→M17 演进）长期陷入"细节修修补补"循环——mermaid 节点标注不符预期、批注卡连线位置错误、嵌入块渲染不符预期。
> 本文档是**架构层**的最终方案；行为契约（二元化/语法外壳/分隔行等裁决规则）不变，见 [`doc/git-diff-rules.md`](../../doc/git-diff-rules.md)。
> 关联：[git-workbench.md](git-workbench.md)（M11 工作台）· [git-render-redesign.md](git-render-redesign.md)（M13 历史）· `render-diff.ts`（M17 现实现）
>
> **第五轮核心裁决（2026-08-23）**：保留本方案的数据层骨架（DocDiff 单一真相 / 分层承诺 / 测试网 / 可观测 / 批量 IO），**渲染基底由「lifecycle 事件驱动管理借来的异步组件」替换为「确定性渲染管线（write-once doc + 自有 mermaid NodeView + 单点 settle）」**——消灭异步与身份问题，而非驯服它。原 lifecycle 方案压缩为附录 A（spike 失败时的回退路径）。裁决理由见 §13。
>
> **第六轮修订（2026-08-23，外部评审采纳）**：① mermaid 图内标注主路径由「渲染后 DOM class 手术」改为「**合并源码 classDef/class 声明**」（mermaid 原生渲染，DOM 手术降为 fallback；原备选 F28 升格）；② 嵌套渲染治理（循环引用 / 深度折叠的判定语义与视觉形态）**独立成文** [`embed-nesting-governance.md`](embed-nesting-governance.md)，本方案 prefetch / 预填充改为其消费方，「访问集防环」修正为「祖先链环检测 × 全局源去重」两概念；③ P0 裁剪、P3 拆分（P3a 前置至 P1 后立即交付多层嵌套）。记录见 §14。

---

## 1. 问题诊断（两轮综合 + 第五轮模式复盘）

### 1.1 三个表现，同一组根因

| 用户可见问题 | 直接原因 | 根因归类 |
|---|---|---|
| mermaid 节点标注不符预期 | DOM 手术依赖 mermaid 内部结构；手写解析器只覆盖语法子集 | §1.2-R3 / R4 |
| 批注卡连线位置错误 | 连线画完后布局移位；note 的 from/to 是快照、doc 变化后过期 | §1.2-R1 / R2 |
| 嵌入块渲染不符预期 | 嵌入物化异步改 doc，装饰被 mapping 救回但 notes 没有；路径字符串匹配错位 | §1.2-R1 / R2 |

### 1.2 八个根因

**渲染层（第一轮诊断）：**

- **R1 时序赌博**：mermaid 懒加载 + 嵌入物化异步 + `resolveRefs` 限时，下游全靠 `sleep + 轮询`（0/400/1200/2500ms 补标 + scroll 监听 + 700ms idle 轮询 8s）。修复 = 调整赌赢概率，而非消除赌博。
- **R2 无稳定寻址**：所有关联靠脆弱匹配——mermaid fence 按**下标**配对（中途插图全错位）；`applyMermaidAnnotations` 循环里 `querySelector` **永远取第一张 svg**（多图文档现行 bug）；节点靠 `gid.includes('-flowchart-${id}-')` 子串匹配；note 靠 `anchor.includes(path)` 字符串包含；from/to 位置拷进普通对象后无人映射（装饰系统有 `tr.mapping`，notes 绕过了它）。
- **R3 在错误层做布局**：mod 节点克隆幽灵 + `getCTM()` 坐标还原 + 8 步碰撞右移——用 DOM 算术对抗 mermaid 布局引擎，正确性不取决于自己。
- **R4 解析面超载**：`mermaid-diff.ts` 332 行正则覆盖 3 种图类型的语法子集，与 mermaid 真实语法模型的偏差 = 静默降级，永远修不完。
- **R5 无验证回路**：e2e 39 个文件中，渲染 diff 的测试仅剩 `git-m11a-e2e.js` 的 6 条「存在性」浅断言（`.diff-ins/.diff-del` 存在、svg 存在、`.ref-file-block` 存在、批注卡激活），对 mermaid 节点级标注、多图各自落位、嵌入内容级 diff、嵌套嵌入、降级路径、`data-dnote` 锚定等 M14–M17 真正出 bug 的功能覆盖为 0。无 fixture、无快照 → 修复无法验证不回归，mermaid 升级全部悄悄重新坏。

**横向层（第二轮诊断）：**

- **R6 三源真相**：git 行级 hunks（文本模式用）、`computeDocDiff`（渲染模式用）、mermaid 手写解析器（图标注用）三个引擎独立产出，叙事可互相矛盾；text/渲染/批注卡各消费各的。
- **R7 数据新鲜度缺失**：`openGitDiff` 按 base 复用缓存 diff（秒开），但磁盘后续变化不失效 → stale 数据被当成渲染 bug 修。
- **R8 静默失败**：降级/异常 `console.warn` 吞掉，用户与诊断都看不出哪个局部降级、为什么。（实证：M16 注释声称已删 sequence includes 兜底，代码未删。）

### 1.3 历代重构模式复盘（第五轮补充）

把 M11c→M17 排开看，存在一个反复出现的模式——**每一代都在一个自己不拥有的层上做手术**：

| 代 | 手术层 | 结果 |
|---|---|---|
| M11c | 双 Crepe 渲染后 DOM 提取融合 | 失败——DOM 结构随库版本漂移 |
| M13–M16 | 往 md **字符串**注入标记 → 渲染后 **DOM 手术**（幽灵克隆/getCTM/碰撞右移） | 反复失败——与 markdown 解析器、mermaid 布局引擎对抗 |
| M17 | PM 结构 diff + 装饰 | **成功**——把 diff 搬到了自己拥有的层（computeDocDiff 输入输出、DecorationSet、`tr.mapping`） |
| M18 第四轮稿 | lifecycle 状态机追逐组件事件（renderPreview 回调时机、occurrence 计数、增量 settled） | 本稿否决——追逐组件库内部时序，是同一模式的时序维度重演 |

**推论（本稿的设计基点）**：diff 视图是**只读快照**，它不需要「活」编辑器的三样东西——懒加载（性能需求）、异步物化（写回语义）、可变 doc（编辑能力）。借来的每一样都转化为时序/身份问题。第四轮稿的 §4.1–§4.1.2 约 80 行状态机形式化，全部是在**为一个本可不存在的问题建模**（两轮评审 F1/F2/F12 的漏洞闭合成本即是信号）。正确解法：**把渲染输入做成 write-once，消灭异步，而不是管理异步**。

---

## 2. 设计原则（七条，按序裁决冲突）

1. **分层承诺**：拆成两层——
   - **保证层**（100% 正确，可测试）：批注卡结构化摘要（增/删/改了什么）、嵌入源文件改动说明、图旁源码对比。全部由自有代码产出。
   - **增强层**（尽力而为）：图内红绿标注、卡片徽标。失败 → **scoped 降级**到保证层，用户感知是"少了彩蛋"而非"信息错误"。
2. **单一真相（分层）**：一个 `DocDiff` 模型描述"谁改了"；渲染视图与批注卡都是它的投影，不允许各自计算。文本视图的**行/词级着色**继续消费 git hunks（已稳定，不动），仅其**批注卡文案**改由 `ChangeRecord` 统一产出——修掉"同一改动两视图说法不一"，同时不回归词级高亮。
3. **确定性优先于事件驱动**：渲染管线内**能同步确定的绝不异步**——嵌入内容 mount 前预填充、变更图 eager 渲染、身份由结构（PM pos / NodeView 自身）免费获得。事件（settle、ResizeObserver）只用于编排**自有代码**的完成时机，绝不用于追逐第三方组件的内部行为。（第五轮将原「事件驱动」原则升级为此条：原则覆盖面从布局引擎延伸到时序维度——**不依赖第三方组件的内部时序行为**。）
4. **身份寻址**：锚点带稳定 id（`data-dnote` / fence id），id 由内容派生（hash），与位置解耦；位置同步交给装饰系统的 `tr.mapping`（保险）；删掉一切手工位置同步与字符串匹配。
5. **不与布局引擎对抗**：图内标注主路径是**合并源码的 classDef/class 声明**（mermaid 原生渲染，第六轮升级）——不触碰渲染产物 DOM；DOM class 手术仅作 fallback 收缩到"能稳定做到"的子集；做不了的（旧值幽灵节点）移到保证层表达。
6. **降级可见**：每个 diff 单元产出 `enhancement: ok|degraded|failed` + reason，UI 微提示 + 诊断落盘；静默失败视为 bug。
7. **渐进与可回退**：每阶段独立合入、feature flag 可一键回退；渲染基底的更换以 spike 验证为前置（§6 Spike 0），spike 失败回退附录 A。

> 行为契约不变：`git-diff-rules.md` 总纲（二元化红/绿、语法外壳永不被吞噬、分隔行跳过、mermaid 保序保拓扑加回）继续有效，本重构是**实现层**替换。

---

## 3. 目标架构

```
┌─ 数据层 ────────────────────────────────────────────────┐
│ git hunks（后端）  发现/预取层（IO：读各层嵌入源 old/new → source map）│
│        └────────── 归一化 ──────────┘                    │
└────────────────────────┬────────────────────────────────┘
                         ▼
┌─ 计算层（纯函数，可单测）────────────────────────────────┐
│ diff/model.ts：old/new md + git 数据 → DocDiff           │
│   · ChangeRecord（含 enhancement 状态、内容派生 id）      │
│   · mergedMd（mermaid 预合并后的渲染输入）                 │
│   · FenceRegistry（结构配对为主路径的栅栏身份表）          │
└────────────────────────┬────────────────────────────────┘
                         ▼
┌─ 渲染层（确定性管线）───────────────────────────────────┐
│ diff/renderer.ts：                                      │
│   ① doc 预填充（file_block 递归填入预取内容，write-once） │
│   ② mount 单 readonly Crepe（doc 自挂载起不再变化）      │
│   ③ 自有 mermaid NodeView：变更 fence eager 渲染（身份=  │
│     NodeView 自身，免费）；未变更 fence 保留懒加载        │
│   ④ 单点 settle：Promise.allSettled(变更单元) + 5s 兜底   │
│   装饰 = ChangeRecord 投影（携带 data-dnote=<recordId>）  │
└────────────────────────┬────────────────────────────────┘
                         ▼
┌─ 增强层（尽力而为，scoped 降级）─────────────────────────┐
│ diff/overlay.ts：卡片徽标注入 + 图内标注 fallback（主路径 │
│   = merged 源码 classDef/class，mermaid 原生渲染，§4.8）  │
│ AnchorResolver：resolvePos（id→pos）/ resolveRect（id→   │
│   DOMRect，prose 以 coordsAtPos 为主）；ResizeObserver 重绘 │
└─────────────────────────────────────────────────────────┘
```

与现实现的对应：`render-diff.ts`（713 行）拆解为 model / renderer / overlay 三块；`diff-deco.ts` 保留核心算法但输出改为带身份的装饰；`AnnotationDrawer.vue` 连线改走 AnchorResolver。

与第四轮稿的差异：**lifecycle.ts（事件状态机）取消**，其职责被「write-once doc + eager NodeView + 单点 settle」吸收；F1（renderPreview 回调无身份）/ F2（嵌入栅栏二段登记）/ F12（增量 settled 与 occurrence 形式化）三个阻塞项**不再存在**（问题被消除而非修补）。

---

## 4. 核心机制设计

### 4.1 确定性渲染管线（对治 R1/R2 的根因层）

#### 4.1.1 write-once doc：嵌入预填充（消灭 R1/R2 的主要来源）

**现状问题**：mount 后 `resolveRefs` 异步物化 file_block（`replaceWith` 改 doc）→ 装饰靠 `tr.mapping` 救、notes 的 from/to 快照过期、嵌入内栅栏"二段出现"。全部时序问题的第一来源。

**方案**：物化从"mount 后异步"移到"mount 前同步"——

```
预取层产出 source map（Map<realPath, {oldMd, newMd, mergedMd}>，§4.4.1-a）
   ▼
parse(mergedMd) → 得到 newDoc（宿主骨架，file_block 均为空容器）
   ▼
遍历 file_block（递归 + 祖先链环检测 × 全局源去重，判定语义与折叠形态见 embed-nesting-governance.md）：
   对每块：content = parse(scopeMergedMd).content
   doc.replaceWith(from, to, content) + setNodeMarkup(materialized=true)
   ▼
mount readonly Crepe（defaultValue 不再传 md 字符串，直接注入预填充 doc）
```

两个已核实的前提（第三轮实现核对 + 第五轮复核）：

- **`resolve.ts` 的物化循环会跳过 `materialized=true` 的块**（`blocks.filter((b) => !b.materialized && ...)`）——预填充后 mount 时的 `resolveRefs` 只剩 object_ref 消歧一条路径；
- **object_ref 消歧不产生位置漂移**：`setNodeMarkup` 是属性级更新、`file_ref → object_ref` 的 `replaceWith` 是等尺寸 inline atom 替换（nodeSize 不变）→ 已构建装饰的 from/to 不失效。此断言进 fixture 锁定（若未来 schema 变化破坏此前提，fixture 红灯即报警）。

**效果**：

- doc 自 mount 起 write-once → **notes 的 from/to 快照永不过期**（R2 位置过期类 bug 连根消失，`tr.mapping` 降级为保险性一行）；
- 嵌入内栅栏在 mount 前就存在于 doc 中 → 无"二段登记"、无增量 settled（F2 消除）；
- 现有 `wrapEmbedReadFile`（拦截 fs.readFile 返回合并源码）**退役**——预填充直接消费 source map，绕过整套运行时替换。

#### 4.1.2 自有 mermaid NodeView：身份免费 + eager 渲染（消灭 F1/F12）

**现状问题**：mermaid 渲染走 `@milkdown/components` code-block 的 preview 面板——懒加载由组件内部 IntersectionObserver 控制、`renderPreview` 回调只有时机没有身份（第四轮 F1），于是需要 occurrence 计数、视口状态机、增量 settled 全套形式化（F12）。

**方案**：diff 渲染实例注册**自有 NodeView**（`$prose` nodeView，匹配 `code_block[language=mermaid]`，优先级高于 components 的 code-block view；非 mermaid 代码块不受影响，readonly 下本就走 preview）：

- **身份免费**：NodeView 构造时天然持有 `node`（fence 源码）与 `getPos()`（PM pos）——「这段栅栏是哪个」不再需要从渲染回调反推。NodeView 根元素挂 `data-fence-id=<fenceId>`，图内标注的 scope 查询天然限定在**自己的 DOM 子树**内——「querySelector 永取第一张 svg」这类 bug 在结构上不可能复发；
- **eager / lazy 二分**：查 FenceRegistry——该 fence **有变更记录 → eager 渲染**（NodeView 构造即 `await mermaid.render(...)`，与视口无关）；**无变更 → lazy**（保留 IntersectionObserver 懒加载，未变更图无需标注、不参与 settle，行为与编辑器一致）；
- **渲染代码路径与编辑器完全同源**：`mermaid.render → escapeRefHash → linkifyMermaidRefs → wrapMermaidPreview` 全部复用 `mermaid.ts` 现有函数——**divergence 仅限挂载点与时机，渲染代码零分叉**，观感一致性由 spike 验证（§6 Spike 0）；
- **图内红绿标注随源码免费获得（第六轮）**：mermaid-diff 产出的 merged 源码尾部携带 `classDef`/`class` 声明（§4.8 主路径）→ NodeView 渲染出的 SVG 天然带 diffAdd/diffDel class，**无任何 DOM 手术**——「标注打到第一张图」类 bug 在主路径上结构性不可能；
- **eager 预算**：变更 fence 通常每文件 ≤ 3 张；设上限（如 20），超限部分降级为 lazy + 保证层卡（图不参与图内标注）。

**残留异步清单**（全部自有代码，可测）：

| 残留异步 | 归属 | 处理 |
|---|---|---|
| 变更 fence 的 `mermaid.render` | 自有 NodeView | 计入 settle |
| object_ref 消歧（`resolveRefs` 残余路径） | 自有代码 | 不改 doc 尺寸（见 4.1.1），不参与 settle |
| 未变更 fence 懒渲染 | 组件行为 | 无标注需求，不参与 settle |

#### 4.1.3 单点 settle（原 §4.1 + §4.1.2 状态机的全部替代）

```ts
// diff/renderer.ts 内（非独立模块）
async function settle(units: Promise<UnitResult>[]): Promise<SettledResult> {
  const r = await Promise.allSettled(units)  // 变更 fence 的 eager 渲染
  // + 5s 总超时兜底：超时单元按 enhancement: 'degraded' + reason 归因
  // + 重算 diff 时旧管线 destroy（取消未完成单元的注入）
}
```

- settle 是**一个 promise**，不是状态机：无 `pending/waiting-viewport/rendering/done/degraded/failed` 迁移表、无增量重估、无 occurrence 绑定时机（F1/F12 消除）；
- 下游行为：图内标注/徽标注入订阅 settle **一次性执行**；连线绘制订阅 settle + 渲染容器 `ResizeObserver`（布局移位即重绘）；
- **删除全部 `setTimeout/setInterval` 猜测型补标轮询**（约 60 行）、删除 `Promise.race([resolveRefs, sleep(1500)])` 截断、删除 scroll 节流补标；仅保留 5s 总超时；
- 重算（新鲜度失效 / 切 base）：destroy 旧渲染实例 → 重跑整条管线。管线是幂等的纯编排函数（备数据 → 渲染 → settle），重跑成本 = 一次挂载，无增量状态需要清理。

#### 4.1.4 生命周期时序图

```
openGitDiff ──► 预取层(IO) ──► model(纯函数) ──► 预填充doc ──► mount ──┐
                                                                      │
        ┌─────────────────────────────────────────────────────────────┘
        ▼
 变更 fence NodeView: mermaid.render(eager) ─┐
 未变更 fence NodeView: lazy(IO 组件)  ──────┤（不参与 settle）
 resolveRefs: object_ref 消歧(残余)   ───────┤（不改 doc 尺寸）
        ▼                                     │
 Promise.allSettled + 5s 兜底  ◄──────────────┘
        ▼
 settle: overlay 一次性注入图内标注/徽标 → 装饰（mount 前已投影）→ 连线 + ResizeObserver
```

### 4.2 锚点身份化（对治 R2 残余部分）

**批注卡锚点 = 身份，不是位置：**

```ts
// 构建装饰时（diff-deco.ts 改造）
decorations.push(
  Decoration.inline(from, to, { class: 'diff-ins', 'data-dnote': record.id }),
)
// record.id = hash(scopePath + kind + op + 内容摘要) —— 内容派生、重算稳定
// （现状 dn-${++noteSeq} 自增序列退役：freshToken 失效重算后 id 不变，
//   批注抽屉激活态/滚动位置得以保持）
```

write-once doc（§4.1.1）已保证 from/to 不漂移；`data-dnote` 的职责收敛为：① 连线端点的 DOM 锚（`querySelector('[data-dnote=...]')` 校验/兜底）；② P4 迁移到主编辑器时的接口预留（届时位置会漂移，身份仍在）。装饰插件保留 `tr.mapping` 映射（一行成本，双保险）。

**栅栏注册表（结构配对为主路径）：**

```ts
interface FenceRegistry {
  /** fenceId（= NodeView data-fence-id）→ 该栅栏的变更记录 + eager/lazy 判定 */
  fences: Map<string, FenceChange>
}
```

- **新旧栅栏配对主路径 = `computeDocDiff` 结构配对**：code_block 的替换变更天然给出同一 region 内的新旧节点对应，结构配对**天然免疫「fence 前插入一段文字」导致的行号/下标漂移**（M17 按下标盲配 bug 的根因层修复）；
- **fallback = md 行级加权配对**（保留第四轮规格）：结构配对不可用（如整块 fence 增删跨多 region）时，`pairFences(oldBodies[], newBodies[])` 纯函数——评分 = `α·相似度(归一化编辑距离或 token Jaccard) + β·(1/(1+|Δidx|))`；「两张同内容图」「中途插图」两组用例入 fixture；
- `mermaid-diff.ts` 的新旧源码消费结构配对结果，不再自行按下标配对。

**sourceLineMetrics / measureMonoChar 手工度量退役**：源码模式 mark/diff 标记携带 data 属性，直接 DOM 定位（不变，见 §5 删除清单）。

### 4.3 AnchorResolver —— "找屏幕上的锚点"收敛为一处

现状 4 份各自为政的实现（prose `coordsAtPos`、textarea 手工度量、mermaid `getCTM`、字符串匹配）。统一为**两个接口**——连线需要「屏幕 rect」，滚动/点击定位需要「文档位置」：

```ts
// diff/anchor.ts
interface AnchorRef { noteId: string }          // 身份引用
interface AnchorResolver {
  /** id → 文档 pos（DecorationSet 按 data-dnote 反查；滚动/点击定位用） */
  resolvePos(ref: AnchorRef): number | null
  /** id → 屏幕 rect（连线用）；找不到返回 null（连线隐藏） */
  resolveRect(host: HTMLElement, ref: AnchorRef): DOMRect | null
}
// resolveRect 策略：prose(coordsAtPos 为主 + data-dnote DOM 校验兜底)
//                 / source(data 属性 DOM) / diagram(fenceId + 节点 id → 该 NodeView DOM 子树内 SVG 元素)
```

三个关键裁决：

- **prose 的 rect 主策略保留 `coordsAtPos(pos)`**：行内 `Decoration.inline` 会被 PM 按 mark 边界拆成多个 span、widget 装饰可能宽度为 0，`querySelector` 只取第一个片段会得到不完整 rect。`data-dnote` DOM 只作校验与兜底；
- **diagram 策略的查询 scope = 自有 NodeView 的 DOM 子树**（按 `data-fence-id` 定位到具体 NodeView，再在其内部按节点 id 找 SVG 元素）——「标注打到第一张图」类 bug 的第二道结构防线；classDef 主路径下图中节点已带自有 class，本策略仅在 class 注入失效（mermaid 渲染降级）时作为 fallback 定位手段触发，常规链路不执行 DOM 节点匹配（第六轮）；
- **滚动/点击定位走 `resolvePos`**：目标在离屏懒加载图里时没有 DOM rect，但 `DecorationSet.find()` 能拿到 id → pos 再 `scrollIntoView`。

连线绘制、滚动定位、批注点击定位全部走这两个入口；每个策略独立单测。write-once doc 使 `resolvePos` 大部分场景可直接用 notes 的稳定 from/to，`DecorationSet.find` 作统一入口（兼容 P4）。

### 4.4 DocDiff 单一真相（对治 R6）

三个引擎的产出归一化为同一模型：

```ts
type ChangeKind = 'text' | 'block' | 'table' | 'diagram' | 'embed' | 'ref'
type DiffStatus = 'ok' | 'degraded' | 'failed'

interface ChangeRecord {
  id: string                  // 稳定身份 = hash(scopePath + kind + op + 内容摘要)
                              //  = 装饰 data-dnote = 批注卡 id（重算稳定）
  kind: ChangeKind
  op: 'add' | 'del'           // 二元化（契约规则 1：mod = 删旧+增新两条）
  summary: string             // 保证层文案（批注卡 / 摘要）
  old?: string                // 旧内容摘要（卡片预览）
  new?: string                // 新内容摘要
  location?: DocLocation      // 新文档位置（构建装饰时解析）
  /** 记录所属嵌入源（真实路径）；宿主正文为空。多层嵌套递归时每层源各产一批 records */
  scopePath?: string
  guarantee: 'ok'             // 保证层恒定（§4.5 双维度）
  enhancement: DiffStatus     // 增强层结果（R8）
  degradeReason?: string
  detail?: DiagramDetail | EmbedDetail | RefDetail
}

interface DocDiff {
  base: DiffBase
  freshToken: { oldHash: string; newHash: string }        // 内容指纹（R7，§4.6）
  records: ChangeRecord[]
  mergedMd: string            // 渲染输入（mermaid 预合并后的新文档）
  fences: FenceRegistry
}
```

配套约定（四个 + 第五轮新增的循环防护，缺了它们目标项会落空）：

- **嵌入递归（对治多层嵌套）**：`model.ts` 对宿主正文产出 records 后，遍历所有 `file_block` 引用，对每个嵌入源文件**递归执行同一套流程**（`computeDocDiff` + `patchMermaidFences` + 表格/引用判定），以 10 层为界（见下）。每层源的 records 带 `scopePath = 该源真实路径`，渲染时由 §4.1.1 预填充与 §4.2 身份分发到对应嵌入卡片的内容区。A 嵌 B 嵌 C 时，B、C 各自产生红绿标注与批注卡。**嵌套的深度/循环判定语义与折叠视觉形态由独立设计文档 [`embed-nesting-governance.md`](embed-nesting-governance.md) 统一规定**（编辑视图与 diff 视图共用同一套语义与 `embed-chain` 判定模块）；本方案的 prefetch/预填充是其 diff 侧消费者。
- **循环引用防护（第六轮修正语义）**：环检测与源去重是**两个概念**——① **环 = 路径在自身祖先链（含宿主文件）中再次出现**（A 嵌 A、A 嵌 B 嵌 A、A 嵌 B 嵌 C 嵌 B）：该块不展开，预填充为折叠提示卡 + 产一条 `embed` record（summary「循环引用：[[path]]，已折叠」），不递归；② **重复兄弟嵌入**（A 嵌 B 两次、或 B 与 C 都嵌 D 的菱形引用）**不是环**：所有出现处正常渲染，仅 source map 按 realPath 全局去重（同一源只 diff 一次）。第五轮的「全局访问集」表述混淆了两者，按本条修正；判定逻辑复用 `embed-chain` 纯模块，判定矩阵进单测。
- **区域所有权仲裁（以结构 diff 为主干，不做三引擎后验归并）**：三个引擎的坐标空间不同（md 文本栅栏 / PM doc 位置 / file_block 节点），事后归并三家的"产出区域"既不可靠也无法单测。改为：**`computeDocDiff`（PM 结构 diff）是所有权判定的唯一主干**——遍历 changes，按变更区域触碰的节点类型一次性分类（`code_block[language=mermaid]` → diagram；`file_block` → embed；`file_ref`/`object_ref` → ref；其余 → text），每个 change region 只归属一次；mermaid 手写解析器只是 diagram 类 fence 的**内容级子消费者**（拿新旧源码算 add/del/mod），不参与所有权判定。「三源真相」由此在主干处收敛，而非在产出后拼接。**注意：嵌套时是「每 scope 一个 computeDocDiff 作该 scope 主干」**；决策表与跨类拆分规则见 §4.4.1-c。
- **嵌套引用的路径语义**：递归每层复用同一 `readRefFile` 候选路径语义与 `refCfg.fs`；预取层按 realPath 全局去重（同一次 diff 的 base 唯一，源 C 的 merged 与被嵌入层级无关），`scopePath` 只作 records 归属标签，不参与读文件。
- **parser 注入**：`model.ts` 保持无 DOM 无 IO 的纯函数，`parser: (md: string) => Node` 以参数注入（schema 含 `file_ref/file_block/object_ref` 自定义节点，无法内置）。单测用 headless Crepe 或最小 schema 提供 parser；运行时由渲染 Crepe 的 `parserCtx` 提供。

落地策略（**渐进，不推倒重来**）：

1. 第一步只做"叙事归一"：三引擎继续存在，但都产出 ChangeRecord；**渲染视图的行内/块级红绿装饰与批注卡**改由 records 产出。**只有文本视图**的行/词级着色继续消费 git hunks（已稳定，不动）；文本视图批注卡文案统一改由 ChangeRecord 产出（原则 2 的后半）**降级为 P3c 可选项**（第六轮 G9：收益小于耦合成本，可等 P4 tracked-changes 时一并收编）；
2. `model.ts` 为纯函数（old/new md + git 数据 + 注入的 parser → DocDiff，无 DOM、无 IO）——天然可单测，是 fixture 网的断言对象；
3. mermaid fence 级对比优先复用 `computeDocDiff`（unknown 图类型本来就走这条路），自定义解析器只保留 flowchart/state 两类**有明确增益**的路径（sequence 收缩见 §4.8），且解析无把握时整体降级为 fence 级（保证层）。保证层卡片内容 = 该 fence 的新旧源码逐行对比（红/绿），而非仅有「新增 N 个节点」计数——降级不等于信息缺失。

#### 4.4.1 单一真相的落地约束

**a) IO 发现层与 model（纯函数）的边界。** `model.ts` 声明的「无 DOM 无 IO 纯函数」与「嵌入递归产出 records」不可同时成立：递归到第二层就需要 B 文件的 old/new 内容，必须读文件。因此拆分两阶段：

> **发现/预取层（IO，升级现有 `collectEmbedSources`，独立模块 `diff/prefetch.ts`）**：解析 newMd → 收集 file_block 路径 → 批量读各层嵌入源 old/new → 递归解析其内容收集下一层路径（10 层界 + **祖先链环检测 + 全局源去重**，语义与折叠视觉形态见 [`embed-nesting-governance.md`](embed-nesting-governance.md)；环/超深处记折叠标记而非内容）→ 输出 `Map<realPath, { oldMd, newMd, mergedMd }>`。
> **model.ts（纯函数）**：消费该 map 做纯遍历递归，逐层 computeDocDiff，产出带 scopePath 的 records。

发现层只「读」、model 只「算」，二者消费同一份 source map（禁止 model.ts 内部任何 `readFile`/`showFile`）；§4.1.1 的 doc 预填充同样消费该 map。P3 验收含「三层共享同一 source map」断言。**发现/预取层无 UI 依赖，作为第一个独立交付物提前合入**（§6）。

**b) ChangeRecord 是渲染视图装饰与批注卡的唯一来源。** 若红绿装饰仍走旧 `buildDiffDecorations`、批注卡走 records，会制造第四种真相。裁决：**渲染视图的行内/块级红绿装饰与批注卡都由 ChangeRecord 产出**（record 携带 `location: DocLocation`，renderer 转成 Decoration）；只有文本视图（另一个视图）的行/词着色继续消费 git hunks。

**c) 区域所有权决策表（每 scope 一个 computeDocDiff 作该 scope 主干）。** 每个 change region 按触碰节点类型一次归类：

| region 触碰节点 | 归属 kind | 子消费者 |
|---|---|---|
| `code_block[language=mermaid]` | diagram | mermaid 手写解析器（拿新旧源码算 add/del/mod） |
| `file_block` | embed | 该 scope 的递归 diff |
| `file_ref` / `object_ref` | ref | §4.9 身份 diff |
| 其余 | text / block / table | 无（结构 diff 直接产出） |

跨类 region（一个 region 同时触碰 fence 边界与相邻文本）按优先级 mermaid > file_block > ref > text 拆到最小同类子区间；mermaid fence 内部不产通用 text 装饰（diagram 子消费者已产出）——尤其 `patchMermaidFences` 加回的删除节点不得被再标成「新增」。

**d) 递归 diff 资源预算。** A 嵌 B 嵌 C 至 MAX_DEPTH=10，每层都跑 computeDocDiff + patchMermaidFences + 表格/引用判定，无预算会内存/耗时失控。设上限：总 records 数（如 2000）、source map 总字节（如 4MB）、递归深度（沿用 MAX_DEPTH）、eager 渲染 fence 数（§4.1.2，如 20）；超限 → 该 scope 降级为「浅层说明卡」（只标「源文件有改动，已折叠」，不逐行 diff）。

### 4.5 降级可观测（对治 R8）

- **status 双维度**：`guarantee: 'ok'`（恒定，保证层文案永不因 status 隐藏）+ `enhancement: DiffStatus`（`degraded`/`failed` 只影响图内标注/徽标，卡片永远在）。避免「record=failed」被误读为「这张卡也失效」。
- 每个 ChangeRecord 带 enhancement 状态；增强层失败写 `degradeReason`；
- UI：降级处显示细小提示（图角落"标注已降级，见批注卡"），批注卡永远在（保证层）；
- 诊断：`diagEvent('diff:render', { ok, reason })` 落盘，诊断包可见；
- fixture 断言"应降级且原因 = X"——比截图断言更硬。

### 4.6 新鲜度契约（对治 R7，第五轮简化）

- `freshToken = { oldHash, newHash }`——**内容指纹**：`showFile`/`diffFile`/`readWorktreeFile` 本来就把两版内容拿回前端，hash 零额外成本；比「treeVersion（只覆盖应用内操作）→ mtime（变了内容未必变）」的两级演进更精确且一步到位，淘汰第四轮的 mtime 端点依赖；
- `openGitDiff` 缓存 diff 时记录 freshToken；进入 diff 视图 / 切回标签时**轻量复核**（`git_show_files` 批量端点顺带返回各源当前内容 hash，复用 §4.7 的单次往返）：不匹配 → 自动重算 + toast "内容已变化，diff 已刷新"；
- 覆盖外部变化（应用外 git 提交、外部编辑器改文件）：内容指纹直接命中——「磁盘变化自动刷新」验收不再依赖 treeVersion 的盲区。
- 磁盘外部变化的"玄学渲染 bug"从此有明确的归因出口。

### 4.7 嵌入源 IO 批量（性能）

现状：每个嵌入 3~4 次 git 往返（showFile×2 + diffFile + 候选路径逐个试错探测）。10 个嵌入 = 数十次往返（Tauri 下还是同步命令）。

- 后端加批量端点 `git_show_files(paths[], rev)`——一次 `git ls-files` 解析候选路径 + 批量 `git show`，**同时返回每路径的「旧内容 + 新内容 + hunks 非空标志 + 内容 hash」**（hash 供 §4.6 复核，hunks 标志消掉逐源 `diffFile` 往返——只批 show 的话 10 个嵌入仍剩 10 次 diffFile 往返）；
- **mock 后端（`src/git/mock.ts`）最先实现**——mock 是 e2e fixture 的运行后端，它先行落地同时解锁 P0 的数据驱动 fixture 与本节收益，一举两得；随后 `src-tauri/src/lib.rs`（真实 git）与 `src/git/dev.ts`（浏览器真实仓库模式）跟进；
- 前端按 `(realPath, base)` memo，一次面板加载内去重；`resolveRefFilePath` 的试错探测逻辑移到后端一次 `ls-files` 完成；
- **三后端漂移治理前置**：三侧 git 后端存在已知漂移（discardHunk 索引错位、词级 diff 缺路径、quotepath 等），在漂移未治理时新增批量端点会扩大漂移面。裁决：先把「三侧后端对齐」设为 P3 前置工作项（对齐清单 + 三侧同步交付），`git_show_files` 作为其第一个产出，与既有修复同批交付。

### 4.8 mermaid 策略收缩（对治 R3 / R4）

| 现状 | M18 决策 |
|---|---|
| mod 节点：克隆幽灵 + getCTM 定位 + 8 步碰撞右移 | **删除**。新节点标绿（class 稳定可做到）；旧值进批注卡 del 预览（保证层表达"改了什么"） |
| 三类图手写正则解析 | 收缩为 **flowchart / state 两类** + 加**置信度门槛**。落地为白名单行语法（逐行解析，遇未归类行即整体降级）：嵌套 subgraph、引号标签、v2 语法差异、无法归类的 token → 该 fence 整体降级 fence 级 diff（图原样 + 卡片附新旧源码对比），reason = 第几行哪个 token 无法解析，不静默出错 |
| **sequence 消息文本匹配 SVG text/tspan 加 class** | **整体删除**——这是全链路最脆的匹配路径（i18n 换行拆 tspan、同名消息、前缀包含），删掉 includes 兜底后命中率进一步下降，投入产出比最差。sequence 的表达收敛为保证层：图渲染新版本原样 + 卡片附新旧源码逐行红绿对比（删除消息/参与者行红、新增行绿）。**契约规则 5 的 sequence「按 LCS 插回」语义由源码卡承载，SVG 内不再表达** |
| 节点匹配 `gid.includes(...)` | **主路径不再需要节点匹配（第六轮）**：新增/删除节点由合并源码的 `class <ids> diffAdd/diffDel` 声明承载，mermaid 原生渲染样式；DOM 子树内按节点 id 匹配仅作为 class 注入失效时的 fallback 定位手段（§4.3 diagram 策略），匹配不中 = scoped 降级 + reason |
| sequence 消息 includes 兜底匹配 | 随 sequence SVG 标注整体删除（M16 声称删而未删的代码，本方案物理删除） |
| 删除节点"加回源码"（保序保拓扑） | **保留**——改源码不改 DOM，稳定且契约要求（规则 5） |
| classDef/`class` 源码注入（原备选 F28） | **升格为图内标注主路径（第六轮裁决）**：M14 拍板弃用的语境是「标注语法混进合并源码、担心往返污染」；diff 视图渲染的是一次性快照 mergedMd，**无往返问题**。`mermaid-diff.ts` 产出 merged 源码时尾部追加 `classDef diffAdd/diffDel` + `class <ids> ...` 声明（不逐行 `:::` 注入，避免边引用裸 id 的语法坑；样式与 diff.css 红绿定义同源），新增/删除节点标注由 **mermaid 自己渲染**——零 DOM 匹配、对 mermaid DOM 结构升级完全免疫、且可在模型层单测直接断言源码文本（比 DOM 断言硬一个数量级）。Spike 0③ 验证 classDef 在当前 mermaid（11.16）下的样式效果与 `class` 语句对 stateDiagram-v2 / 边引用裸 id 的支持 |

### 4.9 引用改动（`[[ref]]` / `object_ref`，对治目标项「引用」）

嵌入（`![[..]]`）由规则 6 覆盖；**内联引用**（`[[path]]` / `[[path#frag]]` / object_ref chip）目前被当作普通词级文本 diff，路径变化时会拆到 chip 的 `[[ ]]` 外壳，违背规则 2 精神。M18 决策：

- `file_ref` / `object_ref` 节点按**身份（path + fragment/object）二元化**：路径或片段变化 = 删旧 ref + 增新 ref，chip 本体不标记；
- 新增 `ChangeKind = 'ref'` 与 `RefDetail = { path, fragment?, changed: boolean }`；
- 引用目标文件在 diff 范围内有改动 → 复用嵌入的「源文件改动说明」，但降级为轻量角标（不内联渲染目标全文）——引用是「分身」的弱形式，规则 6 的卡片内嵌摘要仅对 `![[..]]` 成立，`[[..]]` 只给「目标有改动」提示；
- `buildDiffDecorations` 把 ref 节点从文本 diff 路径摘出，走身份 diff，避免词级 diff 切进 chip；
- `object_ref` 的 `resolvedText`/`label` 变化（引用目标对象内容变化导致 chip 显示变化）：归入 ref 类，按规则 6 精神降级为「目标有改动」轻量角标，不产删+增两条卡（chip 显示文本不是用户编辑内容，拆二元反而噪音）；`path`/`fragment` 变化仍按身份二元化删旧增新。

---

## 5. 文件级改造清单

**新增：**

| 文件 | 职责 |
|---|---|
| `src/editor/diff/prefetch.ts` | 发现/预取层（IO）：收集各层嵌入源 old/new/merged → source map（10 层界 + 祖先链环检测 + 全局源去重，语义与折叠形态见 [`embed-nesting-governance.md`](embed-nesting-governance.md)，环/超深处预填充折叠提示卡）；**无 UI 依赖，首个独立交付物（P1 基础版 / P3a 递归版）** |
| `src/editor/diff/model.ts` | DocDiff 构建（纯函数：md + git 数据 + 注入的 parser → records/mergedMd/fences；含 scopePath 嵌入递归与区域所有权仲裁） |
| `src/editor/diff/nodeview.ts` | diff 实例自有 mermaid NodeView（变更 fence eager / 未变更 lazy；`data-fence-id` 身份；渲染代码复用 `mermaid.ts` 现有函数） |
| `src/editor/diff/anchor.ts` | AnchorResolver（prose/source/diagram 三策略，diagram 以 NodeView DOM 子树为 scope） |
| `src/editor/diff/status.ts` | enhancement 状态定义 + 诊断埋点 |
| `tests/e2e/git-render-fixture/` | golden fixture 用例集（DOM/视觉层，见 §7） |
| `tests/unit/diff/` | model / fence 配对 / AnchorResolver / settle 编排（fake timer）的 node 单测（vitest） |
| `src/editor/ref/embed-chain.ts`（**由 [`embed-nesting-governance.md`](embed-nesting-governance.md) 定义，本方案为消费方**） | 嵌入链判定纯模块（环 / 超深 / 正常 + 全局源去重语义），prefetch 与 resolveRefs 共用 |

**改造：**

| 文件 | 改动 |
|---|---|
| `render-diff.ts` | 拆解为 renderer（预填充 + mount + settle 编排）/ overlay；**降级链 `renderSplitFallback` 与主路径共享 mount 逻辑，P1 改造波及之处同步适配 + fixture 强制降级用例覆盖**；保留降级链 |
| `diff-deco.ts` | 装饰携带 data-dnote（record.id）；notes 不再自持可过期位置（write-once 前提下 from/to 稳定）；算法核心保留；`file_ref`/`object_ref` 节点按身份二元化 |
| `mermaid-diff.ts` | 收缩为 flowchart/state 两类 + 置信度门槛；sequence SVG 标注路径删除；消费 FenceRegistry 结构配对；**merged 源码尾部追加 classDef/class 声明（§4.8 主路径，图内红绿由 mermaid 原生渲染）** |
| `mermaid.ts` | 渲染核心（`mermaid.render → escapeRefHash → linkifyMermaidRefs → wrapMermaidPreview`）导出为可复用纯函数，供自有 NodeView 与编辑器 preview 共用（零分叉） |
| `AnnotationDrawer.vue` | 连线/滚动走 AnchorResolver |
| `manager.ts` | openGitDiff 记录 freshToken（内容指纹）；`renderInstances` 全局 Map 随锚点身份化逐步退役 |
| `ref/resolve.ts` | 无需改造（`materialized` 跳过逻辑已被 §4.1.1 核实）；仅补 e2e 断言「预填充后 mount 时不再发生块物化事务」 |
| 后端 `lib.rs` / `src/git/dev.ts` / `src/git/mock.ts` | `git_show_files` 批量端点（三侧同步；**mock 先行**；返回旧/新内容 + hunks 标志 + hash） |

**删除（净减约 300+ 行脆弱代码）：**

- `applyMermaidAnnotations` 的幽灵克隆 + getCTM + 碰撞循环（~90 行）
- 0/400/1200/2500ms 补标 + 8s idle 轮询 + scroll 节流补标（~60 行）
- `sourceLineMetrics` / `measureMonoChar` 手工度量（~60 行）
- `locateNotesByDoc` 的字符串包含匹配、`collectEmbedChanges` 的 anchor.includes 匹配
- `Promise.race([resolveRefs, sleep(1500)])` 截断、`wrapEmbedReadFile` 运行时内容替换（被预填充取代）
- sequence 消息 SVG 标注路径（includes 兜底 + 精确匹配全套）

---

## 6. 分阶段实施（Spike 0 → P0 → P4）

| 阶段 | 内容 | 验收标准 | 风险 |
|---|---|---|---|
| **Spike 0（前置，约 1.5 天，三个独立 spike）** | ① **file_block 预填充兼容性 + 离线 doc 构造**：构造预填充 + `materialized=true` 的 doc 挂载 readonly Crepe（含 parse → 递归 replaceWith 的离线构造路径本身），验证 `FileBlockView` 渲染与 `resolveRefs` 跳过行为；② **自有 mermaid NodeView 观感**：用 `mermaid.ts` 现有函数做 diff 实例专用 NodeView，对比 code-block preview 面板外观；③ **classDef/class 源码注入样式**：验证当前 mermaid（11.16）下 `classDef diffAdd/diffDel` + `class <ids>` 的渲染效果，及 `class` 语句对 stateDiagram-v2 / 边引用裸 id 的支持 | 三 spike 各出一页结论（可行 / 不可行 + 证据）；**①②任一失败 → 渲染基底回退附录 A（lifecycle 方案），数据层骨架不变；③失败 → 图内标注回退 DOM class 手术路径（§4.3 diagram 策略），merged 源码产出不变** | 低（纯验证，不产生合入代码） |
| **P0 测试网（第六轮裁剪）** | fixture 框架 + 已知 bug 固化（§7 清单）。**含基建**：vitest 引入（仅 model 层）+ `tests/e2e/git-render-fixture/` runner + **mock 后端 `git_show_files` 批量端点**（解锁数据驱动 fixture）+ **性能基准用例**（大文档 + 5 嵌入耗时阈值）；**fixture 首版 ≤ 15 用例**（优先级：已知 bug 固化 > 多层嵌套/循环 > 降级链 > 性能基准，其余矩阵项随阶段补入，见 §7）；已知 bug 用例在现状下允许红灯/降级断言 | 每个已知 bug 有一个失败/降级断言用例；性能基准阈值可跑；CI 可跑 | 中（基建是真实成本；裁剪后是纯投入期的最短路径） |
| **P1 确定性渲染管线**（原 P1+P2 合并） | `prefetch.ts` **基础版**（一层嵌入，替代 `collectEmbedSources` + `wrapEmbedReadFile` 退役；首个独立交付物，可先于本阶段其余部分合入）→ doc 预填充 + 自有 mermaid NodeView + 单点 settle；删全部轮询/竞速截断/`wrapEmbedReadFile`；装饰携带 data-dnote（record.id 内容派生）；FenceRegistry（结构配对主路径 + 加权配对 fallback）；AnchorResolver（coordsAtPos 主策略 + NodeView scope）；连线/滚动迁移；`renderSplitFallback` 同步适配 | 全文档无 setTimeout 补标；mount 后无块物化事务（fixture 断言）；多图文档标注各自落位；嵌入物化位置稳定（连线一次到位）；object_ref 消歧不改 doc 尺寸（fixture 断言）；P0 全绿；**openGitDiff→mount 耗时不劣于现状（性能基准用例）** | 中（时序重排 + NodeView 新增；spike 0 已排雷，靠 P0 网） |
| **P3a 多层嵌套（第六轮新增，P1 后立即执行）** | `prefetch.ts` 递归扩展：10 层界 + `embed-chain` 祖先链环检测/超深折叠 + 全局源去重 + 折叠提示卡预填充（语义与视觉见 [`embed-nesting-governance.md`](embed-nesting-governance.md)，与其 E2 同批）+ scopePath records | A 嵌 B 嵌 C 各层产出 records 且 scopePath 正确；循环引用折叠卡 + 保证层 record；重复兄弟嵌入两处均渲染且源只 diff 一次；折叠处渲染形态与编辑视图一致 | 中（纯前端，无后端依赖；**直接交付「多层嵌套 diff」核心场景**） |
| **P2 mermaid 收缩 + 降级可观测** | 删幽灵 hack；sequence SVG 标注整体删除（源码卡承载）；置信度门槛；**classDef/class 主路径落地**（merged 源码 class 声明 + 模型层单测断言源码文本；DOM class 手术降为 fallback）；enhancement 双维度 + UI 微提示 | mod 节点绿标 + 卡片含旧值；sequence 图 + 源码逐行卡；覆盖不了的图显示降级提示且卡片兜底；无静默 console.warn 类失败；**同步修订 `git-diff-rules.md` 规则 1 的 mermaid 条目与规则 5 的 sequence 表达**（图内旧值/sequence 插回移至保证层，见 §10） | 中低（删代码为主，含契约修订） |
| **P3b IO 批量 + 三后端对齐（第六轮拆分）** | `git_show_files` 三侧收尾（tauri/dev，mock 已于 P0 先行）+ 前端 `(realPath, base)` memo + 候选路径探测移后端一次 `ls-files` + **三侧后端对齐清单**（discardHunk 索引错位、词级 diff 缺路径、quotepath 等既有漂移一并治理） | 嵌入扫描单次往返；三侧端点行为一致（对齐清单逐项验收） | 中（后端三侧同步，漂移面控制） |
| **P3c DocDiff 模型归一 + 新鲜度（第六轮拆分）** | `diff/model.ts` 纯函数化（parser 注入 + scopePath 递归消费 + 区域所有权 + 资源预算）；发现层/model/预填充共享同一 source map；freshToken 内容指纹全链路；**（可选）文本视图批注卡统一改由 ChangeRecord 产出**（G9：可等 P4 一并收编） | 渲染视图装饰与批注卡同源（records）；资源预算超限降级；新鲜度复核触发自动重算 + toast；model 层单测覆盖 | 中高（重构核心，靠 P0–P3a 网） |
| **P4 北极星评估（可选决策点）** | tracked-changes 原型：diff 内联进主编辑器（`@milkdown/plugin-diff` + `@milkdown/components` 的 `diffComponent`——依赖里已内置 ins/del 装饰 + accept/reject 按钮，启动成本低于第四轮预估） | 出独立决策文档 + demo；不承诺落地 | 见 §8 |

排序依据（第六轮调整）：Spike 0 用约 1.5 天验证「能否删掉渲染层 30% 的复杂度」再动工（三个 spike 分别排雷渲染基底两押注与 classDef 主路径）；P0 是其余一切的安全网（裁剪到纯投入期最短路径）；P1 一口气消灭 R1/R2/F1/F2/F12（确定性基底使其可合并为一个阶段，原 P1/P2 的拆分是为控制 lifecycle 方案的风险，基底更换后不再必要）；**P3a 紧随 P1**——prefetch 基础版已在 P1 就绪，递归扩展纯前端即可交付「多层嵌套」这个核心诉求，不等 P2/P3；P2 是产品决策 + 净删代码（classDef 主路径在此落地）；P3b/P3c 是后端与模型归一，放最后；P4 是战略决策不是任务。嵌套治理文档（embed-nesting-governance.md）的 E1 阶段（编辑视图侧）不依赖本方案任何阶段，可与 Spike 0 并行启动。

---

## 7. 测试策略（P0 详情）

**测试分两层**（禁 playwright）：

- **node 单测**（`tests/unit/diff/`，vitest）：model 纯函数（records 数量 / enhancement 状态 / scopePath / 区域所有权 / 循环防护）、fence 结构配对 + 加权配对 fallback、AnchorResolver 纯逻辑、settle 编排（fake timer：超时归因 / allSettled 语义 / destroy 取消）——毫秒级红灯，是"每个细节 bug 先变 fixture"的快反馈层。
- **ego-lite DOM/视觉断言**（`tests/e2e/git-render-fixture/`，headless）：data-dnote 锚定、mount 后无物化事务、截图快照（仅布局敏感场景）。

DOM/视觉 fixture 矩阵：

- 图类型 × 变更：flowchart / state / sequence（源码卡）/ **unknown**（降级）× 增节点 / 删节点 / 改标签 / 删整个 fence / 中途插入 fence（配对错位）/ **图语法错误（新版源码 broken → 降级路径 + 保证层卡兑底）** / **节点标签内 `[[ref]]` 变化（ref × diagram 交叉场景）**
- 多图文档：两个 fence 各有变更 → 断言各自 NodeView scope 的节点 class（现行 bug 用例）
- 嵌入：源文件改动 / 新增引用 / 删除引用 / 嵌套嵌入 / **多层嵌套（A 嵌 B 嵌 C，断言 B、C 各产 records 且 scopePath 正确）** / **循环引用（A 嵌 B 嵌 A → 折叠卡）** / 路径互为前缀的两个源文件 / **重复兄弟嵌入（A 嵌 B 两次 → 两处均渲染、源只 diff 一次）** / **嵌入源被删除断链 → 提示不报错** / **git rename（`![[a]]`→`![[b]]` 且 b 为 a 的改名）**；判定语义与折叠形态以 [`embed-nesting-governance.md`](embed-nesting-governance.md) 判定矩阵为准
- **write-once 断言**：mount 后监听 PM transactions，断言无 `replaceWith`/`setNodeMarkup` 改变 nodeSize 的事务（object_ref 消歧的等尺寸替换除外——单独断言其不改尺寸）
- 时序：变更图在视口外 → 不滚动也有图内标注（eager，P1 后应稳定）；未变更图懒加载不受影响
- 回归保护：表格分隔行噪音跳过、仅格式化说明卡、尾空段删除跳过
- 新鲜度：渲染后磁盘变化 → 重算提示
- 降级链：构造 Crepe 挂载失败 → `renderSplitFallback` 可用（主路径改造后不腐化）
- 其他（第六轮补入）：双 tab 并存两个 diff 渲染实例互不干扰；表格列换位（结构 diff 噪音基线观察用例）；**性能基准**：大文档（数百 KB）+ 5 个嵌入的 prefetch/model 耗时阈值断言（P0 建立，P1/P3a 验收引用）
- 断言层次：① records 数量与状态 + scopePath（模型层 node 单测，最硬）② data-dnote 装饰存在且锚定正确 + resolvePos 反查（DOM 层）③ 少量截图快照（视觉层，仅覆盖布局敏感场景）
- 截图快照脆弱性：golden 截图对字体/平台/mermaid 版本极敏感。约束：截图压缩到极少数 + 像素容差断言；**mermaid 版本在 lockfile 中 pin 写进契约**；DOM 断言全部基于结构选择器（`data-fence-id` / `data-dnote` / class），不基于视觉；视觉层只作回归护栏、不作主判，主判永远在模型层与 DOM 层。

**规则**：此后每个"细节 bug"先变成一个 fixture（红灯），再修（绿灯）。这是打断修修补补循环的机制本身。

**基建现状（第三轮核对）**：`package.json` 无 vitest 依赖；`tests/e2e/` 是散装 ego-lite 脚本（39 个，无统一 fixture runner、无数据驱动目录约定）。P0 第一步是补齐这两套基建（vitest + fixture runner + mock 批量端点），排期时按独立工作项计。

**范围裁剪（第六轮）**：fixture 首版 ≤ 15 个用例（优先级：已知 bug 固化 > 多层嵌套/循环 > 降级链 > 性能基准），矩阵其余项随对应阶段（P2/P3a/P3b/c）补入；vitest 仅覆盖 model 层纯函数（AnchorResolver / settle 编排用 fake timer 最小集）——先让安全网以最短路径存在，再随阶段加密。

---

## 8. 北极星：tracked-changes（P4 决策点）

**现状**：渲染模式是"第三个视图"——独立 readonly Crepe + 全局 overlay + 实例 Map + 专用连线逻辑，为其维护一整套平行体系。

**终局形态**：diff 内联进主编辑器（Word/Docs 式追踪变更）——

- 消灭 readonly Crepe + overlay + `renderInstances` Map 整条线；
- 连线/定位天然复用主编辑器 `coordsAtPos`；
- 批注抽屉本来就是为主编辑器设计的，diff 只是喂 tracked-changes 数据；
- 解锁"diff 态直接编辑/接受/拒绝改动"——**依赖事实（第五轮核实）**：`@milkdown/components` 已内置 `diffComponent`（ins/del 装饰 + 每处变更 accept/reject 按钮），配合 `@milkdown/plugin-diff` 的 `diffPlugin`/`startDiffReviewCmd`，P4 的基建已在依赖里装好，启动成本显著低于第四轮预估。

**触发条件**（满足其一再启动）：M18 P0–P3 落地后渲染 bug 率仍不可接受；或产品需要"接受/拒绝单处改动"能力。**在此之前，所有日常决策不向"第三个视图"继续堆复杂度**。

**P0–P3 投入的可复用性清单**（避免 P4 迁移时沉没）：

- **P4 直接复用**：`model.ts`（纯函数）、`ChangeRecord` 模型（id 内容派生，迁移后位置漂移但身份不变）、`prefetch.ts`（发现层）、`data-dnote` 装饰接口、`AnchorResolver` 的 `resolvePos`、settle 编排思想（主编辑器中 settle 退化为「diff 数据就绪」一个事件）；
- **P4 淘汰**：`renderer.ts` 的 readonly Crepe 编排与 doc 预填充（主编辑器 doc 已活，预填充不适用——这正是 §1.3 的边界：write-once 只属于快照视图）、自有 mermaid NodeView（主编辑器沿用组件 preview，届时图内标注需要附录 A 的 lifecycle 思路重新评估）、`overlay.ts` 的 DOM 图内标注、AnnotationDrawer 的 diff 专用连线分支。

判定原则：凡新模块优先设计成 view-agnostic；renderer/overlay/nodeview 明确标记为「thin adapter，P4 可弃」，不在其上堆业务逻辑。

---

## 9. 风险与回滚

| 风险 | 缓解 |
|---|---|
| Spike 0 预填充不兼容（`FileBlockView` 假定初始空内容等） | Spike 先行、不产生合入代码；失败 → 渲染基底回退附录 A，数据层骨架不变 |
| 自有 NodeView 与编辑器 preview 观感 divergence | 渲染代码零分叉（复用 `mermaid.ts` 函数）；Spike 0② 对比验证；仅挂载点与时机不同 |
| eager 渲染性能（变更图多的大文档） | eager 预算上限（20）+ 超限降级 lazy + 保证层卡；变更图典型 ≤3 张 |
| object_ref 消歧破坏「不改 doc 尺寸」前提（未来 schema 变化） | write-once fixture 断言红灯即报警；`tr.mapping` 保险仍在 |
| P1 时序重排引入新竞态 | P0 网先行；settle 是纯 promise 编排（fake timer 单测）；feature flag（`diff.pipeline`）一键回退旧行为 |
| P3 模型归一改变批注卡文案 | 文案快照进 fixture；契约规则不变即视为兼容 |
| 三后端（lib.rs / dev.ts / mock.ts）批量端点漂移 | mock 先行 + 三侧对齐清单设为 P3 前置工作项，与既有修复同批交付 |
| 渲染降级链（renderSplitFallback）路径少人走而腐化 | P1 改造波及处同步适配 + fixture 强制降级用例（构造 Crepe 挂载失败） |
| mermaid DOM 结构升级漂移导致 DOM class 手术（fallback）失效 | 主路径 classDef/class 源码注入对 DOM 漂移**完全免疫**（§4.8，第六轮）；fallback 失效 → scoped 降级到保证层（源码卡） |
| Spike 0③ classDef 样式不符预期（如 stateDiagram-v2 不支持 `class` 语句） | 图内标注回退 DOM class 手术路径（§4.3 diagram 策略），merged 源码产出与数据层不变 |
| 大文档 + 多嵌入的主线程耗时（computeDocDiff 字符级 LCS × 嵌套每层递归 + mermaid eager 渲染） | P0 性能基准用例建立阈值护栏；资源预算（§4.4.1-d）兑底失控场景；worker 化留作后续选项（模型层纯函数化后天然可迁移） |
| fence 结构配对在某类编辑模式下退化 | 加权配对 fallback 纯函数 + fixture（「两张同内容图」「中途插图」） |

**回滚**：每阶段独立合入；P1 有 feature flag（`diff.pipeline`）可回退旧行为；P2 删码前 tag 标记（`pre-m18-p2`）。渲染基底层面：Spike 0 失败在动工前回退附录 A；P1 合入后发现基底级问题，feature flag 回退 + 附录 A 的 lifecycle 模块按原文档规格实施（数据层不受影响）。

---

## 10. 与现有文档/代码的关系

- `doc/git-diff-rules.md`：**行为契约，除两处显式修订外不变**。M18 只换实现层；§4.8 的保留项均直接对应契约规则 5。例外修订（P2 落地时同步改文，避免"契约不变"的表述与实现自相矛盾）：
  1. 规则 1 的 mermaid 条目（"旧标签红划线 + 新标签绿"的图内表达）→ 修订为「图内标注由合并源码的 `classDef`/`class` 声明承载（mermaid 原生渲染）：新增节点绿、删除节点红（虚线划线）；标签修改 = 新值绿 + 旧值入批注卡 del 预览」；
  2. 规则 5 的 sequence 条目（"按 LCS 对齐顺序插回原位"的图内表达）→ 修订为「SVG 内不再标注；删除/新增消息由保证层源码逐行红绿卡承载（保序语义不变，表达位置改变）」。
- `doc/git.md` / `git-workbench.md`：功能文档，P3 后补"渲染模式架构"一节。
- [`embed-nesting-governance.md`](embed-nesting-governance.md)（新增，第六轮）：多层/循环嵌套的判定语义与折叠视觉形态（编辑视图 × diff 视图共用）——本方案 §4.4 嵌入递归、§4.4.1-a 预取层、P3a 均按其规定消费；其 E1 阶段（编辑视图侧）不依赖本方案任何阶段，可先行合入。
- 已知 git 后端 bug（discardHunk 索引错位、词级 diff 缺路径、quotepath 等）：**三侧后端对齐设为 P3 前置工作项**（对齐清单 + 三侧同步交付），`git_show_files` 批量端点作为其第一个产出——避免在漂移未治理时新增端点扩大漂移面（见 §4.7）。
- `raw/milkdown-source/`（上游组件源码镜像）：§4.1.2 对 `@milkdown/components` code-block 的 NodeView 优先级、`previewOnlyByDefault` 行为的核对基于此；自有 NodeView 不改库、只在自己的 Crepe 实例注入。

---

## 11. 第三轮评审记录（实现核对，2026-08-22）

对现实现逐文件核对（`render-diff.ts` / `diff-deco.ts` / `mermaid-diff.ts` / `mermaid.ts` / `ref/resolve.ts` / `manager.ts` / `AnnotationDrawer.vue`，及 `@milkdown/components` code-block 源码）后的结论与修订。修订已并入正文（第四、五轮的渲染基底更换不改变本轮诊断的事实性结论；F1/F2/F12 的裁决被第五轮的「消除」取代，留档原因见 §13）。此处留档裁决理由。

### 总体裁决

方案三大支柱与问题诊断（R1-R8）与代码事实完全对得上，诊断准确：轮询补标（0/400/1200/2500ms + 8s idle）、`querySelector` 永取第一张 svg、note 自持 from/to 绕过 mapping、sequence includes 兜底仍在（M16 注释声称已删但代码未删，实锤 R8 类静默偏差）、fence 下标配对。方向正确。

### 发现清单

| # | 发现 | 严重度 | 裁决（第五轮后） |
|---|---|---|---|
| F1 | `renderPreview` 钩子回调无栅栏身份；多 tab 可同时持有 diff 渲染实例 | **阻塞 P1** | ~~§4.1.1 content/occurrence 解析~~ → **被 §4.1.2 自有 NodeView 消除**（身份免费，问题不复存在） |
| F2 | 嵌入栅栏需异步物化后才存在；`Promise.race` 截断与生命周期模型冲突 | **阻塞 P1** | ~~§4.1.1-d 增量 settled~~ → **被 §4.1.1 预填充消除**（栅栏 mount 前已在 doc 中） |
| F3 | §4.8 删除幽灵旧值 vs 规则 1 要求图内"旧标签红划线"——契约表述自相矛盾 | 阻塞 P2 | 维持：定性为契约修订，P2 同步改 `git-diff-rules.md`（§10 扩展为两处） |
| F4 | 三引擎坐标空间不同，后验归并产出不可测 | 阻塞 P3 | 维持：`computeDocDiff` 作所有权主干（§4.4） |
| F5 | 嵌入扫描每源还有 1 次 `diffFile`，批量 show 解决一半 | 影响 P3 收益 | 维持：端点一并返回 hunks 标志 + hash（§4.7） |
| F6 | vitest 未引入、e2e 无 fixture runner——P0 基建不存在 | 影响 P0 排期 | 维持：基建列为独立工作项 + mock 批量端点先行 |
| F7 | P1 验收"嵌入物化后连线仍正确"在 P2 之前只能靠时机保证 | 验收措辞误导 | **被 §4.1.1 消除**：write-once 下 from/to 本就稳定 |

### 顺带确认的利好（无需改动）

- code-block 组件 `previewOnlyByDefault = config.previewOnlyByDefault ?? getReadOnly()`：diff 的 readonly 实例默认预览态，预览钩子一定会被调用；
- `mountRenderCrepe` 本就为每个 Crepe 单独构造 featureConfigs——自有 NodeView 的注入点现成，不需要改 components 库；
- `resolve.ts` 物化循环跳过 `materialized=true` 的块——预填充方案的可行性前提（第五轮复核确认）。

---

## 12. 第四轮评审记录（架构自审，2026-08-23）

在第三轮实现核对基础上，对方案自身做一次「架构空白」自审。修订已并入正文（其中 F9/F10/F13/F14 的裁决在第五轮延续有效；F12 的裁决被第五轮取代）。此处留档裁决理由。

> 注：阶段编号已按第五轮重排（原 P1/P2 合并为新 P1，原 P3→P2、P4→P3、P5→P4）；表中为当时的表述，按新编号读。

### 发现清单

| # | 发现 | 严重度 | 裁决（第五轮后） |
|---|---|---|---|
| F8 | R5「渲染 diff 测试数为 0」不准确——有 6 条存在性浅断言 | 影响 P0 论证 | 维持：§1.2 改为「覆盖为 0」 |
| F9 | 「model.ts 无 IO」与「嵌入递归产出 records」矛盾 | 阻塞 P3 | 维持：发现/预取层与 model 分两阶段，共享 source map（§4.4.1-a） |
| F10 | ChangeRecord 与 Decoration 关系未定义 | 阻塞 P3 | 维持：渲染视图装饰与批注卡同源（records）（§4.4.1-b） |
| F11 | AnchorResolver 放弃 coordsAtPos 有回归风险；滚动需要 pos 不是 rect | 影响 P1 | 维持：拆 resolvePos/resolveRect，prose rect 以 coordsAtPos 为主 |
| F12 | 「增量 settled」与「occurrence 身份解析」未形式化，会成新竞态源 | 阻塞 P1 | ~~状态迁移表 + occurrence 视口内消歧~~ → **第五轮消除**：§1.3 判定其复杂度源于「追逐组件时序」，被确定性管线整体取代（附录 A 留档原形式化作为回退规格） |
| F13 | 「置信度门槛」不可测量；fence 配对算法未定；所有权仲裁只有一句话 | 影响 P2/P3 | 维持并简化：白名单行语法；配对主路径改结构配对（§4.2）；所有权决策表（§4.4.1-c） |
| F14 | status 语义歧义；object_ref label 变化未覆盖；递归 diff 无资源预算 | 影响 P2/P3 | 维持：双维度（§4.5）；§4.9 补充；§4.4.1-d 预算 + eager 上限 |
| F15 | P5 与 P0-P4 投入的复用性未交代 | 战略 | 维持：§8 可复用性清单（第五轮更新） |
| F16 | 批量端点应在三后端漂移治理后绑定；新鲜度复核与批量 IO 相悖 | 影响 P3 | 维持并简化：mock 先行；新鲜度改内容指纹后直接复用批量端点返回的 hash（§4.6/§4.7） |

---

## 13. 第五轮评审记录（架构裁决，2026-08-23）

外部评审（含历代提交史复盘 + `@milkdown/plugin-diff`/`components` 依赖核实）后的架构层裁决。修订已并入正文，此处留档裁决理由。

### 总体裁决

数据层骨架（DocDiff 单一真相 / 分层承诺 / 测试网 / 降级可观测 / 批量 IO）达到可定稿水平；但渲染基底的最大押注——**用 lifecycle 状态机管理借来的异步组件**——延续了 M11c 以来「在自己不拥有的层上做手术」的模式（M17 成功正是换对了层）。diff 视图是只读快照，配得上 write-once 的确定性渲染管线：**把异步消灭掉，而不是驯服它**。裁决：骨架保留 × 渲染基底更换。

### 发现清单

| # | 发现 | 严重度 | 裁决 |
|---|---|---|---|
| F17 | lifecycle 方案（§4.1–§4.1.2 约 80 行状态机 + occurrence 解析 + 视口 IO + 增量 settled）是为「本可不存在的问题」建模——问题的存在性来自「借用活编辑器的渲染管线」这一前提本身 | 架构级 | §1.3 模式复盘；§4.1 重写为确定性管线；lifecycle 压缩为附录 A 回退规格 |
| F18 | `resolveRefs` 跳过已物化块（代码事实）→ 嵌入内容可 mount 前预填充，write-once 可行 | 利好 | §4.1.1 预填充方案；Spike 0① 验证 NodeView 兼容性 |
| F19 | `mermaid.ts` 渲染要素（render/escapeRefHash/linkifyMermaidRefs/wrapMermaidPreview）为现成纯函数 → 自有 NodeView 只是换挂载点，渲染代码零分叉 | 利好 | §4.1.2；Spike 0② 验证观感 |
| F20 | `patchMermaidFences` 按下标配对的根因层修复在结构 diff 里现成——computeDocDiff 的 code_block 替换天然给出新旧对应 | 影响 P1 | §4.2：结构配对主路径 + md 加权配对 fallback |
| F21 | 嵌入递归无环检测（MAX_DEPTH 是深度截断不是环检测） | 阻塞 P3 | ~~§4.4：发现层访问集防环 + 循环引用折叠卡~~ → **第六轮修正语义**：祖先链环检测 × 全局源去重分离，独立成文 embed-nesting-governance.md（§4.4 / §14 G2/G3） |
| F22 | `ChangeRecord.id` 自增序列在 freshToken 重算后变化 → 批注抽屉激活态/滚动丢失 | 影响 P3 | §4.2/§4.4：id = hash(scopePath+kind+op+内容) 内容派生 |
| F23 | 新鲜度「treeVersion → mtime」两级演进绕远：showFile/diffFile 已把内容拿回，hash 零成本且更精确 | 影响 P3 | §4.6：直接用内容指纹 |
| F24 | sequence 消息 SVG text 匹配是全链路最脆路径（删 includes 兜底后命中率进一步下降） | 影响 P2 | §4.8：sequence SVG 标注整体删除，源码卡承载（契约规则 5 表达位置同步修订） |
| F25 | `@milkdown/components` 已内置 `diffComponent`（ins/del 装饰 + accept/reject 按钮）——P5 基建已在依赖里 | 战略 | §8：P4 启动成本预估下调 |
| F26 | `renderSplitFallback` 与 `mountRenderCrepe` 共享，P1 改造会波及降级链 | 影响 P1 | §5/§6：同步适配 + fixture 强制降级用例 |
| F27 | mock 后端是 e2e fixture 运行时 → 批量端点 mock 先行可同时解锁 P0 数据驱动 fixture | 影响 P0/P3 | §4.7/§6：mock 实现列为 P0 基建 |
| F28 | classDef 源码注入的 M14 否决语境（标注语法污染往返）在 readonly 快照下不成立 | 备选记录 | ~~§4.8：不预先实现，作为 mermaid DOM 漂移时的免疫退路留档~~ → **第六轮升格为图内标注主路径**（§4.8 / §14 G1） |

### 评审结论

**通过（渲染基底更换 + 上述修订）**。执行顺序：Spike 0（1 天，两个 spike）→ 任一失败回退附录 A；通过则按 P0 → P1（原 P1+P2 合并）→ P2 → P3 → P4 执行。F18/F19/F20/F21/F22/F23/F24/F26 并入 P1/P2/P3 验收，F25/F28 为战略与备选记录。

---

## 14. 第六轮评审记录（外部评审采纳，2026-08-23）

独立评审（APP 全景 + 场景矩阵枚举 + M11→M17 历史复盘 + 方案空间发散：静态 HTML 渲染管线 / lifecycle / write-once / tracked-changes / classDef 源码注入 / AST 级 diff 六路对比）后的修订。修订已并入正文，此处留档裁决理由。

### 总体裁决

骨架与第五轮渲染基底裁决维持；三处修订：① **mermaid 图内标注主路径更换**——DOM class 手术是全链路唯一残留的「在自己不拥有的层上做手术」（§1.3 推论要求根除，M17 成功经验的完整贯彻）；② **嵌套视觉规模问题确认不属于 diff 视图独有**（编辑视图同样存在），独立成文解决，本方案改为消费方；③ **阶段节奏调整**（P0 裁剪、P3 拆分并前置多层嵌套交付）。

### 发现清单

| # | 发现 | 严重度 | 裁决 |
|---|---|---|---|
| G1 | DOM class 手术（渲染后按 gid 子串匹配加 class）仍是 mermaid DOM 结构的依赖——历史上每次 mermaid 升级悄悄坏掉的正是这一层；而 F28 已论证 classDef 否决语境（往返污染）在 readonly 快照下不成立，却把最强路径留作备选、最脆路径留作主路径 | 架构级 | §4.8：classDef/class 源码注入升格主路径（merged 源码尾部 class 声明，mermaid 原生渲染，模型层可断言源码文本）；DOM 手术降为 fallback；Spike 0 增设③ |
| G2 | 多层嵌套的视觉规模（全量内联展开 + 各层标注）不是 diff 独有问题，编辑视图同样存在；用户裁决：循环嵌套感知+提示不渲染、多层支持 10 层、超层提示不渲染 | 产品缺口 | 独立设计文档 [`embed-nesting-governance.md`](embed-nesting-governance.md)（共用 embed-chain 判定模块 + 折叠提示卡）；本方案 §4.4 / §4.4.1-a / P3a 按其语义消费 |
| G3 | 第五轮「访问集防环」混淆两个概念：环（祖先链命中）≠ 重复兄弟嵌入（合法，应正常渲染、仅源数据去重）——全局访问集会把 A 嵌 B 两次误折叠 | 阻塞 P3a | §4.4 修正：祖先链环检测 × 全局源去重两概念分离；embed-chain 判定矩阵单测覆盖 |
| G4 | P0 是纯投入期（fixture 框架 + vitest + mock 端点，合入前用户可见改善为零），原 fixture 矩阵全量铺开成本高 | 影响 P0 | P0 裁剪：fixture 首版 ≤ 15 用例 + vitest 仅 model 层；矩阵其余项随阶段补入（§6/§7） |
| G5 | P3 单阶段承载 6 个可独立交付项（模型归一/递归/批量端点/三后端对齐/新鲜度/预算），大爆炸风险 | 影响 P3 | 拆分 P3a（多层嵌套，**前置至 P1 后立即交付**——直接命中核心诉求）/ P3b（IO 批量 + 对齐）/ P3c（模型归一 + 新鲜度） |
| G6 | fixture 矩阵遗漏交叉/边界场景：图语法错误、mermaid 标签内 ref 变化、嵌入源被删除断链、git rename、双 tab 并存、表格列换位 | 影响 P0/P2 | §7 矩阵补入 |
| G7 | computeDocDiff 字符级 LCS × 嵌套每层递归全在主线程同步执行，大文档无度量 | 影响 P1/P3a | P0 建性能基准用例（阈值断言）；§9 增风险行；worker 化留作后续（模型层纯函数化后天然可迁移） |
| G8 | Spike 0① 只验证 FileBlockView 兼容，未覆盖「离线构造 doc（parse → 递归 replaceWith）」的实现路径本身 | 影响 P1 | Spike 0① 范围扩至离线 doc 构造验证 |
| G9 | 文本视图批注卡改由 ChangeRecord 产出（原则 2 后半）耦合成本大于收益 | 影响 P3 | 降级为 P3c 可选项，可等 P4 一并收编 |

### 评审结论

**通过（按上述修订执行）**。执行顺序调整为：**Spike 0（三个 spike，约 1.5 天）→ P0（裁剪版）→ P1 → P3a（多层嵌套，前置）→ P2 → P3b → P3c → P4 决策点**。嵌套治理文档 E1（编辑视图侧）不依赖本方案任何阶段，可与 Spike 0 并行启动。

---

## 附录 A：备选渲染基底——lifecycle 事件驱动（spike 失败回退规格）

> 本附录为第四轮稿 §4.1–§4.1.2 的压缩留档。**仅当 Spike 0 任一失败时启用**；启用时数据层骨架（§4.2 装饰身份 / §4.4 DocDiff / §4.5–§4.9）不变，仅渲染编排不同。

核心思路：继续借用 `@milkdown/components` code-block 的 preview 面板，用**每渲染实例一份的 RenderLifecycle** 管理其异步完成：

- **事件源**：`mountRenderCrepe` 包装本实例的 `'code-mirror'` featureConfig 的 `renderPreview(language, text, applyPreview)`——完成时机取自回调，身份由 `(content, occurrence)` 纯函数解析（内容索引 + 出现次数消歧；occurrence 仅对视口内已渲染单元计数，离屏单元进入视口后再绑定）；
- **状态机**：`waiting-viewport`（离屏，自有 IntersectionObserver 驱动迁移）→ `rendering` → `done/degraded/failed`；5s 超时仅对 `rendering` 态判 degraded，`waiting-viewport` 继续等待；
- **增量 settled**：嵌入栅栏二段登记（`embed:<path>` markDone 时登记该 scope 栅栏）；settled 后新增 track 重估并重启一次兜底计时；断链 file_block 判 failed 不挂起 settled；
- **配套约束**：lifecycle 每实例闭包注入（禁模块级单例，多 tab 并存）；DOM 序映射只作校验不作主路径；删除 `Promise.race` 截断。

该方案的已知残留风险（第四轮风险表）：mermaid 版本行为差异、occurrence 乱序滚动错位、事件源不全——均靠超时归因 + fixture 兜底而非根治，这正是第五轮弃用它的原因。
