# WriteIt v2 Goal Decision Ledger

本文件记录启动长程 Codex Goal 前已经冻结、允许由实现证据微调、或必须再次询问用户的选择。它补充 SPEC/ADR，不取代 Accepted ADR。

## Decision classes

- **FROZEN**：Goal 内按此实现；如必须反向设计，属于 `MUST ASK`。
- **MAY ADAPT**：Agent 可根据 fixture、可访问性、平台或测试证据选择最小替代方案，记录理由后继续。
- **MUST ASK**：必须暂停 Goal 并取得用户决策。

## Product and delivery decisions

| ID | Class | Decision | Implementation note |
|---|---|---|---|
| D-001 | FROZEN | 一个 Goal 覆盖 P4 UX reconciliation 与 P5～P12；目标是 release candidate readiness，不包含真实发布。 | Checkpoint 与完成条件见 [GOAL.md](./GOAL.md)。 |
| D-002 | FROZEN | 左侧栏自动收纳默认关闭；开启后仅在打开文件或焦点进入中央编辑区后收起，并保留明显展开入口。 | Search/Git 切换、resize、菜单/弹窗不触发自动收起。 |
| D-003 | FROZEN | 内部 Reference 默认普通标签打开；Settings 可改为 split，右键/修饰键可临时选另一方式。 | split 仍共享同一 DocumentStore authority。 |
| D-004 | FROZEN | Table 编辑态 Tab/Shift+Tab 提交 cell 并前后移动；IME composition 期间不提交。 | 含显示换行的 cell 规则相同。 |
| D-005 | MAY ADAPT | Table cell 显示换行默认持久化为可见的 `<br>`；P5-00 必须用 renderer 与 legacy fixture 验证。 | 已确认采用 `<br>`：CM6 spike 与 legacy clipboard 均使用该公开格式；legacy Milkdown 的 `<nbr />` 是其 parser workaround，不带入 v2。v2 Table Core 显式解析 `<br>` 并保证 round-trip。见 [P5-00 contract](./P5_00_TABLE_UX_CONTRACT.md)。 |
| D-006 | FROZEN | Table column width 首版仅是运行时/工作区视图状态，不跨应用重启持久化，永不写入 Markdown。 | row/column reorder 仍是 P5 必须完成的 source mutation。 |
| D-007 | FROZEN | Annotation drawer 默认 `360px`、可 resize；窄窗口需限制宽度。 | Annotation 本体持久化遵守 ADR-0007。 |
| D-008 | FROZEN | Git Diff 默认 unified；支持 split toggle。Blame gutter 显示作者短名 + 相对日期，完整 metadata 在详情中。 | 不确定/本地行显示 Unknown 或 Local，不猜 provenance。 |
| D-009 | FROZEN | Annotation 是 workspace sidecar review data，不写入 Markdown body，也不成为 Document 内容 authority。 | 见 [ADR-0007](./adr/ADR-0007-annotation-workspace-sidecar-persistence.md)。 |
| D-010 | FROZEN | `rules.ts` / `suggest.ts` / `export.ts` 是显式启用的 trusted workspace extension；不在 UI/editor realm 直接执行，也不暴露任意 host capability。 | 见 [ADR-0008](./adr/ADR-0008-template-provider-runtime-boundary.md)。 |
| D-011 | FROZEN | Node 22 是 CI/release evidence 基准；本地允许 `>=22 <24`。统一验证命令为 `verify:fast` / `verify`。 | G8 必须有 Node 22 green evidence。 |
| D-012 | FROZEN | Desktop 目标是 macOS unsigned dev package + Windows CI package artifact。 | 签名、公证、发布、Linux 均不在 Goal 内。 |
| D-013 | FROZEN | production Embed loader failure → visible retry → recovery 必须在 G0 关闭，不再 deferred。 | Controlled harness 可继续作为补充证据，不能替代真实 App journey。 |
| D-014 | FROZEN | Goal 可自动创建本地 checkpoint commits；不得自动 push、tag、签名或发布。 | commit 前必须同步状态并通过对应验证。 |

## Approved parity deferrals

以下是 G8 可接受的预授权范围；它们不是自动 `DEFERRED`，仍需在 Phase 12 给出证据和恢复条件。

| ID | Capability | Allowed outcome |
|---|---|---|
| PD-001 | Full directory path migration and closed-document incoming-reference rewrite | 可保持现行 fail-closed policy，并记录未来 transaction/identity protocol 的进入条件。 |
| PD-002 | Advanced blame copy/move/whitespace heuristics | 可延期；基础准确 blame、Local/Unknown、history drill-down 不能延期。 |
| PD-003 | Legacy lite/GPU/occlusion switches | 无真实性能证据时可 `INTENTIONALLY DROPPED`；有证据则建 platform profile。 |
| PD-004 | Office clipboard extended matrix | 可延期当前环境无法验证的应用；核心 clipboard、TSV/HTML 与已有 WPS 证据不能延期。 |
| PD-005 | Signing/notarization/store distribution/Linux package | Goal 外；不影响 unsigned macOS dev package 与 Windows CI artifact。 |
| PD-006 | Physical legacy-directory cutover | Goal 外；`editor-app/` 和 `raw/` 不删除、不改名。 |

## MUST ASK triggers

只有以下情况需要中断连续执行：

1. 方案要求修改或 supersede Accepted ADR，或违反根 `AGENTS.md` 的架构不变量。
2. 需要新增上述列表之外的 parity deferral，或降低 GOAL completion conditions。
3. 需要用户凭据、证书、付费服务、第三方账户授权、完整 Xcode 安装/许可或修改系统级安全设置。
4. 需要 push、merge、tag、签名、公证、发布、删除真实用户数据或其他不可逆外部动作。
5. 两个可行方案会明显改变主要用户工作流，而本文件与 `UX_SPEC.md` 均未覆盖。

测试失败、Phase Gate HOLD、小型 API 命名、内部数据结构、可恢复的本地文件编辑和 remediation 不属于 `MUST ASK`。

## Change log

- **2026-09-09:** P6-00 accepted the Annotation/Mermaid UX contract: sidecar-only annotation state with fail-closed anchor mapping, and source-backed Mermaid cards with stale-render/error fallback.
- **2026-09-09:** P5-00 closed D-005 evidence review; `<br>` is the accepted v2 table-cell newline representation and legacy `<nbr />` remains unmodified source unless an explicit future migration is requested.
- **2026-09-08:** Goal preparation created; D-001～D-014 and PD-001～PD-006 accepted for the upcoming Codex Goal.
