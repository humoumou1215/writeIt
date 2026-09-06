# WriteIt CM6 Architecture Spike — 当前验收报告

状态：**GO**。

2026-09-06，项目负责人确认按 GO 推进。第二个及更多真实表格应用的互粘验证，以及更广的大表格性能观察，转为 GO 后的兼容性与优化工作，不再作为架构门槛。

本报告继续如实区分 `PASS`、`PARTIAL` 和 `PENDING`；GO 表示现有证据足以接受 CM6 主架构，不表示所有未来兼容场景都已验证。

## 1. Executive Summary

当前 Spike 已证明：

- 一个 `DocumentStore` 可以作为所有 CM6 View / Embed Projection 的唯一 Markdown authority。
- Table core 可以脱离浏览器测试，并由 CM6 Widget 提供接近电子表格的 cell、二维 selection、clipboard 和局部 Markdown 回写。
- Editable Embed 的多投影同步、revision、undo、close/reopen、循环保护和生命周期已经有运行时证据。

GO 后继续跟踪的非阻断验证：

- 在 WPS 之外继续扩大 Excel、Numbers 等真实应用的互粘覆盖；
- 扩大大表格人工滚动、输入延迟和 CPU 体验样本。

这些结果可以驱动 clipboard adapter、Table Widget 或性能实现的改进；只有证据表明核心架构不变量无法满足时，才需要通过新 ADR 重新评估架构。

## 2. Table Results

| Requirement | Result | Evidence / note |
| --- | --- | --- |
| T01 Click Cell | PASS | 内置浏览器真实键盘输入只改变目标 cell。 |
| T02 Keyboard navigation | PASS | Arrow / Tab；AX 显示焦点从 row 2 col 2 移到 row 2 col 3。 |
| T03 Rectangle selection | PASS | Shift-click 后得到 4 个 `table-selected-cell`。 |
| T04 Copy | PARTIAL | 用户已实测 WPS 复制/粘贴正常；第二个及更多真实表格应用的覆盖保留为 GO 后兼容性工作，不再阻断架构决定。 |
| T05 Paste TSV | PASS | 2×2 TSV 粘贴正确映射。 |
| T06 Multi-cell Paste | PASS | 以 anchor cell 左上角映射，尺寸不一致时自动扩展。 |
| T07 Markdown round trip | PASS | table-core + 浏览器局部回写；换行保持。 |
| T08 Undo / Redo | PASS | DocumentStore history 已覆盖 cell、paste、add/delete row/column 的逆向/正向恢复；浏览器输入 Cmd/Ctrl+Z、Cmd/Ctrl+Shift+Z 也已验证。 |
| T09 Add/Delete Row | PASS | 浏览器 3→4→3 rows，且走 Markdown source。 |
| T10 Add/Delete Column | PASS | 浏览器 3→4→3 columns，alignment row 保留。 |
| T11 Chinese IME | PASS | 用户实测中文输入正常；Cell input 仍保留 composition 事件记录和高亮。 |
| T12 Source switch safety | PASS | Source probe 改表格后重新解析，unknown syntax 原样保留。 |
| T13 Drag selection | PASS / P1 | 已用内置浏览器真实坐标从 row1/col1 拖到 row2/col2，得到 4 个 `table-selected-cell`，未改动 Markdown。 |
| T14 Row/column reorder | PENDING / P1 | 未实现。 |
| T15 Column resize | PENDING / P1 | 未实现。 |
| T16 Large table | PARTIAL | 用户反馈大文件滚动“还算正常”；浏览器确认可见 100×20 与 10,000 行样例可滚动，500×20 离屏挂载约 230ms；大表格 CPU/体感仍未单独确认。 |

## 3. Editable Embed Results

| Requirement | Result | Evidence / note |
| --- | --- | --- |
| E01 Render Projection | PASS | B→A、C→B→A 可读 Projection。 |
| E02 Editable Projection | PASS | B→A 输入改变 `DocumentStore(A)` revision。 |
| E03 Multi Projection Sync | PASS | A tab、B→A、C→B→A 同 revision 实时更新。 |
| E04 Correct Persistence | PASS | Save 后仅 A.md 改变，B/C 引用文本保留。 |
| E05 No Lost Update | PASS | 按规格执行 `B→A`、`A Tab`、`C→B→A` 三次真实键盘输入，最终 A.md 为 `20BAC`，A 主视图与两层嵌套 Projection 均为 rev=4。 |
| E06 Revision | PASS | Debug Panel 显示每个 View 的 document/revision。 |
| E07 Stale | PASS | Force stale 显示 `STALE` 和落后 revision。 |
| E08 Close/Reopen | PASS | 关闭 B 后 C Projection 保持；重开 B 后新的 B→A Projection 工作。 |
| E09 Nested/Circular | PASS | C→B→A；CycleA→CycleB→CycleA 显示 Circular embed，不递归。 |
| E10 Undo Across Projections | PASS | Embed 输入后切 A tab Undo，A source 恢复。 |
| E11 Embed focus | PASS | 嵌入 CM6 content 可直接接收字符。 |
| E12 Shortcut isolation | PASS | store origin guard + storeSync annotation；未观察到 host/child 双执行。 |
| E13 Escape | PASS | 嵌入 A 按 Escape 后 AX focus 回到宿主 B。 |
| E14 Delete reference | PASS | Source probe 与宿主 caret 直接退格都能删除整个 `![[A.md]]` token；A.md 仍存在，相关 Projection 被卸载/重建。 |

## 4. Other Mini-Proofs

- Annotation：`Hello world` 前插入 `Wonderful ` 后 range 映射到原 `world`。
- Mermaid：非编辑态显示 Widget，底层 Markdown 保留。
- Diff：`markdownDiff(oldMarkdown, newMarkdown)` 直接比较 Markdown source，不经过 DOM/HTML。
- Unknown Markdown：`:::unknown-syntax` 保持普通可编辑文本。
- Source fidelity：10 类 golden fixture 打开/保存无编辑时字节不变。

## 5. Architecture Findings

- A.md 的内容位置：`DocumentStore.get('A.md').markdown`。
- B.md 中编辑 A.md：提交到 Document A，不写回 B 的 Embed token。
- Projection 只有 CM6 state / Widget DOM / subscription metadata，没有第二份权威 Markdown。
- 防回环：origin key + `storeSync` transaction annotation。
- Stale：projection revision 与 store revision 分开记录，不能静默落后。
- Lifecycle：100 次 mount/unmount 后 view 数不增长；压力 probe `6 → 6`，fresh browser console errors 为 0。

## 6. Table Design Decisions

1. 采用整个 Markdown Table Widget；未编辑时 source 仍保留，编辑时只序列化该 table region。
2. Cell 编辑使用原生 `<input>`，不是嵌套 ProseMirror/Milkdown；输入事件被隔离，避免宿主 CM6 把 Widget input 当成 source edit。
3. Undo/Redo 属于 DocumentStore 的 source history，不建立第二套永久 Table history。
4. Cell 修改先从当前 source 重新解析 table，再用 row/column 坐标更新，最后局部替换 Markdown region。

## 7. Complexity Comparison（当前 Spike 观察）

| Area | CM6 Spike vs current Milkdown/Crepe | Observation |
| --- | --- | --- |
| Table core | 略简单 | 纯模型和操作可单测；Widget focus/事件隔离需要额外工作。 |
| Editable Embed | 略简单 | authority/revision 直接；嵌套 View 生命周期仍需小心。 |
| Annotation | 明显更简单 | ChangeSet mapping 是直接能力。 |
| Mermaid | 相当 | Widget 与 source toggle 足够完成 mini-proof。 |
| Diff | 明显更简单 | source-to-source，无 rich DOM round-trip。 |
| Diagnostics | 略简单 | Store event timeline 能直接解释状态。 |
| Testing | 明显更简单 | table/document 业务规则脱离 browser；IME/clipboard 仍需 browser。 |

## 8. Final Architecture Decision

最终结论为 **GO**。现有证据已经覆盖 Markdown authority、source fidelity、DocumentStore、多 Projection、revision/stale、editable embed、table-core 边界、局部 Markdown 回写、基础 clipboard/IME 和 lifecycle，足以接受 CM6 作为 v2 主编辑器架构。

项目负责人决定把更多办公软件互粘和更广的大表格性能样本作为 GO 后验证。表中的 `PARTIAL` / `PENDING` 状态继续保留，以免把尚未覆盖的兼容范围误写成通过；后续问题应优先在 clipboard adapter、Table Widget 或性能边界内解决。只有问题证明已接受的 source fidelity、单一 authority 或 projection 不变量无法成立时，才通过新的 ADR 重新评估架构。

## 9. User Acceptance Checklist

局域网验收时在运行 Spike 的 Mac 上执行 `npm run dev`，使用终端日志中 `Network` 开头的地址打开页面；当前已确认可用地址包括 `http://192.168.1.2:5187/` 和 `http://192.168.31.240:5187/`。

打开 `http://127.0.0.1:5187/` 后，建议按以下顺序验收：

1. 在 A.md 的 `Age` cell 中启用 macOS 中文输入法，输入一段中文并确认 composition、候选确认、光标和 source 都正常；再用 Cmd+Z / Cmd+Shift+Z 验证回退与重做。
2. 选中一个 2×2 区域复制到两个真实表格应用，再从这两个应用各复制一段二维数据粘贴回 Spike；检查 TSV、HTML、换行和多行映射。
3. 点击 `Open visible stress fixtures`，分别打开 `visible-10k.md` 与 `visible-table-100x20.md`，观察大文档/大表格的滚动、输入延迟和 CPU；再点击 `Run stress probes` 获取趋势数据。自动探针不能替代这一步的肉眼验收。

验收前页面、文档和 diagnostics 已恢复到 rev=1 的初始基线。当前根据用户反馈，T11 通过、WPS 通过、大文件滚动可接受；后续优先补充更多真实表格应用和更广性能样本，但这些项目不阻断 GO。
