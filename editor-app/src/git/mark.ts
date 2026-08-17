// 主文件树 git 角标数据（M15）：工作区 git status → 文件/目录状态标注
//  复用 buildChangeTree 的目录聚合逻辑（dirs 仅含有改动子级的祖先目录）
import { state } from '../state/store'
import type { GitFileStatus } from './types'
import { buildChangeTree, type GitChangeNode } from './change-tree'

/** 填充角标数据（GitPanel 加载 / App 启动时调用；status 空数组 = 清空） */
export function applyGitMark(status: GitFileStatus[]) {
  const files: Record<string, GitFileStatus> = {}
  const dirs: Record<string, string> = {}
  for (const s of status) files[s.path] = s
  const tree = buildChangeTree(status)
  const visit = (nodes: GitChangeNode[]) => {
    for (const n of nodes) {
      if (n.kind === 'dir' && n.status) dirs[n.path] = n.status
      if (n.kind === 'dir' && n.children) visit(n.children)
    }
  }
  visit(tree)
  state.gitMark = { files, dirs }
}

/** 清空角标（非 git 仓库 / 无改动） */
export function clearGitMark() {
  state.gitMark = { files: {}, dirs: {} }
}