// _cleanup-spaces.ego.js —— 释放所有遗留 task space（防内存堆积）
// 由 run-all.js 在整套回归结束后调用；也可手动跑：
//   PATH="$HOME/.local/bin:$PATH" ego-browser nodejs < tests/e2e/_cleanup-spaces.ego.js
// 逐个 claim（user-held/agent-held 都可）+ complete(keep:false) 关闭，释放浏览器标签/上下文。
// 只处理 WriteIt 测试命名空间和已知旧版测试命名，避免误关用户自己的 space。

const LEGACY_TEST_PREFIXES = [
  '_cycchk', '_m3check', '_multiblock-e2e', 'diffcomplex-verify', '_discard-probe',
  'ph-repro', 'scratch-docstore-doc', 'scratch-stale-verify', 'zz-debug-click',
  'annotation-recheck-e2e', 'annotations-overlap-e2e', 'app-e2e', 'diagnostics-e2e',
  'drag-e2e', 'embed-cross-e2e', 'embed-indep-verify-e2e', 'embed-indep-verify2-e2e',
  'embed-sync-', 'export-e2e', 'git-m11a-e2e', 'git-m11a-smoke', 'git-m18-fixture-e2e',
  'img-preview-e2e', 'm3-e2e', 'm4-e2e', 'm4b-e2e', 'm4c-e2e', 'm5-e2e',
  'm5-strict', 'm5diag-e', 'm6-e2e', 'm6-toolbar', 'm6c-e2e', 'm6d-e2e',
  'm6e-e2e', 'm7-apidoc-e2e', 'm8-db-e2e', 'm9-placeholder-e2e', 'menu-e2e',
  'mermaid-ref-e2e', 'mermaid-zoom-e2e', 'nested-ref-e2e', 'paste-ref-e2e',
  'ref-e2e', 'refs-footer-e2e', 'scroll-e2e', 'search-e2e', 'source-e2e',
  'tabbar-overflow-e2e', 'table-enhance-e2e', 'xxljob-e2e',
]
const isTestSpace = (space) => {
  const name = String(space?.name || space?.taskId || '')
  return name.startsWith('writeIt-e2e:') || LEGACY_TEST_PREFIXES.some((p) => name.startsWith(p.endsWith('-') ? p : `${p}-`))
}

const list = await listTaskSpaces().catch(() => [])
const targets = (list || []).filter(isTestSpace)
cliLog(`清理前 task spaces: ${(list || []).length}，测试空间: ${targets.length}`)
let closed = 0
for (const s of targets) {
  try {
    await claimTaskSpace(s.id).catch(() => {})
    const r = await completeTaskSpace(s.id, { keep: false })
    if (r && r.done) closed++
  } catch (e) {
    /* 个别空间无法关闭则跳过 */
  }
}
cliLog('已关闭: ' + closed)
cliLog('清理完成')
