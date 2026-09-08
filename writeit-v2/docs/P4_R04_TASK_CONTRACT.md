# P4-R04 — Clipboard fallback freshness protocol

## Goal

修复 P4-07 的应用内 reference clipboard fallback freshness：WriteIt 内部复制 reference 后，即使浏览器不支持 custom MIME 或系统 clipboard 读取失败，只有当前 paste event 能证明仍对应最近一次 WriteIt internal reference copy 时，才允许使用 fallback；用户在外部应用复制普通文本后回 WriteIt 粘贴，必须让普通文本进入正常 CM6 paste，不得误用 stale internal reference。

## Allowed scope

- `writeit-v2` 中 P4-07 reference clipboard fallback 的 core/application/platform/CM6 adapter contract 与实现。
- 真实系统 file URI、WriteIt custom MIME、fallback plain-text fingerprint/token 的识别、绑定、失效和安全降级。
- 与上述 freshness protocol 直接相关的 unit、integration、browser regression 测试。
- 本任务合同和 `writeit-v2/docs/STATUS.md` 的简洁状态更新。

## Read first

- 根 `AGENTS.md`。
- `writeit-v2/docs/IMPLEMENTATION_SPEC.md`、`writeit-v2/docs/STATUS.md`。
- P4-07/P4-08 已实现代码和测试，以及相关评审结论，尤其是 fallback stale internal reference 可能拦截外部普通文本的风险。
- `writeit-v2/src/core/reference/clipboard.ts`。
- `writeit-v2/src/application/reference/clipboard.ts`。
- `writeit-v2/src/platform/clipboard/browser.ts`。
- `writeit-v2/src/editor/cm6/extensions/reference-clipboard.ts`。
- 现有 P4-07/P4-08 的 unit、integration、browser clipboard/context-action 测试。

## Implementation requirements

1. 只有当前 paste event 能证明仍对应最近一次 WriteIt internal reference copy 时，才允许使用 internal fallback；不能因为内存中存在上一次 copy 就直接拦截 paste。
2. 优先识别并使用真实系统 reference/file URI 与 WriteIt custom MIME payload。有效 custom MIME 或 file URI 必须继续保留现有 link、editable embed、readonly embed、多文件/目录语义和顺序。
3. 普通 `text/plain`、无法识别的外部文本、空/模糊 payload 必须交给正常 CM6 paste，不得被 reference fallback 拦截。普通文本不应改变 Markdown、revision 或 fallback 状态以外的 reference clipboard 语义。
4. 在浏览器不支持 custom MIME 时，以明确、可比较的 plain-text fingerprint/token 将 internal fallback 与 copy payload 绑定。外部应用复制不同文本后，fallback 必须失效；协议不得依赖外部应用一定回传 copy event。
5. fallback 过期、系统 clipboard 权限不足、读取失败、token/fingerprint 不匹配或 payload 不足以证明来源时，安全降级到普通 paste；不得阻止正常文本粘贴，不得静默生成 reference。
6. 不改变 DocumentStore mutation capability、Markdown source fidelity、revision/history、editable projection/readonly projection 边界；所有被识别的 reference paste 仍只能通过既有 projection mutation capability 提交。
7. 不引入 timeout/sleep 作为同步协议，不 runtime import `editor-app`，不修改 conditional writes、dirty delete、目录 migration、embed retry、图片 compensation 或 P5，也不改变既有 ADR 核心不变量。

## Tests

- Unit：custom MIME/file URI 优先级；普通 text/plain 与未知/空/模糊 payload fall-through；internal copy payload 的 fingerprint/token 绑定、匹配、外部不同文本后的失效、无 copy event 时的安全行为、权限/读取失败降级。
- Integration：CM6 paste adapter 只在 fresh internal reference 证据存在时拦截；ordinary text paste 走正常 CM6 mutation；reference link/editable embed/readonly embed、多文件和目录语义、DocumentStore revision/source fidelity 不回归。
- Browser regression：WriteIt copy → 模拟外部普通文本改变 clipboard 内容 → paste，普通文本必须胜出；WriteIt internal reference fallback 仍可工作；真实/模拟 file URI、custom MIME、过期 payload、空 payload、权限不足/不可读 payload 均安全降级或按既有 reference 语义工作。
- 运行相关 unit/integration/browser 测试、`npm run typecheck`、`npm run build`、`npm run check:boundaries` 和 `git diff --check`；不得通过增加固定等待掩盖失败。

## Acceptance criteria

- 外部普通文本复制后回 WriteIt 粘贴绝不会误用 stale internal fallback reference，普通文本由正常 CM6 paste 处理。
- 没有 custom MIME 的浏览器中，最近一次 WriteIt internal reference copy 在 plain-text fingerprint/token 仍匹配时可正常 fallback；不同外部文本、空 payload、过期或模糊 payload 均不触发 fallback。
- 有效 file URI/custom MIME 仍优先并保留 P4-07 既有 link、editable embed、readonly embed、多文件/目录语义和顺序。
- fallback 失效、权限不足或读取失败不改变 Markdown、revision/history，不阻止普通文本粘贴；reference mutation 仍经 DocumentStore/Projection capability。
- 相关 unit/integration/browser、typecheck、build、boundary 和 whitespace 检查通过，且不违反既有 ADR、source-fidelity、no-timeout、no-legacy-runtime-import 不变量。

## Out of scope

- conditional writes、dirty-aware delete、目录 migration/rename path rebinding、embed retry、图片 compensation、P5/table 及 P5 以后功能。
- P4-08 reference context actions 的新功能或行为重设计；仅可保持其共享 clipboard 基础 contract 的兼容性。
- 新的系统 clipboard/native Tauri adapter、跨平台 clipboard 兼容矩阵或超出本 fallback freshness 问题的 UI 改造。
- 改变 accepted ADR、DocumentStore authority/revision 模型、Markdown 持久化合同、Projection ownership，或任何 `editor-app/` 修改/runtime import。
