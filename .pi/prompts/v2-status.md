# WriteIt v2 Status Prompt

> **Legacy Pi entrypoint.** 保留用于历史状态核对；Codex Goal 不读取或执行本 prompt。当前 Codex 状态合同见 `writeit-v2/docs/GOAL.md` 与 `writeit-v2/docs/STATUS.md`。

用法：

```text
/v2-status
```

这个 prompt 只用于核对和维护 v2 状态，不用于开始新的实现任务。

---

维护 WriteIt v2 的实施状态。

## 先读取

```text
@AGENTS.md
@writeit-v2/docs/IMPLEMENTATION_SPEC.md
@writeit-v2/docs/STATUS.md
```

必要时读取当前 Task 的 ADR、feature spec、验收产物和测试结果；先运行 `git status --short`，不得覆盖、回滚或清理用户已有工作。

## 状态核对协议

1. 识别 `STATUS.md` 的 `Current phase`、`Current task`、Completed、Active 和 Blocked。
2. 对照 SPEC/当前 Task 的验收条件，检查实现、测试和文档证据是否真实存在；不能只因代码“看起来完成”就标记完成。
3. 如果当前 Task 的验收条件未满足，保留它为 Active，或在 Blocked 中写明具体阻塞原因；不要跳到后续 Task。
4. 只有当前 Task 已通过验收，才将其移入 Completed，并从 SPEC 推荐顺序选择一个下一 Task 作为 Active/Next；这里只更新状态，不执行下一 Task。
5. `Recent decisions` 只记录已接受的架构/范围决定；`Known risks` 只保留当前仍存在的风险；不要把 STATUS 写成逐步开发日志。
6. 如果发现状态与工作树、测试结果或架构约束冲突，优先如实记录冲突并停止扩展，不要通过修改状态掩盖问题。

## 允许的修改

- 允许更新 `writeit-v2/docs/STATUS.md`。
- 如状态核对发现验收证据链接或任务文档缺失，可报告缺口；除非用户另行指定，不在本 prompt 中实现产品代码、清理仓库或修改 legacy。
- 不自动开始或批量执行任何后续 Task。

## 标准格式

```markdown
# WriteIt v2 Status

Current phase: P0
Current task: P0-01

## Completed
- [x] ...

## Active
- [ ] ...

## Blocked
None

## Recent decisions
- ...

## Known risks
- ...

## Next
P0-02
```

完成后汇报：状态变更、核对依据、未解决风险、下一建议 Task ID。不要提交 Git commit。
