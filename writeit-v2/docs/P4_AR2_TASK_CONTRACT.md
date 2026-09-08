# P4-AR2 — P0–P4 Architecture & Product Boundary Re-review

## Goal

只对 P0–P4 的架构不变量、产品边界和已批准 remediation 做一次综合 gate 评审。确认 Markdown/DocumentStore/Projection/Core/source-fidelity/no-timeout 协议仍成立，逐项复核 P2-AR-06、P4-R01、P4-R02、P3-R01、P4-R03、P3-R02、P3-R03、P4-R04、P4-R05，并决定是否允许进入 P5。

这是评审 Task，不是产品开发 Task。评审发现的返工只记录为 blocker、test gap、deferred risk 或用户决策点；本 Task 不实现返工，也不开始 P5。

## Allowed scope

- 仅读取 v2 源码、测试、ADR、SPEC、STATUS、Task Contracts、README、`LEGACY_FEATURE_MAP.md`、Spike 和既有评审结论。
- 执行完整 v2 gate 和必要的只读代码/AST/静态检查。
- 新增本合同和 `P4_ARCHITECTURE_REVIEW.md`；必要时更新 `STATUS.md`、`README.md` 以消除 gate/状态漂移。
- 评审产生的文档可以记录已解决项、证据、仍需返工项、可接受 deferred 风险和用户验收/决策点。

不得修改产品源代码、测试代码、`editor-app/`、`raw/`、accepted ADR，或通过局部实现改变已批准的目录 rename/move 策略。不得实现 transactional directory path migration，不得开始 P5，不得用 timeout/sleep 掩盖测试失败。

## Read first

- 根 `AGENTS.md`
- `writeit-v2/docs/IMPLEMENTATION_SPEC.md`
- `writeit-v2/docs/STATUS.md`
- `writeit-v2/docs/P2_ARCHITECTURE_REVIEW.md`
- `writeit-v2/docs/P2A_ACCEPTANCE_REVIEW.md`
- 所有当前 P3/P4 remediation Task Contracts
- 根 `LEGACY_FEATURE_MAP.md`
- ADR-0001 至 ADR-0006 及 `experiments/cm6-spike/SPIKE-REPORT.md`
- P1/P2 architecture review、P2A acceptance review 及其他既有外部评审结论
- 开始前的 `git status`

## Review requirements

1. 重新验证 Markdown persistent contract、DocumentStore runtime authority、Projection-only boundary、Core layer boundary、source fidelity、revision/stale/degraded 语义和 no-timeout/no-sleep 状态协议；特别确认 P2-AR-06 fan-out selection mapping、typing grouping、history byte budget 的实际证据及残余 fallback 风险。
2. 验证目录操作当前的 fail-closed policy：影响已打开 descendant Document 或 recovery path binding 时在 filesystem mutation 前阻止；不得把该策略伪称为完整 directory path migration。完整 migration、incoming-reference rewrite、path rebind/rollback 必须明确列为 deferred 风险或决策点。
3. 复核 dirty recursive delete、conditional write/CAS、clipboard freshness、embed missing/retry/detach/late-result lifecycle，检查 data loss、autosave resurrection、ghost state、external overwrite 和 late-result mutation 风险。
4. 对照 P3/P4 Task Contracts、STATUS、README、Feature Map 和旧 Known Risk，指出过时或过宽的成功声明；不删除真实风险，不把历史 PASS 改写为当前未执行的证据。
5. 单独检查 image attachment compensation/orphan/collision strategy、Embed production acceptance、P2A user acceptance evidence，并分别标为 blocker、test/evidence gap、deferred risk 或用户验收点。
6. Gate 必须明确为 `PASS` 或 `CHANGES REQUIRED / HOLD`。只有证据充分且无 P5 blocker 时，STATUS 才能指向 P5-01；否则必须保持 HOLD。

## Tests and verification

```bash
cd writeit-v2
npm run test
npm run test:browser
npm run typecheck
npm run build
npm run check:boundaries
git diff --check
```

允许额外执行只读的 `git grep`、AST、依赖边界、timer/protocol 和测试覆盖检查。不得添加固定等待、sleep 或临时产品/测试文件来改变 gate 结果。

## Acceptance criteria

- `P4_ARCHITECTURE_REVIEW.md` 记录 baseline、git 状态、所有 gate 命令结果、逐项 remediation 结论、证据链接、严重性分类、用户决策点和最终 gate。
- 评审结果不掩盖目录 migration、attachment compensation、Embed production 或 P2A evidence 的未完成状态。
- 若为 HOLD，`STATUS.md` 明确 P5-01 未授权且不再把它写成 Next；README 与 STATUS 不再互相矛盾。
- 若修改文档/STATUS/合同，最终只创建一个独立 commit，且只暂存本评审产生的文档；默认不 push。
- 不修改任何产品源代码、测试代码或 legacy，不改变 accepted ADR 和既定目录安全策略。

## Out of scope

- 任意产品实现、测试实现、P5 Table Engine、P5 task contract、Transactional directory migration、真实 Tauri/native adapter、Feature Parity 新功能实现。
- 修改 P2A/P3/P4 历史实现以使 gate 通过。
- 重写 ADR、迁移 `editor-app/`、修改 `raw/`、Git reset/checkout/clean/force push/amend/rebase。
- 自动开始下一 Task；后续返工必须由用户批准并单独执行。
