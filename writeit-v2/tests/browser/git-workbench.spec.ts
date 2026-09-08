import { expect, test } from '@playwright/test'

test('Git workbench consumes structured mock data, switches layout, and surfaces failures', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    const load = (path: string): Promise<any> => import(new URL(path, window.location.origin).href)
    const vue = await load('/node_modules/.vite/deps/vue.js')
    const git = await load('/src/platform/git/index.ts')
    const panel = await load('/src/ui/review/GitWorkbenchPanel.vue')
    const path = 'notes.md'
    const target = { kind: 'worktree-vs-head', path }
    const adapter = new git.MemoryGitAdapter({
      info: { isGitRepository: true, branch: 'feature', head: 'abc123', branches: ['main', 'feature'] },
      statuses: [{ path, status: 'modified', staged: false }],
      diffs: { 'worktree:notes.md': { target, before: 'one\ntwo', after: 'one\nTWO', hunks: [{ id: 'hunk-1', oldStart: 1, oldCount: 2, newStart: 1, newCount: 2, lines: [{ kind: 'context', text: 'one' }, { kind: 'removed', text: 'two' }, { kind: 'added', text: 'TWO' }] }], rawChangeCount: 2 } },
      history: { [path]: [{ id: 'abc123', authorName: 'Ada', authorTime: '2026-09-09', summary: 'Update notes', parentIds: [] }] },
    })
    const service = new (await load('/src/application/git/index.ts')).GitWorkbenchService(adapter, adapter)
    const state = vue.reactive({ info: await service.repositoryInfo(), statuses: await service.fileStatuses(), diff: null, history: [], selectedPath: null, layout: 'unified', loading: false, error: null })
    const refresh = async () => { state.loading = true; state.error = null; try { state.info = await service.repositoryInfo(true); state.statuses = await service.fileStatuses(true) } catch (error) { state.error = String(error) } finally { state.loading = false } }
    const selectPath = async (selected: string) => { state.selectedPath = selected; state.diff = await service.diff({ kind: 'worktree-vs-head', path: selected }); state.history = await service.history(selected) }
    const Wrapper = { setup() { return () => vue.h(panel.default, { ...state, 'onRefresh': refresh, 'onSwitchBranch': async (branch: string) => { await service.switchBranch(branch); await refresh() }, 'onSelectPath': selectPath, 'onToggleLayout': () => { state.layout = state.layout === 'unified' ? 'split' : 'unified' }, 'onDiscardFile': async (selected: string) => { await service.discardFile(selected) }, 'onDiscardHunk': async () => {} }) } }
    const root = document.createElement('div'); root.dataset.testid = 'git-harness'; document.body.append(root); vue.createApp(Wrapper).mount(root)
    ;(window as any).__writeItV2GitHarness = { adapter, state, refresh }
  })
  await expect(page.getByTestId('git-workbench')).toBeVisible()
  await page.getByTestId('git-branch').selectOption('main')
  await page.locator('[data-git-file="notes.md"]').click()
  await expect(page.getByTestId('git-diff')).toContainText('raw changes')
  await expect(page.locator('[data-git-hunk="hunk-1"]')).toContainText('-two')
  await page.getByTestId('git-layout-split').click()
  await expect(page.getByTestId('git-layout-split')).toHaveClass(/active/)
  await page.locator('[data-git-discard="notes.md"]').click()
  await expect.poll(async () => page.evaluate(() => (window as any).__writeItV2GitHarness.adapter.discarded)).toEqual(['notes.md'])
  await page.evaluate(() => (window as any).__writeItV2GitHarness.adapter.failNext())
  await page.getByTestId('git-refresh').click()
  await expect(page.getByTestId('git-error')).toContainText('Git command failed')
})
