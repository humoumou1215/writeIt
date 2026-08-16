# 模板机制（M4）

> 核心代码：`editor-app/src/template/`（service.ts / ts-loader.ts / suggest-context.ts / types.ts）。
> 设计文档：`editor-app/docs/design.md` §4。
> 一句话：**一个目录 = 一个模板 = 一份 Markdown + 可选配套 TypeScript 规则**，运行时用 esbuild-wasm 转译执行 TS，实现"结构查询 + 对象引用 + 自动校验"。

## 1. 模板域结构

```
.template/                     ← 工作区模板域（根目录下的隐藏目录，树中始终显示）
└── <名称>/                    ← 一个模板一个目录
    ├── <名称>.md              ← 模板正文（首行 doctype:<值>）
    ├── <名称>.rules.ts        ← 可选：校验规则（M5）
    ├── <名称>.suggest.ts      ← 可选：对象引用定义（M4）
    └── <名称>.export.ts       ← 可选：导出定义（M10，见 [导出功能](export.md)）
```

- `doctype` 是模板的**唯一标识**（首行 `doctype:xxx`，支持中文、排除 `#` 防与标题冲突）。
- 配套 TS 文件命名：`<名称>.rules.ts` / `<名称>.suggest.ts` / `<名称>.export.ts`（同目录同名）。
- **双域扫描**：工作区 `.template/` + 全局模板域（mock 内置示例；真实文件系统外部目录 v1.5 缺口）；同名 doctype **工作区优先**。
- **热扫描**：文件树变化（新建/删除/重命名）自动 `rescan()`，斜杠菜单每次打开时重新 buildMenu，即时生效。

## 2. 使用说明（用户视角）

### 基于模板新建

1. 目录右键 → 「新建自模板」→ 弹出模板选择器（TemplatePicker）。
2. 选择 doctype → 生成 `<名称>.md`（内容 = 模板正文，自动带 doctype 首行，从而继承 rules/suggest）。

### 插入模板内容

- 输入 `/` → 斜杠菜单「模板」组 → 选中即插入模板内容（复制，与模板无链接）。
- 模板中的 `![[…]]` 引用块插入后自动物化。

### 写一个模板

1. 建目录 `.template/周报/`，写 `周报.md`：

```markdown
doctype:周报

# 周报

{{title}}

## 本周进展

- 

## 版本

v0.1.0
```

2. 可选：写 `周报.suggest.ts` 定义可被 `[[路径#对象]]` 引用的对象（见下）。
3. 可选：写 `周报.rules.ts` 定义校验规则（见 [校验机制](validation.md)）。

## 3. suggest.ts（对象引用）

```ts
import type { SuggestContext, SuggestObject } from '@milkdown-note/suggest'

export const objects: SuggestObject[] = [
  {
    id: 'version',                      // 被 [[path#version]] 引用
    label: '版本号',
    fragment: '版本',                   // 点击跳转的标题锚点（缺省 = 文件顶部）
    resolve: (ctx) => ctx.headingText(1, /^版本/) ?? 'unknown',
  },
]

// 可选：动态对象生成器（M7）——按被引用文件的 ctx 现场生成（如"字段说明表"的每个字段）
export const objectsFor = (ctx: SuggestContext): SuggestObject[] => {
  const table = ctx.tableAfterHeading('字段说明')
  return (table ?? []).map((row, i) => ({
    id: `field-${i}`,
    label: row[0] ?? `字段${i}`,
    fragment: '字段说明',
    resolve: () => row[1] ?? '',
  }))
}
```

### SuggestContext API（结构查询工具）

| 方法 | 作用 |
|---|---|
| `findText(re)` | 取第一个匹配正则的段落纯文本（无则 null） |
| `headingText(level, re)` | 指定级别的标题纯文本 |
| `paragraphAfterHeading(level, re)` | 指定标题后的第一个段落文本 |
| `taskCount(re?)` / `taskProgress(re?)` / `firstTask(re?)` | 任务列表数量 / 完成率（"2/5"）/ 首个任务 |
| `firstTableCell(rowIdx, colIdx, re?)` | 表格指定单元格文本 |
| `tableAfterHeading(heading)` | 标题后第一个表格的全部行单元格（含表头） |
| `allText()` | 全部段落纯文本拼接 |

> 名字、展示内容、跳转锚点全在 TS 里定义——**模板域的 TS 是可信区**（esbuild-wasm 转译后在隔离环境执行）。

## 4. rules.ts（校验规则）

```ts
import type { ValidationContext, Rule } from '@milkdown-note/validate'

export const mode: 'hint' | 'strict' = 'hint'           // strict = 保存前把关
export const report = { enabled: true, path: '.validate/report.md' }  // 可选：报告落盘

export const rules: Rule[] = [
  {
    id: 'require-version',
    label: '版本章节必填',
    run(ctx) {
      if (!ctx.findHeading(/^## 版本/)) {
        ctx.violation('缺少「## 版本」章节', 'error')
      }
    },
  },
]
```

ValidationContext API 与执行细节见 [校验机制](validation.md)。

## 5. 主要实现方式

### 扫描与注册（`service.ts`）

- `ready()`：幂等扫描（工作区 + 全局），失败降级为空注册表。
- `scanTemplateDir`：读取 `<name>.md` → `extractDoctype`（首行正则）→ 记录配套 rules/suggest 路径。
- `ensureSuggest(tpl)` / `ensureRules(tpl)`：**惰性加载**（缓存到 Template 对象，空结果也算已加载）。

### TS 运行时加载（`ts-loader.ts`）

- **esbuild-wasm** 转译 TS（浏览器内，无 Node 依赖）→ `new Function` 隔离执行 → 取模块导出。
- 初始化 + 首个 transform 各 ~450ms 一次性开销 → **启动时后台预热**（`warmupTsLoader`），首次 suggest 从 1.5s 降到 ~100ms。

### 斜杠菜单集成（`features.ts`）

- `block-edit.buildMenu` 扩展点：`builder.addGroup('template', '模板')`，遍历 `templateService.list()` 注册全部模板。
- 插入：`clearTextInCurrentBlockCommand` + `insert(tpl.content)`，插入后 `resolveRefs` 物化模板内引用。
- 模板图标：菱形虚线 SVG（区别于 Mermaid 鱼形）。

### 基于模板新建

`createFromTemplate(path, doctype)`：`fs.createFile` + 写入模板内容 → 新文件继承 doctype → 自动关联 rules/suggest。

### 占位符（M9）

`{{title}}` 等占位符 v1 为原样文本，`placeholder.ts` 提供 decoration 渲染（代码块内保留字面）。

## 6. 关键文件

| 文件 | 职责 |
|---|---|
| `service.ts` | 双域扫描 / 注册表 / suggest & rules 惰性加载 / 标题实体提取 |
| `ts-loader.ts` | esbuild-wasm 转译 + 隔离执行 + 预热 |
| `suggest-context.ts` | SuggestContext 实现（mdast 结构查询） |
| `types.ts` | SuggestObject / Rule / ValidationContext / Template 类型 |
| `editor/features.ts` | 斜杠菜单「模板」组 + 批注工具条集成 |
