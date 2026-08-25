// ref 插件包配置切片（P0：去除对 app 模块的直接 import，装配层注入依赖）
// 设计：refPlugin 内部所有 fs / toast / templateService / app 回调
// 一律经 `refConfigCtx` 读取——插件包不再 import ../../fs、../../state/store、../../template/service。
// 注入时机：`crepe.editor.config((ctx) => ctx.set(refConfigCtx.key, cfg))`（use(refPlugin) 之前，
// config 回调在 ConfigReady timer 内执行，先于所有 $prose/schema 插件工厂）。
import { $ctx } from '@milkdown/kit/utils'
import type { Editor } from '@milkdown/kit/core'
import type { Node } from '@milkdown/kit/prose/model'
import type { FsEntry } from '../../fs/types'
import type { SuggestObject, Template } from '../../template/types'

/** ref 插件实际用到的最小文件系统接口（fs 抽象的子集） */
export interface RefFs {
  readFile(path: string): Promise<string>
  readTree(showAll?: boolean): Promise<FsEntry[]>
  writeFile(path: string, content: string): Promise<void>
}

/** ref 插件实际用到的模板服务接口（TemplateService 的子集） */
export interface RefTemplateService {
  get(doctype: string): Template | undefined
  ensureSuggest(tpl: Template): Promise<SuggestObject[] | null>
  loadSuggestForFile(
    path: string,
    parser?: (src: string) => Node | null
  ): Promise<SuggestObject[] | null>
  loadHeadingsForFile(
    path: string
  ): Promise<Array<{ id: string; label: string; kind: 'heading' }> | null>
}

/** 装配层注入的 ref 配置 */
export interface RefConfig {
  fs: RefFs
  toast: (msg: string, kind?: 'success' | 'error' | 'info') => void
  /** 引用 chip 点击打开目标文件（含 #片段滚动）；由 app 装配层实现 */
  openFile: (path: string, fragment: string | null) => void
  /** 断链 chip 点击 → 打开替换菜单；由 app 装配层实现 */
  reSelect: (path: string) => void
  /** 文件树版本号（菜单树缓存失效依据） */
  getTreeVersion: () => number
  /** 当前文档（宿主）路径——嵌入链判定的链根；经理打开 tab 时注入；
   *  diff 视图注入被 diff 的文件路径。未保存新文件时为 null：自嵌/宿主在链中的环
   *  无法检测（降级为仅深度折叠），保存后重新判定即可检测。 */
  hostPath?: string | null
  /** P2：本编辑器所属标签 id（registry 视图注册/广播定位用；diff 渲染视图无标签 → 不注册） */
  tabId?: string
  /** 源文件是否在标签中打开且有「真实未保存编辑」（userEditedAt > lastExternalSyncAt，
   *  区别于联动/写回触发的预览刷新）。宿主保存写回前询问——避免宿主块内容覆盖源标签的
   *  未保存编辑（最后保存者胜 + 提示）。由装配层实现；未提供时不启用该守卫。 */
  isTabUserEdited?: (realPath: string) => boolean
  templateService: RefTemplateService
  /** 系统复制（OS 文件管理器）的绝对路径 → 工作区引用路径：
   *  工作区内返回相对路径；无根路径/工作区外返回文件名（Obsidian 式全库匹配）；
   *  由装配层实现（有 fs.rootPath 全量能力），插件包不做系统路径转换。 */
  resolveExternalPath?: (absPath: string) => string
}

/** ref 配置切片（$ctx 插件：注册进容器时默认 null；装配层 config 回调 set 覆盖）。
 *  refPlugin 需整体 use(refConfigCtx)，插件内部 ctx.get(refConfigCtx.key) 读取。 */
export const refConfigCtx = $ctx<RefConfig | null, 'refConfig'>(null, 'refConfig')

/** 从编辑器 ctx 读取 ref 配置（运行时调用；未注入返回 null） */
export function getRefConfig(editor: Editor): RefConfig | null {
  return editor.action((ctx) => ctx.get(refConfigCtx.key))
}
