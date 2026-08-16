# Milkdown Note — 模板与引用机制设计文档

> 状态：设计定稿（v0.1，M1-M4 已实现）｜ 范围：设计文档 + 实现进展记录
> 里程碑：M1–M10 已实现（最新：M10 template→.template / Mermaid 引用，2026-08-15）
> 下一步：**M11 Git 工作台** → 见 [git-workbench.md](git-workbench.md)（设计已定稿）
> 前置知识：Milkdown（Crepe）节点 schema / SlashProvider / NodeView / ProseMirror decorations

---

## 1. 背景与目标

在 Milkdown Note（Tauri + Vue 3 + Crepe）中引入：

1. **模板机制**：工作区/全局模板域，支持"插入模板"与"基于模板新建文件"
2. **校验机制**：每个模板携带校验规则，校验结果以"文档内标注 / 面板聚合 / 报告落盘"三通道呈现
3. **引用机制**：Obsidian 风格 `[[...]]` 语法，支持"文件名链接 / 整文件块嵌入（可编辑与只读）/ 模板对象引用"三类
4. 与 Milkdown 源码能力对齐（`$nodeSchema` 自定义节点、`SlashProvider` 多 trigger、NodeView、decorations、容器块嵌套）

## 2. 术语表

| 术语 | 含义 |
|---|---|
| 模板域 | `<根>/template/<name>/` 目录，含模板 md 与配套 TS 文件；**可信区** |
| doctype | 模板文件首行 `doctype:<name>`，标识模板身份、弱化只读渲染 |
| rules.ts | 模板的校验规则文件（TS） |
| suggest.ts | 模板的联想说明文件（TS），定义可被引用的对象 |
| 物化 (materialize) | 把 `![[path]]` 标记解析为容器内实际内容的过程 |
| 写回 (write-back) | 嵌入块编辑内容随保存事务写回源文件 |
| resolve 两段式 | 解析时先建暂态节点，异步读取文件后定型 |

## 3. 总体架构

```
数据层（模板域，可信区）
  template/<name>/<name>.md     模板本体（首行 doctype:<name>）
  template/<name>/<name>.rules.ts   校验规则（TS）
  template/<name>/<name>.suggest.ts 联想说明（TS）

语法层（Markdown 为唯一真相）
  doctype:<name>                    → doctype 节点（弱化、只读）
  [[笔记/会议记录]]                 → file_ref（文件名链接）
  [[笔记/会议记录#标题]]            → file_ref + fragment（Obsidian 标题链接，跳转）
  [[笔记/会议记录#greeting]]        → object_ref（模板对象，字符串展示）
  ![[笔记/会议记录]]                → file_block（整块嵌入，可编辑）
  ![[笔记/会议记录|ro]]             → file_block（整块嵌入，只读）
  \[\[ … \]\]                       → 转义，纯文本

运行层（应用内服务）
  TemplateService  模板扫描/注册/插入/新建
  ValidateService  校验执行 + decorations 标注 + 面板 + 报告
  RefSyncService   引用解析（两段式）、物化、写回事务、断链/环处理
```

## 4. 模板机制

### 4.1 目录结构

```
<workspace>/template/
└── demo/
    ├── demo.md            # 首行 doctype:demo
    ├── demo.rules.ts      # 校验规则
    └── demo.suggest.ts    # 联想说明（可缺省）
<global>/templates/        # 全局模板域（设置中配置路径）
    └── …                  # 同构；优先级 工作区 > 全局，同名模板工作区覆盖
```

启动时 `TemplateService` 扫描两个域，建立注册表 `{ doctype → { md, rules, suggest } }`。
新建文件时选择模板 → 复制 `demo.md` 内容为新文件；插入时把模板内容实例化到光标处。

### 4.2 配套文件语言：TypeScript（决策：模板域 = 可信区）

**安全模型**：模板目录视为项目可信配置（等价于 ESLint/nuxt.config 的信任级别）。
- 模板文件由**应用所有者/受信作者**维护，不来自不可信输入
- `rules.ts / suggest.ts` 由应用**动态加载执行**（详见 §10 技术风险：esbuild-wasm 转译 + 隔离执行）
- 被引用的**数据文件**（笔记内容）永远只按 Markdown 解析，不执行任何代码 —— 信任边界在"模板域"，不在"内容"

**API 设计（类型签名）**：

```ts
// template/demo/demo.rules.ts
import type { ValidationContext, Rule } from '@milkdown-note/validate'

export const mode: 'hint' | 'strict' = 'hint'        // 默认不阻止保存
export const report = { enabled: true, path: '.validate/report.md' }
export const rules: Rule[] = [
  {
    id: 'table-acceptance',
    label: '需求表：前置列非空则后置列必填',
    run(ctx: ValidationContext) {
      const table = ctx.findTableAfterHeading('## 需求')
      if (!table) return ctx.violation('缺少「需求」表格')
      table.dataRows().forEach((row, i) => {
        const prev = row.cell(0).text().trim()
        const next = row.cell(1).text().trim()
        if (prev && !next) {
          ctx.violationAt(
            row.cell(1).pos,                       // decorations 标注位置
            `第 ${i + 1} 行：第 1 列已填写，第 2 列不能为空`,
            'warning'
          )
        }
      })
    },
  },
]
```

```ts
// template/demo/demo.suggest.ts
import type { SuggestContext, SuggestObject } from '@milkdown-note/suggest'

export const objects: SuggestObject[] = [
  {
    id: 'greeting',
    label: '问候语',
    resolve(ctx: SuggestContext): string | null {
      return ctx.findText(/^你好/)?.[0] ?? null     // 取模板中第一个匹配段落的文本
    },
  },
  {
    id: 'version',
    label: '版本号',
    resolve(ctx) {
      return ctx.headingText(2, /^版本/) ?? null
    },
  },
]
```

`ValidationContext` 提供结构查询工具（定位表格/标题/块、单元格文本与位置、计数、正则、anyOf/allOf 组合、`check: [注册校验器, args]` 逃生口）——跨列条件、计数、复合条件全部在 TS 里自然表达，无需 DSL 兜底。

### 4.4 模板注册进斜杠菜单（决策：`/` 新增 template 组）

Crepe 的 BlockEdit 菜单基于 `GroupBuilder`（源码 `block-edit/menu/config.ts`），并提供 `config.buildMenu(groupBuilder)` 扩展点。应用在启动时把全部模板注册为一个 **template 组**（label「模板」），每个模板一个菜单项：

```ts
new Crepe({
  features: {
    [Crepe.Feature.BlockEdit]: {
      buildMenu(builder) {
        const group = builder.addGroup('template', '模板')
        for (const tpl of templateService.list()) {
          group.addItem(`template-${tpl.doctype}`, {
            label: tpl.name,
            icon: templateIcon,
            onRun: (ctx) => insertTemplateAtCursor(ctx, tpl),
          })
        }
      },
    },
  },
})
```

选中模板 = 在光标处**实例化**模板内容（占位符显示为 chip）。新建文件的入口在文件树右键菜单（「基于模板新建」）。

### 4.5 使用方式与占位符

- **插入模板**：光标处实例化（复制内容，与模板无链接关系），`{{title}}` 等占位符**原样显示**（渲染为高亮 chip），不弹窗替换
- **新建文件**：选择模板 → 新文件继承 `doctype`，自动关联 rules/suggest
- v1 **不做**：模板继承（extends）、目录级模板（整棵复制）→ v2

## 5. 校验机制

### 5.1 时机（可配置，默认全开）
- 打开文档时（异步）
- 保存前（strict 模式下失败可阻止保存）
- 编辑防抖实时（默认关闭，大文档建议关）

### 5.2 三通道呈现
| 通道 | 实现 | 说明 |
|---|---|---|
| 文档内标注 | **ProseMirror decorations** | 违规位置叠加"⚠ 说明"，不改动文档本身，保存即消失 |
| 聚合面板 | 侧边栏底部/状态栏 | 列出全部违规，点击跳转 |
| 报告落盘 | `report.path` 声明 | 输出 markdown 报告，供归档/CI |

### 5.3 严格度
- `mode: 'hint'`（默认）：仅提示与标注，**不阻止保存**
- `mode: 'strict'`：保存前校验失败给出确认（可配置为强制阻止）

### 5.4 与引用的交互
- `file_block` 物化内容**不参与宿主文档校验**（其内容属于源文件，按源文件自身 doctype 校验）
- `object_ref` **不参与实时校验**（决策）；引用时找不到对象 → 视为不存在（断链处理，见 §6.9）

## 6. 引用机制

### 6.1 语法表

| 语法 | 节点 | 渲染 | 写回 |
|---|---|---|---|
| `[[笔记/会议记录]]` | file_ref {path} | 文件名 chip，点击打开 | 否 |
| `[[笔记/会议记录#标题]]` | file_ref {path, fragment} | 文件名#标题，点击跳转标题 | 否 |
| `[[笔记/会议记录#greeting]]` | object_ref {path, object} | 对象当前值字符串 | 否 |
| `![[笔记/会议记录]]` | file_block {path, readonly:false} | 卡片 + 内嵌全部块（可编辑） | 是（随保存） |
| `![[笔记/会议记录\|ro]]` | file_block {path, readonly:true} | 卡片 + 只读徽标 | 否 |
| `\[\[` / `\!\[\[` | 文本 | 原样 | — |

### 6.2 `#` 消歧（Obsidian 兼容为默认）

解析 `[[path#xxx]]` 时：
1. 目标文件**存在 suggest.ts 且定义对象 `xxx`** → `object_ref`
2. 否则 → **Obsidian 标题链接**（`file_ref` + fragment，点击打开文件并滚动到该标题）

即：无 suggest 规则时天然兼容 Obsidian；有 suggest 时优先模板对象。两者都不命中 → 断链处理。

### 6.3 节点设计（ProseMirror schema）

```ts
// 均通过 $nodeSchema 注册，附 parseMarkdown / toMarkdown
doctype    : block atom,   attrs { value }                       // 首行 doctype:<name>
file_ref   : inline atom,  attrs { path, fragment? }             // [[…]]
object_ref : inline atom,  attrs { path, object, resolvedText? } // [[…#obj]]
file_block : block,        content: 'block+',                    // ![[…]]
             attrs { path, readonly: boolean }
```

- `file_block` 的 `toMarkdown` 只输出 `![[path]]`（或 `![[path|ro]]`）**标记行**，不落盘物化内容 → 单一真相源
- `doctype` 渲染弱化（灰色、小号、徽标），`contenteditable=false`，不可删除（删除需转为普通文本的操作，v1 仅只读）

### 6.4 两段式解析（resolve）

`[[path#xxx]]` 的消歧、`![[path]]` 的物化都需要**读文件（异步）**，而 Milkdown 解析是同步的。设计：

1. **解析阶段（同步）**：按语法生成**暂态节点**（file_block 空容器 / ref 带 `kind: unknown`）
2. **resolve 阶段（异步）**：`RefSyncService` 遍历暂态节点 → 读目标文件（缓存）→ 判定 suggest 对象 / 标题链接 / 断链 → 定型节点；`file_block` 物化内容填充容器

保存时只序列化标记行，与物化状态无关，因此两段式对磁盘内容无副作用。

### 6.5 触发规则（决策已确认）

| 触发 | 位置规则 | 产出 |
|---|---|---|
| `@` | **边界感知**：块首或前一字符为空白时才触发（避免中文/邮箱误触，如“联系@小明”不触发） | 菜单：链接 / 嵌入 / 嵌入只读 |
| `[[` | **任意位置**触发 | 链接（含 `#对象/标题` 消歧） |
| `![[` | **任意位置**触发 | 嵌入（`\|ro` 只读变体） |
| `\[\[` | 转义 | 纯文本 |

**嵌入自动劈分**：`![[path]]` 是 block 节点（`group: 'block'`），不能在段落文本内。若光标位于段落中间，插入事务自动劈分段落为三段：`前段 \| 嵌入块 \| 后段`（ProseMirror 事务 split + replace，schema 决定，非自定义行为）。

### 6.6 触发与菜单流程（三级递进，v2 定稿）

- `SlashProvider` `trigger: ['@', '[[', '![']`（源码原生支持多 trigger；`![[` 前缀直接进入嵌入模式）
- 菜单**保留 slash 视觉语言**（同款样式/键盘交互），但内容结构为三级递进（文件树 + 模式选择器 + 实体级），不再三组重复文件列表

**三级结构**：

```
┌───────────────────────────────────────┐
│ [链接] [嵌入] [嵌入只读]   ← 模式选择器（Tab/←→ 切换）│
├───────────────────────────────────────┤
│ 📁 笔记 ▸                  ← 第一级：文件树（逐级发现）│
│ 📁 数据 ▸                             │
│ 📄 README                 ← 每个文件只出现一次      │
├───────────────────────────────────────┤
│ （输入字符 → 全树过滤模式）                       │
│ （选中文件 → 第二级：模板实体列表，懒加载）          │
└───────────────────────────────────────┘
```

**第一级 · 文件树（逐级发现）**：
- 渲染工作区目录树；`Enter` 展开目录进入下一级，`Backspace` 返回上级，展开状态记忆
- 大量文件时默认只显示根目录 + 顶层目录，逐级进入，不做一次性全量渲染
- 每个文件只出现一次；模式（链接/嵌入/嵌入只读）是独立选择器，不复制列表
- 输入字符 → **全树搜索模式**（扁平按路径匹配，带目录前缀展示）；Esc/清空返回树

**第二级 · 模板实体（懒加载）**：
- `Enter` 选中文件时，**仅对该文件**检查 doctype → 命中且有 suggest → 菜单进入实体列表（解析**单个**文件，按路径缓存）
- 选中实体 → 插入 `[[path#object]]`（仅字符串展示）；Esc/Backspace 返回文件级
- **绝不在触发时解析所有文件**（触发成本 = 一次 `fs.readTree`）

**交互矩阵**：

| 动作 | 树模式 | 过滤模式 | 实体模式 |
|---|---|---|---|
| ↑↓ | 移动选择 | 移动选择 | 移动选择 |
| ←→ | 切换模式 | 切换模式 | 返回文件级 |
| Enter | 展开目录 / 选中文件 | 插入 | 插入实体 |
| Backspace | 返回上级 | 清空过滤 | 返回文件级 |
| Esc | 关闭 | 关闭 | 返回文件级 |
| 输入字符 | 进入过滤 | 过滤 | — |

### 6.7 file_block 写回事务（决策：并入保存）

```
保存（Ctrl+S / 自动保存定时器 autoSaveDelay）：
  1. 收集本文档所有可编辑 file_block 的当前内容
  2. 与缓存源内容对比，仅取有差异者（按路径去重，同源多处引用合并）
  3. 批量写回源文件
  4. 序列化当前文档（仅标记行）写盘
  5. 广播"源文件已更新" → 其他打开该源的标签/引用刷新物化内容
```

- 写盘次数 = 保存次数，无独立防抖风暴；一次保存 = 原子提交点（撤销在保存前只影响内存）
- 冲突：同源被多文档编辑 → **最后保存者胜** + toast（不做三方合并）
- 只读变体不参与步骤 2-3

> **【已实现】脏检测双条件 + 写回事务 + 源文件联动**（writeback.ts + manager.ts）：
> `dirty = markdown 变化 || 任一可编辑嵌入容器内容 ≠ 其源文件快照`（物化完成后建立初始快照，保存时更新）。
> 写回：保存时收集可编辑块内容（serializer 包 doc 序列化 + **round-trip 稳定化**——否则与源标签
> replaceAll 后的值差末尾换行，保存时误判"源标签有用户编辑"）→ resolveRealPath 补扩展名（块 attrs.path 常缺
> .md，直接写会创建无扩展名新文件）→ 对比源文件仅写差异 → 更新缓存 → broadcastBlockRefresh 其他标签物化同步
> （路径匹配 sameSource 忽略扩展名差异）。
> **源文件联动（嵌入块编辑 → 源标签实时刷新）**：B 块编辑 → 防抖 600ms → 源文件 A 标签（打开且无自身编辑）内容
> replaceAll 为块内容 + A 脏灯亮（savedContent 保持旧磁盘值）+ `syncedValue` 记录应然值（round-trip 后内容）；
> A 有自身编辑 → 不刷新（最后保存者胜）。**保存语义**：保存 B = 写 B + 写回块到 A 磁盘 + A 标签无自身编辑
> （内容==写回值 或 ==旧磁盘 或 ==syncedValue）→ 以应然值落盘（保证磁盘==A 编辑器）+ A 脏灭；
> 保存 A = 写 A 磁盘 + 广播 B 块物化刷新 + B 块快照同步（仅块改动的 B 脏灭）。坑：联动刷新后的物化 dispatch
> 必须压在 suppressing 期内（否则 markdownUpdated 误清标志）；"无自身编辑"判断不能用 externallySynced
> （防抖校验空事务会误清）——用内容比较 + syncedValue。

> **【缺口记录 · M1 暴露】只读变体拖拽缺口**：`contenteditable=false` + `stopEvent` 只拦截打字，
> block 拖拽把手在 ProseMirror 事务层操作，可绕过 DOM 层修改只读容器内容。加固方案（M2/M3 实施）：
> ① NodeView 拦截拖拽/选择事件；② 事务层编辑守卫（只读容器拒绝修改事务）；③ 对只读容器隐藏块手柄 —— ②③ 已实施（app-plugin readonlyGuardPlugin + styles.css）

### 6.8 嵌套与循环

- 容器 `content: 'block+'` 允许内部再出现 `file_block` → 天然嵌套（A 嵌 B，B 嵌 C）
- **循环检测**：resolve 时维护路径栈，`A→B→A` 渲染"⚠ 循环引用"占位，不再展开
- **深度上限 3 层**，超限渲染截断提示

### 6.9 断链与重命名

- 目标文件被删除/改名 → 引用节点红色警告态（"文件不存在"），提供「重新选择 / 清除」
- 同目录内重命名文件 → 联动更新引用路径；跨目录移动 → 提示断链（v1）
- `object_ref` 对象缺失 = 同上断链处理

### 6.10 路径边界与安全

- **拒绝工作区外引用**（`..` 穿越拒绝）——模板域除外（可信区）
- 字面量 `[[` 用 `\[\[` 转义
- 嵌入内容仅按 Markdown 解析，不执行代码

### 6.11 外部改动与性能

- v1 **不做 fs.watch**：打开/激活标签时刷新引用；打开中的标签间靠保存广播
- 源内容按路径**缓存**；>200KB 懒加载提示；物化内容不落盘

## 7. 运行时服务

| 服务 | 职责 |
|---|---|
| TemplateService | 双域扫描、注册表、斜杠「模板」组注册、插入/新建、占位符渲染 |
| ValidateService | rules 执行、decorations 标注、聚合面板、报告落盘、strict 门禁 |
| RefSyncService | 两段式 resolve、物化、写回事务、断链/环/深度处理、广播 |

### 7.1 异步容错原则（决策）

**ValidateService 与 RefSyncService 均为异步、隔离的附加功能——崩溃不得影响编辑器主流程：**

- rules.ts 执行包裹 try/catch + **超时上限**（如单条规则 2s），异常 → 该规则跳过 + toast 提示
- suggest.ts 的 `resolve` 失败 → 该对象引用进入断链态，不中断编辑
- 两段式 resolve 中任何文件读取失败 → 引用节点标记警告态，编辑器继续可用
- 两服务由应用启动后**旁路初始化**（不阻塞编辑器创建），任何阶段失败只降级不报错

## 8. 场景决策矩阵（最终）

| # | 场景 | 决策 |
|---|---|---|
| 1 | 模板作用域 | 工作区 + 全局目录，优先级工作区 > 全局 |
| 2 | 占位符 | 原样显示为 chip，不做变量替换 |
| 3 | 校验联动 | mode 声明于 rules.ts，默认 hint 不阻止；报告路径声明 |
| 4 | 外部改动 | v1 无 fs.watch，打开/激活时刷新 |
| 5 | 断链 | 红色警告 + 重新选择/清除；同目录重命名联动 |
| 6 | 循环/深度 | 路径栈 + 占位，深度上限 3 |
| 7 | 性能 | 缓存、懒加载、物化不落盘 |
| 8 | 安全 | `\[\[` 转义、拒绝 `..`、内容不执行代码 |
| 9 | 多标签并发 | 写回并入保存，最后保存者胜 + toast |
| 10 | 模板继承 | **v1 不做**（extends） |
| 11 | 目录模板 | v2 |
| 12 | 对象引用校验 | 不实时校验；缺失视为断链 |

## 9. 实现效果（视觉）

- `doctype:demo` 首行：灰色弱化 + 「模板：demo」徽标，不可编辑
- 输入 `@` / `[[`：浮出迷你文件树，方向键选择
- `![[path]]`：边框卡片，内部为源内容，可编辑；保存后源文件与所有引用同步更新
- `![[path|ro]]`：同款卡片 + 只读徽标，内容不可编辑
- 校验违规：黄色下划线 + 「⚠ 说明」；侧边栏聚合面板；可选报告文件
- 断链/循环：红色警告态卡片

## 10. 技术风险与关键实现点

1. **TS 动态加载**：模板域 TS 文件不在 Vite 模块图内。方案：fs 读文本 → esbuild-wasm 转译 → 隔离执行（Web Worker / Function）。需评估 esbuild-wasm 体积（约 8-10MB，可后置懒加载）；备选：构建期注册或受限 VM
2. **两段式 resolve**：异步定型节点需处理"用户已编辑暂态区域"的竞态（resolve 完成前禁止编辑 file_block 容器）
3. **写回事务**：批量写回需按路径合并、失败回滚提示；广播刷新需避免抖动（节流）
4. **decorations 与文档同步**：violationAt 使用位置，文档编辑后需重算（ProseMirror decorations 天然随 doc 变化）
5. **`![[` 与表格语法冲突**：`[[` 出现在表格单元格内需转义规则
6. **【缺口】嵌入编辑脏检测**（§6.7）：getMarkdown 不感知嵌入编辑 → 脏检测双条件
7. **【缺口】只读容器拖拽**（§6.7）：block 手柄绕过 contenteditable → 事务层守卫/隐藏手柄
8. **触发菜单插入语义**（M2）：触发文本需替换为**节点**而非文本（slash 命令同款：transaction 直接建节点），块嵌入需劈分段落

## 11. v1 里程碑拆解

> 状态：**M1-M7 已完成并全量回归通过**（M7：源码查看模式 Ctrl+E 切换所见即所得/源码；M7b：文件树拖拽移动 + 瞄准定位）。
> 测试：ref 15/15、menu 26/26、m3 9/9、m4 13/13、m4b 9/9、m4c 6/6、m5 9/9、m5-strict 3/3、m6 6/6、m6-toolbar 9/9、m6c 20/20、m6d 10/10、source 26/26、**drag 31/31**、app 28/28

### 里程碑状态

1. **M1 语法与节点 ✅**：doctype / file_ref / object_ref / file_block + remark 插件 + stringify handler + 两段式 resolve + Obsidian 路径补全（.md/.markdown/.txt）
2. **M2 触发菜单 ✅**：`@`/`[[`/`![[` 触发 + 三级递进菜单（模式选择器 / 文件树逐级发现 / 实体级懒加载）
3. **M3 文件树联动 ✅**：chip 点击跳转（#片段平滑滚动）、断链检测+重选菜单、重命名引用联动、只读事务守卫
4. **M4 模板机制 + 实体级 ✅**：TemplateService 双域扫描、esbuild-wasm 运行时加载 rules/suggest、`/` 菜单「模板」组、ref 菜单第二级实体（suggest 对象 + Obsidian 标题）、基于模板新建
5. **M5 ValidateService ✅**：rules.ts 执行 + 三通道呈现（decorations 标注 / 聚合面板 / 报告落盘）+ strict 门禁
6. **M6 批注插件 ✅**：`<mark data-note>` 语法节点 + 运行时批注（校验违规高亮）+ 批注卡 + 选中文本工具条「添加批注」
7. **M7 源码查看 ✅**：Ctrl+E 切换所见即所得 / 源码模式（语法高亮 CodeMirror）
8. **M7b 文件树拖拽 + 瞄准定位 ✅**：HTML5 DnD 拖拽文件/目录移动（入目录 / 同级插入线 / 拖到根 / 悬停自动展开 / 循环·冲突·空操作拒绝）+ 🎯 定位当前文件（展开祖先链 + 高亮 + 滚动）

### M4 完成清单（含用户反馈修复轮次）

**模板机制**：`src/template/`（types / ts-loader / service / suggest-context）；`/` 斜杠「模板」组（buildMenu 扩展点，mountEditor 前 await ready()）；基于模板新建（目录右键 → 选择器 → 自动补 .md）；占位符 v1 原样文本（chip 渲染待做）；双域扫描工作区 `template/` + 全局（mock 示例；真实外部目录 v1.5 缺口）

**实体级引用（§6.2 Obsidian 兼容落地）**：选文件 → 实体级 = 文件本身 + （有 suggest.ts → 模板对象；无 → md 提取的标题列表）；选标题插入 `[[path#标题]]`（file_ref+fragment），选对象插入 `[[path#对象]]`（object_ref，resolve 填充值）；实体级与目录展开同款视觉（h6 路径风格 + ◆/#/📄 图标 + › 箭头）；`![[`（嵌入）与断链替换不进实体级

**suggest 自定义能力**：SuggestContext 提供 findText / headingText / paragraphAfterHeading / taskCount / taskProgress / firstTask / firstTableCell / allText；SuggestObject = { id, label, fragment(锚点标题), resolve }——名字、展示内容、跳转锚点全在 TS 定义；demo 样例：问候语、版本号、待办数量(5)、完成率(3/5)、首个待办

**菜单交互**：快捷键 = Tab 切模式 / ← 返回上级或清过滤 / → 进入目录或文件实体级 / Enter 选中 / Backspace 返回上级；← 返回恢复到进入前 hover 的目录/文件（Enter/→/点击三路径都记录）；多标签 keydown 双重触发 → hasFocus + data-show 双守卫；全角符号（＠！【）归一化触发

**引用 UI**：file_ref / object_ref / 断链统一 chip + pointer 光标 + hover 加深；自定义浮窗（`ref-tooltip.ts` 替换原生 title：📄 路径 — 点击打开 / 🔗 对象名（路径）/ ⚠️ 文件不存在）；file_ref 显示完整路径；object_ref 点击跳转（fragment 锚点 + 平滑滚动）；标题跳转手动计算滚动位置（标题在滚动容器顶部下方 15% 偏上处）

**性能**：菜单打开 ~20-50ms（`[menu-perf]` 锚点 + `window.__refMenuPerf`）；esbuild-wasm 启动预热（首次 suggest 1.5s → ~100ms）；菜单树缓存（treeVersion 失效）

### 关键技术坑（实现记录）

1. **treeChildren walk 未命中返回 `[]`（真值）** → 短路导致只有第一个目录可进 → 返回 `null` + `found !== null`
2. **插入新块定位**：位置会因插入内容漂移（旧块被误判为新块）→ dispatch 前后用 ProseMirror 节点对象引用（持久化，未修改块对象不变）
3. **空段落替换嵌入**：replaceWith 整段替换时块在 `$pos.before()` 偏移 1 → dispatch 后按节点对象重定位再物化
4. **flip 测量 0 高**：菜单内容 v-if 渲染晚于定位 → 树加载后手动 computePosition 重定位（fixed 策略 + flip/shift，不用 provider.update 避免 onShow 递归循环）
5. **滚动容器查找**：`inst.el` 自身是 `.editor-pane`，querySelector 子元素查不到 → classList 判断自身；scrollIntoView 的 block:'center' 在嵌套滚动容器不可靠 → 手动算 scrollTop
6. **scrollToHeading 时序**：mountEditor 异步，300ms 固定延迟不够 → waitForInstance 轮询等待挂载
7. **shouldShow 重置 mode**：每次更新覆盖用户手动切换 → 加 triggerKind 仅触发词变化时重置
8. **matchTrigger 优先旧 `[[`**：段落旧触发词抢占新输入 → 收集候选取「终点离光标最近」者
9. **IME 输入**：keydown 记不到组合文本 → beforeinput（insertCompositionText）跟踪 recentTyped；全角符号归一化
10. **多标签 keydown**：多个菜单实例共享 window 监听 → hasFocus + data-show 守卫
11. **esbuild-wasm**：初始化 + 首个 transform 各 ~450ms 一次性开销 → 启动后台预热
12. **mock 示例升级**：SEED_VERSION 版本化 + 演示核心文件跨版本强制覆盖；`window.__mockFsDebug()` 诊断钩子

### M5 实现记录（ValidateService）

- `src/validate/`：service（执行/结果缓存/订阅广播/报告落盘）、validate-context（doc → 结构查询上下文）、plugin（decorations）
- 类型补全：ValidationContext 完整（findTableAfterHeading/findHeading/findText/allText + violation/violationAt + TableContext/TableRow/TableCell）；Violation 结果类型
- **三通道**：① decorations——`validateDecorationsPlugin`（$prose 包装 + PluginKey），违规位置 ⚠ widget（level 分色 + title 提示），service 完成后空事务 `setMeta('validateRefresh')` 触发重算，不写入 doc（保存即消失）；② 聚合面板——`ValidatePanel.vue` 浮动右下角（错误/警告计数、违规列表、点击跳转 scrollToPos、⟳ 刷新），无 doctype 时引导提示；③ 报告——`report = { enabled, path }` 声明 → 校验后写 markdown 报告（`.validate/report.md`）
- **触发时机**：打开文档（mountEditor 后 silent）+ 编辑防抖（1.5s，markdownUpdated 挂载点；§5.1 默认关闭 → v1 内置，后续可加开关）+ 保存前（saveTab 重新校验保证新鲜）
- **strict 门禁**：saveTab 里 `hasStrictBlock`（mode strict + error 违规）→ ConfirmDialog「校验失败，确定保存？」（可取消/仍然保存）；hint 模式不阻止
- **§5.4 引用交互**：collect() 跳过 file_block 物化内容（源文件按自己 doctype 校验）；object_ref 不参与实时校验
- **doctype 提取坑**：首行 `doctype:<value>` 被 M1 自定义 doctype 节点解析（textContent 为空！）→ 从 `node.attrs.value` 提取，不能从文本
- **单元格 pos 坑**：`table.pos + 1 + rowOff + cellOff` 少加 1（cell 相对 row 还有一层边界）→ ⚠ 会标到前一格（A 单元格）内 → 应为 `pos + 2 + rowOff + cellOff`（用户反馈：需求表提示位置不对）
- **超时防护**：单条规则 >2s 标记 stale（同步 run 无法中断，仅告警跳过结果归属）
- **demo.rules.ts**：需求表前置/后置联动（violationAt 单元格级标注）+ 必须存在版本章节（error 级）；mode/report 导出演示
- 测试：m5-e2e 9/9（三通道 + 编辑触发 + hint 保存不阻止）、m5-strict 3/3（严格模式弹确认/取消不保存/确认仍保存）

### M6 实现记录（批注插件，独立于校验）

- `src/annotations/`：remark-annotation（`<mark data-note="x">…</mark>` 合并为 annotation mdast）、nodes（$nodeSchema('annotation')，inline 容器 content text*，渲染为高亮 mark）、service（AnnotationService：运行时批注 setRuntimeAnnotations / 人工批注 add/remove/update）、plugin（运行时批注 decorations：非空范围 inline 高亮、空范围降级锚定行 node 高亮）、card（批注卡：点击展开/再点收起，@floating-ui 靠右+flip，持久化批注可删除/内联编辑）、styles
- **两种批注**：① 运行时（persist=false，校验违规→高亮/锚定行，不落盘）② 人工（persist=true，插入 `<mark data-note>` 节点，随保存序列化到 md——round-trip 已验证）
- **校验集成**：ValidateService 违规 → `setRuntimeAnnotations`（替换原 validate/plugin.ts decorations 通道）；锚定行 = violationAt 空范围（如空单元格）降级为所在 block 容器（tr/段落）整块高亮
- **人工批注入口**：Crepe Toolbar（选中文本浮窗）`buildToolbar` 加「添加批注」（与加粗/标黄等并列）→ 输入浮窗 → addAnnotation 包裹选区
- **坑**：① schema marks 名称是 emphasis/inlineCode 而非 em/code（Unknown mark type）；② ToolbarItem 必须提供 active()（checker 渲染抛错）；③ posAtDOM 对 inline 节点返回内容位置（偏移 1）→ 减 1 找 annotation 节点；④ onRun 类型缺口（ToolbarItem 未声明但运行时使用）→ 断言 addItem 参数类型
- 测试：m6-e2e 7/7（round-trip/批注卡/动态高亮）、m6-toolbar 7/7（Toolbar 添加/删除/编辑）；m5-e2e 同步更新（校验标注改走批注体系）

**M6 v2（gutter 侧边条 + 批注卡连线）**：

1. **gutter 侧边条**（`annotations/gutter.ts`）：编辑器右侧垂直标记条（挂在 .editor-pane 内，position:absolute，零遮挡）——每个批注/校验违规对应彩色小圆点（error 红 / warning 橙 / comment 黄），top 由 `view.coordsAtPos` 计算；hover → 摘要浮窗；点击 → scrollToPos + `openAnnotationAt` 展开批注卡。更新时机：批注变化订阅（subscribeAnnotations）/ pane scroll（rAF 节流）/ resize / 标签激活（activateTab rAF）
2. **批注卡右侧 + 连线**：卡片固定屏幕右侧（right 16px，top 跟随锚点 clamp）；SVG 贝塞尔连线（卡左边缘 → 锚点右边缘，`.annotation-connector` 全屏 fixed pointer-events:none）；**默认淡化（opacity 0.22），悬停批注卡或被批注文字时突出（0.95 + 加粗）**
3. **锚点虚拟矩形兜底**：装饰 tr 等元素 `getBoundingClientRect` 返回 0（无布局）→ 用 `coordsAtPos` 计算虚拟锚点矩形
4. 测试：m6b-e2e 10/10（marker 数量/滚动跟随/摘要/点击展开/连线显隐/淡化/悬停突出/右侧定位）

**M6 v3（批注抽屉 + 评论线程；按用户拍板重构）**：

1. **移除 gutter 侧边条**（用户决策：不再需要）
2. **右侧抽屉**（`AnnotationDrawer.vue`，替代浮层批注卡 + ValidatePanel）：固定右侧，默认宽 300px、拖拽 50-480（复用 resizer 模式，宽度存 settings）；头部统一折叠/展开（折叠为窄把手）；批注计数（error/warning/comment）
3. **批注卡 = 抽屉内卡片**：人工批注卡（锚定文本 + 评论线程列表 + 回复输入 + 标记已解决）+ 校验违规只读卡（无回复/删除）；点击正文锚点 → 激活卡 + 展开抽屉
4. **评论线程**：`<mark data-note>` 的 note 存线程 JSON（短字段 a/c/t/r/rt/rb；&quot; 转义；remark 路径 value 需 unescape 再 JSON.parse；兼容旧纯文本 note）；**评论不可删除、仅创建人（用户名匹配）可标记已解决/重新打开**；markdown 不渲染（v3 决策，纯文本）
5. **连线保留**：抽屉左边缘 → 激活批注锚点（默认淡化，悬停卡或锚点突出）；折叠时隐藏
6. **git 用户名**：Tauri 下目录是 git 仓库（.git 存在）→ Rust 命令 `git_user_name`（git config user.name）；web/mock → 设置「批注用户名」（默认「我」）
7. **无位置整体违规**（如缺需求表）也进抽屉展示（from=-1 无定位按钮）；decorations 跳过
8. 移除 ValidatePanel.vue（校验违规全部走抽屉只读卡）
9. 测试：m6c 17/17（抽屉/线程/权限/连线/拖拽/折叠）；m5-e2e/m6-e2e/m6-toolbar 同步更新

**M6 v4（批注交互细化，按用户反馈）**：

1. 移除批注卡「删除批注」按钮（评论只可标记已解决，线程保留）
2. 评论输入：回车换行、**Ctrl+Enter 提交**（@keydown.ctrl.enter.prevent）
3. **Ctrl+R**：选中文字后快速弹出评论输入浮窗（document keydown capture + preventDefault，绕过浏览器刷新）
4. **点击批注卡 = 定位 + 展开/折叠**：卡片头部点击 → scrollToPos + 切换折叠；折叠态隐藏评论输入框（保留评论列表？不——折叠隐藏列表与输入框，只显示头部）；定位按钮移除
5. **已解决状态 = 状态圆**：评论人-时间行右侧空圆（○）= 未解决 → 点击变 ✔绿圆 = 已解决；仅创建人（mine）可点，非创建人圆淡化不可点
6. 测试：m6c 19/19、m6-toolbar 7/7（含 Ctrl+Enter/Ctrl+R）；m5-e2e/m6-e2e 同步

**M6 v5（折叠/快捷键/连线细化）**：

1. **折叠状态**：折叠时仍显示评论列表，只隐藏输入框和发送按钮；展开显示输入框（评论列表常显）
2. **评论输入**：Enter 换行 / **Ctrl+Enter（或 Cmd+Enter）提交** / **ESC 清空草稿**——改为显式 @keydown 处理（onReplyKeydown），不再依赖 Vue 修饰符；添加批注浮窗（showAnnotationInput）也支持 ESC 关闭
3. **点击批注卡 = 定位 + 激活（显示该卡连线）+ 折叠切换**：locate() 增加 setActiveAnnotation（连线跟随点击的卡片）；无锚点整体违规仅激活+展开
4. 测试：m6c 20/20、m6-toolbar 9/9（含 Enter 换行/ESC/Ctrl+Enter/Ctrl+R）

**M6 修复：嵌入块批注写回双重转义（&amp;quot;）**：

1. **症状**：在 file_block 嵌入块内选中文字添加评论 → 保存（writeback 写回源文件）→ 打开源文件：评论作者变「未知」、内容变原始转义字符串 `[{&quot;a&quot;:...}]`
2. **根因**：`writeback.collectBlockContentsSync` 的 round-trip 稳定化（序列化→再解析→再序列化）中，toMarkdown 的 `escapeAttr` 转义了 note，但 parseMarkdown runner **不解码**（历史设计：PM 节点内 note 保留转义态，parseThread 读取时再解）。第二次序列化把已转义的 `&quot;` 再转义成 `&amp;quot;`（双重转义）→ 源文件写回双重转义 → 重新打开后 parseThread 的 unescapeHtml 只解一层 → JSON.parse 失败 → 走旧版兜底（author='' 显示未知 / content=原始字符串）
3. **修复**：`annotations/nodes.ts` parseMarkdown runner 对 note 做 `unescapeAttr`（与 escapeAttr 互逆，&amp; 最后替换）——PM 节点内 note 恒为原始 JSON（与 parseDOM / 运行时 setNodeMarkup 一致）。round-trip 变为 转义→解码→转义 = 稳定单次转义；且旧双重转义数据经 runner+parseThread 两级解码自愈
4. 测试：m6d-e2e 9/9（嵌入块内加批注→写回单次转义→源文件打开作者/内容正确；含旧数据自愈断言）

**M6 修复：批注输入浮窗底部出屏（按钮不可点）**：

1. **症状**：锚点在视口底部附近时，添加批注浮窗（position:fixed 跟随选区）超出屏幕底部，确认按钮不可点
2. **根因**：`card.ts showAnnotationInput` 只做 `top = max(8, coords.bottom + 6)`——仅保底贴顶，无底部钳制/上翻
3. **修复**：先加 visible class 再测量真实尺寸（display:none 时 offsetHeight=0），垂直优先下方、下方放不下（`top + h + MARGIN > innerHeight`）→ 上翻到选区上方（类 tooltip），极端情况贴顶保底；水平左右钳制（用实测宽度，留 8px 边距）
4. **交互变更（并行改动）**：添加批注输入浮窗由按钮组改为快捷键交互——Enter 确认提交（`submitAnnotation`，含 resolveUserName/激活定位）、Shift+Enter 换行、ESC 取消；占位提示同步更新
5. 测试：m6d-e2e 增加「浮窗完整在视口内」断言并改回正常交互（Enter 提交，10/10）；m6-toolbar（顶部锚点常规下置）9/9 无回归

### M7 实现记录（源码查看模式，Ctrl+E 切换）

- 背景：增加源码查看模式，Ctrl+E 在所见即所得（Crepe）与源码（textarea）间切换。与「每标签独立 Crepe 实例、切标签只切容器可见性」架构一致——**不销毁实例**，源码 = 容器内 textarea 覆盖层。
- `state/store.ts`：Tab 加 `sourceMode: boolean`（默认 false，每标签独立）；`openTab` 初始化。
- `editor/manager.ts`：
  - `ensureSourceTa(inst, tabId)`：懒创建 textarea（`.source-ta` + `data-source-ta` 属性），input 事件实时比 `savedContent` 置脏 + `userEditedAt`/`lastModified`（§6.7 机制复用）；keydown 拦截 Tab 插入两空格（原生 Tab 会跳焦点）
  - `setSourceMode(tabId, on)`：进入 → `crepe.getMarkdown()`（canonical）填 textarea、隐藏 `.milkdown`、加 `.source-mode` 类、焦点末尾；退出 → 先 `ensureDocSynced` 再恢复可见性 + 焦点回编辑器
  - `ensureDocSynced(tabId)`：源码模式下把 textarea 最新内容 `replaceAll` 解析回 doc（不切换模式）——保存/校验/定位等读 doc 的操作前调用；非 suppressing（让 markdownUpdated 正常走脏检测/防抖校验）
  - `toggleSourceMode(tabId)`：export，供 Ctrl+E 调用
  - `saveTab` 顶部、`refreshValidation` 顶部接 `ensureDocSynced`（源码模式保存不切回，继续编辑源码；⟳ 校验对应源码最新内容）
  - `scrollToPos`：源码模式下先 `setSourceMode(false)` 再定位（用户要看到位置）
  - `refreshTabToContent`（§6.7 联动）：`replaceAll` 后同步 `srcTa.value = canonical`（源标签处源码模式时 textarea 与 doc 保持一致）
  - `activateTab`：同步批注卡上下文（切标签后 Ctrl+R/批注卡作用于当前编辑器）；焦点适配（源码模式 → textarea）
  - `closeTab`：关闭活动标签后恢复新活动标签的批注卡上下文（原 close 把 editorRef 清成 null 后不恢复的既有缺陷一并修复）
  - mountEditor 的 `editor.config`：改绑 inline-code 快捷键 `Mod-e` → `Mod-Shift-e`（释放 Ctrl+E 给源码模式）
  - `__editorGetMarkdown` 调试钩子：源码模式返回 textarea 值（doc 是同步前的旧内容）
- `state/settings.ts`：`SHORTCUT_DEFS` 加 `toggleSource`（默认 Ctrl+E，可在设置中自定义/冲突检测）
- `App.vue`：`shortcutActions` 加 `toggleSource`；`onKeydown` 对 `data-source-ta` 焦点放行全局快捷键（其他 INPUT/TEXTAREA 仍跳过）；状态栏加「源码模式」badge
- `annotations/card.ts`：Ctrl+R 源码模式守卫——`tab.sourceMode` 时 preventDefault + toast 提示切回编辑模式（否则会加到旧 doc 的错误位置；且不 preventDefault 会触发浏览器刷新）
- 样式：`style.css` 全局 `.source-ta`（等宽字体、跟随主题 `--chrome-*`）；`EditorPane.vue` scoped `.editor-pane.source-mode`（overflow hidden、去内边距，textarea 自身滚动）
- **关键决策**：① 快捷键冲突——milkdown commonmark inline-code 原绑 `Mod-e`，改绑 `Mod-Shift-e` 释放 Ctrl+E（工具栏按钮不受影响）；② 源码模式保存不切回——`ensureDocSynced` 保 doc 新鲜，writeBackBlocks/校验/块快照均走正常流程；③ 源码编辑不触发 markdownUpdated（doc 不变）→ 脏标记由 textarea input 自行维护，切回时 replaceAll 触发 markdownUpdated 复核
- 测试：source-e2e 26/26（进入/内容回填/焦点/源码编辑脏/Ctrl+E 切回渲染/未改不脏/源码模式 Ctrl+S 落盘+保持模式/切标签模式保持/Ctrl+R 守卫/Ctrl+Shift+E 改绑/WYSIWYG 下 Ctrl+E 进源码）

### M7b 实现记录（文件树拖拽移动 + 瞄准定位）

- **拖拽**：`FileTree.vue` 节点 `draggable`（重命名输入中不可拖）+ HTML5 DnD（dragstart/dragover/drop/dragleave/dragend）；`treeOps.ts` 的 `dragState`（reactive，module 级集中管理）+ `beginDrag` / `dragOver` / `dragLeaveTarget` / `moveNode` / `endDrag` / `computeTargetPath` / `isValidDrop`
- **落点语义**：目录中间 1/3 = 移入（`into`）；上/下 1/3 = 同级插入线（`before`/`after`）；文件上/下二分。位置由 `e.clientY - rect.top / rect.height` 计算（不用 offsetY，跨节点稳定）
- **同级插入线**：本质 = 移到目标同级目录（文件系统无手排顺序，树始终按名称排序——与 VS Code 文件夹一致，非 Obsidian 手排）。插入线指示「落到此目录」
- **拖到根**：`.tree` 容器 dragover/drop → 根虚拟路径 `''`（空串）；`isValidDrop`/`computeTargetPath`/`moveNode` 用 `targetPath === null` 判定空值（**不能用 `!targetPath`——空串是 falsy 会误拒根**）
- **自动展开**：`dragOver` 里悬停目录中间 500ms → `state.expanded.add(targetPath)`（module 级 `expandTimer`，递归组件共享，防多实例各自计时）；`dragLeaveTarget` 清计时；根路径 `''` 不展（无意义）
- **校验**：循环（dir 拖进自己/后代）、拖回原父目录（`into` 时 `targetPath === dirName(sourcePath)`）、拖到自身、目标已存在（前端 `findInTree` 预检 + 各 FS 后端防御）→ 拒绝 + `drag-invalid` 红标
- **联动**：`moveNode` 复用 `onFileRenamed`（标签跟随）+ `updateRefsAfterRename`（引用路径更新）+ `refreshBrokenAll` + `refreshTree`（与重命名同一套，确保 [[path]] 引用跟随迁移）
- **FS 适配**：mock `rename` 加冲突检测（不覆盖）；tauri `rename` 加 `to.exists() && from != to` 拦截（Windows `fs::rename` 目标存在会失败，前端+后端双防）；web `rename` 补目录递归移动（`copyDir` 递归复制 + removeEntry，原仅支持文件）
- **瞄准定位（🎯）**：`revealInTree(path)` 展开祖先链（拆 path 累加 `state.expanded`）+ `state.revealPath` 高亮 + 2.4s 自动清除；`App.vue` watch revealPath → `querySelector([data-path])` + `.closest('.tree')` 手动算 scrollTop（复用 scrollToPos 的 0.2 视口偏移模式）；侧边栏按钮「📂 打开目录」移除（设置弹窗已有），替换为「🎯 定位」
- **坑**：① 递归组件 dragover 冒泡 → 每节点 `e.stopPropagation()`；② dragleave 因子元素（span/actions）触发 → `relatedTarget.contains` 判定真离开；③ mock `buildTree` 按名称排序 → 同级重排无持久顺序，测试验证路径语义而非顺序；④ 点击树节点名被遮挡超时 → 测试改用 `evaluate` dispatch click（绕过 actionability）；⑤ 打开文件自动收纳侧边栏 → 拖拽/定位前 `ensureSidebar()`
- 测试：drag-e2e 31/31（文件入目录/插入线 before·after/目录递归/拖到根/循环拒绝/空操作/冲突拒绝/悬停自动展开/真实 dragAndDrop 冒烟/标签+引用联动/瞄准定位展开+高亮+自动清除）

### Mermaid 预览放大查看（悬停放大镜 + Lightbox）

- **需求**：mermaid 渲染结果图鼠标悬停显示放大镜按钮，点击放大查看，ESC 关闭
- **包裹层**：`mermaid.ts` renderPreview 成功回调改为 `applyPreview(wrapMermaidPreview(svg))`——SVG 包一层 `<div class="mmd-zoomable">` + 右上角 `.mmd-zoom-btn`（整段 HTML 随预览走 Crepe PreviewPanel 的 DOMPurify sanitize 通道，div/button/svg/class/title/type 默认 profile 均保留，已验证）
- **交互**：`mermaid-zoom.ts`（document 级委托，多标签共享一份监听）——① 悬停显隐纯 CSS（`.mmd-zoomable:hover .mmd-zoom-btn` opacity 过渡，按钮随 innerHTML 重建无妨）；② 点放大镜 → 克隆 SVG 进 Lightbox；③ Lightbox = fixed 遮罩 + 画布（transform translate+scale，origin 0 0）：滚轮以光标为中心缩放（fitS/5 ~ fitS×20）/ 拖拽平移（window 级 pointermove/pointerup，拖出遮罩不丢）/ 双击复位适配 / ESC（capture keydown + stopPropagation）/ 点遮罩空白 / ✕ 关闭；关闭后焦点回到触发按钮
- **适配尺寸**：克隆 SVG 去 mermaid 内联 max-width/width/height，取 viewBox 自然尺寸 → fitS = min(92vw/w, 86vh/h)（小图也放大，符合「放大查看」）
- **坑：setPointerCapture 会重定向后续 pointerup/click 到捕获元素** → pointerup.target 恒为 overlay，「点遮罩关闭」误判把图表上的任何点击都关掉（双击复位必触发关闭）→ 不用 capture，改 pointerdown 记录 downTarget + window 级 move/up 监听，关闭判定用 downTarget===overlay
- 测试：mermaid-zoom-e2e 16/16（包裹/悬停显隐/打开/ESC/✕/遮罩关闭/滚轮缩放/双击复位/拖拽平移/拖拽不关闭），已注册 run-all

### 记录缺口 / 待办

- 编辑防抖校验开关（§5.1 默认关闭——v1 内置 1.5s，大文档建议后续加设置项）
- 占位符 `{{title}}` chip 渲染（v1 原样文本）
- 全局模板域真实文件系统（外部目录需 Rust 命令）
- 已打开编辑器不感知模板注册表变更（重开标签生效）
- 脏检测双条件（§6.7 缺口）、只读拖拽加固剩余项、fs.watch、模板继承、目录级模板

### P0/P1 架构改造（2026-08-14：插件依赖净化 + 校验插件化）

按 milkdown 插件体系（源码 packages/plugins/* 范式）重构编辑器侧接线，消除插件包对 app 模块的直接 import：

**P0 — ref 插件包依赖净化（$ctx 注入）**：
- 新增 `src/editor/ref/config.ts`：`refConfigCtx = $ctx<RefConfig|null>`（fs 最小接口 / toast / templateService 最小接口 / openFile / reSelect / getTreeVersion）。插件内一律 `ctx.get(refConfigCtx.key)` 读取；未注入降级不中断。
- `resolve.ts` / `app-plugin.ts` / `writeback.ts` / `menu/index.ts` 删除 `import { fs } / toast / templateService`；无 ctx 的自由函数改传 cfg 参数（`readRefFile(cfg, path)`、`refPathExists(cfg, path)` 等）。
- 删除全局桥 `registerOpenRefHandler / registerReSelectHandler` → 装配层直接注入回调（manager mountEditor 组装 refCfg，`crepe.editor.config(ctx.set(refConfigCtx.key, ...))`）。
- 点击跳转插件工厂化：`refClickPlugin` 模块级实例 → `createRefClickPlugin(cfg)`（回调经 cfg）。

**P0 — 批注绑定切片化**：
- 新增 `src/annotations/config.ts`：`annotationConfigCtx`（tabId + getRuntimeAnnotations 读取器）；`bindAnnotationDecorations(tabId)` 闭包绑定 → 插件内 ctx 读取；`annotationPlugin = [configCtx, ...$remark, ...schema, $prose]` 整体 use。

**P1 — 校验插件化（引擎留 app 侧）**：
- 新增 `src/validate/plugin.ts`：`validatePlugin = [validateConfigCtx, $prose(事务监听→防抖→run), $command('validate')]`。
- `$prose` 插件 `state.apply` 检测 docChanged → 防抖（默认 1.5s，按 tabId 隔离）→ 调注入的 `run`（= validateEditor）；`shouldSkip` 注入 suppressing 判断（物化/保存期程序化事务不触发）。
- manager.ts 删除 `scheduleDebouncedValidation` 与 `validationTimers`；saveTab strict 门禁 / refreshValidation 保持调引擎；closeTab 清理 `clearValidationTimer`。
- 命令 `validate`（$command）：手动触发入口（当前未接线 UI，供后续面板/快捷键用）。

**装配时序（milkdown 源码确认）**：`editor.config(fn)` 回调在 ConfigReady timer 内执行，先于所有 `$prose`/schema 插件工厂（它们 wait SchemaReady/InitReady）→ ctx 注入安全。

**关键坑**：裸 `createSlice` 不注册进容器，`ctx.get` 抛 "Context not found"——配置切片必须用 `$ctx`（插件形式，`.key` 即 SliceType）。

**回归**：19 套件全绿（含 xxljob-e2e）+ `npm run build` 通过。另修复 mock.ts seed 漂移：接口文档「数据来源」列仍指向已删除的 `数据库/loan/表结构.md`（M8 重构遗留）→ 更新为 `loan_apply` / `customer_info`（m7-apidoc A3 依赖）。

### M9：Mermaid 流程图中引用（联想输入 + 文本级链接跳转，2026-08-15）

**需求**：mermaid 代码块内输入 `@` 快速联想引用（复用存量 ref 菜单）；渲染后**节点内文字**（非整节点）可点击跳转；显示去掉 `[[ ]]` 只显路径、chip 同款背景色。

**存量复用（不重复实现）**：
- 新增 `ref/menu/core.ts` **共享内核**：触发检测（matchTrigger/normalizeTriggers，从 menu/index.ts 移入）、树缓存 loadTree(cfg, state)、实体级加载 loadEntitiesForPath(cfg, path, parser?)、导航状态机（enterDir/goUp/openEntities/closeEntities 操作传入 state 实例）。
- 正文菜单（menu/index.ts）与 mermaid 联想（mermaid-ref.ts）**共用内核 + RefMenu.vue UI**（mermaid 传独立 reactive state 实例 + hideModeSelector 隐藏 embed 模式选择器）。
- 数据源沿用 refConfigCtx（P0 成果）；打开跳转复用 manager 的 handleOpenRef（resolveRefPath → openTab → scrollToHeading）。

**mermaid 实现**（新增 `editor/mermaid-ref.ts`）：
1. **CodeMirror 联想**（mermaidRefMenuExtension，ViewPlugin）：语言识别 = 代码块 DOM 语言按钮文本 == 'mermaid'（js 等不触发）；光标行文本 matchTrigger（仅 link 模式）；recentTyped 校验（全选替换也累积插入文本）；floating-ui 定位到 cm 光标；选择后删除触发词插入 `[[path]]` / `[[path#fragment]]` 纯文本。
2. **渲染文本链接化**（linkifyMermaidRefs）：mermaid.render 后把 foreignObject 内 HTML 文本的 `[[path#frag]]` 替换为 `<a class="mmd-text-ref" data-ref>`（去 [[ ]] 显示路径；DOMPurify 保留 <a>/data-*；edge label 同样生效）。
3. **点击委托**：document capture click——`a.mmd-text-ref`（data-ref）与旧内容 `a[xlink|href^="[["]]`（节点级 click 指令防御）→ 解析 `path#frag` → 打开回调（manager 注册，复用 handleOpenRef）；Lightbox 内点击同样生效（先关 Lightbox）。

**语法要求**：节点文本含 `[[` 必须用引号包裹（`B["修改 [[path#amount]] 的值为 1"]`）——mermaid 语法限制；不自动补引号（用户场景引号已开时自然工作）。

**测试**：新增 mermaid-ref-e2e 11 断言（渲染链接/去 [[ ]] / 点击跳转 / @ 联想 / 实体级 / 插入 / 非 mermaid 不触发 / 菜单关闭）；修 run-all.js 判定 bug（失败被 ✅ 掩盖：`结果: X 通过 / Y 失败` 只看 Y 是否 0）。

**M9 修复轮（用户反馈两问题，2026-08-15）**：
1. **联想插入后渲染失败**（节点文本含 `[[` 未引号包裹）：insertText 自动补引号——nodeQuoteRange 找光标所在节点边界（行内最近未闭合 `[`/`{`，排除 `[[` 第二位，配对其 `}`/`]`），节点文本未以引号开头时在左右括号内侧补 `"`（changes 三处：左引号 + 触发词替换 + 右引号，quoteShift 校正光标）。边文本（`-->|…|`）mermaid 语法不支持引号，不自动处理。渲染层另有兜底（外部：无引号 `[[..]]` 预处理，mermaid-ref-e2e F 组）。
2. **无法回到第一级目录**：进入目录/实体级时文档里的过滤词残留 → 后续任何输入/光标移动触发 checkTrigger 从残留文本重新提取 query → 菜单跳回过滤态。修复：adapter enterDir/selectFile 先 `deleteQueryText()`（删文档过滤词保留触发词，triggerTo 同步收缩），导航后文档干净，`←`/Backspace 逐级返回正常（G 组验证 Aaa → 深层 → ← 回第一级）。
3. 顺带修复：mermaid 菜单容器统一 `.milkdown-slash-menu`（crepe 主题样式）+ 浮层挂 `.milkdown` 容器内（block-edit.css 样式嵌套在 `.milkdown` 选择器下，挂 body 样式失效）；mermaid-ref-e2e 扩展至 21 断言（C5/C6 补引号、F 无引号渲染、G 目录返回）。

### M10：template → .template + 联想范围/键位/边标签/时序图（2026-08-15）

1. **template → .template**：demo 目录改名（`demo/消金业务合作/template/` → `.template/`，sync:demo 重新生成 mock-samples.generated.ts）；`TemplateService.WORKSPACE_TEMPLATE_DIR = '.template'`；`shouldShowInTree` 显示 `.template` 目录本身及其内容（模板域文件始终显示）；受影响测试路径同步（m4/drag/m9/m5-strict）。
2. **`.` 开头目录不进联想**：core.ts `loadTree` 递归过滤隐藏目录（`.template`/`.git` 等；正文菜单 + mermaid 联想共用）；文件树仍显示 `.template`。
3. **实体级 → 键不移动光标**：RefMenu.vue 实体级分支拦截 ArrowRight（preventDefault，无操作）。
4. **边标签引用**：`-->|"是 [[...]]"|` 引号可解析（实验确认）；nodeQuoteRange 扩展支持边标签 `|...|`（光标前最近未闭合 `|`）自动补引号；无引号边标签走外部 prepareMermaidRefs fallback（占位符渲染）。
5. **时序图（sequenceDiagram）点击跳转**：消息文本渲染在 SVG `<text>`（非 foreignObject）→ linkifyMermaidRefs 扩展处理 `<text>` 块（`<tspan class="mmd-text-ref" data-ref>`，DOMPurify 保留验证过）；**mermaid sequence 消息会丢弃 `#` 及其后内容**（`[[path#frag]]` 的 # 段丢失）→ 新增 `escapeRefHash`：渲染前把 `[[ ]]` 内半角 # 转全角 ＃（渲染完整保留），linkify 时还原半角；点击委托支持 `tspan.mmd-text-ref`；CSS `tspan.mmd-text-ref`（fill + 下划线）。

**回归**：全量 21 套件全绿（mermaid-ref-e2e 26 断言含 H 组：时序图 tspan 跳转/边标签链接/.template 过滤/→ 键不移动光标）+ build 通过。

## 12. 未来工作（v2）

- 模板继承（extends）与规则合并优先级
- fs.watch 实时同步外部改动
- 目录级模板（整棵复制）
- Obsidian 标题链接冲突的进一步细化（对象/标题同名优先级已在 §6.2 定义）
- 三方合并 / 冲突解决 UI
- 模板市场/导入导出
