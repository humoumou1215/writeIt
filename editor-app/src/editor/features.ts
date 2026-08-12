// 每个 Crepe 实例的 feature 配置组合：
//   Mermaid（代码块预览 + 斜杠菜单分组）
//   模板组（/ 菜单「模板」分组，设计文档 §4.4 —— buildMenu 扩展点）
import type { Ctx } from '@milkdown/kit/ctx'
import { commandsCtx, editorCtx, editorViewCtx } from '@milkdown/kit/core'
import { clearTextInCurrentBlockCommand } from '@milkdown/kit/preset/commonmark'
import { insert } from '@milkdown/kit/utils'

import { mermaidFeatureConfigs } from './mermaid'
import { templateService } from '../template/service'
import type { Template } from '../template/types'
import { resolveRefs } from './ref/resolve'
import { showAnnotationInput } from '../annotations/card'

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

// 批注图标（对话气泡）
const annotationIcon = `
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
  </svg>`

/** 每个 Crepe 实例都应用这套 feature 配置（mermaid + 模板 + 批注） */
export function featureConfigs(): CrepeFeatureConfig {
  const base = mermaidFeatureConfigs() ?? {}
  const blockEdit = base['block-edit']
  return {
    ...base,
    // M6：选中文本工具条加「添加批注」（与加粗/标黄等放一起）
    'toolbar': {
      ...(base['toolbar'] ?? {}),
      buildToolbar: (builder) => {
        base['toolbar']?.buildToolbar?.(builder)
        const g = builder.addGroup('annotation', '批注')
        // ToolbarItem 类型缺口：onRun 在运行时被使用但未声明 → 断言到 addItem 参数类型
        type AddItemParam = Parameters<typeof g.addItem>[1]
        const annotationItem = {
          label: '添加批注',
          icon: annotationIcon,
          active: () => false,
          onRun: ((ctx: Ctx) => {
            const view = ctx.get(editorViewCtx)
            const editor = ctx.get(editorCtx)
            const { from, to } = view.state.selection
            if (to <= from) return
            showAnnotationInput(editor, from, to)
          }) as unknown,
        } as AddItemParam
        g.addItem('add-annotation', annotationItem)
      },
    },
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
