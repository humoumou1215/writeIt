// _cleanup-spaces.ego.js —— 释放所有遗留 task space（防内存堆积）
// 由 run-all.js 在整套回归结束后调用；也可手动跑：
//   PATH="$HOME/.local/bin:$PATH" ego-browser nodejs < tests/e2e/_cleanup-spaces.ego.js
// 逐个 claim（user-held/agent-held 都可）+ complete(keep:false) 关闭，释放浏览器标签/上下文。

const list = await listTaskSpaces().catch(() => [])
cliLog('清理前 task spaces: ' + (list || []).length)
let closed = 0
for (const s of list || []) {
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
