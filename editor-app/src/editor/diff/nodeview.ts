// M18 §4.1.2：diff 渲染实例自有 mermaid NodeView——身份免费 + eager/lazy 二分
//   · 身份免费：NodeView 构造时天然持有 node（fence 源码）与 getPos()——「这段栅栏是哪个」
//     不再需要从渲染回调反推；根元素挂 data-fence-id，图内标注的 scope 查询天然限定在
//     自己的 DOM 子树内（「querySelector 永取第一张 svg」类 bug 结构上不可能）。
//   · eager/lazy：查 FenceRegistry——变更栅栏 → eager（构造即渲染，与视口无关，计入 settle）；
//     未变更 → lazy（IntersectionObserver，行为与编辑器一致，不参与 settle）。
//   · 渲染代码路径与编辑器完全同源：renderMermaidSvg（mermaid.ts 导出）——
//     divergence 仅限挂载点与时机，渲染代码零分叉（§5 mermaid.ts 改造）。
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'
import type { LanguageDescription } from '@codemirror/language'
import { CodeMirrorBlock, codeBlockConfig } from '@milkdown/kit/component/code-block'
import { $view } from '@milkdown/kit/utils'
import { codeBlockSchema } from '@milkdown/preset-commonmark'
import { renderMermaidSvg, MermaidRenderError } from '../mermaid'
import { extractSequenceRows } from '../mermaid-diff'
import { fenceIdOf, normalizeFenceBody } from './fence-pair'
import type { FenceRegistry, FenceChange } from './model'
import { diagRenderUnit, degradedState } from './status'
import type { Ctx } from '@milkdown/kit/ctx'

/** settle 单元结果（§4.1.3 单点 settle） */
export interface UnitResult {
  fenceId: string
  ok: boolean
  reason?: string
}

/** 每渲染实例的 settle 收集器（自有代码编排；不追逐第三方时序） */
export class SettleCollector {
  private units = new Map<string, Promise<UnitResult>>()
  add(fenceId: string, p: Promise<UnitResult>) {
    this.units.set(fenceId, p)
  }
  get count() {
    return this.units.size
  }
  /** 单点 settle：Promise.allSettled + 5s 总超时兜底（超时单元按 degraded + reason 归因） */
  async settle(timeoutMs = 5000): Promise<Array<{ fenceId: string; ok: boolean; reason?: string }>> {
    if (!this.units.size) return []
    const guard = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('diff:render timeout')), timeoutMs)
    )
    try {
      const results = await Promise.race([Promise.allSettled(this.units.values()), guard])
      return results.map((r) => (r.status === 'fulfilled' ? r.value : { fenceId: '', ok: false, reason: String(r.reason) }))
    } catch {
      // 超时：全部未完成单元按 degraded 归因
      const out: Array<{ fenceId: string; ok: boolean; reason?: string }> = []
      for (const [fenceId, p] of this.units) {
        const settled = await Promise.race([
          p.then((v) => ({ done: true as const, v })),
          Promise.resolve({ done: false as const }),
        ])
        out.push(
          settled.done
            ? { fenceId, ok: settled.v.ok, reason: settled.v.reason }
            : { fenceId, ok: false, reason: 'settle-timeout' }
        )
      }
      return out
    }
  }
}

// ---------- diff 专用 mermaid NodeView ----------

export interface DiffMermaidViewOpts {
  registry: FenceRegistry
  settleCollector: SettleCollector
  /** eager 渲染开始回调（overlay/装饰一次性订阅 settle 后序） */
  onRenderStart?: (fenceId: string) => void
}

export class DiffMermaidNodeView implements NodeView {
  dom: HTMLElement
  private node: ProseNode
  private readonly view: EditorView
  private readonly opts: DiffMermaidViewOpts
  private readonly fenceId: string
  private readonly entry: FenceChange | null
  private disposed = false
  private io: IntersectionObserver | null = null

  constructor(node: ProseNode, view: EditorView, _getPos: () => number | undefined, opts: DiffMermaidViewOpts) {
    this.node = node
    this.view = view
    this.opts = opts
    this.fenceId = fenceIdOf(node.textContent ?? '')
    this.entry = opts.registry.fences.get(this.fenceId) ?? null

    this.dom = document.createElement('div')
    this.dom.className = 'milkdown-code-block diff-mermaid-fence'
    this.dom.setAttribute('data-fence-id', this.fenceId)
    // 占位（渲染前显示源码骨架，与编辑器一致：语言行 + 单调内容）
    const pre = document.createElement('pre')
    pre.className = 'milkdown-code-block-placeholder'
    const code = document.createElement('code')
    code.textContent = this.node.textContent
    pre.appendChild(code)
    this.dom.appendChild(pre)

    if (this.entry?.eager) {
      this.opts.onRenderStart?.(this.fenceId)
      void this.render()
    } else {
      // lazy：视口内再渲染（未变更图无需标注、不参与 settle，行为与编辑器一致）
      this.io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            this.io?.disconnect()
            this.io = null
            void this.render()
          }
        },
        { rootMargin: '200px' }
      )
      this.io.observe(this.dom)
    }
  }

  private render(): Promise<UnitResult> {
    // 先注册 settle 单元（构造期同步入册；render 完成时 settle 才可能被调用）
    const p = this.doRender()
    this.opts.settleCollector.add(this.fenceId, p)
    return p
  }

  private async doRender(): Promise<UnitResult> {
    const body = this.node.textContent ?? ''
    const result: UnitResult = { fenceId: this.fenceId, ok: true }
    try {
      const svg = await renderMermaidSvg(body)
      if (this.disposed) return result
      // 复用编辑器 preview 面板结构（样式同源）
      const panel = document.createElement('div')
      panel.className = 'preview-panel'
      const preview = document.createElement('div')
      preview.className = 'preview'
      preview.innerHTML = svg
      panel.appendChild(preview)
      // Issue：sequence 消息级红绿标注——合并源码已把删除消息插回原位，这里按 messageText
      // 内容匹配 add/del，给消息文字 + 对应 messageLine 上 diff-seq-add/del（绿/红）。
      this.applySequenceDiff(preview)
      // 移除占位
      const ph = this.dom.querySelector('.milkdown-code-block-placeholder')
      if (ph) ph.remove()
      this.dom.appendChild(panel)
      this.dom.setAttribute('data-rendered', 'true')
    } catch (e) {
      if (this.disposed) return result
      const reason = e instanceof MermaidRenderError ? e.message : String((e as Error)?.message ?? e)
      result.ok = false
      result.reason = reason
      // 降级可见（§4.5）：图内标注降级 + 保证层卡（源码对比由批注卡承载）
      const ph = this.dom.querySelector('.milkdown-code-block-placeholder')
      if (ph) ph.remove()
      const fail = document.createElement('div')
      fail.className = 'rd-mermaid-failed'
      fail.textContent = `⚠️ 图表渲染失败（已降级：见批注卡的源码对比）：${reason}`
      this.dom.appendChild(fail)
      diagRenderUnit(`mermaid:${this.fenceId}`, degradedState(reason, this.fenceId))
    }
    return result
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    // readonly 下 doc 不再变化；若 body 变了（防御）按身份重渲染需重建 NodeView
    return normalizeFenceBody(node.textContent ?? '') === normalizeFenceBody(this.node.textContent ?? '')
  }

  selectNode() {}
  deselectNode() {}

  /** sequence 消息级 diff 标注：按 messageText 内容匹配 entry.add/del（消息标签），
   *  绿（add）/红（del，含删除线）。line.messageLine{i} 与 text.messageText{i} 同序，尽力着色。 */
  private applySequenceDiff(panel: HTMLElement): void {
    const entry = this.entry
    if (!entry || entry.type !== 'sequence') return
    const addSet = new Set(entry.add)
    const delSet = new Set(entry.del)
    if (!addSet.size && !delSet.size) return
    const svg = panel.querySelector('svg')
    if (!svg) return
    const addCls = 'diff-seq-add'
    const delCls = 'diff-seq-del'
    const texts = [...svg.querySelectorAll('text.messageText')]
    texts.forEach((t, i) => {
      const m = (t.textContent || '').trim()
      const cls = addSet.has(m) ? addCls : delSet.has(m) ? delCls : null
      if (!cls) return
      t.classList.add(cls)
      svg.querySelectorAll('line.messageLine' + i).forEach((l) => l.classList.add(cls))
    })
  }

  stopEvent(): boolean {
    return !this.view.editable // readonly：拦截一切事件
  }

  destroy() {
    this.disposed = true
    this.io?.disconnect()
    this.io = null
    this.dom.remove()
  }
}

// ---------- code_block NodeView 覆写（优先级高于 components；非 mermaid 委托 CodeMirrorBlock） ----------

/** 最小语言加载器（对齐 components 内部 LanguageLoader 语义） */
class SimpleLanguageLoader {
  private readonly languages: LanguageDescription[]
  private readonly map: Record<string, LanguageDescription> = {}
  constructor(languages: LanguageDescription[]) {
    this.languages = languages
    for (const l of languages) for (const a of l.alias) this.map[a] = l
  }
  getAll() {
    return this.languages
  }
  load(languageName: string): Promise<unknown> {
    const language = this.map[languageName.toLowerCase()]
    if (!language) return Promise.resolve(undefined)
    if (language.support) return Promise.resolve(language.support)
    return language.load()
  }
}

/**
 * diff 渲染实例的自有 mermaid NodeView 插件。用法：`crepe.editor.use(createDiffMermaidNodeView(ctx, opts))`
 * ctx 为渲染实例的 Milkdown 上下文（拿到 codeBlockConfig 供非 mermaid 委托）；
 * opts 携带本次渲染的 FenceRegistry + SettleCollector（每实例闭包注入，禁模块级单例）。
 */
export function createDiffMermaidNodeView(opts: DiffMermaidViewOpts) {
  return $view(codeBlockSchema.node, (ctx: Ctx) => {
    const config = ctx.get(codeBlockConfig.key)
    const loader = new SimpleLanguageLoader(config.languages)
    return (node, view, getPos) => {
      const lang = String(node.attrs.language ?? '')
      if (lang.toLowerCase() === 'mermaid') {
        return new DiffMermaidNodeView(node, view, getPos, opts)
      }
      // 非 mermaid 代码块：完全委托编辑器默认 NodeView（readonly 下走 preview 面板，无功能分叉）
      return new CodeMirrorBlock(node as never, view as never, getPos as never, loader as never, config as never)
    }
  })
}

export type { FenceChange }