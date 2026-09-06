# WriteIt v2

WriteIt v2 是基于 Markdown-first 和 CodeMirror 6 方向的新主线。当前目录是 P0-07 的最小可运行工程骨架，尚未实现产品功能。

## 开发命令

```bash
npm install
npm run dev
npm run test
npm run typecheck
npm run build
```

## 边界

- Markdown 是长期数据合同；后续 DocumentStore 将成为运行时内容权威。
- `src/` 只属于 v2；不得运行时依赖 `../editor-app/`。
- 当前占位页面仅用于确认 Vue/Vite 工程可以启动，产品能力按实施 SPEC 的后续任务逐步加入。
