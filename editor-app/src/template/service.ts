// TemplateService（设计文档 §4）
// 双域扫描：工作区 <root>/template/<name>/ + 全局模板目录（mock 内置示例；真实文件系统外部目录 → v1.5 缺口）
// 优先级：工作区 > 全局（同名 doctype 工作区覆盖）
// 原则：旁路异步服务 —— 扫描失败只降级（toast / console），不阻塞编辑器。
import { fs } from '../fs'
import type { FsEntry } from '../fs/types'
import { joinPath } from '../fs/types'
import { toast } from '../state/store'
import type { Template, TemplateDomain, SuggestModule, RulesModule, SuggestObject } from './types'
import { RULES_FILE_SUFFIX, SUGGEST_FILE_SUFFIX } from './types'
import { loadTsModule } from './ts-loader'

const WORKSPACE_TEMPLATE_DIR = 'template'
// doctype 支持中文与任意非空白字符（中文模板名是普通用户常态；排除 # 防与 markdown 标题冲突）
const DOCTYPE_RE = /^doctype\s*:\s*([^\s#]+)\s*$/

/** 取文件内容的首行 doctype；无则返回 null */
export function extractDoctype(content: string): string | null {
  const firstLine = content.split('\n')[0]?.trim() ?? ''
  const m = DOCTYPE_RE.exec(firstLine)
  return m ? m[1] : null
}

/** 全局域读取器：mock 用内置示例（含读取函数）；真实文件系统外部目录 v1 暂不支持 */
async function readGlobalDomain(): Promise<{ tree: FsEntry[]; readFile: (p: string) => Promise<string> }> {
  if (fs.kind === 'mock') {
    const { mockGlobalTemplates, mockGlobalReadFile } = await import('../fs/mock')
    return { tree: mockGlobalTemplates(), readFile: mockGlobalReadFile }
  }
  return { tree: [], readFile: (p) => fs.readFile(p) }
}

class TemplateService {
  private registry = new Map<string, Template>()
  private scanPromise: Promise<void> | null = null

  /** 幂等扫描；失败也 resolve（降级为空注册表） */
  ready(): Promise<void> {
    if (!this.scanPromise) {
      this.scanPromise = this.scan().catch((e) => {
        console.error('[template] 扫描失败:', e)
      })
    }
    return this.scanPromise
  }

  private pendingRescan: Promise<void> | null = null

  /** 强制重新扫描（文件树变化时自动调用；并发调用合并为一次，末尾重扫兜底） */
  rescan(): Promise<void> {
    if (this.pendingRescan) return this.pendingRescan
    this.pendingRescan = this.doRescan().finally(() => {
      this.pendingRescan = null
    })
    return this.pendingRescan
  }

  private async doRescan(): Promise<void> {
    // 等待进行中的扫描完成后再重扫（避免与 ready() 并发重复扫描）
    if (this.scanPromise) {
      try {
        await this.scanPromise
      } catch {
        /* 忽略 */
      }
    }
    this.scanPromise = null
    await this.ready()
  }

  private async scan(): Promise<void> {
    const found: Template[] = []
    // ---- 工作区域 ----
    try {
      const tree = await fs.readTree(true)
      const templateDir = tree.find((n) => n.kind === 'dir' && n.path === WORKSPACE_TEMPLATE_DIR)
      if (templateDir?.children) {
        for (const sub of templateDir.children) {
          if (sub.kind !== 'dir') continue
          const tpl = await this.scanTemplateDir(sub, 'workspace')
          if (tpl) found.push(tpl)
        }
      }
    } catch (e) {
      console.warn('[template] 工作区扫描失败:', e)
    }
    // ---- 全局域（工作区优先，同名 doctype 不覆盖）----
    try {
      const global = await readGlobalDomain()
      const globalDir = global.tree.find((n) => n.kind === 'dir' && n.name === WORKSPACE_TEMPLATE_DIR)
      for (const sub of globalDir?.children ?? []) {
        if (sub.kind !== 'dir') continue
        const tpl = await this.scanTemplateDir(sub, 'global', global.readFile)
        if (tpl) found.push(tpl)
      }
    } catch (e) {
      console.warn('[template] 全局模板扫描失败:', e)
    }

    const next = new Map<string, Template>()
    for (const tpl of found) {
      if (!next.has(tpl.doctype)) next.set(tpl.doctype, tpl)
    }
    this.registry = next
  }

  /** 扫描一个模板目录：读取 <name>.md（含 doctype 首行）+ 记录配套 rules/suggest 路径 */
  private async scanTemplateDir(
    dirEntry: FsEntry,
    domain: TemplateDomain,
    readFile: (p: string) => Promise<string> = (p) => fs.readFile(p)
  ): Promise<Template | null> {
    const name = dirEntry.name
    const mdPath = joinPath(dirEntry.path, name + '.md')
    let content: string
    try {
      content = await readFile(mdPath)
    } catch {
      // 目录里没有与目录同名的 .md → 不是模板目录
      return null
    }
    const doctype = extractDoctype(content)
    if (!doctype) return null
    const children = dirEntry.children ?? []
    const fileOf = (suffix: string) =>
      children.some((c) => c.kind === 'file' && c.name === name + suffix)
        ? joinPath(dirEntry.path, name + suffix)
        : null
    return {
      doctype,
      name,
      content,
      domain,
      path: mdPath,
      dir: dirEntry.path,
      suggestFile: fileOf(SUGGEST_FILE_SUFFIX),
      rulesFile: fileOf(RULES_FILE_SUFFIX),
      suggestObjects: null,
      rules: null,
    }
  }

  list(): Template[] {
    return [...this.registry.values()]
  }

  get(doctype: string): Template | undefined {
    return this.registry.get(doctype)
  }

  /** 模板配套 TS 文件的读取器（全局域 mock 用内置示例；其余走 fs） */
  private readerFor(tpl: Template) {
    if (tpl.domain === 'global' && fs.kind === 'mock') {
      return (p: string) =>
        import('../fs/mock').then((m) => m.mockGlobalReadFile(p))
    }
    return (p: string) => fs.readFile(p)
  }

  /** 惰性加载 suggest 模块（缓存到 Template 上；失败/无文件返回 null） */
  async ensureSuggest(tpl: Template): Promise<SuggestObject[] | null> {
    if (tpl.suggestObjects !== null || !tpl.suggestFile) return tpl.suggestObjects
    const mod = await loadTsModule<SuggestModule>(
      tpl.suggestFile,
      this.readerFor(tpl)
    )
    tpl.suggestObjects = Array.isArray(mod?.objects) && mod.objects.length ? mod.objects : null
    return tpl.suggestObjects
  }

  /** 惰性加载 rules 模块（M5 ValidateService 使用；M4 仅验证可加载） */
  async ensureRules(tpl: Template): Promise<RulesModule | null> {
    if (tpl.rules !== null || !tpl.rulesFile) return tpl.rules
    tpl.rules = await loadTsModule<RulesModule>(
      tpl.rulesFile,
      this.readerFor(tpl)
    )
    return tpl.rules
  }

  /**
   * 按文件路径解析其 doctype 并返回 suggest 对象（ref 菜单第二级用）。
   * 返回 null = 无模板 / 无 suggest（调用方按普通文件处理）。
   */
  async loadSuggestForFile(path: string): Promise<SuggestObject[] | null> {
    // 路径可能已去扩展名（菜单 strip），补常见扩展名
    const candidates = [path, `${path}.md`, `${path}.markdown`, `${path}.txt`]
    for (const c of candidates) {
      try {
        const content = await fs.readFile(c)
        const doctype = extractDoctype(content)
        if (!doctype) return null
        const tpl = this.get(doctype)
        if (!tpl) return null
        return await this.ensureSuggest(tpl)
      } catch {
        /* 继续尝试下一候选 */
      }
    }
    return null
  }

  /**
   * 读取文件并返回标题实体列表（Obsidian 模式，设计文档 §6.2）：
   * 无 suggest.ts 的文件按标题链接引用（# 标题）。
   * 返回 [{ id: 标题文本, label: 标题文本, kind: 'heading' }]；读取失败返回 null。
   */
  async loadHeadingsForFile(path: string): Promise<Array<{ id: string; label: string; kind: 'heading' }> | null> {
    const candidates = [path, `${path}.md`, `${path}.markdown`, `${path}.txt`]
    for (const c of candidates) {
      try {
        const content = await fs.readFile(c)
        const headings: Array<{ id: string; label: string; kind: 'heading' }> = []
        for (const line of content.split('\n')) {
          const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
          if (m) {
            const text = m[2].trim()
            if (text && !text.startsWith('doctype:')) {
              headings.push({ id: text, label: text, kind: 'heading' })
            }
          }
        }
        return headings
      } catch {
        /* 继续尝试下一候选 */
      }
    }
    return null
  }

  /** 新建文件：从模板复制内容（继承 doctype → 自动关联 rules/suggest） */
  async createFromTemplate(path: string, doctype: string): Promise<void> {
    const tpl = this.get(doctype)
    if (!tpl) throw new Error(`模板不存在: ${doctype}`)
    await fs.createFile(path)
    await fs.writeFile(path, tpl.content)
  }
}

export const templateService = new TemplateService()

export { toast as templateToast }
