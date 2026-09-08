# P3-R01 — Standard document-relative image paths

## Goal

将 P3-06/P3-07 的 Markdown 图片路径统一为相对于当前 Markdown 文档所在目录的标准相对路径。四种图片粘贴策略写入的 source path、解析、预览、复制和 workspace tree 定位必须共享同一套 document-relative 语义；读取或渲染失败只能降级，不能改写 Markdown source。

## Allowed scope

- `writeit-v2` 中 P3-06/P3-07 图片路径的纯路径计算、持久化 source path、二进制读取解析、Live Preview/CM6 image projection、图片预览与复制、workspace tree 定位。
- `writeit-v2` 中为上述语义提供共享、无 DOM/CM6 依赖的路径 helper，以及必要的 application/editor/UI adapter 接线。
- 相关 unit、integration、browser 测试、边界检查、`STATUS.md` 和本 Task Contract。

不得修改 accepted ADR；如果实现必须改变已接受的 Markdown persistent contract 或需要新增/修改 ADR，立即停止并报告决策点。

## Read first

- `AGENTS.md`
- `writeit-v2/docs/IMPLEMENTATION_SPEC.md`
- `writeit-v2/docs/STATUS.md`
- `LEGACY_FEATURE_MAP.md` 中 Image paste persistence / relative image display 条目
- `writeit-v2/src/core/workspace/attachments.ts`
- `writeit-v2/src/application/attachments/image-paste.ts`
- `writeit-v2/src/editor/preview/image-projection.ts`
- `writeit-v2/src/editor/preview/basic-live-preview.ts`
- `writeit-v2/src/editor/cm6/extensions/live-preview.ts`
- `writeit-v2/src/editor/cm6/extensions/image-paste.ts`
- `writeit-v2/src/application/workspace/tree.ts`、`src/App.vue` 及相关 image/tree 测试
- 上一份 P3-06/P3-07 审计结论：现状使用 workspace-relative attachment paths，解析对 bare path 采用 workspace-first、document-relative fallback；该兼容语义在本 remediation 中被移除为 source authority 规则。

## Implementation requirements

1. 定义并集中实现 document-relative source path：路径使用 `/`，以文档所在目录为 base，按 workspace path segment 计算 `.`、`..` 和嵌套目录；不得把 workspace-root-relative path 作为 canonical Markdown source。目标文件仍以 canonical workspace path 交给 binary filesystem。
2. 四种策略必须有一致且可测试的映射：`root-images` 写入 workspace root 的 `images/` 并从当前文档目录计算 source path；`same-dir` 写入文档所在目录并使用显式 `./` source；`file-images` 写入文档所在目录的 `images/` 并使用显式 `./images/` source；`inline` 不写 binary file，保留现有 data URL/data payload 合同。嵌套文档必须覆盖向上 `../` 的 source path。
3. 持久化、解析、preview/resource、复制和 tree reveal 必须使用同一 shared path semantics。解析 document-relative path 时不得 workspace-root-first；不明确、越界、缺失或读取失败必须返回可诊断的 degraded/unavailable projection，不得静默改写或替换 source。合理的既有相对输入（包括显式 `./`、`../`、URL-encoded path 及 data URL）只能按明确且无歧义的 document-relative 规则兼容。
4. `ImageProjectionResource.path` 必须是实际 resolved workspace path；preview、copy image bytes 和 `revealImageInWorkspace` 使用该 path，tree 定位不能重新解释 Markdown source。inline/data resource 保持 data URL/data payload，不伪造 workspace path。
5. 保持 `DocumentStore` 为唯一 Markdown/revision authority；CM6、Live Preview、modal 和 workspace tree 都是 Projection/derived UI。读写/解码/Clipboard 失败只影响 projection 或状态提示，不创建第二份 source，也不引入 timeout/sleep 同步协议。
6. 不修改 entity completion、P2A 验收证据、P3/P4 其他合同、目录操作、ReferenceGraph 或 P5；不引入 `editor-app` runtime import。

## Tests

- Pure unit：根文档和多层嵌套文档下四种策略的 binary destination 与 document-relative source path；`./`、`../`、URL-encoded、查询/fragment、外部/data/绝对/越界输入；不得错误回退到 workspace root；inline data URI byte fidelity。
- Integration：attachment write 后 Markdown 只保存 canonical document-relative path；resolver/read/cache、missing/decode degradation、preview/copy、source fidelity 和实际 workspace path 一致；不同文档目录下同名图片不会被 root-first 误解析。
- Browser：嵌套文档粘贴四种策略，验证 source path、Live Preview 图片加载、modal/copy 不改 source、Locate 选中并展开实际 workspace tree path；覆盖读取失败后的可继续使用状态。
- 执行相关 unit/integration/browser、`npm run typecheck`、`npm run build`、`npm run check:boundaries` 和 `git diff --check`；不增加固定等待掩盖失败。

## Acceptance criteria

- P3-06 四种策略在根文档及嵌套文档产生可解释、可重复、相对于当前文档目录的 Markdown source path；inline 合同和 source fidelity 保持不变。
- P3-07 的解析、预览、复制和 workspace tree 定位均指向同一个 document-relative 解析结果；不存在 workspace-root-first 私有解析路径。
- 缺失、歧义、读取、解码或 Clipboard 失败均可见地降级，原始 Markdown source 与 DocumentStore revision 不被改写。
- 相关 unit/integration/browser、boundary、typecheck、build 和 whitespace 检查通过，且不违反 DocumentStore authority、Projection boundary、no-timeout/no-sleep 和 no-legacy-runtime-import 不变量。

## Out of scope

- entity completion、P2A 验收证据、P3/P4 其他合同、目录 rename/move、ReferenceGraph、P5/table 及后续 Phase 功能。
- 新增或修改 ADR、改变 DocumentStore/revision/Projection 长期架构、系统文件管理器 reveal、真实平台 binary adapter。
- 批量迁移或重写已有 Markdown 图片 source；不通过读取失败自动改写旧文件。
- `editor-app/` 的修改或任何 runtime import。
