// 模板机制的类型定义（设计文档 §4.2）
// rules.ts / suggest.ts 为模板域内 TypeScript 文件，运行时经 esbuild-wasm 转译执行。
// 类型标注仅用于开发期提示；运行时由 esbuild 擦除（import type）。

// ---------- suggest.ts ----------

/** suggest.ts 提供给对象引用解析的结构查询上下文 */
export interface SuggestContext {
  /** 取第一个匹配正则的段落纯文本；无匹配返回 null */
  findText(re: RegExp): string[] | null
  /** 取指定标题级别、匹配正则的标题纯文本；无匹配返回 null */
  headingText(level: number, re: RegExp): string | null
  /** 取指定标题级别、匹配正则的标题之后的第一个段落文本；无匹配返回 null */
  paragraphAfterHeading(level: number, re: RegExp): string | null
  /** 任务列表数量（- [ ] / - [x]；re 可选过滤）；无则 null */
  taskCount(re?: RegExp): string | null
  /** 任务完成率（如 "2/5"）；无任务则 null */
  taskProgress(re?: RegExp): string | null
  /** 首个任务文本（re 可选过滤）；无则 null */
  firstTask(re?: RegExp): string | null
  /** 首个表格指定单元格文本（re 可选过滤）；无则 null */
  firstTableCell(rowIdx: number, colIdx: number, re?: RegExp): string | null
  /** 全部段落纯文本拼接 */
  allText(): string
}

/** suggest.ts 定义的一个可被 [[path#object]] 引用的对象 */
export interface SuggestObject {
  id: string
  label: string
  /** 点击引用时跳转的标题锚点（如 '版本' → 滚动到 ## 版本）；缺省 = 文件顶部 */
  fragment?: string
  resolve(ctx: SuggestContext): string | null
}

/** suggest.ts 模块导出形状 */
export interface SuggestModule {
  objects: SuggestObject[]
}

// ---------- rules.ts ----------

/** rules.ts 提供给规则执行的结构查询上下文（M5 ValidateService 完整实现） */
export interface ValidationContext {
  /** 查找某个标题后的表格（返回表格上下文或 null） */
  findTableAfterHeading(heading: string): unknown
  /** 无位置的整体违规 */
  violation(message: string, level?: 'warning' | 'error'): void
  /** 带位置的违规（decorations 标注用） */
  violationAt(pos: number, message: string, level?: 'warning' | 'error'): void
}

export interface Rule {
  id: string
  label: string
  run(ctx: ValidationContext): void
}

/** rules.ts 模块导出形状 */
export interface RulesModule {
  mode?: 'hint' | 'strict'
  report?: { enabled?: boolean; path?: string }
  rules: Rule[]
}

// ---------- 模板注册表 ----------

export type TemplateDomain = 'workspace' | 'global'

export interface Template {
  /** doctype 标识（模板 md 首行 doctype:<value>） */
  doctype: string
  /** 展示名（默认取目录名） */
  name: string
  /** 模板 md 完整内容 */
  content: string
  domain: TemplateDomain
  /** 模板 md 文件的路径（工作区相对根；全局域为绝对/标识路径） */
  path: string
  /** 模板目录（md / rules.ts / suggest.ts 所在目录） */
  dir: string
  /** 配套 suggest.ts 路径（无则 null） */
  suggestFile: string | null
  /** 配套 rules.ts 路径（无则 null） */
  rulesFile: string | null
  /** 惰性加载的 suggest 对象（M4） */
  suggestObjects: SuggestObject[] | null
  /** 惰性加载的 rules 模块（M5） */
  rules: RulesModule | null
}

// 模板 TS 配套文件的相对路径模式：<dir>/<name>.rules.ts / <dir>/<name>.suggest.ts
export const RULES_FILE_SUFFIX = '.rules.ts'
export const SUGGEST_FILE_SUFFIX = '.suggest.ts'
