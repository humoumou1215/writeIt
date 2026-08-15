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

type CrepeFeatureConfig = NonNullable<
  ConstructorParameters<typeof Crepe>[0]
>['featureConfigs']

// 全局单例初始化（多标签共享同一 mermaid 实例）
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
let mermaidSeq = 0

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
        const run = (s: string, refs: string[]) =>
          mermaid
            .render(`mmd-${mermaidSeq++}`, escapeRefHash(s))
            // M9：foreignObject 内 [[path#frag]] 文本 → 可点击链接（去 [[ ]] 显示路径）
            // 再包裹放大镜按钮（悬停显示，点击 Lightbox 放大查看，ESC 关闭）
            .then(({ svg }) =>
              applyPreview(wrapMermaidPreview(linkifyMermaidRefs(svg, refs)))
            )
        ;(async () => {
          try {
            await run(src, [])
          } catch (err) {
            // M9 fallback：节点 label 里「未加引号」的 [[..]] 会让 mermaid parse error
            // （裸 [[ 解析为子程序节点形状）→ 换成可解析占位符再渲染；prepare 已剔除
            // 子程序节点形状（A[[x]]），避免破坏原生写法。
            if (!/\[\[.+?\]\]/.test(src)) throw err
            const prepared = prepareMermaidRefs(src)
            if (!prepared.refs.length) throw err
            await run(prepared.src, prepared.refs)
          }
        })().catch((err: unknown) => {
          console.error('[mermaid] 渲染失败:', err)
          const msg = err instanceof Error ? err.message : String(err)
          applyPreview(
            `<div style="color: var(--crepe-color-error, #ba1a1a)">⚠️ Mermaid 渲染失败：${msg}</div>`
          )
        })
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
