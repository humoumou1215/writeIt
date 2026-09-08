# F-03-R1 — Loaded dirty Document 的统一显式 Open/激活策略

**Status: IMPLEMENTED**

## Goal

统一显式 Open、Embed 的明确 Open action、文件树打开和其他 workspace navigation 对“已经进入同一个 `DocumentStore` 的 Document”的处理。只要目标 Document 已在当前 Store 中且有未保存修改，Open 必须复用这份 authority 和同一个 `DocumentId`，不能通过文件系统重新读取来替代它，也不能因为 `persistence.reopen()` 的 dirty guard 失败。

本任务只修复 application open/activation seam；不改变 Markdown authority、Embed projection、persistence 的 Save/Discard/Cancel 或 external-conflict policy。

## Product rule and decision table

`openWorkspaceFile(path)` 在进行 filesystem load/reopen 之前，按稳定 workspace path 查询当前 `DocumentStore`：

| Store 状态 | 是否已有该 Document 的 tab | Open 行为 |
| --- | --- | --- |
| 未加载 | 否 | 创建/复用路径对应的加载 id，走正常 `persistence.loadFromFile()`；文件缺失或读取失败仍按原流程报错。 |
| 未加载 | 是（仅异常/残留状态） | 不创建第二份 authority；先按正常 load 流程恢复同一 tab 的 DocumentId。 |
| 已加载、dirty | 否 | **直接复用现有 DocumentId，创建并激活绑定该 id 的 tab；绝不调用 `persistence.reopen()`。** |
| 已加载、dirty | 是 | **只激活现有 tab；不重新加载、不重复打开、不改变 source/revision/history。** |
| 已加载、clean | 是 | 只激活现有 tab；不重复打开。 |
| 已加载、clean | 否 | 保留当前 clean closed-document 的正常 `persistence.reopen()`/filesystem reconciliation 流程，以维持普通文件重新打开和外部文件检查语义。 |

其中“已加载”以 Store 按稳定 path 找到的 `DocumentState` 为准；路径缓存只能辅助定位，不能制造第二个 id 或覆盖 Store authority。

## Invariants

- 同一 workspace path 在 Store 中最多对应一份 Document；dirty Embed child、主编辑器和显式 Open 共享同一 `DocumentId`、Markdown、revision、persistedRevision 和 history。
- 激活 dirty Document 只改变 tabs/navigation/UI state：不重新读取文件、不调用 `persistence.reopen()`、不提交 Store source change，不重复修改 host reference token、host source/revision/history 或 target source/revision/history。
- B 没有 tab 时，新增的是只保存 `DocumentId` 的 tab；B 已有 tab 时，激活原 tab。tab 不拥有 Markdown 副本。
- missing → appears 仍由 Embed 的现有 missing/load/retry seam 负责；文件出现后如果 target 已被加载并编辑，显式 Open 走上述 dirty 复用规则。
- external conflict、external-change、Save/Discard/Cancel 语义不被静默绕过：Open 不自动 Save、Discard、Reload 或清除 conflict；已有 persistence 状态继续展示并由既有显式操作处理。普通 clean 文件的既有 reopen/reconciliation 行为保持不变。
- host token/source/revision/history、target revision/history、projection attach/ack/detach 和 source fidelity 不因 Open 重复发生；不得用 catch/忽略 `UnsavedChangesError` 掩盖错误。

## Acceptance and regression coverage

至少覆盖：

1. A.md 中 editable Embed B.md，B child 编辑后显式 Open B：保留编辑，Store 只有一个 B Document，B 只有一个正确 tab；分别覆盖 B 原有 tab 与无 tab。
2. missing → appears 后同样复用已加载 dirty B。
3. host token/source/revision/history 不重复变化，DocumentId/path identity 不变化。
4. 未加载的 clean 文件仍按正常 filesystem load；已有 clean closed 文件的 reopen 语义不变。
5. external conflict 与既有 Save/Discard/Cancel 流程继续有效。

## Scope limits

- 不实现 F-03-R2 之外的图片提示生命周期。
- 不实现 `@`、`/` popup（F-03-R3）。
- 不开始 F-02-R2、P4-AR2、P5 或其他后续任务。
- 不修改 `editor-app/`、`raw/`，不恢复、重建或触碰 `writeit-docs-merge-kit.zip`，不使用 timeout/sleep 作为状态协议。
