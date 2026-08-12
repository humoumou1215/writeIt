// 每个 Crepe 实例的 feature 配置组合：
//   Mermaid（代码块预览 + 斜杠菜单分组）
//   模板组（/ 菜单「模板」分组，设计文档 §4.4 —— buildMenu 扩展点）
import type { Ctx } from '@milkdown/kit/ctx'
import { commandsCtx, editorCtx } from '@milkdown/kit/core'
import { clearTextInCurrentBlockCommand } from '@milkdown/kit/preset/commonmark'
import { insert } from '@milkdown/kit/utils'

import { mermaidFeatureConfigs } from './mermaid'
import { templateService } from '../template/service'
import type { Template } from '../template/types'
import { resolveRefs } from './ref/resolve'

type CrepeFeatureConfig = NonNullable<
  ConstructorParameters<typeof import('@milkdown/crepe').Crepe>[0]
>['featureConfigs']

// 模板图标（菱形 + 虚线，区别于 mermaid 鱼）
const templateIcon = `
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <rect x="5" y="3" width="14" height="18" rx="2"/>
    <path d="M9 8h6M9 12h6M9 16h3"/>
  </svg>`

/** 光标处实例化模板内容（复制内容，与模板无链接关系；占位符 v1 原样文本） */
async function insertTemplateAtCursor(ctx: Ctx, tpl: Template) {
  try {
    const commands = ctx.get(commandsCtx)
    const editor = ctx.get(editorCtx)
    commands.call(clearTextInCurrentBlockCommand.key)
    insert(tpl.content)(ctx)
    // 模板中的 ![[…]] 引用块异步物化（容错：失败不影响插入）
    void resolveRefs(editor)
  } catch (e) {
    console.error('[template] 插入失败:', e)
  }
}

/** 每个 Crepe 实例都应用这套 feature 配置（mermaid + 模板） */
export function featureConfigs(): CrepeFeatureConfig {
  const base = mermaidFeatureConfigs() ?? {}
  const blockEdit = base['block-edit']
  return {
    ...base,
    'block-edit': {
      ...blockEdit,
      buildMenu: (builder) => {
        blockEdit?.buildMenu?.(builder)
        // 模板组：注册全部已扫描模板（mountEditor 前已 await templateService.ready()）
        const g = builder.addGroup('template', '模板')
        for (const tpl of templateService.list()) {
          g.addItem(`template-${tpl.doctype}`, {
            label: tpl.name,
            icon: templateIcon,
            onRun: (ctx) => {
              void insertTemplateAtCursor(ctx, tpl)
            },
          })
        }
      },
    },
  }
}
