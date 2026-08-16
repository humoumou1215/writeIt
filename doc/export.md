# 导出功能（M10）

> 核心代码：`editor-app/src/export/`（types.ts / mdast.ts / docx.ts / pdf.ts / service.ts）+ `components/ExportModal.vue` + `src-tauri`（save_binary 命令）。
> 一句话：**图标列独立按钮（📤）把当前文档导出为 PDF / DOCX / Markdown**；模板目录有 `export.ts` 时按其定义导出。

## 1. 使用说明（用户视角）

1. 打开一个文件 → 左侧图标列点「📤 导出」→ 独立导出弹窗。
2. 查看「当前文件」与「模板类型」（doctype；有 `export.ts` 时显示徽标）。
3. 选择格式：自动 / PDF / DOCX / Markdown。
4. 点「📤 导出」：
   - **Tauri**：弹出保存对话框 → 选择位置 → 写入文件。
   - **浏览器（web/mock）**：直接下载到浏览器下载目录。
5. 结果 toast 提示（成功/取消/失败）。

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

## 2. 模板 `export.ts`（可选，与 rules/suggest 同范式）

模板目录下放 `<名称>.export.ts`（如 `.template/接口文档/接口文档.export.ts`），esbuild-wasm 转译执行：

```ts
import type { ExportContext, ExportResult } from '@milkdown-note/export'

export const format: 'pdf' | 'docx' | 'md' = 'docx'   // 默认格式（「自动」模式）
export const filename: string = '助贷接口文档'          // 可选：默认文件名（不含扩展名）

// 可选：完全自定义（返回 null = 走默认）
export const build = (ctx: ExportContext): ExportResult | null => ({
  format: 'pdf',
  filename: '接口-助贷',
  content: '# 标题\n' + ctx.content,   // 返回 markdown
})
```

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
}
```

## 3. 默认导出管线（无 export.ts）

```
当前文档 markdown
  → mdast（unified + remark-parse + remark-gfm + 复用 remark-ref / remark-annotation）
  → 嵌入块递归合并（![[path]] 读源文件内容：深度 ≤3、循环防护、失败降级为路径行）
  → 中间结构 ExportBlock（heading/paragraph/list/task/table/code/quote/hr）
  → DOCX（docx 库）  /  PDF（pdfmake + 内置字体）
```

自定义节点处理：

| 节点 | 导出表现 |
|---|---|
| `![[path]]` 嵌入块 | 递归读取源文件**合并内容**（源文件不存在/超深 → 路径说明行） |
| `[[path#对象]]`（suggest 命中） | 导出 **resolve 解析值**（如版本号）；未命中 → 标题/路径文本 |
| `[[path]]` / `[[path#标题]]` | 链接（DOCX 外部超链接 / PDF link 注解，可点击） |
| ` ```mermaid ` 代码块 | 渲染为 **PNG 图片**导出（md → data URI；PDF/DOCX → 内嵌位图）；渲染失败保留代码块 |
| `<mark data-note>` 批注 | 黄色高亮文本 |
| `doctype:` 首行 | 不导出 |
| 任务列表 `- [x]` | ☑ / ☐ 前缀 |

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
| `types.ts` | ExportContext / ExportResult / ExportModule / ExportOptions / ExportOutcome |
| `mdast.ts` | md → ExportBlock / 展开后 markdown（嵌入块递归合并 + 引用展示解析 + mermaid 渲染 + fileRef 转链接） |
| `docx.ts` | ExportBlock → DOCX Blob（docx 库；宋体/黑体/Consolas + 编号 + 表格边框 + 高亮） |
| `pdf.ts` | ExportBlock → PDF Blob（pdfmake；内置字体注册 + 段落/表格/代码/引用排版） |
| `service.ts` | 编排：内容 → doctype → export.ts → 转换 → 落盘；调试钩子 `__exportDebug` |
| `pdfmake.d.ts` | pdfmake 最小类型声明 |
| `template/service.ts` | 模板扫描扩展（`exportFile` 字段 + `ensureExport` 惰性加载） |
| `src-tauri/src/lib.rs` | `save_binary` 命令（base64 解码写盘） |
| `components/ExportModal.vue` | 导出弹窗 UI（图标列 📤 独立入口） |

## 7. 测试

`tests/e2e/export-e2e.js`（29 断言）：默认 PDF/DOCX/MD 导出（文件头验证）、独立导出弹窗 UI、**嵌入块导出包含内容**、**链接引用展示解析值**、**mermaid 渲染图片导出**、export.ts 自定义、无活动标签容错。全量回归 `npm run test:e2e`。
