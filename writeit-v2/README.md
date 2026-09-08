# WriteIt v2

WriteIt v2 是基于 Markdown-first、DocumentStore 和 CodeMirror 6 的新主线。
P0～P4 与 F-01～F-03 follow-up 已完成，P4-AR2 为 **PASS**。下一阶段将通过 [`docs/GOAL.md`](./docs/GOAL.md) 定义的单一 Codex Goal，先关闭 P4 UX/production Embed retry 证据缺口，再连续推进 P5～P12。当前 Goal 仅完成准备，尚未激活；实时状态与前置决策分别见 [`docs/STATUS.md`](./docs/STATUS.md) 和 [`docs/DECISIONS.md`](./docs/DECISIONS.md)。

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
npm run verify:fast
npm run verify
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
