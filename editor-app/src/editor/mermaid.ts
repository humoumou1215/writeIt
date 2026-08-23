// Mermaid 图表能力（从 editor/ 子项目移植，适配多标签场景）：
//  1. CodeMirror 代码块预览钩子：language=mermaid 时渲染 SVG
//  2. BlockEdit 斜杠菜单：/ 菜单新增「Mermaid」分组（精选 8 种模板）
// mermaid 全局只初始化一次；返回的配置是纯函数，可安全应用于每个 Crepe 实例。
import type { Crepe } from '@milkdown/crepe'
import { commandsCtx } from '@milkdown/kit/core'
import { clearTextInCurrentBlockCommand } from '@milkdown/kit/preset/commonmark'
import { insert } from '@milkdown/kit/utils'
import mermaid from 'mermaid'
import { MERMAID_SLASH_ITEMS } from './mermaid-diagrams'
import { wrapMermaidPreview } from './mermaid-zoom'
import {
  linkifyMermaidRefs,
  mermaidRefMenuExtension,
  prepareMermaidRefs,
  escapeRefHash,
} from './mermaid-ref'
// 诊断埋点（D2）：mermaid 渲染成功/失败/耗时
import { diag, diagEvent } from '../diagnostics/logger'

type CrepeFeatureConfig = NonNullable<
  ConstructorParameters<typeof Crepe>[0]
>['featureConfigs']

// 全局单例初始化（多标签共享同一 mermaid 实例）
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
let mermaidSeq = 0

// ---------- M18 §5：可复用的 mermaid 渲染纯函数（编辑器 preview 与 diff 自有 NodeView 共用，零分叉） ----------

/** 渲染失败信号（区别于语法错误与静默降级；toString 即展示文案） */
export class MermaidRenderError extends Error {}

/**
 * mermaid source → 渲染后 SVG HTML（escapeRefHash → mermaid.render → linkifyMermaidRefs →
 * wrapMermaidPreview）。与编辑器 preview 面板共用同一条代码路径（§4.1.2：divergence 仅限挂载点）。
 * 失败抛 MermaidRenderError（不带 DOM/调用栈依赖，node 可测）。
 */
export async function renderMermaidSvg(src: string): Promise<string> {
  const t0 = performance.now()
  const run = async (s: string, refs: string[]): Promise<string> => {
    const { svg } = await mermaid.render(`mmd-${mermaidSeq++}`, escapeRefHash(s))
    diagEvent('mermaid:render', {
      target: 'mermaid',
      ok: true,
      ms: performance.now() - t0,
      data: { srcLen: s.length, refs: refs.length },
    })
    // M9：foreignObject 内 [[path#frag]] 文本 → 可点击链接（去 [[ ]] 显示路径）
    // 再包裹放大镜按钮（悬停显示，点击 Lightbox 放大查看，ESC 关闭）
    return wrapMermaidPreview(linkifyMermaidRefs(svg, refs))
  }
  try {
    return await run(src, [])
  } catch (err) {
    // M9 fallback：节点 label 里「未加引号」的 [[..]] 会让 mermaid parse error
    // （裸 [[ 解析为子程序节点形状）→ 换成可解析占位符再渲染；prepare 已剔除
    // 子程序节点形状（A[[x]]），避免破坏原生写法。
    if (!/\[\[.+?\]\]/.test(src)) {
      diagEvent('mermaid:render', {
        target: 'mermaid',
        ok: false,
        ms: performance.now() - t0,
        data: { error: err instanceof Error ? err.message : String(err) },
      })
      throw new MermaidRenderError(err instanceof Error ? err.message : String(err))
    }
    const prepared = prepareMermaidRefs(src)
    if (!prepared.refs.length) {
      diagEvent('mermaid:render', {
        target: 'mermaid',
        ok: false,
        ms: performance.now() - t0,
        data: { error: err instanceof Error ? err.message : String(err) },
      })
      throw new MermaidRenderError(err instanceof Error ? err.message : String(err))
    }
    try {
      return await run(prepared.src, prepared.refs)
    } catch (err2) {
      diagEvent('mermaid:render', {
        target: 'mermaid',
        ok: false,
        ms: performance.now() - t0,
        data: { error: err2 instanceof Error ? err2.message : String(err2) },
      })
      throw new MermaidRenderError(err2 instanceof Error ? err2.message : String(err2))
    }
  }
}

// Mermaid 鱼形图标（斜杠命令菜单）
const mermaidIcon = `
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
    <path fill="currentColor" d="M2 12C5 7.5 8.5 5.5 12 5.5c2.8 0 5.3 1.3 7 3.6l2.4 2.9-2.4 2.9c-1.7 2.3-4.2 3.6-7 3.6-3.5 0-7-2-10-6.5z"/>
    <circle cx="18" cy="12" r="1.3"/>
  </svg>`

/** 每个 Crepe 实例都应用这套 feature 配置 */
export function mermaidFeatureConfigs(): CrepeFeatureConfig {
  return {
    // ---- 代码块预览：任意 ```mermaid 代码块右上角 👁 按钮渲染 SVG ----
    'code-mirror': {
      // M9：mermaid 代码块内 @ / [[ 联想（复用 ref 菜单内核；非 mermaid 代码块自动忽略）
      extensions: [mermaidRefMenuExtension],
      renderPreview: (language: string, content: string, applyPreview) => {
        if (language.toLowerCase() !== 'mermaid') return null
        const src = String(content)
        // M18：与 diff 自有 NodeView 共用同一条渲染路径（renderMermaidSvg）——零分叉
        ;(async () => {
          const t0 = performance.now()
          try {
            const svg = await renderMermaidSvg(src)
            diagEvent('mermaid:render', {
              target: `${language.toLowerCase()}`,
              ok: true,
              ms: performance.now() - t0,
              data: { srcLen: src.length },
            })
            applyPreview(svg)
          } catch (err) {
            console.error('[mermaid] 渲染失败:', err)
            const msg = err instanceof Error ? err.message : String(err)
            diag('error', 'mermaid', `渲染失败: ${msg}（源码片段: ${src.slice(0, 200)}）`)
            diagEvent('mermaid:render', { target: 'mermaid', ok: false, ms: performance.now() - t0, data: { error: msg } })
            applyPreview(
              `<div style="color: var(--crepe-color-error, #ba1a1a)">⚠️ Mermaid 渲染失败：${msg}</div>`
            )
          }
        })()
        // 返回 undefined → code-block 先显示 loading，渲染完成后 applyPreview(svg)
        return undefined
      },
    },

    // ---- 斜杠命令：/ 菜单「Mermaid」分组（8 种常用模板，插入带示例的代码块）----
    'block-edit': {
      buildMenu: (builder) => {
        const g = builder.addGroup('mermaid', 'Mermaid')
        for (const item of MERMAID_SLASH_ITEMS) {
          g.addItem(item.key, {
            label: item.label,
            icon: mermaidIcon,
            onRun: (ctx) => {
              const commands = ctx.get(commandsCtx)
              commands.call(clearTextInCurrentBlockCommand.key)
              insert('```mermaid\n' + item.example + '\n```\n\n')(ctx)
            },
          })
        }
      },
    },
  }
}
