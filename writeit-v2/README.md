# WriteIt v2

WriteIt v2 是基于 Markdown-first、DocumentStore 和 CodeMirror 6 的新主线。
当前已完成 P2-01 至 P2-06、P2A-00 至 P2A-06、P2A-R01 至 P2A-R06、P3-01 至 P3-08、P4-01 至 P4-09 及已批准的 P2-AR-06/P3/P4 remediation；P2A-AR1 用户验收门已通过。P4-AR2 综合 architecture/product-boundary gate 按用户决策 B 已为 **PASS**：当前 Embed controlled harness + workspace/reference `Refresh` retry 作为 acceptance 证据被接受，真实 production loader failure/retry journey 记录为后续非阻断 deferred/test gap。P5 尚未开始，下一建议为 P5-00（Table UX & Behavior Contract）。能力包括 CM6 编辑器与 DocumentStore 双向同步、同一 Document 的多 Projection、revision/stale 协议、基础 Live Preview、编辑辅助、同一 CM6 状态内的 Raw Source / Live Preview 切换、Workspace tree/tabs/navigation、manual save/auto-save/dirty/conflict/external-change policy、路径型 workspace recovery 和可持久化的 sidebar/settings shell，以及四种图片粘贴策略、二进制附件落盘和相对路径图片投影/预览/复制与工作区定位；目录移动影响已打开 descendant 时继续 fail-closed 阻止，完整 directory migration 继续 deferred；真实 production Embed loader failure/retry journey 不属于当前 P4 gate blocker。

## 开发命令

```bash
npm install
npx playwright install chromium
npm run dev
npm run check:boundaries
npm run test
npm run test:browser
npm run typecheck
npm run build
```

## 当前边界

- Markdown 是长期数据合同，`DocumentStore` 是运行时内容权威。
- 用户编辑通过明确的 editor origin 提交 Store；Store 回放到 Projection 时使用 `storeSync` annotation 防止回环。
- 同一 Document 可以挂载多个 CM6 Projection；每个 Projection 独立注册、确认 revision，并在销毁时解绑。
- Live Preview 只读消费 Store Markdown；仅增强 headings、emphasis、代码块和安全 links，未知语法作为文本保留。
- Raw Source / Live Preview 使用同一个 CM6 Document；`Ctrl/Cmd+E` 只切换 presentation decorations/widgets，不创建第二个 textarea authority，也不改写 source、selection 或 Store history。
- `src/editor/` 负责 UI/CM6 Projection；Core 不依赖 Vue、DOM、CodeMirror 或 Tauri。
- `scripts/check-boundaries.mjs`、Playwright Chromium 集成测试和 `.github/workflows/v2.yml` 自动检查依赖边界、真实浏览器行为、类型和构建。
- `writeit-v2/` 禁止运行时依赖 `../editor-app/`。
- Persistence policy 只保存 DocumentStore snapshot；保存前校验外部文件基线，冲突时不覆盖外部内容，关闭未保存标签时必须显式丢弃或先保存。
- Workspace recovery/settings 只通过 platform storage 保存路径、active/selected entry 和 shell preferences，不保存 Markdown、CM6 state 或 revision；桌面持久化由后续 adapter 替换浏览器 storage。
