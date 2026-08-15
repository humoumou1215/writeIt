// ref 菜单共享内核：纯逻辑（触发检测 / 树缓存 / 实体级加载 / 导航状态机）
// 供两个适配器复用，避免重复实现：
//   1. 正文（ProseMirror slash 菜单）—— ref/menu/index.ts
//   2. mermaid 代码块 @ 联想 —— editor/mermaid-ref.ts
// 设计：所有函数操作「传入的 state 实例」，不绑定任何编辑器（view/cm）；
// 唯一例外 back()（删除过滤词）依赖编辑器，留在各适配器实现。
import { reactive } from 'vue'
import type { FsEntry } from '../../../fs/types'
import type { RefConfig } from '../config'

export type RefMode = 'link' | 'embed' | 'embed-ro'

export interface EntityItem {
  id: string
  label: string
  kind: 'file' | 'object' | 'heading'
  fragment?: string | null
}

/** 菜单状态形状（RefMenu.vue 依赖；正文/联想各持有独立 reactive 实例） */
export interface RefMenuState {
  visible: boolean
  mode: RefMode
  query: string
  tree: FsEntry[]
  /** 触发词在文档中的范围（删除用） */
  triggerFrom: number
  triggerTo: number
  /** 文件树导航：当前所在目录（'' = 根） */
  currentDir: string
  /** 第二级：选中文件（有 suggest 时进入实体级） */
  selectedPath: string | null
  /** 第二级：实体列表（首项=文件本身，其后 suggest 对象 / Obsidian 标题） */
  entities: EntityItem[]
  /** 最近键入的字符（验证触发词是刚输入的，避免段落里旧 [[ 误触发） */
  recentTyped: string
  /** 当前触发词类型（仅触发词变化时重置模式，不覆盖用户手动选择） */
  triggerKind: '@' | '[[' | '![[' | null
  /** 替换模式：非空时 select 替换该位置上的节点（断链重选） */
  replacePos: number | null
  /** 替换模式的输入起点（光标位置，用于计算过滤词与替换范围） */
  replaceStart: number
  /** 被替换的旧引用路径（按路径重查节点，避免位置漂移） */
  replacePath: string | null
}

export function createRefMenuState(): RefMenuState {
  return reactive<RefMenuState>({
    visible: false,
    mode: 'link',
    query: '',
    tree: [],
    triggerFrom: 0,
    triggerTo: 0,
    currentDir: '',
    selectedPath: null,
    entities: [],
    recentTyped: '',
    triggerKind: null,
    replacePos: null,
    replaceStart: 0,
    replacePath: null,
  })
}

// ---------- 触发检测（全角归一化 + @ / [[ / ![[ 候选） ----------

// 全角符号 → 半角（中文输入法输出的 ＠！【 等也能触发对应功能）
const FULLWIDTH_MAP: Record<string, string> = {
  '＠': '@',
  '！': '!',
  '【': '[',
  '［': '[',
  '】': ']',
  '］': ']',
}

export function normalizeTriggers(text: string): string {
  let out = text
  for (const [fw, hw] of Object.entries(FULLWIDTH_MAP)) {
    if (out.includes(fw)) out = out.split(fw).join(hw)
  }
  return out
}

export interface TriggerMatch {
  mode: RefMode
  query: string
  /** 触发词类型（用于验证最近键入） */
  kind: '@' | '[[' | '![[' | null
  /** 触发词在文本中的起始偏移（@ 指向 @ 本身，[[ 指向第一个 [） */
  start: number
}

export function matchTrigger(raw: string): TriggerMatch | null {
  // 检测层归一化全角符号（1:1 字符映射，偏移不变）；文档文本保持原样
  const text = normalizeTriggers(raw)
  // 收集全部候选触发词，取「终点离光标最近」者（同终点取更长更具体的触发词）。
  // 这样段落里更早的旧 [[ 不会抢占新输入的 @ / [[（触发词后不能有 ] = 已完成引用）。
  const cands: TriggerMatch[] = []
  const embedIdx = text.lastIndexOf('![[')
  if (embedIdx >= 0 && !text.slice(embedIdx + 3).includes(']')) {
    cands.push({ mode: 'embed', query: text.slice(embedIdx + 3), start: embedIdx, kind: '![[' })
  }
  const linkIdx = text.lastIndexOf('[[')
  if (linkIdx >= 0 && !text.slice(linkIdx + 2).includes(']')) {
    cands.push({ mode: 'link', query: text.slice(linkIdx + 2), start: linkIdx, kind: '[[' })
  }
  // @（边界感知：块首或前一字符为空白）
  const at = /(?:^|\s)@([^\s]*)$/.exec(text)
  if (at) {
    const atStart = text.length - at[1].length - 1
    cands.push({ mode: 'link', query: at[1], start: atStart, kind: '@' })
  }
  if (!cands.length) return null
  const end = (t: TriggerMatch) => t.start + (t.kind?.length ?? 0)
  cands.sort((a, b) => end(b) - end(a) || (b.kind?.length ?? 0) - (a.kind?.length ?? 0))
  return cands[0]
}

// ---------- 树缓存加载 ----------

let menuTreeCache: { version: number; tree: FsEntry[] } | null = null

/** 联想树过滤：剔除 . 开头目录（.template/.git 等隐藏目录不进联想；文件保留） */
function filterHiddenDirs(list: FsEntry[]): FsEntry[] {
  const out: FsEntry[] = []
  for (const e of list) {
    if (e.kind === 'dir') {
      if (e.name.startsWith('.')) continue
      out.push({ ...e, children: e.children ? filterHiddenDirs(e.children) : [] })
    } else {
      out.push(e)
    }
  }
  return out
}

/** 树缓存：按 cfg.getTreeVersion() 失效；结果写入传入的 state（隐藏目录已过滤） */
export async function loadTree(cfg: RefConfig, state: RefMenuState): Promise<void> {
  try {
    const v = cfg.getTreeVersion()
    if (menuTreeCache && menuTreeCache.version === v) {
      state.tree = menuTreeCache.tree
      return
    }
    const tree = filterHiddenDirs(await cfg.fs.readTree(true))
    menuTreeCache = { version: v, tree }
    state.tree = tree
  } catch {
    state.tree = []
  }
}

// ---------- 实体级加载（suggest 对象 / Obsidian 标题） ----------

export interface EntitiesResult {
  fileSelf: EntityItem
  entities: EntityItem[]
}

/**
 * 选中文件 → 实体级数据（设计文档 §6.2）：
 *   有 suggest.ts → 模板对象实体；无 suggest → Obsidian 标题实体；
 *   无内容 → 返回 null（调用方回落为普通链接）。
 * parser 可选：传入时运行 objectsFor 合并动态对象（正文有 parserCtx；mermaid 联想无 → 仅静态对象）。
 */
export async function loadEntitiesForPath(
  cfg: RefConfig,
  path: string,
  parser?: (src: string) => import('@milkdown/kit/prose/model').Node | null
): Promise<EntitiesResult | null> {
  const fileSelf: EntityItem = {
    id: '',
    label: path.split('/').pop()?.replace(/\.(md|markdown|txt)$/i, '') ?? path,
    kind: 'file',
  }
  const objs = await cfg.templateService.loadSuggestForFile(path, parser)
  if (objs && objs.length) {
    return {
      fileSelf,
      entities: [
        fileSelf,
        ...objs.map((o) => ({
          id: o.id,
          label: o.label,
          kind: 'object' as const,
          fragment: o.fragment ?? null,
        })),
      ],
    }
  }
  const headings = await cfg.templateService.loadHeadingsForFile(path)
  if (headings && headings.length) {
    return { fileSelf, entities: [fileSelf, ...headings] }
  }
  return null
}

// ---------- 导航状态机（操作传入的 state 实例） ----------

/** 进入目录 */
export function enterDir(state: RefMenuState, dir: string): void {
  state.currentDir = dir
  state.query = ''
}

/** 返回上级目录 */
export function goUp(state: RefMenuState): void {
  state.currentDir = state.currentDir.includes('/')
    ? state.currentDir.slice(0, state.currentDir.lastIndexOf('/'))
    : ''
}

/** 进入实体级（suggest 对象 / Obsidian 标题） */
export function openEntities(
  state: RefMenuState,
  path: string,
  entities: EntityItem[]
): void {
  state.selectedPath = path
  state.entities = entities
}

/** 返回文件级 */
export function closeEntities(state: RefMenuState): void {
  state.selectedPath = null
  state.entities = []
}
