# F-03-R2 — Editable Embed child image paste bridge

## Goal

为 editable Embed child projection 接入现有图片粘贴能力：图片附件仍由既有 `ImageAttachmentService`/`DocumentStore` mutation capability 处理，Markdown authority、target revision/history 和 source fidelity 不变。readonly Embed 继续拒绝粘贴。

## Allowed scope

- `src/editor/cm6/extensions/embed-projection.ts`：仅为 mounted editable child 接入 child-scoped image-paste extension 与 target path/revision/capability 接线。
- `src/App.vue`：向 Embed child 传递既有 attachment service、当前 image-paste mode、cleanup/diagnostic/error/applied callbacks 所需的最小 application seam。
- 直接相关的 image-paste/embed unit、integration、browser tests。
- 本 contract、`STATUS.md` 事实更新。

不得修改 accepted ADR、F-02-R1 全局语义、popup、dirty Open、toast 生命周期、P4-AR2、P5、`editor-app/` 或 `raw/`；不得建立第二份 Markdown authority、不得使用 timeout/sleep。

## Implementation requirements

1. Child 必须使用目标 `DocumentState.path` 作为 `ImagePasteHandlerContext.documentPath`/attachment host path；不得复用 host 路径。
2. Source-backed attachment 继续调用既有 `ImageAttachmentService`，source mutation 只通过 child 自身的 `ProjectionMutationCapability` 与 captured/current revision gate 提交；不得直接取得 host 路径、Store mutation 绕过 capability 或创建 Markdown 副本。
3. 只为 child projection 添加图片粘贴 extension；不改变 F-02-R1 的全局 event claim、files/items 去重、多图顺序和 compensation 语义。
4. readonly、destroyed/detached、stale、revision race、读取/写盘/校验/Store mutation 失败必须 source-safe：不得多次 mutation、误删非本次附件或损坏 host/target source；失败 compensation 仅限本次 ownership receipts。
5. 同一 paste event 必须幂等；同一事件的 `files`/`items` projection、重复路径/等元数据不能重复插入，但一次事件明确提供的多图不能丢失。
6. parent host token/source/revision/history 不得因 child paste 重复变化；target Document 只产生一次对应 mutation/history entry。嵌套 child 必须继续使用各自目标文档目录解析相对图片路径。
7. child detach/destroy/stale/失败时不得扩大 compensation 范围；readonly child 必须继续拒绝 paste；popup、dirty Open、toast 不属于本任务。

## Tests and verification

最小必要证据覆盖：

- editable child 一次有效图片 paste 生成一个目标 image token、一次 target Store mutation/revision/history；host token/source 不变；
- target document-relative path，含嵌套目标可显示/解码；
- readonly child 拒绝 paste；child detach/destroy/stale/失败不重复 mutation、不删除非本次附件；
- 同一 paste event 的 files/items/重复路径只处理一次，同时明确多图仍全部保留；
- 相关 unit/integration/browser tests，以及 `npm run test`、`npm run typecheck`、`npm run build`、`npm run check:boundaries`、`git diff --check`。

测试只等待明确 Promise/event completion，不用固定延时掩盖同步问题。

## Acceptance criteria

Editable Embed child 可在当前 host tab 内粘贴 source-backed 图片并更新目标 DocumentStore；readonly child 不可粘贴；目标路径和嵌套相对路径正确；同一事件不重复；host authority/history 不重复；所有失败/lifecycle/compensation 路径保持 source-safe。上述验证通过后只更新 STATUS，不自动开始其他 Task，不创建 commit。

## Out of scope

`@`/`/` popup、missing target dirty Open、成功 toast 生命周期、全局 image-paste 语义重做、P4-AR2/P5、accepted ADR、legacy/raw 修改。
