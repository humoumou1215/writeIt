# F-03 — Editable Embed card interaction and nested image preview

## Goal

关闭 P4-09 Embed Projection 的生产用户验收缺口：`![[path]]` 默认作为当前 tab 内的 editable Embed projection，点击/聚焦卡片正文必须把光标留在该 Embed child projection 中；输入通过目标 `DocumentStore` authority 更新目标 Markdown，并同步目标 Document 的所有 projection，不能因为正文点击导航到目标 workspace tab。同时修复 Embed child projection 内 source-backed 图片预览未使用目标文档路径/共享 resolver 的集成根因。

保持 Markdown persistent contract、DocumentStore runtime authority、Projection-only boundary、source/revision/history、nested/circular、missing/retry、close/reopen、undo/redo 和 lifecycle 不变量；`![[path|ro]]` 继续是 readonly projection。

## Allowed scope

- `writeit-v2/src/editor/cm6/extensions/embed-projection.ts`：editable/readonly Embed card 的点击、聚焦、事件边界、child projection image options 传递和必要的 source-backed projection lifecycle 接线。
- `writeit-v2/src/editor/cm6/extensions/reference-navigation.ts` 或等价的 P4-09 交互边界适配：避免 editable Embed 正文点击被 reference navigation 误判为打开目标；保留/提供明确的 readonly/title/open 导航动作。
- `writeit-v2/src/editor/cm6/projection/single-document-view.ts`、`src/editor/cm6/extensions/live-preview.ts`、`src/editor/preview/*` 仅限为 Embed child 使用目标 `DocumentState.path` 和共享图片 resolver/cache 所需的最小投影接线。
- `writeit-v2/src/App.vue` 及必要的 Embed/图片 UI 样式：向 Embed projection 注入现有共享 image resolver/callback，不建立新的图片或 Markdown authority。
- P4-09、P4-R05、F-02-R1 直接相关的 unit、integration、browser 测试与测试 harness/fixture。
- 本合同、`writeit-v2/docs/STATUS.md` 及与本任务验收证据直接相关的简洁文档更新。

不得修改 dirty delete、CAS/conditional write、clipboard fallback、目录 migration、P5/Table、P6–P12、accepted ADR、`editor-app/` 或 `raw/`；不得改变 Markdown authority、Projection 边界或引入 runtime legacy import；不得用 timeout/sleep 作为状态同步协议。

## Read first

- 根 `AGENTS.md`
- `writeit-v2/docs/IMPLEMENTATION_SPEC.md`
- `writeit-v2/docs/STATUS.md`
- `LEGACY_FEATURE_MAP.md` 中 Editable/readonly/nested/circular Embed 和相对图片投影条目
- `writeit-v2/docs/P4_ARCHITECTURE_REVIEW.md` 的 F-03 production acceptance gap、P4-R05 结论和用户验收记录
- `writeit-v2/docs/P4_R05_TASK_CONTRACT.md`
- `writeit-v2/docs/F_02_R1_TASK_CONTRACT.md`
- P4-09 implementation：`src/editor/cm6/extensions/embed-projection.ts`
- Embed/Preview/DocumentStore projection lifecycle：`src/editor/cm6/projection/single-document-view.ts`、`src/editor/cm6/projection/mutation-capability.ts`、`src/editor/preview/basic-live-preview.ts`、`src/editor/preview/image-projection.ts`、`src/core/document/store.ts`
- App wiring：`src/App.vue`、`src/editor/cm6/extensions/live-preview.ts`、`src/editor/cm6/extensions/reference-navigation.ts`
- P4-09、P4-R05、F-02-R1 相关 unit/integration/browser tests，以及既有真实 Chromium 用户验收记录
- 开始前的 `git status`

## Implementation requirements

1. `![[path]]` 默认是 editable Embed。点击或聚焦卡片正文时，焦点/光标必须进入当前 tab 的 Embed child CM6 projection；正文输入只能经目标 projection mutation capability → 目标 `DocumentStore` authority 提交，并同步目标 Document 的其他 projection。不得调用 workspace tab 导航作为正文点击的替代行为。
2. Embed 的事件边界必须区分正文和明确打开/标题动作：editable 正文点击不能被 host reference-navigation 误判为打开；如保留导航，必须由明确的标题/打开动作触发。`![[path|ro]]` child projection 必须保持 `readOnly`、不拥有 Markdown 副本、不产生目标 source mutation；其既有/明确的打开动作可以导航。
3. child projection 的 source-backed Preview 必须接收目标 `DocumentState.path`，使用现有共享 `WorkspaceImageProjectionResolver`/cache 和现有 callback；嵌套目标的图片按目标文档目录解析。读取/解码失败只能显示可诊断降级并保留 Markdown source。
4. 保持 nested/circular/depth guard、missing→appears、transient load failure→explicit retry、parent detach/late result、close-reopen、stale/degraded、undo/redo、source/revision/history 和 Store projection attach/ack/detach 不变量。不得以重新编辑 host token、复制 Markdown 或新建第二份 authority 解决问题。
5. 点击/聚焦/输入不得生成重复 reference token、重复 Store mutation 或错误 revision/history；目标 projection detach/destroy 后晚到的 CM6/Promise/DOM 事件必须被拒绝，不能写入 target Store。readonly/circular/missing/error 状态不得意外 mutation。
6. 不引入 timeout/sleep，不修改 ADR，不 runtime import `editor-app`，不扩展到 dirty delete、CAS、clipboard、目录 migration 或 P5。

## Tests

- **Unit**：editable/readonly interaction policy、Embed body 与 host navigation 的事件边界、readonly mutation rejection、目标文档路径覆盖图片 resolver options、source/path fallback 语义和 destroy/detach 后 late event 不写入。
- **Integration**：
  - `welcome.md` → `![[notes/workspace.md]]` 的 child focus/edit，通过目标 Store fan-out 更新所有 target projections，host source/revision/history 不重复且当前 tab 不导航。
  - `![[path|ro]]` 正文不可编辑；明确打开动作按现有 contract 导航或调用 open callback。
  - 目标/嵌套目标含 document-relative 图片时，Embed 内图片使用目标路径成功解析、显示和解码；失败仅降级并保留 source。
  - nested/circular、missing→appears、transient failure→retry、parent detach/close-reopen、stale/degraded、undo/redo 和 projection lifecycle 不回归。
  - 一次输入只产生一次 Store mutation、revision/history；detach/destroy 后晚到事件不写入。
- **Browser / Chromium acceptance**：真实 App 旅程验证 `welcome.md` Embed 正文点击后当前 tab 不变、child `.cm-content` 获得焦点并可输入；readonly Embed 不可编辑且显式打开动作可导航；目标和嵌套目标图片 `complete && naturalWidth > 0`；controlled Promise/event 验证 missing/retry/detach/close-reopen，不使用固定等待掩盖失败。
- **Verification**：
  - `cd writeit-v2 && npm run test`
  - 相关 `npm run test:browser` / integration / unit tests
  - `cd writeit-v2 && npm run typecheck`
  - `cd writeit-v2 && npm run build`
  - `cd writeit-v2 && npm run check:boundaries`
  - `git diff --check`

## Acceptance criteria

1. 在真实 App 中，`welcome.md` 使用 `![[notes/workspace.md]]` 时，点击 Embed 卡片正文会在当前 tab 内的 child projection 获得光标；输入只更新 `notes/workspace.md` 的目标 `DocumentStore`、revision/history 和所有 target projections，不自动切换到 `notes/workspace.md` tab，也不改写 host token。
2. `![[path|ro]]` 的 child projection 是 readonly：正文点击/输入不产生 target Store mutation；明确标题/打开动作仍可按现有 navigation contract 导航。
3. 目标文档及嵌套目标中的 document-relative 图片在 Embed child projection 内通过目标文档路径和共享 resolver/cache 正确解码显示；read/decode 失败可见降级且 source/revision/history 不变。
4. nested/circular/depth、missing→appears、transient load failure→explicit retry、parent detach/late result、close-reopen、stale/degraded、undo/redo 和 lifecycle 全部通过；无 ghost child projection、重复 token、重复 mutation 或错误 revision/history。
5. target projection destroy/detach 后晚到事件、Promise 或 DOM interaction 不得写入 Store；readonly/circular/error 路径保持 source-safe。
6. 相关 unit/integration/browser、typecheck、build、boundary 和 whitespace 检查通过；更新 STATUS 记录 F-03 完成与剩余风险；只为 F-03 创建一个 commit，默认不 push、不 amend/rebase/reset/checkout/clean，不开始 P5。

## Out of scope

- dirty delete、CAS/conditional filesystem writes、clipboard/reference fallback、目录 rename/migration/path rebind。
- P5 Table、P6–P12、accepted ADR、真实 Tauri/native adapter 或 workspace persistence 架构重写。
- 新的图片格式/缓存架构、全局 Preview 重设计、Markdown parser/serializer 重写、Embed 以外的 reference navigation redesign。
- 任何 `editor-app/`、`raw/` 修改、runtime import、固定延时/timeout/sleep 协议，或除 F-03 外的自动任务/提交。
