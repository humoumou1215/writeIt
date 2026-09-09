# WriteIt v2 全量 Review 与验证报告

**日期：** 2026-09-09  
**分支：** `codex/goal-writeit-v2`  
**结论：** PASS WITH FOLLOW-UP

## 结论摘要

本轮按 `IMPLEMENTATION_SPEC.md`、`UX_SPEC.md`、`PHASE_GATE_CHECKLIST.md`、`GOAL.md` 和 `DECISIONS.md` 对 v2 做了静态边界审查、全量自动化验证和内置浏览器可见旅程验证。没有发现 Markdown 数据权威、DocumentStore、Projection、source-fidelity、Diff guarantee 或 P0/P1 UX 阻断问题。

审查中修复了两个问题：同一 dirty 标签的快速重复关闭可能并发进入确认流程；以及浏览器测试依赖默认 1 秒 auto-save 制造 dirty 状态、在 Node 22/并行负载下会先自动保存。应用增加同一 Document 关闭请求的 in-flight 防重入，Cancel 路径立即释放保护；相关测试显式使用 Manual 保存，并隔离原生 dialog 的 CDP 时序。

## 自动化证据

| 验证 | 结果 |
|---|---|
| Goal contract / boundary check | PASS；156 个 v2 source files |
| Vitest unit/integration | PASS；89 files / 477 tests |
| Chromium browser suite | PASS；80 tests |
| Node 23 `npm run verify` | PASS |
| Node 22.23.2 `npm run verify` | PASS |
| `npm run desktop:package-smoke` | PASS；unsigned webview bundle smoke |
| 内置浏览器运行时日志 | PASS；手动旅程期间无 warn/error |

## 内置浏览器可见旅程

- 启动页布局：Workspace/File Tree、Outline、Backlinks、Tabs、编辑区、Live Preview、状态栏均可达。
- Raw Source ↔ Live Preview：同一 CM6 编辑器切换，revision 不增加，未知 Markdown 保留。
- 编辑与保存：输入、dirty/persistence 状态变化、Manual Save 后恢复 clean 通过。
- Settings：Auto-save 切换为 Manual、侧栏收纳、刷新后恢复设置；中央文档仍保持打开。
- Workspace：展开目录、打开文档、多标签切换；Search 精确命中跳转；Git 非仓库状态有可理解提示。
- Reference：输入 `[[` 后出现 Link / Editable embed / Readonly embed 三种模式和工作区候选。

## SPEC / UX 覆盖判断

- Markdown-first、单一 DocumentStore authority、Projection-only editor/embed/preview/table/diff：有边界检查、unit/integration/browser 证据。
- source fidelity：LF/CRLF/mixed/unknown Markdown、局部编辑、Preview fallback 有测试证据。
- 失败恢复：Embed retry、late result、circular embed、clipboard fallback、popup lifecycle、删除保护均有 browser/integration 证据。
- UX baseline：侧栏默认不自动收纳、标签 dirty 保护、搜索/Git 不销毁编辑器、Live Preview、Table、Annotation、Mermaid、Reference 和设置入口均有对应自动化或可见验证。
- Feature Map：granular workflow 均已分类；未发现新增未分类项。

## 待决策与后续事项

本轮没有触发 `DECISIONS.md` 的新增 `MUST ASK`。以下是既有、已批准的 Goal deferral：

- 完整目录迁移及 closed-document incoming-reference rewrite；当前 fail-closed policy 保持。
- 高级 Git blame copy/move/whitespace heuristics。
- 无真实性能证据时的 lite/GPU/occlusion tuning。
- 超出当前环境可验证范围的 Office clipboard 扩展矩阵。
- signing/notarization/store distribution/Linux packaging。
- physical legacy-directory cutover。

非阻断 follow-up：production JS 主 chunk 约 990 kB（约 311 kB gzip），超过 Vite 500 kB warning threshold；应以真实启动/运行性能数据决定是否拆包。macOS 原生 Tauri launch 与 Windows artifact execution 仍需对应工具链/CI 主机证据；本机已完成 webview bundle smoke 和 workflow 静态核对。
