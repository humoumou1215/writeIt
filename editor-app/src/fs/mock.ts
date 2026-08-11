// localStorage 模拟文件系统 —— 无需任何宿主即可在浏览器里完整体验
// 数据结构：{ files: { [path]: content }, dirs: string[] }
import type { FileSystem, FsEntry, FsBackendKind } from './types'
import { isEditableFile, dirName, baseName } from './types'
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
}

interface MockData {
  files: Record<string, string>
  dirs: string[]
}

function load(): MockData {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as MockData
  } catch {
    /* ignore */
  }
  const data: MockData = { files: { ...SAMPLE }, dirs: ['笔记', '数据'] }
  persist(data)
  return data
}

function persist(data: MockData) {
  localStorage.setItem(KEY, JSON.stringify(data))
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
    if (!showAll && !isEditableFile(path)) continue
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
