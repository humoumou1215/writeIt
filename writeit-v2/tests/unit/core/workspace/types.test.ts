import { describe, expect, it } from 'vitest'
import {
  createWorkspacePath,
  createWorkspaceTree,
  findWorkspaceNode,
  flattenWorkspaceTree,
  isWorkspacePath,
  isWorkspacePathWithin,
  sortWorkspaceNodes,
  workspaceJoin,
  workspaceParent,
} from '../../../../src/core/workspace'
import type { WorkspaceNode } from '../../../../src/core/workspace'

const root = createWorkspacePath('')

function file(path: string): WorkspaceNode {
  const normalized = createWorkspacePath(path)
  return { kind: 'file', path: normalized, name: normalized.split('/').at(-1) ?? '' }
}

describe('workspace path and tree primitives', () => {
  it('canonicalizes separators but rejects ambiguous or escaping paths', () => {
    expect(createWorkspacePath('notes\\todo.md')).toBe('notes/todo.md')
    expect(createWorkspacePath('.')).toBe(root)
    expect(workspaceParent(createWorkspacePath('notes/todo.md'))).toBe('notes')
    expect(workspaceParent(createWorkspacePath('todo.md'))).toBe(root)
    expect(workspaceJoin(root, 'todo.md')).toBe('todo.md')

    expect(() => createWorkspacePath('/outside.md')).toThrow()
    expect(() => createWorkspacePath('../outside.md')).toThrow()
    expect(() => workspaceJoin(root, 'notes/todo.md')).toThrow()
    expect(isWorkspacePath('notes/todo.md')).toBe(true)
    expect(isWorkspacePath('notes//todo.md')).toBe(false)
  })

  it('checks workspace containment without confusing sibling prefixes', () => {
    expect(
      isWorkspacePathWithin(
        createWorkspacePath('notes/todo.md'),
        createWorkspacePath('notes'),
      ),
    ).toBe(true)
    expect(
      isWorkspacePathWithin(
        createWorkspacePath('notebook/todo.md'),
        createWorkspacePath('notes'),
      ),
    ).toBe(false)
    expect(isWorkspacePathWithin(root, root)).toBe(true)
  })

  it('sorts directories before files and flattens recursive nodes', () => {
    const notes = {
      kind: 'directory' as const,
      path: createWorkspacePath('notes'),
      name: 'notes',
      children: [file('notes/todo.md')],
    }
    const tree = createWorkspaceTree(root, [
      file('welcome.md'),
      notes,
      file('Alpha.md'),
    ])
    const sorted = sortWorkspaceNodes(tree.root.children)

    expect(sorted.map((node) => node.path)).toEqual(['notes', 'Alpha.md', 'welcome.md'])
    expect(flattenWorkspaceTree(tree).map(({ node, depth }) => [node.path, depth])).toEqual([
      ['notes', 1],
      ['notes/todo.md', 2],
      ['Alpha.md', 1],
      ['welcome.md', 1],
    ])
    expect(findWorkspaceNode(tree, createWorkspacePath('notes/todo.md'))?.kind).toBe('file')
    expect(findWorkspaceNode(tree, createWorkspacePath('missing.md'))).toBeUndefined()
  })
})
