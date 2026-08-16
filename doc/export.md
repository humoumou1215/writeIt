# 导出功能（M10）

> 核心代码：`editor-app/src/export/`（types.ts / mdast.ts / docx.ts / pdf.ts / service.ts）+ `components/ExportModal.vue` + `src-tauri`（save_binary 命令）。
> 一句话：**图标列独立按钮（📤）把当前文档导出为 PDF / DOCX / Markdown**；模板目录有 `export.ts` 时按其定义导出。

## 1. 使用说明（用户视角）

1. 打开一个文件 → 左侧图标列点「📤 导出」→ 独立导出弹窗（**左右两栏布局**）。
2. **左侧文件树**（较宽）：checkbox 多选 + 🔍 筛选输入框 + 全选/清空；目录可展开/收起；
   **默认勾选当前打开的文件**（并自动展开其所在目录）。
3. **右侧已选列表**：每个文件**独立选择导出模式**——
   - 有模板 `export.ts` 的文件：默认「模板(export.ts)」（按模板定义导出）；可选 PDF/DOCX/Markdown；
   - 无 `export.ts` 的文件：默认 **PDF**；可选 DOCX/Markdown。
4. 点「📤 导出（N 个）」：
   - **Tauri**：批量 → 选择保存目录全部写入；单文件 → 保存对话框。
   - **浏览器（web/mock）**：逐个下载到浏览器下载目录。
5. 结果 toast 提示（成功/失败计数）。

### 批量导出的文件名

- 批量导出文件名**沿用原文件名**（模板 `export.ts` 的自定义 filename 仅单文件导出生效），
  避免多个文件重名互相覆盖；模板定义的格式/内容转换仍生效（格式选「模板」时）。
- 内容：已打开的标签用编辑器最新内容（含未保存），未打开的文件读磁盘。

### 格式说明

| 格式 | 说明 |
|---|---|
| 自动 | 模板有 export.ts → 按其定义；无 → 默认 PDF |
| PDF | **内置思源黑体子集（GB2312 常用字），离线可用**；排版：标题/列表/表格/代码/引用/批注高亮 |
| DOCX | Word 文档（引用系统中文字体，无需嵌入）；排版与 PDF 对齐 |
| Markdown | 导出 .md（**嵌入块内容已展开**，非原文标记行） |

> 三种格式均会**展开嵌入块**：`![[path]]` / `![[path|ro]]` 的内容递归合并进导出文件（深度 ≤3、循环防护、源文件缺失时保留说明行）。
> **链接引用导出展示内容**：`[[path#对象]]` 命中模板 suggest 对象 → 导出其 resolve 解析值（如版本号 v0.2.1）；标题引用 → 标题文本；文件引用 → 路径。
> **Mermaid 代码块渲染为图片**：` ```mermaid ` 块在导出时渲染为 PNG 图片一并导出（md → data URI 图片；PDF/DOCX → 内嵌位图）。
> **数学公式渲染为图片**：`$...$` / `$$...$$` 用 katex 渲染为 PNG（md 导出保留原文可编辑）。
> 以上规则在**模板 export.ts 自定义时同样自动适用**（见 §2「公共规则」）。

## 2. 模板 `export.ts`（可选，与 rules/suggest 同范式）

模板目录下放 `<名称>.export.ts`（如 `.template/接口文档/接口文档.export.ts`），esbuild-wasm 转译执行：

```ts
import type { ExportContext, ExportResult } from '@milkdown-note/export'

export const format: 'pdf' | 'docx' | 'md' = 'docx'   // 默认格式（「自动」模式）
export const filename: string = '助贷接口文档'          // 可选：默认文件名（不含扩展名；仅单文件导出）

// 可选：完全自定义（返回 null = 走默认）
export const build = (ctx: ExportContext): ExportResult | null => ({
  format: 'pdf',
  filename: '接口-助贷',
  content: '# 标题\n' + ctx.content,   // 返回 markdown（自动套用公共规则）
})
```

### 示例：接口文档「对外版本」过滤（demo 已内置）

`接口文档.export.ts` 把文档转换为**提供给其他系统人员**的对外版本：

- 基本信息表仅保留对外行（方法/路径/版本号/业务范围/会调用该系统），删除内部评估行
  （是否关键接口/并发量/幂等规则/防重复机制/交易状态判断/外部接口引用）；
- 字段说明表仅保留列（字段/类型/长度/说明），删除内部列（是否高风险字段/高风险字段类型/数据来源）；
- 删除「变更记录」章节；请求示例/响应示例保留。

> 注意：编辑器序列化的表格是**对齐填充格式**（`| 项   | 值   |`），模板内用正则匹配表头，勿用 `startsWith`。
> **JSON/代码块对齐且可复制**：PDF 用 `preserveLeadingSpaces` + 等宽中文字体（WqyMono）保留行首缩进，DOCX 用 `break` 换行——均为**文本**（可选中复制），非图片。

```ts
interface ExportContext {
  path: string        // 相对路径
  name: string        // 文件名（无扩展名）
  doctype: string | null
  content: string     // 规范化 markdown（编辑器 getMarkdown）
  title: string       // 首行 # 标题（无则文件名）
}
interface ExportResult {
  format?: 'pdf' | 'docx' | 'md'
  filename?: string   // 不含扩展名
  content?: string    // markdown；缺省 = ctx.content
  raw?: boolean       // true = content 原样导出，跳过公共规则（仅 md 格式生效）
}
```

### 公共规则（export.ts 无需重复写，自动适用）

export.ts 只需写**差异**（format / filename / content），以下处理自动套用：

- 嵌入块 `![[path]]` 内容展开（含只读嵌入）
- 引用展示：`[[path#对象]]` → suggest resolve 值
- Mermaid 代码块 → 图片
- 数学公式 → katex 图片
- 普通图片 → 内嵌（可 fetch 的 http(s)/data URI）
- 表格对齐、代码语言标注、批注高亮、任务列表

若确实需要**原样输出**（跳过全部处理），在 build 返回或模块顶层声明 `raw: true`（仅 md 格式；pdf/docx 必须结构化，忽略此标记）。

## 3. 默认导出管线（无 export.ts）

```
当前文档 markdown
  → mdast（unified + remark-parse + remark-gfm + remark-math + 复用 remark-ref / remark-annotation）
  → 嵌入块递归合并（![[path]] 读源文件内容：深度 ≤3、循环防护、失败降级为路径行）
  → 引用展示解析（[[path#对象]] → suggest resolve 值 / 标题 / 路径）
  → mermaid 代码块 → PNG（htmlLabels:false 保证可 canvas 绘制）
  → katex 公式 → PNG（offscreen DOM + html2canvas，仅 pdf/docx）
  → 普通图片 fetch → data URI（可嵌入时）
  → 中间结构 ExportBlock（heading/paragraph/list/task/table/code/quote/hr/image）
  → DOCX（docx 库）  /  PDF（pdfmake + 内置字体）  /  md（remark-stringify，公式保留原文）
```

自定义节点处理：

| 节点 | 导出表现 |
|---|---|
| `![[path]]` 嵌入块 | 递归读取源文件**合并内容**（源文件不存在/超深 → 路径说明行） |
| `[[path#对象]]`（suggest 命中） | 导出 **resolve 解析值**（如版本号）；未命中 → 标题/路径文本 |
| `[[path]]` / `[[path#标题]]` | 链接（DOCX 外部超链接 / PDF link 注解，可点击） |
| ` ```mermaid ` 代码块 | 渲染为 **PNG 图片**导出（md → data URI；PDF/DOCX → 内嵌位图）；渲染失败保留代码块 |
| ` ```json ` 等代码块 | **文本导出（可复制）**：PDF `preserveLeadingSpaces` 保留缩进 + 等宽字体；DOCX `break` 换行；md 保留原样 |
| `$...$` / `$$...$$` 公式 | **katex 渲染为 PNG**（PDF/DOCX）；md 导出保留原文（$..$ / latex 代码块） |
| `![alt](url)` 普通图片 | 可 fetch 的 http(s)/data URI → 内嵌图片；失败降级文本（md 保留原链接） |
| `<mark data-note>` 批注 | 黄色高亮文本 |
| `doctype:` 首行 | 不导出 |
| 任务列表 `- [x]` | ☑ / ☐ 前缀 |
| 表格对齐 | `---:` / `:---:` 声明 → PDF/DOCX 单元格对齐 |
| 代码块 | 语言标注（TS/JSON/SQL…）+ 背景；**不做语法高亮**（已知差距） |

## 4. 中文字体（PDF）

- **Noto Sans CJK SC（思源黑体）** GB2312 常用字子集，Regular + Bold 双字重（各 ~3MB）。
- 位于 `src/export/assets/`，Vite `?url` 打包为静态资源（不进 JS bundle）。
- 运行时 `fetch → base64` 注册进 pdfmake vfs（**懒加载 + 幂等**，只做一次）。
- 子集化脚本历史：fonttools pyftsubset（`python3 -m fontTools.subset … --text-file=chars.txt`，字符集 = GB2312 6763 汉字 + ASCII + 全角标点）。
- 不覆盖生僻字（CJK 扩展区）——业务文档常用字均在 GB2312 内。

## 5. 落盘（三后端）

| 后端 | 方式 |
|---|---|
| tauri | `@tauri-apps/plugin-dialog` save 对话框 → Rust `save_binary` 命令（base64 → Vec<u8> 写盘，绝对路径） |
| web / mock | Blob → `a[download]` 浏览器下载 |

## 6. 关键文件

| 文件 | 职责 |
|---|---|
| `types.ts` | ExportContext / ExportResult（含 raw）/ ExportModule / ExportOptions / ExportOutcome / BatchExportOutcome |
| `mdast.ts` | md → ExportBlock / 展开后 markdown（嵌入块递归合并 + 引用展示解析 + mermaid/katex 渲染 + 图片 fetch + fileRef 转链接） |
| `docx.ts` | ExportBlock → DOCX Blob（docx 库；宋体/黑体/Consolas + 编号 + 表格边框 + 高亮 + 对齐 + 语言标注 + 行内图片） |
| `pdf.ts` | ExportBlock → PDF Blob（pdfmake；内置字体注册 + 段落/表格/代码/引用/对齐/语言标注/行内图片排版） |
| `service.ts` | 编排：单文件 exportActiveTab / 批量 exportFiles（tauri 选目录 / 浏览器逐个下载）；调试钩子 `__exportDebug` / `__exportDebugMany` |
| `pdfmake.d.ts` | pdfmake 最小类型声明 |
| `template/service.ts` | 模板扫描扩展（`exportFile` 字段 + `ensureExport` 惰性加载） |
| `src-tauri/src/lib.rs` | `save_binary` 命令（base64 解码写盘） |
| `components/ExportModal.vue` | 导出弹窗 UI（图标列 📤 独立入口） |

## 7. 已知差距（与页面渲染的差异，v1 接受）

| 场景 | 页面 | 导出 | 说明 |
|---|---|---|---|
| 代码语法高亮 | CodeMirror 高亮 | 语言标注 + 背景 | 高亮库体积大、文档价值有限；如需可后续加 |
| HTML 块/内联 | 渲染 HTML | 原样文本 | 文档格式不支持任意 HTML |
| 网络图片跨域 | 显示 | 降级文本 | CORS/离线限制；本地/同源可嵌入 |

## 8. 测试

`tests/e2e/export-e2e.js`（56 断言）：默认 PDF/DOCX/MD 导出（文件头验证）、导出弹窗左右布局 + 文件树多选/筛选/默认勾选、**每文件独立导出模式**、批量导出、嵌入块导出包含内容、链接引用展示解析值、mermaid 渲染图片导出、katex 公式渲染图片导出、**JSON 代码块文本可复制（PDF 文本层含内容 + DOCX w:br 换行）**、接口文档对外版本过滤、export.ts 自定义 + 公共规则、无活动标签容错。全量回归 `npm run test:e2e`。
