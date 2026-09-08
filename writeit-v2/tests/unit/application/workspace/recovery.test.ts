import { describe, expect, it } from 'vitest'
import {
  WorkspaceRecoveryStore,
} from '../../../../src/application/workspace'
import {
  createWorkspacePath,
} from '../../../../src/core/workspace'
import { MemorySettingsStorage } from '../../../../src/platform/settings'

const root = createWorkspacePath('')
const welcome = createWorkspacePath('welcome.md')
const notes = createWorkspacePath('notes/architecture.md')

describe('WorkspaceRecoveryStore', () => {
  it('persists paths and active selection, not Markdown or revisions', () => {
    const storage = new MemorySettingsStorage()
    const recovery = new WorkspaceRecoveryStore(storage, {
      workspacePath: root,
    })

    recovery.record({
      workspacePath: root,
      openDocumentPaths: [welcome, notes, welcome],
      activeDocumentPath: notes,
      selectedWorkspacePath: createWorkspacePath('notes'),
    })

    const restored = new WorkspaceRecoveryStore(storage)
    expect(restored.getSnapshot()).toEqual({
      workspacePath: root,
      openDocumentPaths: [welcome, notes],
      activeDocumentPath: notes,
      selectedWorkspacePath: createWorkspacePath('notes'),
    })
    expect(storage.read('writeit-v2.workspace-recovery')).not.toContain(
      'markdown',
    )
  })

  it('drops an active path that is not in the open path list', () => {
    const recovery = new WorkspaceRecoveryStore(new MemorySettingsStorage())
    const snapshot = recovery.record({
      workspacePath: root,
      openDocumentPaths: [welcome],
      activeDocumentPath: notes,
    })

    expect(snapshot.activeDocumentPath).toBeNull()
    expect(recovery.isForWorkspace(root)).toBe(true)
    expect(recovery.validDocumentPaths(new Set([welcome, notes]))).toEqual([
      welcome,
    ])
  })

  it('ignores corrupt records and rejects traversal paths', () => {
    const storage = new MemorySettingsStorage({
      'writeit-v2.workspace-recovery': '{not-json',
    })
    const recovery = new WorkspaceRecoveryStore(storage, {
      workspacePath: root,
    })

    expect(recovery.getSnapshot()).toMatchObject({
      workspacePath: root,
      openDocumentPaths: [],
      activeDocumentPath: null,
    })
    expect(() =>
      recovery.record({
        workspacePath: root,
        openDocumentPaths: ['../outside.md'],
      }),
    ).toThrow()
  })
})
