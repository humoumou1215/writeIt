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
      renderPreview: (language: string, content: string, applyPreview) => {
        if (language.toLowerCase() !== 'mermaid') return null
        // 返回 undefined → code-block 先显示 loading，渲染完成后 applyPreview(svg)
        mermaid
          .render(`mmd-${mermaidSeq++}`, content)
          // 包裹放大镜按钮（悬停显示，点击 Lightbox 放大查看，ESC 关闭）
          .then(({ svg }) => applyPreview(wrapMermaidPreview(svg)))
          .catch((err: unknown) => {
            console.error('[mermaid] 渲染失败:', err)
            const msg = err instanceof Error ? err.message : String(err)
            applyPreview(
              `<div style="color: var(--crepe-color-error, #ba1a1a)">⚠️ Mermaid 渲染失败：${msg}</div>`
            )
          })
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
