import { describe, expect, it } from 'vitest'
import { createWorkspacePath } from '../../../../src/core/workspace'
import { GitPortError, MemoryGitAdapter, targetKey } from '../../../../src/platform/git'

describe('MemoryGitAdapter', () => {
  it('returns structured repository/status/history data without CLI parsing', async () => {
    const path = createWorkspacePath('notes.md')
    const adapter = new MemoryGitAdapter({
      info: { branch: 'feature', head: 'abc123', branches: ['main', 'feature'] },
      statuses: [{ path, status: 'renamed', staged: false, oldPath: createWorkspacePath('old.md') }],
      history: { [path]: [{ id: 'abc123', authorName: 'Ada', authorTime: '2026-09-09', summary: 'Rename notes', parentIds: [] }] },
    })
    await expect(adapter.repositoryInfo()).resolves.toMatchObject({ branch: 'feature', head: 'abc123' })
    await expect(adapter.listFileStatuses()).resolves.toHaveLength(1)
    await expect(adapter.listHistory(path)).resolves.toMatchObject([{ id: 'abc123' }])
  })

  it('supports deterministic diff keys and explicit command failures', async () => {
    const path = createWorkspacePath('notes.md')
    const target = { kind: 'worktree-vs-head' as const, path }
    expect(targetKey(target)).toBe('worktree:notes.md')
    const adapter = new MemoryGitAdapter({ info: { isGitRepository: false } })
    adapter.failNext(new GitPortError('not-git', 'Not a Git workspace'))
    await expect(adapter.repositoryInfo()).rejects.toMatchObject({ code: 'not-git' })
    await expect(adapter.repositoryInfo()).resolves.toMatchObject({ isGitRepository: false })
  })
})
