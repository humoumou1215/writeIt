# Git Diff 渲染测试案例整理

> 定位：git diff「渲染模式」测试全清单——什么场景、断言什么渲染结果。
> 行为契约见 [`doc/git-diff-rules.md`](git-diff-rules.md)（规则 1–8），架构设计见 [`editor-app/docs/git-render-arch-m18.md`](../editor-app/docs/git-render-arch-m18.md)。
>
> 测试载体：
> - **单测（vitest + jsdom）**：`editor-app/tests/unit/diff/model.test.ts`（DocDiff 模型层）· `editor-app/tests/unit/diff/prefetch.test.ts`（嵌入预取层）——纯函数层，断言「模型算对了」。
> - **e2e（ego-lite / ego-browser 驱动真实 Chromium）**：`editor-app/tests/e2e/git-m18-fixture-e2e.js`（M18 确定性渲染管线）· `git-m11a-e2e.js`（IPC mock 全流程）· `git-m11a-smoke.js`（浏览器 mock 演示仓库）——DOM 层，断言「渲染出来的效果」。
>
> 渲染效果术语对照：`.diff-del` = 红色划线删除（文本划线）、`.diff-ins` = 绿色新增、`.ad-card` = 批注卡片（「改动说明」只读卡）、`.annotation-connector-path` = 卡片连线、`.ref-file-block` = 嵌入卡片、`classDef diffAdd/diffDel` = mermaid 图内绿/红。

---

## 一、单测层（模型正确性）

### 1.1 `tests/unit/diff/model.test.ts`（M18 P0 fixture 网）

#### A. 栅栏配对 `pairFences`（mermaid 代码块身份配对）

| 测试场景 | 输入 | 预期效果 |
|---|---|---|
| 普通对应 | 旧/新各两图，内容相同 | 按序配对 `[0↔0, 1↔1]` |
| 中途插入新图 | 旧 `[A-->B, C-->D]`，新 `[A-->B, X-->Y, C-->D]` | 插入图 `X-->Y` → `oldIdx=null`（**新增**，不产 diagram 标注，块级新增表达）；后续 `C-->D` **正确归位**到旧 1（下标漂移免疫） |
| 两张同内容图（重复） | 旧/新各两图内容均为 `A --> B` | 按序配对 `[0↔0, 1↔1]`，不误折叠、不重复标注 |
| 整段删除旧栅栏 | 旧 2 图 / 新 1 图 | 多出的旧栅栏不匹配任何新栅栏（走删除表达） |
| 内容变更仍配对 | 同图改标签 `A["旧标签"]-->B` → `A["新标签"]-->B` | 相似度评分配对成功 `oldIdx=0`（同图识别，为后续节点级标注做准备） |

#### B. 嵌入环判定 `classifyEmbed`（治理文档判定矩阵）

| 测试场景 | 预期效果 |
|---|---|
| A 嵌 A（自嵌） | `{kind:'cycle'}` |
| A 嵌 B 嵌 A | cycle（链根含宿主） |
| A 嵌 B 嵌 C 嵌 B | cycle 命中**祖先**（非宿主） |
| 兄弟重复（A 嵌 B ×2） | ok（不是环） |
| 第 10 层 / 第 11 层 | 10 层 ok；11 层 `too-deep`（`MAX_EMBED_DEPTH` 上限） |
| 路径互为前缀（`数据/需求` vs `数据/需求表`） | 精确比较不误判为环 |

#### C. 内容派生身份 `recordId` / `fenceIdOf`

| 测试场景 | 预期效果 |
|---|---|
| 同一记录两次计算 | id 相同；内容不同 → id 不同（稳定指纹，供连线/去重） |
| fence 同 body（含尾换行） | `fenceIdOf` 稳定（`A-->B` === `A-->B\n`），不同 body 不同 |

#### D. DocDiff 模型 `computeDocDiffModel`（核心）

| 测试场景 | 输入 | 预期效果（渲染素材层面） |
|---|---|---|
| mermaid 增节点 | 旧 `A-->B` / 新 `A-->B, C-->D` | 产出 diagram record、`enhancement:'ok'`、`fences.changedCount=1`、fence `changed/ eager=true`、`f.add` 含 `C` |
| mermaid 删节点 | 旧 `A-->B, C-->D` / 新 `A-->B` | `mergedMd` **含 `classDef diffDel` + `class C,D diffDel`**（合并源码承载删除，mermaid 原生渲染红）；`f.del` 含 `C` |
| mermaid 标签修改（mod） | `A["旧名"]` → `A["新名"]` | `mergedMd` 含 `class A diffAdd`（新值绿）；diagram summary「新增 1 个节点」（旧值入批注卡 del 预览） |
| 新栅栏中途插图 | 新旧各三图，第二张为新增 | 不产 diagram（块级新增由 text 记录承载）；`C-->D` 归位后不误标 |
| graph 语法错误（新版 broken） | 新版 `A---- B` / `++[unclosed` | 不抛错、`mergedMd>0`；diagram `enhancement` 不承诺图内标注（保证层卡兜底） |
| 文本/块级新增 | 两段间插入「中间插入」 | text/block record：op=add、summary 含「新增」、`rec.new` 含文案、`location.from ≥ 0`、`id` 以 `dn-` 开头 |
| 表格分隔行噪音 | 仅 `---` → `---:` / `:---:` 列宽对齐 | **无任何记录**（规则 3：语法行永不标记、不产卡） |
| 嵌入源有改动 | 宿主 `![[notes/A]]`，源文件 old≠new | embed record，`scopePath='notes/A.md'`（源真实路径）、summary 含「嵌入「A.md」」 |
| 循环引用折叠 | 宿主嵌 `![[B]]`，B 嵌 A 嵌 B | 保证层 embed record：op=del、summary 含「循环引用 … 已折叠」 |
| 引用路径变化 | `[[笔记/乙]]` → `[[笔记/丙]]` | **ref 删旧 + 增新两条记录**（规则 1 二元化） |
| `freshToken` 内容指纹 | 同输入两次 / 不同输入 | 相同输入令牌一致；不同输入 `nextHash` 不同（缓存失效判定） |

#### E. mermaid 合并 `patchMermaidFences`（M18 配对 + merged 重建）

| 测试场景 | 输入 | 预期效果 |
|---|---|---|
| 删除节点加回 + classDef | 旧 `A-->B, G-->H` / 新 `A-->B` | `mergedMd` 含 `G-->H`（**保序保拓扑加回**）+ `classDef diffDel`；notes 含「删除」说明（规则 5） |
| sequence 消息变更 | 旧 `旧消息`+`保留` / 新 `新消息`+`保留` | 源码逐行红绿承载：`add` 含新消息、`del` 含旧消息；merged **不含旧消息、不含 `classDef diff`**（M18：SVG 内不再标注，改保证层源码卡对比） |
| 无法识别的图类型 | `python` 代码块 | `type:'unknown'`、merged = 新源码原样 |

#### F. eager 预算上限（§4.1.2：变更图 ≤3，上限 20）

| 测试场景 | 预期效果 |
|---|---|
| 4 张变更图、预算 3 | `changedCount=4`；exactly 3 个 fence eager、1 个降级 lazy（`skip`）；出现 `degradeReason:'eager-budget-exceeded'` 的保证层降级记录 |

#### G. mermaid diff 文案（宿主与嵌入块共用，二元语义）

| 测试场景 | 预期效果 |
|---|---|
| 增 4 删 2 | 一张卡同时报「新增 4 个节点」「删除 2 个」（不拆黄） |

### 1.2 `tests/unit/diff/prefetch.test.ts`（预取层：嵌入源发现/批量 IO）

| 测试场景 | 预期效果 |
|---|---|
| 第一层嵌入有改动 | `sourceMap` 含 `笔记/A.md`、`changed=true`、`mergedMd='新内容\n'`（写卡素材）；**无改动不入 sourceMap** |
| mermaid 有结构变化 | 嵌入卡素材 `mergedMd` 带 `class C,D diffDel`（卡片内容级标注材料） |
| 多层嵌套 A→B→C | 每层各入 sourceMap（`B.md` + `C.md`），`writePath→realPath` 映射齐全 |
| 循环引用 A 嵌 B 嵌 A | 进 `collapsedScopes`（reason=cycle、chain 完整），**不入 sourceMap** |
| 兄弟重复嵌入 `![[B]]`×2 | 两处 writePath 映射完整；sourceMap 按 realPath **全局去重只存 1 份**（只 diff 一次） |
| 断链（old/next 均不可读） | `brokenPaths` 标记，不报错 |
| 超深（11 层） | `collapsedScopes` 出现 reason=depth 的折叠标记 |

---

## 二、e2e 层（渲染效果——DOM 断言）

### 2.1 `git-m18-fixture-e2e.js`（M18 确定性渲染管线 fixture，mock 后端）

覆盖：write-once / 自有 mermaid NodeView / data-dnote 锚定 / 嵌入预填充 / 徽标 / 循环折叠卡 / 批注抽屉。

| # | 测试场景 | 渲染出来的预期效果 |
|---|---|---|
| 1 | README diff 主路径（mermaid + 嵌入 + 引用） | 装饰态：**`.diff-ins` > 0**（结构 diff 渲染）、**`[data-dnote]` 锚点存在**（内容派生身份 = 连线锚） |
| 2 | 自有 mermaid NodeView | `.diff-mermaid-fence` 挂 **`data-fence-id`**；**SVG 数 ≥ 栅栏数**（变更图 eager 渲染，不等滚动） |
| 3 | classDef 主路径 | **SVG 内出现 `.diffAdd` class**（mermaid 原生 classDef 渲染，非 DOM 手术） |
| 4 | 嵌入预填充 | 卡片内容非空（write-once 物化，mount 前填入） |
| 5 | 嵌入内容级 diff | **卡片内部也有 `[data-dnote]` 装饰**（源文件改动带偏移标注进卡） |
| 6 | 嵌入徽标 | 「内容有改动」角标 `.ref-embed-diff-badge` 出现 |
| 7 | 循环引用折叠（P3a，环测试/甲） | 折叠卡 `.ref-file-block[data-collapsed]` ≥1、提示文案含「循环引用」 |
| 8 | 批注抽屉 | 「改动说明」`.ad-card` > 0（diff 记录全部转批注卡） |

### 2.2 `git-m11a-e2e.js`（IPC mock 模拟真实 git 仓库全流程）

覆盖：面板 + 文本/渲染双模式 + 导航 + 还原 + 分支 + Esc。

| # | 测试场景 | 渲染出来的预期效果 |
|---|---|---|
| 1 | Git 面板基本态 | 分支徽标 main；分支 3 项；工作区 2 文件；历史 2 提交；HEAD 提交自动展开含 2 文件 |
| 2 | 工作区文件 → diff 视图 | viewMode=diff、`.git-diff-view`；路径/基准「工作区 vs HEAD」；统计 `+12 −3` |
| 3 | 默认渲染模式激活 | 工具栏「渲染」active（M11c 起默认渲染） |
| 4 | **文本模式**：hunk 与行级 | `.hunk-meta` 含 `@@`；**删除行 `.cell.del`**（旧版本列表）、**新增行 `.cell.add`**（新版本列表）；mermaid 上下文行渲染 |
| 5 | **分栏布局**（默认左旧右新） | `.diff-row.split`；del 行仅左栏 |
| 6 | **词级高亮** | `.word-del` 含「版本」（红划线细分）、`.word-add` 含「版本」；mermaid 修改对 `A-->B→C` **词级：`B` 带 word-del 划线** |
| 7 | hunk 折叠 | 「相同 14 行」折叠条 → 点开变「收起」 |
| 8 | 统一视图 `Ctrl+Shift+U` | `.diff-row.unified` > 0，词级保留；再按回分栏 |
| 9 | **M13 渲染模式（核心）** | 组合 md 渲染：`.diff-del/.diff-ins` 同时存在；**行内修改 = 删除字划线（.diff-del 含「旧」）+ 新增字绿底（.diff-ins 含「新」）** |
| 10 | M13 mermaid / 嵌入 | `.render-host svg` 图渲染；`.ref-file-block` 嵌入卡片渲染 |
| 11 | 批注抽屉 | 「改动说明」卡 `.ad-card-title` ≥1 |
| 12 | 点批注卡 | `.ad-card.read-only` 点击 → `.active`（激活态） |
| 13 | F7 导航 | 不崩溃（diff 视图仍在） |
| 14 | 源码模式三态互斥 | `Ctrl+E` diff→source（`.source-ta`）；再按回 wysiwyg（`.milkdown` 恢复渲染） |
| 15 | Esc 退出 diff | 回编辑（`.git-diff-view`=0） |
| 16 | 提交文件 diff | 基准「父提交」；`.cell.add` 含「提交中新增」 |
| 17 | 范围对比（Shift+点击） | 范围条 `.range-bar`；label 形如 `a..b`；范围 diff 渲染「范围新一」、基准含 `..` |
| 18 | 还原 | 「还原…」按钮 + hunk「还原此段」；确认框 → 还原后退出 diff + toast「已还原」 |
| 19 | 标签右键「Git 改动」 | 右键菜单项 → 打开 diff |
| 20 | 分支切换 | 确认框 → 徽标更新为 `feature/xxx` |
| 21 | 无页面错误 | `L.errors()` 为空 |

### 2.3 `git-m11a-smoke.js`（浏览器 mock 演示仓库——渲染效果最全）

覆盖：README（行内/纯删纯增/词级/嵌入/ mermaid 节点级/批注卡连线）+ 会议纪要 + 需求表 + 文本模式。

| # | 测试场景 | 渲染出来的预期效果 |
|---|---|---|
| 1 | Git 面板（演示仓库） | 分支 main + `feature/图表优化`；工作区 3 文件；历史 4 提交（含分叉/合并） |
| 2 | README 行内标注总量 | `.diff-ins ≥ 3`、`.diff-del ≥ 2` |
| 3 | **纯删除块** | `.diff-del` 含「旧版本说明」（整段红划线回显） |
| 4 | **纯新增段** | `.diff-ins` 含「消息通知模块」 |
| 5 | **词级修改** | `.diff-ins` 含「与权限」（改词绿底） |
| 6 | 嵌入卡片 | `.ref-file-block ≥ 2`；**「内容有改动」角标 ≥ 2** |
| 7 | **mermaid 节点级**（滚动到图，IO 懒加载） | 修改节点 = **新节点绿（.diff-node-add 含「授信成功」）+ 旧值红删除节点（.diff-node-del 含「支付成功」）双渲染**；新增/删除节点 class 各自 ≥1 |
| 8 | 批注抽屉 | 「改动说明」卡 ≥5；卡文本含 mermaid「流程图」变更说明（语义摘要进卡） |
| 9 | **批注卡连线** | 点卡 → `.annotation-connector-path` 的 `d` 属性 >10 字符（**抽屉左缘到锚点的连线出现**）+ 卡 active |
| 10 | 会议纪要 | 新增议题 `.diff-ins` 含「消息通知需求收集」；备注词级改「不做」→「下期排期」（两个断言同时成立） |
| 11 | 需求表（**单元格级**） | 「待评审→评审中」：`.diff-del` 含「待」+ `.diff-ins` 含「中」（单元格内词级）；新增行 `.diff-ins` 含「消息通知」 |
| 12 | 文本模式 | 分栏 + word-del/word-add + hunk 还原按钮 |
| 13 | Esc 退出 / 无页面错误 | diff 视图关闭；errors 为空 |

---

## 三、按用户可见效果的分组速查

| 效果 | 断言载体 | 覆盖测试 |
|---|---|---|
| **文本划线（删除）** | `.diff-del`（行内红划线）、`.cell.del`（文本模式整行）、`.word-del`（词级细分） | model.test.ts D 全部渲染素材；m11a-e2e #4/6/9；smoke #2/3/5/10/11 |
| **新增绿** | `.diff-ins`、`.cell.add`、`.word-add` | model.test.ts（text/block/ref 记录）；m11a-e2e #9；smoke #2/4/5/10/11 |
| **批注卡片** | `.ad-card`（「改动说明」只读卡）、卡片文案（增/删计数、mermaid 变更说明、折叠提示） | model.test.ts D/E/G（卡文案来源）；m18 #8；m11a-e2e #11/12；smoke #8 |
| **卡片连线** | `.annotation-connector-path` 的 `d` + `.ad-card.active` | smoke #9；m11a-e2e #12（激活态） |
| **嵌入卡片** | `.ref-file-block` + 内容预填充 + 卡内 data-dnote + 徽标（新增/内容有改动） | prefetch.test.ts 全部；model D（embed 记录）；m18 #4-7；smoke #6 |
| **mermaid 节点级** | SVG 内 `.diffAdd/.diffDel`（classDef 原生渲染，M18 主路径）；`.diff-node-add/.diff-node-del`（DOM 手术 fallback/旧路径） | model E/F（合并源码素材）；m18 #2/3；smoke #7；m11a-e2e #6（词级） |
| **结构/身份锚定** | `data-dnote`、`data-fence-id`、`recordId/fenceIdOf`、`freshToken` | model.test.ts C/D；m18 #1/2/5 |
| **环/超深折叠** | 折叠卡 `data-collapsed` + 提示文案 + collapsedScopes | model B；prefetch（cycle/too-deep）；m18 #7 |
| **降级** | eager 预算降 lazy + degradeReason、graph 语法错误不误标、断链 brokenPaths、unknown 图 | model F/E；prefetch 断链 |
| **噪音跳过** | 表格分隔行/列宽对齐无任何记录 | model D（表格分隔行测试） |

---

## 四、运行方式

```bash
cd editor-app
npx vitest run tests/unit/diff/model.test.ts tests/unit/diff/prefetch.test.ts   # 单测
npm run dev                                                                       # 先起 dev server :5173
node tests/e2e/_run-one.js git-m18-fixture-e2e   # 或 git-m11a-e2e / git-m11a-smoke
npm run test:e2e                                 # 全量回归（含上述三个套件）
```

> 注意：`git-m18-fixture-e2e` 是新增管线（write-once doc / eager NodeView / classDef 主路径），断言以**结构选择器**为主、不做视觉主判；M11a/smoke 覆盖的都是行为契约层面「对外效果」的既有断言。