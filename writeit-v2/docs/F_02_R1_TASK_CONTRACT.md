# F-02-R1 — Image paste idempotency and preview fidelity

## Goal

修复用户真实验收发现的两个图片工作流问题：

1. 一个真实 `Ctrl+V` 图片 paste event 只能启动一次 attachment pipeline，并对当前 DocumentStore 产生一次 source mutation；单图不能被 CM6 handler、DOM bridge 或异步完成路径重复插入。
2. 刚粘贴的 source-backed 图片在标准 document-relative Markdown path 下必须能被 Preview 正确读取和解码；blob/data URL 的生命周期不能无故使正常图片降级为 `Image could not be decoded; Markdown path was kept.`。

保留 F-02 已接受的 timestamp-first unique naming、exclusive create、ownership receipt、orphan compensation、DocumentStore authority、source fidelity 和 no-timeout/no-sleep 约束。

## Allowed scope

- `writeit-v2/src/editor/cm6/extensions/image-paste.ts`：paste event claim、clipboard file projection 去重、异步 pipeline/mutation 幂等保护及相关诊断接线。
- `writeit-v2/src/editor/preview/image-projection.ts`：source-backed image read/cache、并发解析和 blob/data URL 生命周期；不得改变 document-relative path 语义。
- `writeit-v2/src/editor/preview/basic-live-preview.ts`、`src/editor/cm6/extensions/live-preview.ts`：正常 source-backed 图片的 decode fallback/lifecycle 处理；失败仍只影响 projection。
- 与上述实现直接相关的 P3-06/P3-07 unit、integration、browser tests。
- 本合同、`writeit-v2/docs/STATUS.md` 及必要的本任务验证报告/状态证据。

不得修改 Embed 卡片交互或可编辑性、dirty delete、CAS、clipboard reference fallback、目录 migration、P5/Table、accepted ADR，或 `editor-app/`/`raw/`；不得建立 runtime import。

## Read first

- 根 `AGENTS.md`
- `writeit-v2/docs/IMPLEMENTATION_SPEC.md`
- `writeit-v2/docs/STATUS.md`
- `writeit-v2/docs/F_02_TASK_CONTRACT.md`
- `writeit-v2/docs/P3_R01_TASK_CONTRACT.md`
- `writeit-v2/docs/P4_AR2_TASK_CONTRACT.md`
- `writeit-v2/docs/P4_ARCHITECTURE_REVIEW.md` 中 F-02 结论及用户验收边界
- 根 `LEGACY_FEATURE_MAP.md` 的 image paste / relative image projection 条目
- P3-06/P3-07 实现：`src/application/attachments/image-paste.ts`、`src/core/workspace/attachments.ts`、`src/platform/filesystem/binary-port.ts`、`src/platform/filesystem/memory.ts`、`src/editor/cm6/extensions/image-paste.ts`、`src/editor/preview/image-projection.ts`、`src/editor/preview/basic-live-preview.ts`、`src/editor/cm6/extensions/live-preview.ts`、`src/App.vue`
- 图片粘贴与 Preview 的现有 unit/integration/browser tests
- 用户验收记录：单次 Ctrl+V 单图重复 token，以及 Preview 的 decode degradation
- 开始前的 `git status`

## Implementation requirements

1. 为每个真实 paste event 建立一次性 claim。claim 必须发生在异步读取/写盘前，并覆盖同一 event 经多个 CM6 handler、DOM listener、fallback bridge 或重复回调的情况；同一 event 的 late completion 不得再次调用 attachment handler 或 `DocumentStore` mutation。
2. Clipboard 的 `files` 与 `items` 是同一 paste payload 的两种 projection：同一单图只能进入一次 input batch；当 `files` 为空时仍支持 item-only 图片；同一事件中用户明确提供的两张图片必须保留为两个 inputs/tokens/attachments。不能用跨独立 event 的时间窗口或 sleep 猜测用户意图。
3. 一次成功的图片 paste pipeline 至多执行一次 `mutation.applyChange`，且只通过当前 editable/live projection capability 与 captured revision gate；成功时 source、revision、history、dirty 各只发生一次。readonly、destroyed、stale/revision race、binary failure、reference validation 或 mutation failure 不得重复插入/损坏 source，并继续只补偿本次 receipts。
4. 保持 timestamp-first unique naming、exclusive create、document-relative source path、orphan compensation、DocumentStore authority 和 source fidelity；不要用重复粘贴去重逻辑吞掉同一 event 内的明确多图输入，也不要把附件写盘或预览读取变成新的 source authority。
5. source-backed Preview 与 CM6 live-preview image widget 必须使用同一 document-relative resolved workspace path。并发解析同一路径不能互相 revoke 正在使用的 object URL；object URL 被回收/不可用时，若已有 bytes，应可安全切换到等价 data URL，且正常图片不应无故显示 decode degradation。读取、解码或生命周期确实失败时仍只显示可见降级并保留原 Markdown。
6. raw/Live Preview 切换、重新挂载、重新打开/重新解析和嵌套文档解析必须继续使用同一 source/path semantics。若 B9 中 Embed 卡片内图片失败的根因属于 P4 Embed projection ownership/lifecycle，必须在验证报告中明确隔离，不能借本任务修改 Embed 交互或可编辑性；只有共享图片解析/Preview 根因属于本任务。
7. 不引入 timeout/sleep 作为状态同步协议，不修改 F-01、F-03、clipboard reference fallback、dirty delete/CAS、目录 migration 或 P5，不改变 accepted ADR。

## Tests

- **Unit**：同一 paste payload 的 `files`/`items` projection 不重复；item-only 图片可用；同一 batch 两张明确图片保持两张；event claim/重复调用只执行一次；resolver 同路径并发解析共享安全结果；object URL/data URL fallback 和 revoke/dispose 行为可验证；原始 source/path 不变。
- **Integration**：单次 Ctrl+V 单图恰好一个 Markdown image token、一个 Store revision、一个 history entry 和一个附件；重复 event/异步完成不重复 mutation；两图 paste 产生两个 token/附件；成功后 raw/Preview 切换、重新挂载/重新解析仍可读；嵌套 document-relative path 指向同一 workspace binary；binary write/mutation failure、readonly/destroyed/revision race 不多插入或损坏 source。
- **Browser**：真实 Chromium paste event 的单图 token/revision/attachment 计数；同一 event 不重复、同事件两图不丢；有效图片在 paste 后 Preview `ready` 且 `src` 可解码，raw/Live Preview 切换及 reopen/reparse 继续显示；嵌套路径可解析。若失败只发生在 Embed card projection，记录为隔离的 P4 follow-up，不修改 Embed。
- **Verification**：
  - `cd writeit-v2 && npm run test`
  - `cd writeit-v2 && npm run test:browser`
  - `cd writeit-v2 && npm run typecheck`
  - `cd writeit-v2 && npm run build`
  - `cd writeit-v2 && npm run check:boundaries`
  - `git diff --check`

只等待明确的 Promise/event completion，不用固定延时掩盖失败。

## Acceptance criteria

1. 单次真实 Ctrl+V 单图只产生一个 Markdown image token、一个 DocumentStore revision/history mutation 和一个新附件；timestamp-first、exclusive create、ownership/compensation 行为不回归。
2. 同一 event 经 handler/DOM/fallback/async completion 的重复路径不会重复 attachment pipeline 或 Store mutation；同一 event 中明确两张图片仍产生两张，而不是被错误合并或丢弃。
3. 粘贴后 source/Preview 切换、重新挂载、重新打开/重新解析均能通过标准 document-relative path 解码正常图片；嵌套文档 path 与 workspace binary 一致；正常图片不出现无故 decode degradation。
4. Preview/read/decode/lifecycle 失败仍可见降级且保留 Markdown source；不会以预览状态改写 source、revision 或 history。
5. binary write/mutation failure、readonly/destroyed/revision race 不会多插入、不覆盖/删除非本次附件、不损坏 authoritative source；失败 compensation 仍 receipt-scoped 并报告 orphan diagnostic。
6. 若 B9 的 Embed 卡片内图片失败证明是 P4 Embed projection ownership，而非共享 image pipeline，验证报告明确记录并留给后续 F-03/Embed 任务；本任务不修改 Embed 交互。
7. 相关 unit/integration/browser、typecheck、build、boundary 和 whitespace 检查通过；只为 F-02-R1 创建一个 commit，默认不 push，不 reset/checkout/clean/force push/amend/rebase，不自动开始 Embed 或 P5。

## Out of scope

- Embed 卡片交互、可编辑性、loader/retry production acceptance（F-03/P4 follow-up）。
- dirty delete、CAS、conditional write、clipboard reference fallback、directory rename/migration、path migration。
- P5/Table、P6–P12、accepted ADR、真实 Tauri/native adapter、系统文件管理器 reveal。
- 改动 `editor-app/` 或 `raw/`，建立 legacy runtime dependency，或以 timeout/sleep 掩盖竞态。
