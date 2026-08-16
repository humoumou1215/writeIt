// 导出机制的类型定义
// export.ts 为模板域内 TypeScript 文件，运行时经 esbuild-wasm 转译执行（与 rules.ts / suggest.ts 同范式）。
// 模板有 export.ts → 按定义导出（格式/文件名/内容）；无 → 默认把 markdown 导出为 pdf / docx。

/** 导出目标格式 */
export type ExportFormat = 'pdf' | 'docx' | 'md'

/** export.ts 提供给导出函数的上下文 */
export interface ExportContext {
  /** 文件相对路径（可能不含扩展名） */
  path: string
  /** 文件名（不含扩展名） */
  name: string
  /** 文档 doctype（首行 doctype:xxx；无则 null） */
  doctype: string | null
  /** 规范化 markdown 内容（编辑器 getMarkdown 产物） */
  content: string
  /** 文档标题（首行 # 标题；无则文件名） */
  title: string
}

/** export.ts 的导出结果 */
export interface ExportResult {
  /** 目标格式（缺省 = 用户选择 或 模块默认 format） */
  format?: ExportFormat
  /** 导出文件名（不含扩展名；缺省 = 上下文文件名） */
  filename?: string
  /** 导出内容（markdown；缺省 = ctx.content） */
  content?: string
  /**
   * true = content 原样导出，跳过公共处理管线（嵌入块展开 / 引用展示 / mermaid 渲染 / 图片嵌入）。
   * 仅 md 格式生效；pdf/docx 必须结构化，忽略此标记。缺省 false = 自动套用公共规则。
   */
  raw?: boolean
}

/** export.ts 模块导出形状 */
export interface ExportModule {
  /** 默认导出格式（「自动」模式且无 build 时使用） */
  format?: ExportFormat
  /** 默认导出文件名（不含扩展名） */
  filename?: string
  /** 可选：自定义导出内容/格式/文件名；返回 null = 走默认 */
  build?: (ctx: ExportContext) => ExportResult | null
  /** 可选：true = 默认内容跳过公共处理管线（仅 md 格式生效） */
  raw?: boolean
}

/** 导出选项（设置弹窗「导出」页签传入） */
export interface ExportOptions {
  /** 'auto' = 跟随模板 export.ts；无模板/无 export.ts 时回落到默认格式 */
  format: ExportFormat | 'auto'
}

/** 导出结果摘要（toast / 调试钩子用） */
export interface ExportOutcome {
  ok: boolean
  format?: ExportFormat
  filename?: string
  /** tauri：保存到的绝对路径；web/mock：下载文件名 */
  savedPath?: string
  /** 字节数（pdf/docx）或字符数（md） */
  size?: number
  error?: string
  /** 是否走了模板 export.ts 自定义 */
  usedExportTs?: boolean
}
