# WriteIt — Agent Instructions

## 项目主线

当前正式开发主线是：

`writeit-v2/`

它是基于 **Markdown-first + CodeMirror 6** 的新一代 WriteIt。

`editor-app/` 是旧版实现，只作为：

- 行为和需求参考
- fixture、测试案例和边界案例参考
- 已解决问题参考

除用户明确要求修复旧版外，不再向 `editor-app/` 增加 v2 架构或新功能。

## 开始任务前

处理 v2 任务时先读：

1. `writeit-v2/docs/IMPLEMENTATION_SPEC.md`
2. `writeit-v2/docs/STATUS.md`
3. 当前任务涉及的 ADR 或 feature spec
4. `writeit-v2/docs/LEGACY_FEATURE_MAP.md` 中对应旧实现位置（如已建立且确有需要）

不要为了了解项目而无目的遍历整个 `editor-app/`。

## 核心架构不变量

以下规则不得通过局部实现绕过：

1. Markdown 是长期数据合同。
2. `DocumentStore` 是运行时 Document 内容权威。
3. 同一 Document 只有一份权威 Markdown 和 revision。
4. CM6 EditorView、Embed、Diff View 等都是 Projection，不拥有第二份权威内容。
5. 不认识的 Markdown 可以降级为普通文本，但打开或保存不能丢失。
6. Rich Preview 失败只能降级显示，不能损坏 Markdown。
7. Git Diff 的保证层直接比较 Markdown source；语义渲染只能增强，不能吞掉变化。
8. `writeit-v2/` 禁止 runtime import `editor-app/`。
9. Core/domain 代码禁止依赖 Vue、DOM、CodeMirror、Tauri。
10. 不用 timeout/sleep 作为状态同步协议。

如果实现需要违反上述规则，停止实现并升级为架构决策。

## 新旧代码边界

- `writeit-v2/`：当前开发主线，可正常修改。
- `editor-app/`：Legacy reference，只读研究；若明确要求修改，先读 `editor-app/AGENTS.md`。
- `raw/`：只读，绝不写、改名或删除。
- `wiki/`：仅知识库任务时处理。
- `.pi/`：项目级工具、skills、prompts；现有 debug 工具默认服务 legacy，不要假定其协议适用于 v2。

从旧代码提取行为、fixture 或小型纯逻辑算法时，必须在 v2 中重新归属并测试；禁止通过跨目录 import 形成运行时依赖。必要时在 `LEGACY_FEATURE_MAP.md` 记录来源和处理方式。

## 工作方式

- 与用户使用中文交流。
- 一次只执行 SPEC 中一个明确 Task ID，除非用户明确要求批量执行。
- 修改前检查相关实现、测试和当前 `git status`。
- 不覆盖或回滚用户已有未提交修改。
- 不因顺手而扩展任务范围。
- 架构决策通过 ADR 记录，不藏在实现代码里。
- 发现旧版行为与 SPEC 冲突时，以 v2 SPEC / ADR 为准，并记录差异。

完成任务时报告：修改内容、原因、验证命令和结果、尚存风险、下一建议 Task ID。除非用户明确要求，不自动提交 Git commit。

## 测试与验证

v2 测试优先级：

1. pure unit tests
2. integration tests
3. browser integration
4. 少量关键 E2E

Document、revision、reference graph、table core、diff guarantee、validation 等规则尽量脱离浏览器测试。真实浏览器只验证 IME、clipboard、focus、DOM/widget lifecycle、浏览器快捷键和关键用户旅程。不得用增加固定等待时间掩盖测试失败。

修改 `writeit-v2/` 后，至少执行与任务相关的：

```bash
cd writeit-v2
npm run test
npm run typecheck
npm run build
```

不要因为修改 `writeit-v2/` 而默认运行旧 `editor-app/` 的完整 E2E；仅运行与当前任务相关的验证。

## 任务执行纪律

```text
Read → Inspect → Implement → Test → Update STATUS → Report
```

发现设计缺口时：小型实现选择可以自行选择并记录；会改变 ADR 的选择必须停止并提出决策；Legacy 行为不清晰时查 feature map 和旧测试。不要自动开始下一个 Task。
