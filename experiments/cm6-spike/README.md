# WriteIt CM6 Architecture Spike

这是一个与 `editor-app/` 隔离的架构实验，不导入 Crepe、Milkdown 或 ProseMirror。它为 v2 的 CM6 架构决策提供证据；Spike 代码仍是 `REFERENCE`，不是生产运行时依赖，正式能力需要在 `writeit-v2/` 中重新归属并测试。

## 运行

```bash
npm install
npm test
npm run build
npm run dev
```

开发页面默认是 `http://127.0.0.1:5187/`；`npm run dev` 同时监听 `0.0.0.0:5187`，可用本机局域网 IP 从同一网络的其他设备访问。Vite 启动日志会打印当前可用的 `Network` 地址。

## 当前架构

- `src/core/document-store.ts`：唯一 Markdown authority；每个文档只有 `markdown + revision`，View 只能提交 CM6 `ChangeSet`。
- `src/table/core.ts`：纯 TypeScript 表格模型、解析、局部序列化、selection、TSV/HTML clipboard、增删行列和矩形 paste；无 DOM、无 EditorView。
- `src/editor/spike-controller.ts`：CM6 EditorView / Widget 适配层；Table、Embed、Mermaid 都是投影，Widget 不保存 Markdown 副本。
- `src/core/annotation.ts`、`src/core/diff.ts`：Annotation range mapping 和 Markdown source diff mini-proof。
- `src/main.ts`：最小可视化验收台，包含 A/B/C、多投影、Source probe、Save、Undo/Redo、Stale、关闭/重开 B.md、100 次 lifecycle probe 和压力探针。

## 已完成验证（当前轮）

### Unit / build

- 15 个单元测试全部通过（DocumentStore、revision/conflict、undo/redo、stale、table core、clipboard、annotation、diff、source fidelity、10,000 行 / 100×20 压力场景）；Undo/Redo 单测覆盖 cell、paste、增删行列。
- `tsc --noEmit` 和 Vite production build 通过。
- Spike 目录中没有 Crepe、Milkdown、ProseMirror 依赖或 import。

### 内置浏览器实测

- A.md 表格可视投影、Cell input、Arrow/Tab 导航通过。
- Shift-click 形成二维矩形选择；矩形复制同时产生 `text/plain` TSV 和 `text/html` `<table>`。
- 真实坐标拖拽也能形成二维矩形选择（row1/col1 到 row2/col2 共 4 个 cell）。
- TSV 二维粘贴能按 anchor cell 扩展并映射；增删 row/column 能回写 Markdown。
- 真实键盘输入不会污染其他列；表格修改可通过 Cmd/Ctrl+Z、Cmd/Ctrl+Shift+Z 和 DocumentStore history Undo / Redo。
- B→A 可编辑 Embed 修改后，A tab、B→A、C→B→A 三个 Projection 同 revision 更新。
- Save 后磁盘快照只改变 A.md，B.md/C.md 的 `![[...]]` 保持引用文本。
- 直接 Source 修改后表格重新解析，未知 `:::unknown-syntax` 原样保留。
- Cell input 会在真实 composition 期间显示高亮，并把 `CompositionStart/Update/End` 写入 Last events；这只方便人工验收，不把合成事件模拟当作中文 IME 通过。
- 用户局域网验收反馈：中文输入正常，WPS 复制/粘贴正常，大文件滚动体验可接受；第二个及更多真实表格应用保留为 GO 后兼容性覆盖。
- 循环 `CycleA.md → CycleB.md → CycleA.md` 安全显示 `Circular embed`，不递归爆炸；嵌入内按 Escape 可回到宿主 Projection。
- 删除 B.md 的 `![[A.md]]` 引用后，A.md 仍存在且 C.md 仍能保持自己的 B Projection；Source probe 与宿主 caret 直接退格都能删除整个 token，恢复引用后 A revision 不受影响。
- Debug Panel 能显示 Document、Projection、revision、dirty、STALE 和事件序列。
- 100 次 mount/unmount probe 返回 `before=3, after=3`，未观察到 projection 数量增长。
- 内置浏览器压力探针：10,000 行挂载约 23ms、一次编辑约 20ms、500×20 表格挂载约 230ms、10 Projection 同步约 2ms；探针结束后视图数保持不变（`6 -> 6`）。这是趋势证据，不替代人工滚动/CPU 观察。
- 页面提供 `Open visible stress fixtures`：可见打开 10,000 行 Markdown 与 100×20 表格；编辑区固定为滚动容器，浏览器确认两者均可滚动，10,000 行只保留约 51 个可见 `.cm-line`。
- 关闭 B.md 后 C→B→A 的 Projection 仍在；重开 B.md 后出现新的 B→A Projection，继续从 C→B→A 输入可使 A.md revision 从 1 到 2。

## GO 后续验证（非阻断）

- 用户已完成 macOS 中文输入法和 WPS 互粘实测；后续继续扩大 Excel、Numbers 等真实应用的 clipboard 兼容覆盖。
- 10,000 行普通文档、500×20 表格和多个可见 Projection 已有自动探针与基础人工反馈；后续继续收集更广的滚动、输入延迟和 CPU 样本。
- 自动 clipboard、composition 和离屏压力探针不能冒充所有真实环境证据，因此未覆盖项目继续保留为兼容性/性能风险，不标记为 PASS。

## Final decision

2026-09-06，项目负责人确认 CM6 Architecture Spike 为 **GO**。现有证据足以接受 CM6 主架构；更多办公软件兼容和性能样本作为后续 adapter、widget 与优化工作，不再阻断 v2 实施。只有后续证据表明 source fidelity、单一 Document authority 或 Projection 等核心不变量无法满足时，才通过新 ADR 重新评估架构。
