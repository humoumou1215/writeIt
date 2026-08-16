// 接口文档模板的导出定义（M10 导出机制）
// 模板目录存在本文件时，设置 → 导出 → 「自动」模式按此处定义导出。
// 说明：import type 与类型标注在运行时被 esbuild 擦除，无运行时依赖。
import type { ExportContext, ExportResult } from '@milkdown-note/export'

/** 默认导出格式（「自动」模式；pdf | docx | md） */
export const format: 'pdf' | 'docx' | 'md' = 'docx'

/** 默认导出文件名（不含扩展名） */
export const filename: string = '接口文档-导出'

/** 可选：完全自定义导出内容（返回 null = 使用文档原文） */
export const build = (ctx: ExportContext): ExportResult | null => {
  // 在文档头部加一个生成说明块（ctx 提供 path/name/doctype/content/title）
  const content =
    `# ${ctx.title}\n\n` +
    `> 本文档由「${ctx.doctype ?? '未知'}」模板的 export.ts 生成。\n\n` +
    ctx.content
  return { content }
}
