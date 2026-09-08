import { describe, expect, it } from 'vitest'
import {
  adjacentWorkspaceFilePath,
  orderedWorkspaceFilePaths,
  WorkspaceTabManager,
  WorkspaceTabNotFoundError,
} from '../../../../src/application/workspace'
import {
  createDocumentId,
} from '../../../../src/core/document'
import {
  createWorkspacePath,
  createWorkspaceTree,
  createWorkspaceDirectoryNode,
  createWorkspaceFileNode,
} from '../../../../src/core/workspace'

const first = createDocumentId('first')
const second = createDocumentId('second')
const third = createDocumentId('third')

function makeTree() {
  const notes = createWorkspaceDirectoryNode(createWorkspacePath('notes'), [
    createWorkspaceFileNode(createWorkspacePath('notes/architecture.md')),
    createWorkspaceFileNode(createWorkspacePath('notes/workspace.md')),
  ])
  return createWorkspaceTree(createWorkspacePath(''), [
    createWorkspaceFileNode(createWorkspacePath('welcome.md')),
    notes,
  ])
}

describe('WorkspaceTabManager', () => {
  it('opens each document once, activates it, and keeps immutable snapshots', () => {
    const manager = new WorkspaceTabManager([first])
    const initial = manager.getSnapshot()
    const revisions: number[] = []
    manager.subscribe(({ revision }) => revisions.push(revision))

    manager.open(second)
    manager.open(second)
    manager.open(first)

    expect(manager.getSnapshot().tabs.map((tab) => tab.documentId)).toEqual([
      first,
      second,
    ])
    expect(manager.getSnapshot().activeDocumentId).toBe(first)
    expect(revisions).toEqual([1, 2])
    expect(initial.tabs).toEqual([{ documentId: first }])
    expect(Object.isFrozen(manager.getSnapshot())).toBe(true)
    expect(Object.isFrozen(manager.getSnapshot().tabs)).toBe(true)
  })

  it('selects the next tab at the closed tab position and wraps navigation', () => {
    const manager = new WorkspaceTabManager([first, second, third])
    manager.activate(second)
    expect(manager.nextTab().activeDocumentId).toBe(third)
    expect(manager.nextTab().activeDocumentId).toBe(first)
    expect(manager.previousTab().activeDocumentId).toBe(third)

    manager.activate(second)
    manager.close(second)
    expect(manager.getSnapshot().tabs.map((tab) => tab.documentId)).toEqual([
      first,
      third,
    ])
    expect(manager.getSnapshot().activeDocumentId).toBe(third)
  })

  it('does not close or activate an unknown tab', () => {
    const manager = new WorkspaceTabManager([first])
    expect(() => manager.activate(second)).toThrow(WorkspaceTabNotFoundError)
    expect(() => manager.close(second)).toThrow(WorkspaceTabNotFoundError)
  })
})

describe('workspace file navigation', () => {
  it('uses deterministic depth-first tree order and wraps at both ends', () => {
    const tree = makeTree()
    const welcome = createWorkspacePath('welcome.md')
    const architecture = createWorkspacePath('notes/architecture.md')
    const workspace = createWorkspacePath('notes/workspace.md')

    expect(orderedWorkspaceFilePaths(tree)).toEqual([
      architecture,
      workspace,
      welcome,
    ])
    expect(adjacentWorkspaceFilePath(tree, architecture, 1)).toBe(workspace)
    expect(adjacentWorkspaceFilePath(tree, architecture, -1)).toBe(welcome)
    expect(adjacentWorkspaceFilePath(tree, welcome, 1)).toBe(architecture)
    expect(adjacentWorkspaceFilePath(tree, undefined, -1)).toBe(welcome)
  })
})
