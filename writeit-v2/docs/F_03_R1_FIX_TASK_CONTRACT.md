# F-03-R1-FIX — 显式 Open 后 Tab dirty 指示修复

## Status

IMPLEMENTED

## Goal

当 editable Embed 修改了一个已加载但当前没有 tab 的 Document，随后显式 Open 该路径时，新 tab 必须继续从同一 `DocumentStore` snapshot 反映 `revision !== persistedRevision`；保存后 dirty 指示清除。

## Root cause

App 的 tab view 虽然读取 `DocumentStore`，但其 Vue invalidation 依赖按 Document 建立的订阅。关闭 tab 会移除该订阅，而 Embed 仍可继续持有并修改同一个 loaded Document。此时 Store 已经 dirty，但 tab view 没有可靠的全局 Store 变更通知；同时缺失 snapshot 曾可回退成 clean-looking tab。

## Fix

- App 订阅 `DocumentStore` 的 source/persistence/path timeline facts，作为 tab projection 的统一 reactive invalidation；dirty 值仍直接读取当前 `DocumentState.dirty`。
- 不再把不存在的 DocumentStore snapshot 显示为 `dirty: false`；tab projection 对丢失的 authority 直接暴露生命周期 invariant，而不是渲染 clean-looking tab。
- 保留 DocumentId-only tab、F-03-R1 的 loaded dirty reuse、clean reopen 和既有 persistence Save/Discard/Conflict 语义。

## Regression coverage

Browser coverage covers editable Embed mutation, existing-target-tab and newly-bound-target-tab Open paths, stable DocumentId/no duplicate tab, dirty indicator persistence, Save clearing dirty, and host source/revision preservation. Existing F-03-R1 unit/integration coverage remains enabled.

## Scope limits

不修改 UX 决策、toast、popup 或 P5；不开始 F-03-R3；不触碰 legacy、raw 或 `writeit-docs-merge-kit.zip`；不使用 timeout/sleep 作为状态同步协议。
