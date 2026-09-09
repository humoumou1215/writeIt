# G0 — P4 UX 与 Embed Retry Reconciliation

- **日期：** 2026-09-08
- **范围：** P4-UX01、P4-UX02、production Embed loader failure/retry
- **Gate：** PASS
- **架构决策：** 未修改 ADR-0001～0008；Markdown、DocumentStore、Projection 不变量保持不变

## P4-UX01 acceptance matrix

| Requirement | Reconciliation | Evidence |
|---|---|---|
| Sidebar collapse / resize / opt-in auto-collapse | **本次补齐**：默认 pin/open；只有打开文档或 focus 进入主编辑器时自动收纳，工具切换不触发 | `tabs-navigation.spec.ts` auto-collapse；既有 recovery/settings 与 resize browser tests |
| Search/Git 切换保持 editor continuity | **本次补齐**：建立 File/Search/Git shell seam；切换不销毁主 projection；Git seam 对当前 dirty 文档作轻量突出 | `tabs-navigation.spec.ts` tool continuity，DOM continuity probe 与 dirty current-file assertion |
| File Tree / Git current document highlight；Reveal current | **已有 + 本次补齐**：File Tree selection/reveal 已有；Git seam 显示当前 dirty 文档；完整 repository status 仍由 P7-03 接入同一 seam | `tabs-navigation.spec.ts` navigation/reveal/tool continuity |
| Tab close / double-click close / dirty protection | **本次补齐**：double-click 与 close button 共用同一 command 和 confirm path | `tabs-navigation.spec.ts` dirty close 与 double-click dirty close |
| Normal tab + split navigation, shared authority | **本次补齐**：普通点击保持 tab 默认；Shift-click 或 Embed `Open split` 打开第二 projection；两 pane 共享 Store revision | `tabs-navigation.spec.ts` split shared-state journey |
| Popup only from real input; Raw/Live both supported | **本次补齐**：selection/focus 移动不能启动新 session；显式 completion edit 后可继续 session | `reference-completion.spec.ts` cursor-no-trigger 与 Raw/Live input；popup lifecycle unit/browser |
| Folder Right/Left real history | **本次补齐**：Right 进入 selected directory；Left 恢复原 query 与 selection，不凭路径字符串猜 parent | `reference-completion.spec.ts` directory history |
| Tree drag move uses unified mutation | **已有证据**：file move 仍经 `ReferenceRenameService`，directory 经 `WorkspaceTreeService` fail-closed policy | `workspace-tree.spec.ts`；`directory-rename-safety.spec.ts` |

## P4-UX02 acceptance matrix

| Requirement | Reconciliation | Evidence |
|---|---|---|
| Independent Reference occurrence identity and visible numbering | **本次补齐**：每次 occurrence 带派生 ID、ordinal 与 `①②…`；不写入 source | reference navigation integration + browser duplicate/remap tests |
| Duplicate target occurrences remain precisely addressable | **本次补齐 contract**：相同 target 的两次 mark 保留不同 health fact ID；P8 Backlinks 可直接消费 | `reference-navigation.spec.ts` distinct IDs and remap |
| Embed first line shows real syntax + readonly state | **本次补齐**：label 显示 `reference.raw`；readonly badge 独立显示 | `embed-projection.spec.ts` readonly label |
| Sticky Embed header | **本次补齐**：来源行 `position: sticky`，仅为 projection CSS | computed-style browser assertion |
| Nested blockquote-like depth; no source writeback | **本次补齐**：轻量左边线与 `data-embed-depth`；nested source/revision 保持 | nested Embed browser assertions + existing Store tests |
| Circular Embed bounded diagnostic | **已有 + 补证据**：保留真实来源行，第二行显示 circular diagnostic 并停止递归 | `embed-projection.spec.ts` circular label/message/count |
| Image click focuses; hover action opens preview | **本次补齐**：普通 image click 只 focus/outline；Preview button 才打开 modal | image projection integration + `image-paste.spec.ts` |

## Production Embed retry closure

原 P4-AR2 的 F-03 test gap 已关闭：真实 `App.vue` 使用正常 `ensureEmbeddedDocument → DocumentPersistenceService → DocumentStore` 路径。测试只注入“一次读取失败”故障，不替换 loader；首次 rejection 后 Embed 显示错误与 `Retry`，点击后重新执行同一 loader 并挂载 child projection。重试期间 host Markdown/revision 不发生恢复性改写。

证据：

- `f03-embed-acceptance.spec.ts`：real App failure → visible error/retry → recovered editable child → source fidelity；
- `embed-projection.spec.ts` 与 integration suite：controller retry、late result、detach/reopen；
- retry action 在 reference-navigation capture 前被识别为 Embed interaction，不会误触发普通 navigation。

## Verification

`npm run verify`：63 Vitest files / 397 tests PASS；72 Chromium tests PASS；typecheck、production build、architecture boundary、Goal contract PASS。Vite 主 chunk 大小 warning 是既有性能观察项，不是 G0 correctness blocker。

## Gate conclusion

P4-UX01、P4-UX02 与 D-013 均已 reconciliation 并有自动化证据。G0 **PASS**，允许进入 G1/P5-00。
