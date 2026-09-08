# WriteIt v2 — PHASE_GATE_CHECKLIST

**用途：每个 Phase 做完以后，决定“能不能进入下一阶段”。**

这不是代码风格检查表，也不是“所有测试都绿了就 PASS”。

一个 Phase 最终只能给出三种结果：

- **PASS**：可以进入下一阶段。
- **PASS WITH FOLLOW-UP**：可以进入下一阶段，但有明确、非阻断的后续质量项。
- **CHANGES REQUIRED / HOLD**：先修复，再继续。

> 简单规则：如果问题可能造成数据丢失、保存错文件、看不到真实 Diff、错误归因 Git 作者、编辑器出现第二份 Markdown 数据，通常不能算非阻断问题。

---

## 1. 开始 Gate 前

- [ ] STATUS 与实际代码阶段一致。
- [ ] 本 Phase 所有 Task 有明确完成记录。
- [ ] 本 Phase 涉及 UI 时，对应 `UX_SPEC.md` 已经写清主要操作。
- [ ] 本 Phase 若改变 Accepted ADR，已经建立新 ADR 或明确 decision；没有偷偷绕过旧 ADR。
- [ ] Feature Map 中相关能力没有继续保持模糊 umbrella 状态。

---

## 2. 数据安全

### Markdown

- [ ] Markdown 仍是长期保存格式。
- [ ] 没有因为 UI/Widget 引入第二份保存数据。
- [ ] `open → no edit → save` 不产生无意义全文改写。
- [ ] 修改一个小区域不会重写无关正文。

### DocumentStore

- [ ] 所有正文修改最终经过 DocumentStore / 既定 application mutation 路径。
- [ ] 同一文档多视图不会各自保存一份 Markdown。
- [ ] revision / dirty / persistedRevision 语义仍成立。
- [ ] undo/redo 没有被新功能绕过。

---

## 3. 文件与持久化

只要本 Phase 触碰文件、rename、delete、save、attachment、replace、Git destructive action，就检查：

- [ ] 成功时内存、文件系统、UI 都承认同一个结果。
- [ ] 失败时不会只完成一半却显示成功。
- [ ] dirty 文件有明确保护。
- [ ] external file change（外部程序修改文件）不会被静默覆盖。
- [ ] rename/move 后已打开文档仍保存到正确路径。
- [ ] delete 后不会留下会继续 autosave 的 ghost document。
- [ ] 多文件操作有 partial failure（部分失败）反馈。
- [ ] 能补偿的跨资源失败有 rollback；不能补偿的有明确 orphan/cleanup 策略。

---

## 4. 编辑器行为

只要本 Phase 触碰 CM6 / Live Preview / Widget：

- [ ] Raw Source 和 Live Preview 使用同一份 Markdown。
- [ ] 切换模式不新增 Document revision。
- [ ] 切换模式后 undo history 不断裂。
- [ ] selection/focus 没有明显不可接受跳动。
- [ ] Store 外部更新能正确同步到当前 view。
- [ ] multi-view 同步没有循环写入。
- [ ] renderer/widget 失败时 source 仍可看、可编辑。
- [ ] close/detach 后异步 callback 不会复活旧 view。

---

## 5. 键盘、中文输入、复制粘贴

- [ ] Enter / Escape / Tab 的行为与 UX_SPEC 一致。
- [ ] IME 中文组合输入期间不会误执行命令。
- [ ] copy/paste 不会吞普通文字。
- [ ] clipboard fallback 不会用过期的应用内数据覆盖当前系统剪贴板。
- [ ] keyboard 与 mouse 触发同一功能时不会走两套互相冲突的业务逻辑。
- [ ] completion popup 只因真实输入 trigger 触发，光标移动到旧 `@` / `[[...]]` 不误弹。
- [ ] completion 在 Raw Source / Live Preview 的支持范围与 UX_SPEC 一致。
- [ ] 分层文件候选的 Left/Right 返回/进入保持真实浏览历史。

---

## 6. 错误与恢复

每个主要异步/外部依赖至少考虑：

```text
首次成功
首次失败
失败后重试成功
处理中关闭/切换
旧结果晚到
资源消失后重新出现
```

检查：

- [ ] 错误不会只打 console。
- [ ] 用户知道数据是否仍安全。
- [ ] retry 不会因为旧 `inFlight/missing` 标记永远失效。
- [ ] 旧异步结果不会覆盖更新后的状态。
- [ ] recovery 成功后 UI/diagnostics 能恢复正常状态。

---

## 7. UI / UX

- [ ] 主要入口与 `UX_SPEC.md` 一致。
- [ ] 常用操作容易找到。
- [ ] 低频操作没有长期挤满页面。
- [ ] 危险操作有确认/清楚后果。
- [ ] 空状态有解释。
- [ ] 错误状态有下一步操作。
- [ ] 窄窗口/侧栏打开时仍能完成核心编辑。
- [ ] 没有因为新增功能把正文区域永久压缩得明显不可用。
- [ ] Live Preview 样式没有和其他 Markdown 元素明显割裂。
- [ ] 当前文件在 File Tree / Git 等相关列表中的状态提示一致。
- [ ] Search/Git/Outline 等面板切换不会销毁当前编辑器状态。
- [ ] 如果支持分屏，同一 Document 在不同 pane 中没有产生第二份正文数据。

若本 Phase 有关键 UI：

- [ ] 浏览器交互测试覆盖主要状态。
- [ ] 必要时更新少量 screenshot baseline。

---

## 8. Reference / Derived Data（如适用）

- [ ] ReferenceGraph / Search index / Outline / Backlink / Validation 等只是派生结果。
- [ ] 索引过期时不会被当成 Markdown 保存真相。
- [ ] rename/delete/Document change 后能失效/重建。
- [ ] broken/unknown 有明确状态，不伪装成功。
- [ ] 重复 Reference occurrence 没有因为目标相同而丢失各自 source 位置。
- [ ] Backlinks 若提供 occurrence 入口，能分别跳到同一文件中的第 1/第 2/... 次引用。
- [ ] Outline/字数等若采用“组合内容”，nested/repeated/circular Embed 的计算与 UX_SPEC 一致且不会写回 root Markdown。

---

## 9. Table（如适用）

- [ ] 单击 cell 是“选中无光标”，直接输入覆盖原内容。
- [ ] 双击 cell 是“文字编辑有光标”，可以正常追加/删除。
- [ ] 选中状态 Enter 移到下一行；编辑状态 Enter 插入 cell 内换行。
- [ ] cell 内换行在 Markdown source 中有明确、可读、可 Diff 的表示，不靠 DOM 私有状态。
- [ ] 多行 cell copy/paste 不会错误拆成多行多列。
- [ ] row/column reorder 走 Table Core + DocumentStore，可 undo/redo。
- [ ] column resize 不为了视觉宽度重写 Markdown。
- [ ] 大表格在 resize/reorder/横向查看时仍可操作。

## 10. Git / Diff（如适用）

- [ ] 每一个 raw change 都有 source-level 表示。
- [ ] rich renderer 失败不会吞变化。
- [ ] Mermaid rich diff 若声称支持语义对比，added/removed 的红绿含义稳定；无法可靠匹配时会降级，不猜节点身份。
- [ ] discard/revert 有确认和失败处理。
- [ ] local/uncommitted line 不会被错误归因给旧 commit。
- [ ] blame/file history 数据来自 Git，不修改 Document。

---

## 11. 测试层级

不是每项都要 E2E，但要把测试放在正确层级：

- [ ] 纯算法主要有 unit test。
- [ ] 多模块数据流有 integration test。
- [ ] focus/selection/IME/clipboard/widget/lifecycle 有真实 browser test。
- [ ] 关键完整旅程才使用 E2E。
- [ ] 失败和恢复路径不是只有 happy path。
- [ ] regression（已发现的真实 bug）有对应回归测试。

---

## 12. Boundary Check（架构边界）

- [ ] Core 没有依赖 Vue、DOM、CM6、Tauri。
- [ ] v2 没有 runtime import legacy `editor-app`。
- [ ] UI 没有直接绕过 application policy 做危险文件操作。
- [ ] Tauri/platform 细节没有泄漏到 Document Core。
- [ ] 新模块没有为了方便建立全局共享 mutable state（全局可随意修改状态）。

---

## 13. 性能基本检查

只检查是否出现明显架构性问题，不要求每个 Phase 做极限优化：

- [ ] 光标移动不会触发昂贵全量工作（例如完整 Git blame）。
- [ ] 大量 derived data 有合理 cache/invalidation。
- [ ] Widget/preview 不因为不可见也无限重复渲染。
- [ ] Mermaid 实时渲染有防抖/取消旧结果机制，快速输入不会被旧图覆盖。
- [ ] Outline 自动跟随不会在用户手动滚动 Outline 时持续抢回位置。
- [ ] timeline/history/cache 有上限或清理策略。

---

## 14. 文档收尾

- [ ] STATUS 只记录当前事实，不写成长日志。
- [ ] 已完成 Task 和下一 Task 正确。
- [ ] Known risks 删除已经修复的旧风险。
- [ ] 新的非阻断风险写清楚“为什么可以继续”。
- [ ] `LEGACY_FEATURE_MAP.md` 对本 Phase 能力同步。
- [ ] UX 发生确认性改变时更新 `UX_SPEC.md`。

---

## 15. Gate 报告模板

```markdown
# PX Architecture & Product Gate

Result: PASS | PASS WITH FOLLOW-UP | CHANGES REQUIRED / HOLD

## Summary
一句话说明是否能进入下一阶段。

## Blockers
- P0/P1/P2... findings

## Non-blocking follow-ups
- ...

## Verified
- 数据 authority
- persistence
- source fidelity
- browser interaction
- UX contract
- feature map

## Tests run
- ...

## Remaining risks
- ...

## Next
PX+1-00 / remediation task
```

---

## 16. 严重程度的简单解释

为了让非开发者也能判断：

- **P0**：极严重，例如大范围不可恢复数据损坏、安全事故。通常立刻停止。
- **P1**：高严重度，例如特定真实操作会丢数据、覆盖错误文件、错误执行危险操作。通常阻断下一 Phase。
- **P2**：中等，例如功能明显错误、恢复路径有问题，但一般有 workaround（替代办法）且不会轻易造成不可恢复数据丢失。根据范围决定是否阻断。
- **P3**：低严重度，例如诊断不足、API 容易误用、小体验问题；可以跟进但通常不单独阻断。

严重程度不是按“代码行数”判断，而是按用户后果判断。
