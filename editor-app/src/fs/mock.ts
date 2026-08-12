// localStorage 模拟文件系统 —— 无需任何宿主即可在浏览器里完整体验
// 数据结构：{ files: { [path]: content }, dirs: string[] }
import type { FileSystem, FsEntry, FsBackendKind } from './types'
import { shouldShowInTree, dirName, baseName } from './types'
import demoMd from '../editor/demo.md?raw'
import mermaidMd from '../editor/mermaid.md?raw'

const KEY = 'milkdown-note-mock-fs-v2'

const SAMPLE: Record<string, string> = {
  'README.md': demoMd,
  'Mermaid 图表集.md': mermaidMd,
  '笔记/会议记录.md': `# 会议记录

## 2026-08-11 周会

- [x] 讨论编辑器方案：确定 Tauri + Vue + Crepe
- [ ] 搭建文件树 CRUD
- [ ] 多标签页编辑
- [ ] Windows 打包

| 事项 | 负责人 | 状态 |
| --- | --- | --- |
| 前端 Demo | Pi | ✅ |
| Tauri 壳 | Pi | 🚧 |
| 安装包 | 待定 | ⏳ |

\`\`\`js
// 代码块支持语言选择（CodeMirror）
console.log('hello milkdown note')
\`\`\`

行内公式 $E = mc^2$，以及块级公式：

\`\`\`latex
\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}
\`\`\``,
  '笔记/待办清单.md': `# 待办清单

- [ ] 支持自动保存
- [ ] 文件树右键菜单
- [ ] 多标签页
- [ ] 主题适配
- [x] 搭建工程`,
  '数据/原始数据.txt': `这是一段纯文本文件（.txt）。

Milkdown 也能编辑 txt，以 Markdown 语法渲染。

2026-08-11 00:00`,
  'template/demo/demo.md': `doctype:demo

# 周报模板

{{title}}

## 本周进展

- 

## 下周计划

- 

## 版本

v0.1.0

## 需求

| 前置 | 后置 |
| --- | --- |
| A | B |
`,
  'template/demo/demo.rules.ts': `import type { ValidationContext, Rule } from '@milkdown-note/validate'

// 校验模式：hint 默认不阻止保存（M5 ValidateService 消费）
export const mode: 'hint' | 'strict' = 'hint'

export const rules: Rule[] = [
  {
    id: 'table-acceptance',
    label: '需求表：前置列非空则后置列必填',
    run(ctx: ValidationContext) {
      const table = ctx.findTableAfterHeading('## 需求')
      if (!table) return ctx.violation('缺少「需求」表格')
    },
  },
]
`,
  'template/demo/demo.suggest.ts': `import type { SuggestContext, SuggestObject } from '@milkdown-note/suggest'

// 模板对象：可被 [[path#对象id]] 引用；名字（label）与展示内容（resolve）完全在 TS 中自定义
export const objects: SuggestObject[] = [
  {
    id: 'greeting',
    label: '问候语',
    resolve(ctx: SuggestContext): string | null {
      return ctx.findText(/^你好/)?.[0] ?? null
    },
  },
  {
    id: 'version',
    label: '版本号',
    // 点击引用时跳转到 ## 版本 标题
    fragment: '版本',
    resolve(ctx: SuggestContext) {
      // 取「## 版本」标题后的段落文本（如 v0.2.1）
      return ctx.paragraphAfterHeading(2, /^版本/) ?? null
    },
  },
  {
    id: 'todo-count',
    label: '待办数量',
    resolve(ctx: SuggestContext) {
      return ctx.taskCount() ?? null
    },
  },
  {
    id: 'progress',
    label: '待办完成率',
    resolve(ctx: SuggestContext) {
      // 动态统计：2/5 这种
      return ctx.taskProgress() ?? null
    },
  },
  {
    id: 'first-task',
    label: '首个待办',
    resolve(ctx: SuggestContext) {
      return ctx.firstTask() ?? null
    },
  },
]
`,
  '笔记/周报.md': `doctype:demo

# 周报

你好，本周完成了引用机制的三块里程碑，下一步推进模板服务。

## 版本

v0.2.1

## 待办

- [x] 引用语法与节点
- [x] 触发菜单
- [x] 文件树联动
- [ ] 模板机制
- [ ] 校验服务
`,
  '引用演示.md': `doctype:demo

# 引用机制演示（里程碑 1）

本页演示自定义节点的解析、渲染与序列化。

## 文件名链接

- [[README.md]] 是文件名链接
- [[笔记/会议记录]] 点击可打开
- [[笔记/会议记录#2026-08-11 周会]] 带 # 片段（点击平滑滚动到对应标题）

## 块嵌入

待办清单嵌入如下：

![[笔记/待办清单]]

## 只读嵌入

![[README.md|ro]]

## 模板对象引用（M4）

周报问候语：[[笔记/周报#greeting]]

周报版本号：[[笔记/周报#version]]

周报待办数：[[笔记/周报#todo-count]]

周报完成率：[[笔记/周报#progress]]

首个待办：[[笔记/周报#first-task]]

## 字面量转义

下面这行是转义后的字面量（序列化器自动转义）：

文本里的 \[\[ 不应被解析为引用。
`,
}

const SAMPLE_DIRS = ['笔记', '数据', 'template/demo']

/** 全局模板域示例（mock 模拟；真实文件系统外部目录 v1.5 缺口） */
const GLOBAL_SAMPLE: Record<string, string> = {
  'template/邮件/邮件.md': `doctype:mail

# 邮件模板

{{subject}}

您好：

{{body}}

此致
`,
  'template/邮件/邮件.suggest.ts': `import type { SuggestContext, SuggestObject } from '@milkdown-note/suggest'

export const objects: SuggestObject[] = [
  {
    id: 'subject',
    label: '主题',
    resolve(ctx: SuggestContext): string | null {
      return ctx.headingText(1, /^邮件模板/) ?? null
    },
  },
]
`,
}

/** 全局模板域树（只含 template/ 结构，路径带 template/ 前缀与内容一致） */
export function mockGlobalTemplates(): FsEntry[] {
  const children: FsEntry[] = []
  for (const path of Object.keys(GLOBAL_SAMPLE)) {
    const parts = path.split('/')
    const dirPath = parts.slice(0, 2).join('/')
    const dirName = parts[1]
    const fileName = parts[2]
    let dir = children.find((c) => c.name === dirName)
    if (!dir) {
      dir = { name: dirName, path: dirPath, kind: 'dir', children: [] }
      children.push(dir)
    }
    dir.children!.push({ name: fileName, path, kind: 'file' })
  }
  const tpl = { name: 'template', path: 'template', kind: 'dir' as const, children }
  return [tpl]
}

/** 全局域文件读取（mock：内置示例；真实文件系统：外部目录 v1.5 缺口） */
export async function mockGlobalReadFile(path: string): Promise<string> {
  const content = GLOBAL_SAMPLE[path]
  if (content === undefined) throw new Error(`全局模板文件不存在: ${path}`)
  return content
}

interface MockData {
  files: Record<string, string>
  dirs: string[]
  /** 是否已完成示例合并（防止删除的示例文件被重复恢复） */
  seeded?: boolean
  /** 示例合并版本：新版本会把新增示例文件补进旧快照 */
  seededVersion?: number
}

const SEED_VERSION = 3

/**
 * 版本 3：演示核心文件（模板 suggest 样例 / 周报数据 / 引用演示页）强制更新，
 * 让旧数据也能体验新样例。这些是演示基础设施；用户改过会被覆盖（可接受）。
 */
const FORCE_UPDATE_PATHS = [
  'template/demo/demo.suggest.ts',
  '笔记/周报.md',
  '引用演示.md',
  'template/demo/demo.md',
]

function load(): MockData {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const data = JSON.parse(raw) as MockData
      // 版本旧 或 模板示例缺失 → 补缺（仅补缺失文件，不覆盖用户改动）。
      // 兜底条件加「模板 demo.md 不存在」：防止旧数据（seededVersion=2 但缺模板）一直缺模板
      const needMerge =
        (data.seededVersion ?? 1) < SEED_VERSION ||
        !('template/demo/demo.md' in (data.files ?? {}))
      if (needMerge) {
        const prev = data.seededVersion ?? 1
        for (const [path, content] of Object.entries(SAMPLE)) {
          if (!(path in data.files)) data.files[path] = content
          // 演示核心文件：跨版本强制覆盖（suggest 样例等）
          else if (prev < SEED_VERSION && FORCE_UPDATE_PATHS.includes(path)) {
            data.files[path] = content
          }
        }
        for (const dir of SAMPLE_DIRS) {
          if (!data.dirs.includes(dir)) data.dirs.push(dir)
        }
        data.seeded = true
        data.seededVersion = SEED_VERSION
        persist(data)
      }
      return data
    }
  } catch {
    /* ignore */
  }
  const data: MockData = {
    files: { ...SAMPLE },
    dirs: [...SAMPLE_DIRS],
    seeded: true,
    seededVersion: SEED_VERSION,
  }
  persist(data)
  return data
}

function persist(data: MockData) {
  localStorage.setItem(KEY, JSON.stringify(data))
}

/** 诊断钩子（用户反馈 template 目录空时，可复制 console 输出提供） */
;(window as unknown as { __mockFsDebug?: unknown }).__mockFsDebug = () => {
  const data = load()
  const tplFiles = Object.keys(data.files).filter((p) => p.startsWith('template/'))
  const dirs = data.dirs.filter((d) => d.startsWith('template'))
  console.log('[mock-fs] seededVersion=', data.seededVersion, 'dirs(template)=', JSON.stringify(dirs))
  console.log('[mock-fs] 模板文件数=', tplFiles.length, '→', JSON.stringify(tplFiles.slice(0, 10)))
  console.log('[mock-fs] 总文件数=', Object.keys(data.files).length)
  return {
    seededVersion: data.seededVersion,
    templateFiles: tplFiles,
    templateDirs: dirs,
    totalFiles: Object.keys(data.files).length,
  }
}

function buildTree(data: MockData, showAll: boolean): FsEntry[] {
  const root: FsEntry[] = []
  const dirMap = new Map<string, FsEntry>()
  const rootNode: FsEntry = { name: '', path: '', kind: 'dir', children: root }
  const ensureDir = (path: string): FsEntry => {
    if (path === '') return rootNode
    if (dirMap.has(path)) return dirMap.get(path)!
    const node: FsEntry = { name: baseName(path), path, kind: 'dir', children: [] }
    dirMap.set(path, node)
    const parent = ensureDir(dirName(path))
    parent.children!.push(node)
    return node
  }
  for (const dir of data.dirs) ensureDir(dir)
  for (const path of Object.keys(data.files)) {
    if (!shouldShowInTree(path, baseName(path), showAll)) continue
    const parent = ensureDir(dirName(path))
    parent.children!.push({ name: baseName(path), path, kind: 'file' })
  }
  const sort = (list: FsEntry[]) => {
    list.sort((a, b) =>
      a.kind === b.kind
        ? a.name.localeCompare(b.name, 'zh-Hans-CN')
        : a.kind === 'dir'
          ? -1
          : 1
    )
    list.forEach((n) => n.children && sort(n.children))
  }
  sort(root)
  return root
}

export const mockFs: FileSystem = {
  kind: 'mock',
  rootName: '示例工作区',

  async openDirectory() {
    // mock 模式没有"打开目录"，直接返回（可改为恢复示例）
    return false
  },

  async readTree(showAll) {
    return buildTree(load(), showAll)
  },

  async readFile(path) {
    const data = load()
    if (!(path in data.files)) throw new Error(`文件不存在: ${path}`)
    return data.files[path]
  },

  async writeFile(path, content) {
    const data = load()
    data.files[path] = content
    persist(data)
  },

  async createFile(path) {
    const data = load()
    if (path in data.files) throw new Error(`文件已存在: ${path}`)
    data.files[path] = ''
    persist(data)
  },

  async createDir(path) {
    const data = load()
    if (data.dirs.includes(path)) throw new Error(`目录已存在: ${path}`)
    data.dirs.push(path)
    persist(data)
  },

  async rename(oldPath, newPath) {
    const data = load()
    if (oldPath in data.files) {
      const content = data.files[oldPath]
      delete data.files[oldPath]
      data.files[newPath] = content
    } else if (data.dirs.includes(oldPath)) {
      data.dirs = data.dirs.map((d) =>
        d === oldPath || d.startsWith(oldPath + '/')
          ? newPath + d.slice(oldPath.length)
          : d
      )
      // 目录内的文件路径整体迁移
      for (const [p, c] of Object.entries(data.files)) {
        if (p === oldPath || p.startsWith(oldPath + '/')) {
          const rel = p.slice(oldPath.length)
          delete data.files[p]
          data.files[newPath + rel] = c
        }
      }
    } else {
      throw new Error(`不存在: ${oldPath}`)
    }
    persist(data)
  },

  async remove(path) {
    const data = load()
    if (path in data.files) {
      delete data.files[path]
    } else if (data.dirs.includes(path)) {
      data.dirs = data.dirs.filter((d) => d !== path)
      for (const p of Object.keys(data.files)) {
        if (p === path || p.startsWith(path + '/')) delete data.files[p]
      }
    } else {
      throw new Error(`不存在: ${path}`)
    }
    persist(data)
  },
}

export type { FsBackendKind }
