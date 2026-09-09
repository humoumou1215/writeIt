# WriteIt v2 Status

- **Current phase:** G8 — Phase 12 Parity + RC Audit
- **Current task:** UX-03 — keyboard, disclosure and modal focus baseline
- **Branch:** `codex/goal-writeit-v2`
- **Verified baseline:** Full RC review (`RC_REVIEW_REPORT.md`); Node 22/23 verification and 80 Chromium tests PASS
- **Goal contract:** [GOAL.md](./GOAL.md)
- **Decision ledger:** [DECISIONS.md](./DECISIONS.md)
- **Milestone history:** [MILESTONES.md](./MILESTONES.md)

## UX-03 — 菜单键盘与焦点基线（2026-09-09）

- 在 UX-01 未提交改动之上继续单 Task 实现，不提交、不继续 Goal。
- 原生 disclosure 统一 Enter/Space、ArrowDown、Escape、外部点击和 focus exit；导航动作后关闭。新建为持久内联表单，避免拖动文件时收起造成布局移动。
- 设置/删除确认建立焦点边界，背景 inert、Tab 循环、Escape 关闭或取消；快捷键录制优先消费事件，背景工作区命令不执行。删除按钮重新启用后再恢复焦点。
- 文件树右键面板聚焦当前操作，关闭返回来源行；不存在的来源不会强行聚焦。
- 修复表格 Enter 后延迟恢复焦点导致紧接着输入落到表格外：DOM 更新后同步恢复活动 cell 焦点，不依赖绘制帧或固定等待；Markdown/Core/ADR 合同不变。
- CI remediation：editable Embed 的 body mousedown 在 child projection 已处理后停止继续冒泡，避免忙碌 runner 下宿主 CM6 夺回焦点；保持 Embed projection 与宿主导航隔离。
- 迁移旧 browser tests 的 metadata、隐藏预览、新建/导航菜单入口；独立 editor harness 提供明确可见容器，shell CSS 限定到应用中的编辑区。Revision 使用非视觉 DOM 属性检查，不恢复调试面板。
- 验证：`npm run test` 477 tests PASS；`npm run typecheck` PASS；`npm run build` PASS；稳定代码下 `npm run test:browser -- --workers=2` 全量 84 tests PASS（32s），`git diff --check` PASS。仍有既有大 chunk 构建警告；本次未验证原生 Tauri/WebView。
- 下一建议 Task：UX-02，按正文、Embed、表格、Mermaid 的显示基线进行专门视觉验收；本次未宣称完整 UX_SPEC 所有行为已实现。

## UX-01 — 编辑器布局修正（2026-09-09）

- 用户直接要求修正 Vite 调试界面的编辑器布局；本次为普通单 Task，不继续 Goal、不自动提交。
- 将居中演示卡片改为全窗口 shell：正文独立滚动、紧凑标签/文档栏、底部状态；对照预览/大纲/反向引用/批注按需打开，低频操作进入菜单，设置浮层显示。
- 检查地址 `http://10.144.144.1:5174/`；内置浏览器最初超时，之后连接成功并完成 Raw/Live 视觉核对，保留页面供用户查看。
- 验证：`npm run test` 477 tests PASS；`npm run typecheck` PASS；`npm run build` PASS（已有大 chunk warning）；`npx playwright test workspace-shell-layout live-preview-toggle --workers=2` 2 tests PASS。
- 新浏览器回归覆盖正文尺寸、默认隐藏对照预览、大纲与批注并行、Search 切换保留编辑器实例、900px 窗口无横向溢出和可见状态栏。
- 限制：未运行完整浏览器套件；旧演示界面的 metadata/常驻操作定位需随对应用户旅程迁移。下一建议 Task：UX-03，菜单键盘/焦点与既有浏览器旅程统一验收。

## Completed baseline

- [x] P0 repository reset, v2/legacy boundary, feature map, initial ADRs and scaffold
- [x] P1 DocumentStore/revision/history/timeline/filesystem foundation — gate PASS
- [x] P2 CM6 projection/source-fidelity architecture — gate PASS after remediation
- [x] P2A command/completion/IME/source-mode/keybinding foundation — acceptance PASS after remediation
- [x] P3 workspace, tabs, persistence, recovery/settings, attachment/image and template hook
- [x] P4 references, graph, completion, navigation, rename, clipboard, context actions and Embed
- [x] F-01/F-02/F-03 integration and follow-up fixes
- [x] P4-AR2 — PASS after user decision B ([review](./P4_ARCHITECTURE_REVIEW.md))
- [x] Goal preparation — contracts, decisions, ADR-0007/0008, task-ID normalization and unified verification commands; 396 Vitest + 63 Chromium + typecheck/build PASS
- [x] P6 Annotation + Mermaid — gate PASS ([review](./P6_ARCHITECTURE_REVIEW.md)); sidecar anchors/threads/drawer and source-backed Mermaid preview/commands/reference fallback complete
- [x] P7 Git + Diff + Provenance — gate PASS ([review](./P7_ARCHITECTURE_REVIEW.md)); structured Git ports/workbench, raw diff guarantee, semantic fallback, discard guard and blame projection complete
- [x] Full RC review — PASS WITH FOLLOW-UP ([report](./RC_REVIEW_REPORT.md)); static boundary review, full verification and built-in browser journeys complete

## Goal progress

| Checkpoint | State | Scope |
|---|---|---|
| G0 | PASS | P4-UX01/P4-UX02 and production Embed retry reconciliation |
| G1 | PASS | P5 Table |
| G2 | PASS | P6 Annotation + Mermaid |
| G3 | PASS | P7 Git + Diff + Provenance |
| G4 | PASS | P8 Derived Services + Template Intelligence |
| G5 | PASS | P9 Export |
| G6 | PASS | P10 Diagnostics |
| G7 | PASS | P11 Tauri/Desktop |
| G8 | PASS | P12 parity + RC audit |

## Gate state

- P4-AR2: **PASS**. The earlier architecture blocker is cleared.
- P4-UX01/P4-UX02: **PASS** in [G0 reconciliation](./G0_P4_UX_RECONCILIATION.md).
- production Embed loader failure/retry: closed in G0 with real App browser evidence.
- P5: **PASS** in [P5 Table Architecture Review](./P5_TABLE_ARCHITECTURE_REVIEW.md); core, projection, clipboard/IME, commands, resize and reorder are complete.
- P6: **PASS** in [P6 Annotation + Mermaid Architecture Review](./P6_ARCHITECTURE_REVIEW.md); annotation sidecar/anchors/drawer and source-backed Mermaid preview/commands/reference fallback are complete.
- P7: **PASS** in [P7 Git + Diff + Provenance Architecture Review](./P7_ARCHITECTURE_REVIEW.md); structured ports/workbench, raw diff guarantee, semantic fallback and blame projection are complete.
- P10: **PASS** in [P10 Architecture Review](./P10_ARCHITECTURE_REVIEW.md); bounded diagnostics, explicit privacy report and permissioned debug API are complete.

- P8: **PASS** in [P8 Architecture Review](./P8_ARCHITECTURE_REVIEW.md); search/replace, derived outline/backlinks/stats, validation gate and template catalog/provider contracts are complete.
- P9: **PASS** in [P9 Architecture Review](./P9_ARCHITECTURE_REVIEW.md); snapshot-based Markdown/PDF/DOCX/custom export and itemized batch failures are complete.
- P11: **PASS** in [P11 Architecture Review](./P11_ARCHITECTURE_REVIEW.md); desktop adapters, debug policy, package smoke and Windows CI artifact workflow are complete.
- P12: **PASS** in [P12 RC Audit](./P12_RC_AUDIT.md); feature-map parity classifications and approved deferrals are explicit.
- Full RC review: **PASS WITH FOLLOW-UP** in [RC review report](./RC_REVIEW_REPORT.md); no new P0/P1 blocker or `MUST ASK` decision was found.

## Active decisions

- Product defaults and allowed adaptation are frozen in [DECISIONS.md](./DECISIONS.md).
- Annotation persistence follows [ADR-0007](./adr/ADR-0007-annotation-workspace-sidecar-persistence.md).
- Executable template providers follow [ADR-0008](./adr/ADR-0008-template-provider-runtime-boundary.md).
- Existing directory operations remain fail-closed for Store-loaded/recovery-bound descendants; full directory migration stays an approved parity deferral.
- Goal checkpoints may auto-commit locally after green validation; push/tag/sign/release remain prohibited.

## Known risks / prerequisites

- Local machine currently lacks Rust/Cargo/rustup and full Xcode, so P11 implementation/package smoke needs an explicit toolchain preflight. Installing full Xcode, accepting licenses or obtaining signing credentials requires user action; unsigned development packaging does not require release signing.
- Windows package evidence must come from CI or a Windows host; this macOS checkout cannot provide a native Windows launch smoke.
- Node 22 is the CI/release baseline; current local Node 23 is inside the supported `>=22 <24` development range.
- Browser/mock filesystem coverage is strong, but native CAS/binary/exclusive-create semantics still need P11 adapter evidence.
- Office clipboard evidence does not cover every target application; the bounded deferral policy is in `GOAL.md`.
- P5 follow-up is bounded to approved `PD-004` Office matrix expansion and larger-table performance samples; neither blocks P6.
- Production build passes but the main JS chunk is about `990.43 kB` (`310.70 kB` gzip), above Vite's warning threshold; address from measured startup/runtime evidence rather than hiding the warning.

## Next

No further Goal checkpoint is pending. If continuing post-RC hardening, measure startup/runtime performance before deciding whether to split the main chunk; native Tauri launch and Windows artifact execution still require the corresponding target toolchains/hosts.
