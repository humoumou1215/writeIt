# WriteIt v2

WriteIt v2 是基于 Markdown-first、DocumentStore 和 CodeMirror 6 的新主线。
当前已完成 P2-01 至 P2-06 与 P2A-05：CM6 编辑器与 DocumentStore 双向同步、同一 Document 的多 Projection、revision/stale 协议、基础 Live Preview，以及同一 CM6 状态内的 Raw Source / Live Preview 切换。

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
