# 测试体系

> 套件位置：`editor-app/tests/e2e/`（Playwright 驱动真实 Chromium）。里程碑对应：M1 引用 → M2 菜单 → M3 文件树 → M4 模板 → M5 校验 → M6 批注。

## 1. 运行

```bash
# 终端 1：启动 dev server
cd editor-app && npm run dev          # http://localhost:5173

# 终端 2：全量回归
npm run test:e2e                       # run-all.js 汇总，app-e2e 最后跑

# 或单个套件
node tests/e2e/m6c-e2e.js
```

- 依赖：`playwright`（devDependency）；首次 `npx playwright install chromium`。
- 每个套件末尾输出「结果: X 通过 / Y 失败」。
- **注意**：`app-e2e` 会清空 `demo-shots/`，所以最后跑。
- 每轮回归后 `npm run build` 验证构建。

## 2. 套件清单（22 个，按 run-all.js 顺序）

| 套件 | 里程碑 | 断言 | 覆盖 |
|---|---|---|---|
| `ref-e2e` | M1 | 15 | 引用语法/节点/两段式 resolve/路径补全 |
| `menu-e2e` | M2 | 26 | @/[[/![[ 触发 + 三级递进菜单 |
| `m3-e2e` | M3 | 9 | 跳转/断链/重命名/只读守卫 |
| `m4-e2e` | M4 | 13 | 模板机制/suggest 实体 |
| `m4b-e2e` | M4 | 9 | 实体级/标题实体/样例 |
| `m4c-e2e` | M4 | 6 | 完整路径/对象跳转/平滑滚动 |
| `m5-e2e` | M5 | 9 | 校验三通道（抽屉）/报告 |
| `m5-strict` | M5 | 3 | strict 门禁（确认框） |
| `m6-e2e` | M6 | 6 | 批注 round-trip/锚点激活 |
| `m6-toolbar` | M6 | 9 | Toolbar 添加批注/Ctrl+R/Ctrl+Enter/ESC |
| `m6c-e2e` | M6 | 22 | 抽屉/评论线程/权限/折叠/连线/拖拽 |
| `m6d-e2e` | M6 | 10 | 嵌入块批注写回 round-trip（双重转义回归） |
| `source-e2e` | M7 | 26 | 源码查看模式（Ctrl+E 切换/同步/保存） |
| `drag-e2e` | M7 | 31 | 文件树拖拽移动 + 瞄准定位 |
| `m7-apidoc-e2e` | M7 | 8 | 接口文档：动态对象 objectsFor + findCodeBlocks |
| `xxljob-e2e` | M7 | 8 | xxljob：一文件一任务校验 + 属性对象引用 |
| `m8-db-e2e` | M8 | 10 | 数据库：字段对象 objectsFor + 表清单↔字段表一致性 |
| `m9-placeholder-e2e` | M9 | 8 | 占位符 {{}} decoration 渲染（代码块内保留字面） |
| `mermaid-zoom-e2e` | M9 | 16 | Mermaid 预览放大查看（悬停放大镜 + Lightbox + ESC） |
| `mermaid-ref-e2e` | M9 | 26 | Mermaid 代码块 @ 联想 + 文本级引用跳转 |
| `export-e2e` | M10 | 18 | 导出：默认 PDF/DOCX/MD + 设置导出页签 + export.ts 自定义 |
| `app-e2e` | 综合 | 28 | 全应用（清空 demo-shots/，最后跑） |

> 历史一次性调试脚本归档在 `tests/scratch/`（不维护，仅供查证）。

## 3. 调试钩子（window 上，浏览器控制台可用）

| 钩子 | 作用 |
|---|---|
| `__editorDebug()` | 活动编辑器实例（schema/doc 内省） |
| `__editorGetMarkdown()` | 当前标签 md（源码模式返回 textarea 最新内容） |
| `__editorGoEnd()` | 光标移到文档末尾可输入处（末尾嵌入块自动补空段） |
| `__editorSetRefPath(old, new)` | 批量替换引用节点路径 |
| `__editorOpenPath(p)` | 打开文件 |
| `__editorBlockAppend(pathSubstr, text)` / `__editorGoBlockEnd()` | 嵌入块诊断 |
| `__refMenuState` / `__refMenuPerf` | 菜单 reactive 状态 / 打开耗时 |
| `__writebackDiag()` | 所有标签写回状态机 + 块快照对比 |
| `__mockFsDebug()` | mock 数据摘要（seededVersion / 模板文件清单） |
| `__editorWatchMutations()` / `__editorForceSync()` / `__editorDescInfo()` / `__editorPosAtDOM()` / `__editorDocNodes()` / `__editorSelection()` | ProseMirror 视图/文档诊断 |

## 4. 测试数据

- mock 文件系统内置演示工作区（`mock-samples.generated.ts`，由 `scripts/sync-demo.mjs` 从 `../demo/` 同步生成）+ 手写样例。
- `SEED_VERSION` 版本化：bump 时 `FORCE_UPDATE_PATHS` 里的演示核心文件跨版本强制覆盖，普通文件只补缺。
- 合规/违规样例对：如 `助贷接口.md`（合规）与 `助贷接口-违规.md`、`loan_apply.md` 与 `loan_apply-违规.md`、`下游机构通知.md` 与 `下游机构通知-违规.md`——校验套件直接对比两类文件的行为差异。
