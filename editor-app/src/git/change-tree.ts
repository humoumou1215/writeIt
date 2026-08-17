// 变更文件树（M15）：把扁平 git 变更列表（工作区 status / 提交 files）
//  按目录层级组织成可折叠树，目录聚合状态色板与 +N -M 行数统计。
//  仅创建"有改动文件"的祖先目录，不出现空目录节点。

export interface GitChangeNode {
  name: string
  /** 完整路径（文件=自身路径；目录=目录路径） */
  path: string
  kind: 'dir' | 'file'
  /** 文件：原状态字母（M/A/D/?/R/C/U）；目录：聚合状态（子级中优先级最高的） */
  status?: string
  added: number
  deleted: number
  children?: GitChangeNode[]
}

export interface GitChangeSource {
  path: string
  status: string
  added: number
  deleted: number
}

/** 目录聚合优先级：删除最醒目，未跟踪最弱 */
const STATUS_PRIORITY: Record<string, number> = { D: 0, A: 1, M: 2, R: 3, C: 3, '?': 4, U: 4 }

export function buildChangeTree(files: GitChangeSource[]): GitChangeNode[] {
  const roots: GitChangeNode[] = []
  const map = new Map<string, GitChangeNode>()

  for (const f of files) {
    const parts = f.path.split('/')
    let parentPath = ''
    let siblings = roots
    let dir: GitChangeNode | undefined
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]
      const full = parentPath ? `${parentPath}/${name}` : name
      const isLast = i === parts.length - 1
      if (isLast) {
        const node: GitChangeNode = { name, path: full, kind: 'file', status: f.status, added: f.added, deleted: f.deleted }
        map.set(full, node)
        siblings.push(node)
        break
      }
      dir = map.get(full)
      if (!dir) {
        dir = { name, path: full, kind: 'dir', added: 0, deleted: 0, children: [] }
        map.set(full, dir)
        siblings.push(dir)
      }
      siblings = dir.children as GitChangeNode[]
      parentPath = full
    }
  }

  aggregate(roots)
  sortNodes(roots)
  return roots
}

function aggregate(nodes: GitChangeNode[]): void {
  for (const n of nodes) {
    if (n.kind === 'dir' && n.children) {
      aggregate(n.children)
      n.added = 0
      n.deleted = 0
      for (const c of n.children) {
        n.added += c.added
        n.deleted += c.deleted
      }
      n.status = aggStatus(n.children.map((c) => c.status).filter(Boolean) as string[])
    }
  }
}

/** 子级状态 → 目录聚合状态（取优先级最高；无则 undefined） */
export function aggStatus(states: string[]): string | undefined {
  if (!states.length) return undefined
  let best = states[0]
  let bestP = STATUS_PRIORITY[best] ?? 99
  for (const s of states) {
    const p = STATUS_PRIORITY[s] ?? 99
    if (p < bestP) {
      best = s
      bestP = p
    }
  }
  return best
}

function sortNodes(nodes: GitChangeNode[]): void {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  })
  for (const n of nodes) if (n.kind === 'dir' && n.children) sortNodes(n.children)
}

/** 遍历整棵变更树（后序调用 fn） */
export function walkChangeTree(nodes: GitChangeNode[], fn: (n: GitChangeNode) => void): void {
  for (const n of nodes) {
    fn(n)
    if (n.kind === 'dir' && n.children) walkChangeTree(n.children, fn)
  }
}