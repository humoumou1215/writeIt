# Milkdown Note — 模板与引用机制设计文档

> 状态：设计定稿（v0.1，M1-M4 已实现）｜ 范围：设计文档 + 实现进展记录
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

> **【缺口记录 · M1 暴露】脏检测双条件**：序列化只输出标记行，`getMarkdown()` 不感知嵌入块内的编辑，
> 基于 markdown 对比的脏检测会失效。修复：
> `dirty = markdown 变化 || 任一可编辑嵌入容器内容 ≠ 其源文件快照`
> 语义统一为「保存 = 提交文档 + 全部被引用文件变更（原子）」

> **【缺口记录 · M1 暴露】只读变体拖拽缺口**：`contenteditable=false` + `stopEvent` 只拦截打字，
> block 拖拽把手在 ProseMirror 事务层操作，可绕过 DOM 层修改只读容器内容。加固方案（M2/M3 实施）：
> ① NodeView 拦截拖拽/选择事件；② 事务层编辑守卫（只读容器拒绝修改事务）；③ 对只读容器隐藏块手柄

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

> 进展：M1 ✅（15/15 测试）→ M2 ✅（25/25）→ M3 ✅（9/9）→ M4 ✅（13/13）→ M5（下一步）

1. 语法与节点：doctype / file_ref / object_ref / file_block + parse/toMarkdown + 转义 ✅
2. SlashProvider `@`/`[[`/`![[` 菜单（迷你文件树 + 模式/对象选择）✅
3. TemplateService（双域扫描、插入/新建、占位符渲染）✅（占位符 v1 原样文本，chip 渲染待做）
4. ValidateService（rules.ts 加载执行、三通道呈现、strict 门禁）← M5
5. RefSyncService（两段式 resolve、物化、写回事务、断链/环/深度）← M5（resolve/物化/断链已实现）
6. UI：引用卡片、只读徽标、校验面板、警告态样式（引用卡片/只读徽标/警告态已实现；校验面板 M5）

### M4 实现记录（模板机制 + suggest 实体）

- `src/template/`：types / ts-loader（esbuild-wasm 转译 + new Function 隔离执行）/ service（双域扫描）/ suggest-context
- `/` 斜杠菜单「模板」组（`config.buildMenu` 扩展点；mountEditor 前 await ready() 确保注册表就绪）
- ref 菜单第二级实体：选文件 → 查 doctype+suggest（扩展名补全）→ 实体列表 → 插入 `[[path#object]]`
- resolve 阶段 `#` 消歧：suggest 命中对象 → object_ref（resolvedText）；否则保持 Obsidian 标题链接
- 基于模板新建：目录右键 → 模板选择器 → 文件名（自动补 .md）→ 复制模板内容
- 触发词防误触：beforeinput 跟踪最近键入（含 IME 组合文本），验证触发词是刚输入的（段落里旧 `[[` 不再误触发）

**M4 记录缺口**：① 占位符 `{{title}}` 以文本原样显示（chip 渲染待做）；② 全局模板域真实文件系统（外部目录）需 Rust 命令，v1 仅 mock 示例；③ 已打开编辑器不感知模板注册表变更（重开标签生效）

**M4 后续修复（用户反馈四问题）**：

1. **文件树 demo 目录无文件**：模板配套 `.rules.ts`/`.suggest.ts` 被 showAllFiles=false 隐藏 → 新增 `shouldShowInTree()`：模板域（`template/`）文件始终显示（mock/web/tauri 三端一致）
2. **@ 菜单 Enter 目录直接插入文件（多标签双重触发）**：多标签时多个菜单实例共享 window keydown 监听 → 加 `hasFocus()` + 容器 data-show 双守卫，仅活动编辑器且可见的实例处理按键
3. **文档尾部 @ 菜单位置在屏幕外**：
   - 根因①：菜单内容 v-if 渲染在定位后才显示 → flip 测量到 0 高 → 改为**树加载完成后手动 computePosition 重定位**（fixed 策略 + flip/shift，绕开 provider.update 避免递归）
   - 根因②：`.editor-pane`（滚动容器）与 offsetParent `.milkdown` 不一致 → absolute 坐标错乱 → `strategy: 'fixed'` 视口定位
   - 根因③：`matchTrigger` 固定优先级使段落旧 `[[` 抢占新输入 `@` → 改为收集候选取「终点离光标最近」者
   - 根因④：shouldShow 每次更新重置 mode 覆盖用户手动切换 → 加 `triggerKind`，仅触发词变化时重置
4. **@ 菜单卡顿（性能）**：
   - 锚点统计：`[menu-perf]` 控制台 + `window.__refMenuPerf`（每次打开耗时分布）—— 菜单打开 ~20-50ms（无卡点）
   - 真实卡点：**esbuild-wasm 首次初始化 ~1.5s**（suggest/rules 加载）→ 启动时后台预热（initialize + 首个 transform ~450ms 一次性开销）→ 首次 suggest 加载 1.5s → **~100ms**
   - 菜单打开不再每次 `fs.readTree`（按 treeVersion 缓存树）

**M4 后续修复 2（用户反馈五问题）**：

1. **数据/template 目录回车后无匹配**：`treeChildren` 的 walk 未命中返回 `[]`（真值）→ 第一个目录未命中就短路返回，只有第一个目录能进入 → 改为未命中返回 `null` + `found !== null` 判断
2. **中文输入法符号支持**：全角 `＠！【［】］` 归一化为半角后参与触发检测（`normalizeTriggers`，1:1 映射偏移不变；`recentTyped` 同步归一化）
3. **实体级引用体验**：根因是问题 1 的导航 bug（进不了子目录）；修复后 `@` → 目录 → 文件（有 doctype+suggest 如 笔记/周报）→ Enter 进入实体级
4. **快捷键调整**：Tab 切换模式；← 过滤模式清空过滤词回树 / 树模式返回上级（`back()` 只删过滤字符保留触发词）；→ 进入 hover 目录；Enter 选中（目录进入/文件插入）；Backspace 保留返回上级
5. **template 目录空（旧数据）**：合并条件增加「模板示例缺失」兜底（`template/demo/demo.md` 不在数据中就补缺）；新增 `window.__mockFsDebug()` 诊断钩子（返回 seededVersion/模板文件清单/总数，供用户复制 console 输出）

## 12. 未来工作（v2）

- 模板继承（extends）与规则合并优先级
- fs.watch 实时同步外部改动
- 目录级模板（整棵复制）
- Obsidian 标题链接冲突的进一步细化（对象/标题同名优先级已在 §6.2 定义）
- 三方合并 / 冲突解决 UI
- 模板市场/导入导出
