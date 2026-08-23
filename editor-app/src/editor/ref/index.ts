// 引用机制插件包：注册 4 个自定义节点 + file_block NodeView
// 用法：crepe.editor.use(refPlugin)（必须在 create 之前）
// P0：插件包不 import app 模块——fs/toast/模板服务/打开文件回调一律经 refConfigCtx 注入（见 config.ts）。
import { $prose, $remark, $view } from '@milkdown/kit/utils'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { doctypeSchema, fileRefSchema, objectRefSchema, fileBlockSchema } from './nodes'
import { fileBlockView } from './file-block-view'
import { remarkRef } from './remark-ref'
import { configureRefMenu, refMenu } from './menu'
import {
  createRefClickPlugin,
  readonlyGuardPlugin,
  brokenRefPlugin,
} from './app-plugin'
import { placeholderDecorationPlugin } from './placeholder'
import { editorMenuPlugin } from './editor-menu'
import { refConfigCtx } from './config'
import { installClipboardWatch } from './clipboard-core'

import './styles.css'

// 全局剪贴板失效监听（用户复制了别的内容 → 内部剪贴板作废，防陈旧引用误粘贴）。
// 模块加载即注册一次（幂等；无 document 环境自动跳过）
installClipboardWatch()

export { doctypeSchema, fileRefSchema, objectRefSchema, fileBlockSchema } from './nodes'
export { resolveRefs } from './resolve'
export { refConfigCtx, getRefConfig } from './config'
export type { RefConfig, RefFs, RefTemplateService } from './config'

const fileBlockNodeView = $view(fileBlockSchema.node, fileBlockView)
const remarkRefPlugin = $remark('remarkRef', () => remarkRef as never)

/** 配置引用菜单（必须在 refMenu 插件读取 spec 前执行；配置读取依赖 refConfigCtx 注入） */
const refMenuConfig: MilkdownPlugin = (ctx) => async () => {
  try {
    configureRefMenu(ctx)
  } catch (e) {
    console.error('[ref] 菜单配置失败', e)
  }
  return () => {}
}

/** 注册所有引用节点与视图（$remark/$nodeSchema/$ctx 是 [ctx, plugin] 元组，需整体展开） */
export const refPlugin: MilkdownPlugin[] = [
  refConfigCtx,
  ...remarkRefPlugin,
  ...doctypeSchema,
  ...fileRefSchema,
  ...objectRefSchema,
  ...fileBlockSchema,
  fileBlockNodeView,
  refMenuConfig,
  ...refMenu,
  $prose((ctx) => {
    // P0：点击跳转/断链重选回调经 cfg 注入（未注入时降级为无操作插件）
    const cfg = ctx.get(refConfigCtx.key)
    return cfg
      ? createRefClickPlugin(cfg)
      : new Plugin({ key: new PluginKey('REF_CLICK') })
  }),
  $prose(() => readonlyGuardPlugin),
  $prose(() => brokenRefPlugin),
  // M9：{{}} 占位符渲染（decoration，不改内容；代码块内保留字面）
  $prose(() => placeholderDecorationPlugin),
  // 文件引用粘贴（Ctrl+V）+ 编辑器自定义右键菜单（替代默认 contextmenu）
  editorMenuPlugin,
]
