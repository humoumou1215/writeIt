# F-03-R3 — Editable Embed child popup parity

## Status

IMPLEMENTED

## Goal

为已 mounted 的 editable Embed child 接入现有编辑辅助 popup contract，使 child 在 Live Preview 中可以使用 `/` slash quick insert 以及 `@`、`[[`、`![[` reference completion。popup 仍由既有 CM6 adapter/provider/command contract 驱动，选择结果只通过 child 自己的 `ProjectionMutationCapability` 写入目标 `DocumentStore`。

## Scope

- `EmbedProjectionExtensionOptions` 接收既有 slash/completion registry contract，并在 editable child mount 时安装既有 `createSlashQuickInsertExtension` / `createCompletionExtension`。
- App 将已经安装在 host editor 的 `quickInsertRegistry`、`completionRegistry` 传入 Embed extension；不复制 command/reference provider 业务逻辑。
- child popup 的 source、target path、expected revision、IME/composition、dismiss/destroy/detach、stale/late-result 行为沿用现有 popup 与 `ProjectionMutationCapability` contract。
- host reference navigation 对 child body 与 child popup 继续让位；明确 Open action 仍是 Embed 导航入口。
- 添加 child-specific integration/browser 回归证据，并复用既有 unit popup/lifecycle contract；更新 `STATUS.md`。

## Invariants

- Markdown 仍由目标 `DocumentStore` 权威持有；popup 不拥有 source 副本，也不修改 host token/source。
- child mutation 只能经过 child projection capability，使用目标 `DocumentState.path`/revision；readonly、missing、circular、detached 或 stale child 不产生可提交 mutation。
- 一次选择至多产生一次目标 Store mutation/revision/history；目标其它 projections 正常 fan-out。
- popup 只在真实输入 trigger 时出现；Raw Source/Live Preview 共用同一 CM6 source，IME composition 期间不提交。
- child popup/body 的事件不得被 host reference navigation 当作打开 host reference；显式 Open action 的既有行为不变。
- 不使用 timeout/sleep 作为同步协议，不修改 accepted ADR、`editor-app/`、`raw/` 或 `writeit-docs-merge-kit.zip`，不开始 P4-AR2/P5。

## Acceptance and verification

覆盖：

1. 真实 App `welcome.md` → `![[notes/workspace.md]]` 中 child 输入 `/` 可见 popup，选择基础 Markdown command 只修改目标 source；`@`、`[[`、`![[` 可见既有 completion，选择 leaf 只修改目标 source。
2. host source/token、current tab navigation 不变；目标 dirty/revision/history 与一次选择一致。
3. readonly child 不可编辑、不显示可提交 popup、不产生 mutation；child popup click 不触发 host navigation。
4. child popup 的 IME、Escape dismiss、destroy/detach、stale/late async result 不回写。
5. F-03-R1/FIX dirty tab indication 与 F-03-R2 image paste 相关回归继续通过。

验证命令：

```bash
cd writeit-v2
npm run test
npm run typecheck
npm run build
npm run check:boundaries
git diff --check
```

并运行相关 Vitest integration/unit 与 Playwright Chromium 测试。不得创建 commit。

## Out of scope

dirty Open/dirty indicator、图片 toast/image paste 语义重做、P4-AR2、P5/Table、P6–P12、accepted ADR、目录 migration、clipboard fallback、`editor-app/`、`raw/`、`writeit-docs-merge-kit.zip`。
