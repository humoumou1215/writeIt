import { describe, expect, it, vi } from 'vitest'
import { createWorkspacePath } from '../../../../src/core/workspace'
import { GitWorkbenchService } from '../../../../src/application/git'
import { MemoryGitAdapter } from '../../../../src/platform/git'

describe('GitWorkbenchService', () => {
  it('caches repository/status/blame data and invalidates after discard', async () => {
    const path = createWorkspacePath('notes.md')
    const adapter = new MemoryGitAdapter({
      info: { branch: 'main' },
      blame: { [path]: [{ line: 1, kind: 'uncommitted' }] },
    })
    const info = vi.spyOn(adapter, 'repositoryInfo')
    const blame = vi.spyOn(adapter, 'blame')
    const service = new GitWorkbenchService(adapter, adapter)
    await service.repositoryInfo()
    await service.repositoryInfo()
    await service.blame(path)
    await service.blame(path)
    expect(info).toHaveBeenCalledTimes(1)
    expect(blame).toHaveBeenCalledTimes(1)
    await service.discardFile(path)
    await service.repositoryInfo()
    expect(info).toHaveBeenCalledTimes(2)
  })
})
