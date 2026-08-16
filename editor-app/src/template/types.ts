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
  /** 取标题（支持「## 标题」前缀，或正则）之后第一个表格的全部行单元格文本（含表头行）；无返回 null */
  tableAfterHeading(heading: string | RegExp): string[][] | null
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
  /** 静态对象（扫描期加载，id 固定） */
  objects?: SuggestObject[]
  /** 动态对象生成器：按被引用文件的 ctx 现场生成对象（如「字段说明表」的每个字段）；
   *  与 objects 合并；id 不得与静态对象冲突 */
  objectsFor?: (ctx: SuggestContext) => SuggestObject[]
}

// ---------- rules.ts ----------

/** 表格单元格：文本 + 在文档中的位置（decorations 标注用） */
export interface TableCell {
  /** 单元格纯文本 */
  text(): string
  /** 单元格在文档中的位置（pos） */
  pos: number
}

/** 代码块（fence）：内容 + 语言 + 位置（rules 解析 JSON/YAML 等用） */
export interface CodeBlock {
  /** 代码块纯文本内容 */
  content: string
  /** 语言标识（```json 的 json；无则空串） */
  language: string
  /** 代码块在文档中的位置 */
  pos: number
}

/** 表格行：单元格集合 */
export interface TableRow {
  /** 第 i 列单元格（越界返回空单元格，不抛错） */
  cell(i: number): TableCell
  /** 全部单元格 */
  cells(): TableCell[]
  /** 行在文档中的位置 */
  pos: number
}

/** 表格上下文（dataRows 排除表头行） */
export interface TableContext {
  /** 表头行（无则 null） */
  headerRow(): TableRow | null
  /** 全部行 */
  rows(): TableRow[]
  /** 数据行（跳过表头） */
  dataRows(): TableRow[]
  /** 按行列取单元格（越界返回 null） */
  cell(row: number, col: number): TableCell | null
  /** 表格在文档中的位置 */
  pos: number
}

/** rules.ts 提供给规则执行的结构查询上下文（M5 ValidateService 完整实现） */
export interface ValidationContext {
  /** 查找匹配正则/文本的标题后的第一个表格（标题可带 ## 前缀；无则 null） */
  findTableAfterHeading(heading: string | RegExp): TableContext | null
  /** 查找匹配文本/正则的标题位置（无则 null） */
  findHeading(heading: string | RegExp): { level: number; text: string; pos: number } | null
  /** 取第一个匹配正则的段落纯文本（无则 null） */
  findText(re: RegExp): string | null
  /** 文档纯文本（用于 count/正则检查；不含代码块内容） */
  allText(): string
  /** 查找代码块（fence）：languageRe 可选过滤语言（如 /^json$/i）；无返回 null */
  findCodeBlocks(languageRe?: RegExp): CodeBlock[] | null
  /** 无位置的整体违规 */
  violation(message: string, level?: 'warning' | 'error'): void
  /** 带位置的违规（decorations 标注用；pos 越界自动忽略） */
  violationAt(pos: number, message: string, level?: 'warning' | 'error'): void
  /** 设置当前规则身份（service 执行前调用，用于违规归属） */
  setRule(id: string, label: string): void
}

/** 校验结果（一次运行的全部违规） */
export interface Violation {
  /** 规则 id */
  ruleId: string
  /** 规则名 */
  label: string
  message: string
  level: 'warning' | 'error'
  /** decorations 标注位置；null = 整体违规（仅面板/报告） */
  pos: number | null
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
  /** 配套 export.ts 路径（无则 null；导出机制，见 src/export/types.ts） */
  exportFile: string | null
  /** 惰性加载的 suggest 对象（M4；静态） */
  suggestObjects: SuggestObject[] | null
  /** 惰性加载的动态对象生成器（M7；objectsFor） */
  suggestFactory: ((ctx: SuggestContext) => SuggestObject[]) | null
  /** suggest 模块是否已加载（防重复加载：空 objects 也可能是已加载结果） */
  suggestLoaded: boolean
  /** 惰性加载的 rules 模块（M5） */
  rules: RulesModule | null
}

// 模板 TS 配套文件的相对路径模式：<dir>/<name>.rules.ts / <dir>/<name>.suggest.ts / <dir>/<name>.export.ts
export const RULES_FILE_SUFFIX = '.rules.ts'
export const SUGGEST_FILE_SUFFIX = '.suggest.ts'
export const EXPORT_FILE_SUFFIX = '.export.ts'
