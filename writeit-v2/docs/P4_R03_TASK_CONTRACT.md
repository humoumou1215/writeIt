# P4-R03 — Entity completion across reference modes

## Goal

使 P4-04 的 file-self、object、heading 二级候选在 `link`、editable `embed`、`readonly embed` 三种 reference mode 中通过同一 provider contract 可用，同时保持触发归一化、Markdown authority、DocumentStore revision/history 和 CM6 Projection 边界不变。

## Allowed scope

- `writeit-v2` 的 P4-04 entity completion provider/application contract。
- entity completion 的 CM6 adapter 生命周期、导航、过滤、mode UI 和 apply bridge。
- 与上述行为直接相关的 unit、integration、browser 测试。
- 本任务合同和 `STATUS.md` 的完成状态记录。

## Read first

- 根 `AGENTS.md`。
- `writeit-v2/docs/IMPLEMENTATION_SPEC.md`、`writeit-v2/docs/STATUS.md`。
- P2A completion/reference mode contract 与评审证据：`writeit-v2/docs/P2A_ACCEPTANCE_REVIEW.md`。
- `src/application/assistance/reference-completion.ts`、`suggestion.ts`、`completion.ts`。
- `src/editor/cm6/extensions/completion.ts`。
- 现有 entity/reference completion 的 unit、integration、browser 测试。

## Implementation requirements

1. 对 ASCII 与全宽 `@`、`[[`、`![[` 触发保持现有归一化、初始 mode 和 query；三种 mode 均可进入 entity 子候选。
2. file-self、object、heading 候选的发现、排序、过滤、候选类型和精确 Markdown apply 继续由 provider/application contract 决定；通用 CM6 adapter 不硬编码 workspace、实体或 reference 业务。
3. 选择文件进入二级候选、mode 切换、二级导航、返回、过滤和候选浏览，在最终叶节点选择前不得改变 Markdown、DocumentStore revision、history 或 caret；异步结果必须校验当前 trigger/source/revision/lifecycle。
4. 叶节点必须按当前 provider mode 输出精确语义：link 为 `[[path[#fragment]]]`，editable embed 为 `![[path[#fragment]]]`，readonly embed 为 `![[path[#fragment]|ro]]`；file-self、object、heading 均适用同一规则。
5. 无对象时继续使用 heading fallback；provider/content read 失败只能安全降级为普通 file apply 或诊断，不能损坏 source。异步 provider、Projection lifecycle 和 IME composition 安全不得回退。
6. 不改变既有 ADR、Markdown/DocumentStore authority、Projection 边界；不引入 `timeout`/`sleep` 状态同步协议，不 runtime import `editor-app`，不处理图片路径、P2A evidence、目录操作、ReferenceGraph、P5 或其他合同。

## Tests

- provider unit：三种 trigger、三种 mode 下的 file-self/object/heading 候选、精确 apply、静态/动态 object、heading fallback 和失败降级。
- CM6 integration：三种 mode 的二级进入、mode 切换、二级导航/返回/过滤、source/revision/history/caret 不变，以及叶节点 apply。
- Chromium：`@`、`[[`、`![[` 与全宽触发的真实 popup 旅程、三种 mode、IME/lifecycle/async race 和 source fidelity。
- 运行相关 unit/integration/browser、typecheck、build，以及 architecture boundary 检查。

## Acceptance criteria

- `@`、`[[`、`![[` 及对应全宽触发均保留既有初始 mode/query，并能在三种 mode 进入 file-self/object/heading 二级候选。
- 在最终叶节点选择前，mode、导航、返回和过滤不产生 Markdown、revision、history 或 caret 变化；异步迟到结果、readonly/destroyed Projection 和 IME 不会写入 Store。
- 三种 mode 对 file-self、object、heading 都产生精确的 link/embed/readonly-embed Markdown；无对象时 heading fallback 仍可用。
- provider/application contract 保持业务归属，CM6 adapter 只负责 surface/lifecycle/apply bridge；所有相关验证通过。

## Out of scope

- 图片路径或 attachment、P2A evidence/remediation、目录操作、ReferenceGraph、P5/table、P6 及后续 Phase。
- P4-04 之外的 reference graph、navigation/health、rename、clipboard、context action 或 embed projection 合同。
- 修改 ADR、引入新的 Markdown authority，或 runtime import `editor-app`。
