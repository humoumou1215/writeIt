// localStorage 模拟文件系统 —— 无需任何宿主即可在浏览器里完整体验
// 数据结构：{ files: { [path]: content }, dirs: string[] }
import type { FileSystem, FsEntry, FsBackendKind } from './types'
import { shouldShowInTree, dirName, baseName } from './types'
import mermaidMd from '../editor/mermaid.md?raw'
import { DEMO_FILES, DEMO_DIRS } from './mock-samples.generated'

const KEY = 'milkdown-note-mock-fs-v2'

const MOCK_EXTRA: Record<string, string> = {
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
  '.template/demo/demo.md': `doctype:demo

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
  '.template/demo/demo.rules.ts': `import type { ValidationContext, Rule } from '@milkdown-note/validate'

// 校验模式：hint = 仅提示标注不阻止保存（默认）；strict = 保存前校验失败需确认
export const mode: 'hint' | 'strict' = 'hint'

// 报告落盘（§5.2 通道③）：每次校验后写 markdown 报告
export const report = { enabled: true, path: '.validate/report.md' }

export const rules: Rule[] = [
  {
    id: 'table-acceptance',
    label: '需求表：前置列非空则后置列必填',
    run(ctx: ValidationContext) {
      const table = ctx.findTableAfterHeading('## 需求')
      if (!table) return ctx.violation('缺少「需求」表格')
      // 逐行检查：前置已填而后置为空 → 在该单元格位置标注（decorations 通道）
      table.dataRows().forEach((row, i) => {
        const prev = row.cell(0).text().trim()
        const next = row.cell(1).text().trim()
        if (prev && !next) {
          ctx.violationAt(
            row.cell(1).pos,
            \`第 \${i + 1} 行：前置已填写「\${prev}」，后置不能为空\`,
            'warning'
          )
        }
      })
    },
  },
  {
    id: 'require-version',
    label: '必须存在「## 版本」章节',
    run(ctx: ValidationContext) {
      const v = ctx.findHeading('## 版本')
      if (!v) return ctx.violation('缺少「## 版本」章节（版本号应记录在模板约定位置）', 'error')
      const line = ctx.findText(/^v\\d/)
      if (!line) ctx.violation('「## 版本」后缺少版本号（形如 v0.1.0）', 'warning')
    },
  },
]
`,
  '.template/demo/demo.suggest.ts': `import type { SuggestContext, SuggestObject } from '@milkdown-note/suggest'

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
  '接口字段引用.md': `doctype:demo

# 接口字段引用演示

本页演示对接口文档字段的动态对象引用（M7 objectsFor）。

放款金额取自 [[接口文档/助贷/助贷接口#amount]]。

放款申请号取自 [[接口文档/助贷/助贷接口#applyNo]]。
`,
}

/** demo 目录为唯一源（scripts/sync-demo.mjs 生成）；mock 专有演示文件在此补充 */
const SAMPLE: Record<string, string> = { ...DEMO_FILES, ...MOCK_EXTRA }

/** mock 专有演示目录（笔记/数据/引用演示等，不在 demo/ 内） */
const MOCK_EXTRA_DIRS: string[] = [
  '.template/demo',
  '数据',
  '笔记',
]
const SAMPLE_DIRS: string[] = [...DEMO_DIRS, ...MOCK_EXTRA_DIRS]

/** 全局模板域示例（mock 模拟；真实文件系统外部目录 v1.5 缺口） */
const GLOBAL_SAMPLE: Record<string, string> = {
  '.template/邮件/邮件.md': `doctype:mail

# 邮件模板

{{subject}}

您好：

{{body}}

此致
`,
  '.template/邮件/邮件.suggest.ts': `import type { SuggestContext, SuggestObject } from '@milkdown-note/suggest'

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

/** 全局模板域树（只含 .template/ 结构，路径带 .template/ 前缀与内容一致） */
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
  const tpl = { name: '.template', path: '.template', kind: 'dir' as const, children }
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
  /** 同步管理文件的 content hash（demo 为源，hash 变化自动更新） */
  fileHash?: Record<string, string>
}

const SEED_VERSION = 7

/**
 * 版本 7：接口文档模板新增 export.ts（M10 导出自定义示例）。
 * 版本 6：新增「xxljob」模板（一文件一任务）+ 4 合规样例 + 1 违规样例。
 * 版本 4：新增「接口文档」模板（接口文档.md / rules.ts / suggest.ts）+ 助贷样例（合规/违规）
 * + 接口字段引用演示页，验证 M7 动态对象 objectsFor + findCodeBlocks 能力。
 * 版本 3：演示核心文件（模板 suggest 样例 / 周报数据 / 引用演示页）强制更新，
 * 让旧数据也能体验新样例。这些是演示基础设施；用户改过会被覆盖（可接受）。
 */
const FORCE_UPDATE_PATHS = [
  '.template/demo/demo.suggest.ts',
  '笔记/周报.md',
  '引用演示.md',
  '.template/demo/demo.md',
  '.template/接口文档/接口文档.md',
  '.template/接口文档/接口文档.rules.ts',
  '.template/接口文档/接口文档.suggest.ts',
  '.template/接口文档/接口文档.export.ts',
  '接口文档/助贷/助贷接口.md',
  '接口文档/助贷/助贷接口-违规.md',
  '接口字段引用.md',
  '.template/数据库/数据库.md',
  '.template/数据库/数据库.rules.ts',
  '.template/数据库/数据库.suggest.ts',
  '数据库/loan/loan_apply.md',
  '数据库/loan/loan_apply-违规.md',
  '数据库/customer/customer_info.md',
  '数据库字段引用.md',
  '.template/xxljob/xxljob.md',
  '.template/xxljob/xxljob.rules.ts',
  '.template/xxljob/xxljob.suggest.ts',
  'xxljob/notify-executor/下游机构通知.md',
  'xxljob/notify-executor/还款结果通知.md',
  'xxljob/route-executor/路由批量匹配.md',
  'xxljob/route-executor/路由规则缓存刷新.md',
  'xxljob/notify-executor/下游机构通知-违规.md',
]

function hash(s: string): string {
  let x = 0
  for (let i = 0; i < s.length; i++) x = (Math.imul(x, 31) + s.charCodeAt(i)) | 0
  return (x >>> 0).toString(36)
}

function load(): MockData {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const data = JSON.parse(raw) as MockData
      let changed = false
      // 版本迁移：补缺 + FORCE_UPDATE 覆盖（结构性变化时 bump SEED_VERSION）
      const needMerge =
        (data.seededVersion ?? 1) < SEED_VERSION ||
        !('.template/demo/demo.md' in (data.files ?? {}))
      if (needMerge) {
        const prev = data.seededVersion ?? 1
        for (const [path, content] of Object.entries(SAMPLE)) {
          if (!(path in data.files)) data.files[path] = content
          // 演示核心文件：跨版本强制覆盖（suggest 样例等）
          else if (prev < SEED_VERSION && FORCE_UPDATE_PATHS.includes(path)) {
            data.files[path] = content
          }
        }
        data.seeded = true
        data.seededVersion = SEED_VERSION
        changed = true
      }
      // 内容同步（demo 为唯一源）：hash 变化自动更新；demo 新增添加；用户删除的演示文件保持删除（不补回）
      data.fileHash = data.fileHash ?? {}
      for (const [path, content] of Object.entries(SAMPLE)) {
        const h = hash(content)
        if (data.files[path] !== undefined) {
          // 文件存在：demo 内容变更 → 同步更新
          if (data.fileHash[path] !== h) {
            data.files[path] = content
            data.fileHash[path] = h
            changed = true
          }
        } else if (data.fileHash[path] === undefined) {
          // 从未同步过（demo 新增文件）→ 添加；曾存在但被用户删除（fileHash 有）→ 不补回
          data.files[path] = content
          data.fileHash[path] = h
          changed = true
        }
      }
      for (const path of Object.keys(data.files)) {
        if (data.fileHash[path] !== undefined && !(path in SAMPLE)) {
          delete data.files[path]
          delete data.fileHash[path]
          changed = true
        }
      }
      for (const dir of SAMPLE_DIRS) {
        if (!data.dirs.includes(dir)) {
          data.dirs.push(dir)
          changed = true
        }
      }
      if (changed) persist(data)
      return data
    }
  } catch {
    /* ignore */
  }
  const data: MockData = {
    files: { ...SAMPLE },
    dirs: [...SAMPLE_DIRS],
    fileHash: Object.fromEntries(Object.entries(SAMPLE).map(([p, c]) => [p, hash(c)])),
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
  const tplFiles = Object.keys(data.files).filter((p) => p.startsWith('.template/'))
  const dirs = data.dirs.filter((d) => d.startsWith('.template'))
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
    if (oldPath === newPath) return
    if (newPath in data.files || data.dirs.includes(newPath)) {
      throw new Error(`目标已存在: ${newPath}`)
    }
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
