# WriteIt v2 Task Prompt

> **Legacy Pi entrypoint.** 保留用于复现历史单 Task 工作流；Codex Goal 不读取或执行本 prompt。当前 Codex 入口以根 `AGENTS.md`、`writeit-v2/docs/GOAL.md` 与 `writeit-v2/docs/DECISIONS.md` 为准。

用法：

```text
/v2-task P0-03
```

以下模板中的 `$1` 是用户指定的 Task ID。每次调用只执行一个 Task ID。

---

执行 WriteIt v2 任务 `$1`。

## 先读取

```text
@AGENTS.md
@writeit-v2/docs/IMPLEMENTATION_SPEC.md
@writeit-v2/docs/STATUS.md
```

如果当前任务已有 ADR、feature spec 或 `LEGACY_FEATURE_MAP.md` 对应条目，再读取必要的相关文件；不要为了了解项目而无目的遍历 `editor-app/`。

## Task ID 规则

1. `$1` 必须是 SPEC、ADR 或当前 feature spec 中定义的明确 Task ID，例如 `P0-03`、`P1-02`。
2. 如果没有提供 `$1`，只能使用 `STATUS.md` 的 `Current task`；不能自行猜测或跳到后续任务。
3. 以用户明确提供的 Task ID 为目标，同时检查它与 `STATUS.md` 的关系；如果状态冲突、任务不存在、任务已阻塞或验收条件不清楚，先报告并停止，不要静默换任务。
4. 不自动开始下一个 Task。完成当前任务后只记录下一建议 Task ID。

## 执行协议

1. 先运行 `git status --short`，记录并保护已有未提交修改；禁止 reset、checkout、覆盖或回滚用户工作。
2. 从任务定义提取 Goal、Allowed scope、Implementation requirements、Tests、Acceptance criteria 和 Out of scope。
3. 只修改当前 Task 允许的路径。`writeit-v2/` 禁止 runtime import `editor-app/`；Core/domain 禁止依赖 Vue、DOM、CodeMirror 或 Tauri。
4. 如需参考 legacy，先依据 `LEGACY_FEATURE_MAP.md` 定位，再读取最小必要范围；旧代码只能作为行为、fixture、测试和纯算法参考。
5. 按 `Read → Inspect → Implement → Test` 执行。验证优先使用 pure unit、integration，再使用 browser/E2E；不得用 timeout/sleep 掩盖状态同步问题。
6. 如果实现会改变已有 ADR、数据所有权或依赖方向，停止并提出架构决策，不要把决策藏在局部代码中。
7. 只有在验收条件和相关验证完成后，才更新 `writeit-v2/docs/STATUS.md`：标记当前任务、填写 Active/Blocked、保留 Recent decisions 和 Known risks，并写出下一建议 Task ID。STATUS 是短状态文档，不是开发日志。
8. 当前 Task 成功验收后，先执行 `git diff --check`，再严格只暂存当前 Task 允许的文件/变更；检查 `git diff --cached --name-status` 和 `git diff --cached`，确认没有混入既有用户修改或其他 Task。若共享文件无法安全按 hunk 精确拆分，停止提交并报告。确认无误后自动创建一个独立的本地 commit，commit message 明确包含当前 Task；默认不 push，只有用户明确要求时才 push。不得用 commit 覆盖、回滚或隐式包含其他修改。
9. 最终汇报必须包含：修改文件及原因、验证命令和结果、commit hash、尚存风险、下一建议 Task ID。

## 硬性边界

- Markdown 是长期数据合同。
- `DocumentStore` 是运行时 Document 内容权威。
- CM6 EditorView、Embed、Diff View 等都是 Projection，不是第二份内容权威。
- 不认识的 Markdown、Preview 失败或语义 Diff 失败都不能损坏或吞掉原始 Markdown 变化。
- 不要自动执行下一个 Task。
