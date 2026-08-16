# E2E 测试套件（Milkdown Note）

M1-M6 全量回归套件。基于 Playwright 驱动真实 Chromium，需先启动 dev server。

## 运行

```bash
# 1. 启动 dev server（终端 1）
npm run dev            # http://localhost:5173

# 2. 跑全部套件（终端 2）
npm run test:e2e

# 或单个套件
node tests/e2e/m6c-e2e.js
```

## 依赖

- `playwright`（devDependency，`npm install` 时自动装）
- 首次使用需下载浏览器：`npx playwright install chromium`

## 套件清单（按里程碑）

| 套件 | 里程碑 | 断言数 | 覆盖 |
|---|---|---|---|
| ref-e2e | M1 | 15 | 引用语法/节点/两段式 resolve/路径补全 |
| menu-e2e | M2 | 26 | @/[[/![[ 触发 + 三级递进菜单 |
| m3-e2e | M3 | 9 | 跳转/断链/重命名/只读守卫 |
| m4-e2e | M4 | 13 | 模板机制/suggest 实体 |
| m4b-e2e | M4 | 9 | 实体级/标题实体/样例 |
| m4c-e2e | M4 | 6 | 完整路径/对象跳转/平滑滚动 |
| m5-e2e | M5 | 9 | 校验三通道（抽屉）/报告 |
| m5-strict | M5 | 3 | strict 门禁（确认框） |
| m6-e2e | M6 | 6 | 批注 round-trip/锚点激活 |
| m6-toolbar | M6 | 9 | Toolbar 添加批注/Ctrl+R/Ctrl+Enter/ESC |
| m6c-e2e | M6 | 20 | 抽屉/评论线程/权限/折叠/连线/拖拽 |
| git-m11a-e2e | M11 | 29 | Git 面板/历史/范围对比/diff 视图（IPC mock 全流程） |
| git-m11a-smoke | M11 | 10 | 浏览器降级（图标灰置 + toast + 面板错误） |
| app-e2e | 综合 | 28 | 全应用（**会清空 demo-shots/**，最后跑） |

## 测试数据说明

- 测试通过 `localStorage`（`milkdown-note-mock-fs-v2`）直接 seed mock 文件系统，
  套件间独立（各自强制重写周报等演示文件），可在任意顺序/重复运行。
- 调试钩子：`window.__editorDebug` / `__editorGetMarkdown` / `__editorGoEnd` 等（见 src/editor/manager.ts）。

## 目录结构

```
tests/
├── e2e/       # 正式回归套件（本目录）
│   └── run-all.js   # 汇总运行器（npm run test:e2e）
└── scratch/   # 历史一次性调试脚本归档（diag/check/debug，仅供查证，不维护）
```
