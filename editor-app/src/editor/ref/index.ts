// 引用机制插件包：注册 4 个自定义节点 + file_block NodeView
// 用法：crepe.editor.use(refPlugin)（必须在 create 之前）
import { $prose, $remark, $view } from '@milkdown/kit/utils'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { doctypeSchema, fileRefSchema, objectRefSchema, fileBlockSchema } from './nodes'
import { fileBlockView } from './file-block-view'
import { remarkRef } from './remark-ref'
import { configureRefMenu, refMenu } from './menu'
import {
  refClickPlugin,
  readonlyGuardPlugin,
  brokenRefPlugin,
} from './app-plugin'

import './styles.css'

export { doctypeSchema, fileRefSchema, objectRefSchema, fileBlockSchema } from './nodes'
export { resolveRefs } from './resolve'

const fileBlockNodeView = $view(fileBlockSchema.node, fileBlockView)
const remarkRefPlugin = $remark('remarkRef', () => remarkRef as never)

/** 配置引用菜单（必须在 refMenu 插件读取 spec 前执行） */
const refMenuConfig: MilkdownPlugin = (ctx) => async () => {
  try {
    configureRefMenu(ctx)
  } catch (e) {
    console.error('[ref] 菜单配置失败', e)
  }
  return () => {}
}

/** 注册所有引用节点与视图（$remark/$nodeSchema 是 [ctx, plugin] 元组，需整体展开） */
export const refPlugin: MilkdownPlugin[] = [
  ...remarkRefPlugin,
  ...doctypeSchema,
  ...fileRefSchema,
  ...objectRefSchema,
  ...fileBlockSchema,
  fileBlockNodeView,
  refMenuConfig,
  ...refMenu,
  $prose(() => refClickPlugin),
  $prose(() => readonlyGuardPlugin),
  $prose(() => brokenRefPlugin),
]
