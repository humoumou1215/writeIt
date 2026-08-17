# 演示工作区「消金业务合作平台」

> 内容库位置：`/Users/huyongsheng/project/消金业务合作平台`（独立 git 仓库，52 个文件 + 8 个模板域目录）。
> vite dev **默认真实内容库**（文件系统与 git 均为真实数据，Vite Node 中间件直连）；设置页「数据源」可切 Mock 演示（内置示例，sync-demo 从内容库生成）。

## 1. 背景

一套业务管理系统示例：接收上游发送的意向贷款客户，经**路由**输出到不同下游机构，完成**助贷、增信**等业务合作。核心业务模块：路由、进件、助贷、增信。

## 2. 目录约定

| 目录 | 含义 | 组织方式 |
|---|---|---|
| `迭代/20260806/` 等 | 迭代窗口（批次） | 窗口 → 项目（需求分析/设计文档） |
| `流程图/` | 系统当前最新状态 · 流程图 | 按功能模块（路由/进件/助贷） |
| `接口文档/` | 本系统提供的接口服务 | 按功能模块（路由/进件/助贷） |
| `后端接口/` | 调用下游系统的接口 | 按下游系统（助贷机构/增信机构/资金方） |
| `数据库/` | 表结构 + 数据维护 | 按 schema（route/customer/loan）；数据维护按日期 |
| `xxljob/` | 批任务管理 | 按执行器（route-executor / notify-executor） |
| `配置/` | 运行配置 | 按类型 → 应用 |
| `.template/` | 模板域 | 每模板一个目录 |

> 流程图 / 接口文档 / 后端接口 / 数据库 / xxljob / 配置 是**系统功能描述的当前最新状态**（活文档，跨窗口持续更新）；迭代窗口目录保存各迭代的需求与设计快照。

## 3. 模板域（8 个）

| 模板 | 配套 TS | 用途 |
|---|---|---|
| `接口文档` | rules + suggest | 接口文档（含字段引用/校验） |
| `数据库` | rules + suggest | 表结构文档 |
| `xxljob` | rules + suggest | 批任务（一文件一任务） |
| `后端接口` | — | 下游接口 |
| `流程图` / `表结构` / `需求分析` / `设计文档` | 占位（.gitkeep） | 待逐个确认 |

- 每个模板目录 = `<名称>.md`（首行 doctype）+ 可选 `<名称>.rules.ts` / `<名称>.suggest.ts`。
- M8 重构：数据库 1 文件 = 1 表；xxljob 1 文件 = 1 任务。
- 合规/违规样例对（校验演示）：`助贷接口.md` vs `助贷接口-违规.md`、`loan_apply.md` vs `loan_apply-违规.md`、`下游机构通知.md` vs `下游机构通知-违规.md`。

## 4. 与 mock / 真实调试的关系

- 内容库实际位置：`/Users/huyongsheng/project/消金业务合作平台`（独立 git 仓库；从 `writeIt/demo/` 迁出后初始化）。
- `editor-app/scripts/sync-demo.mjs`：把内容库同步为 `src/fs/mock-samples.generated.ts`（生成式数据源，避免手写两遍）。
- mock 的 `SEED_VERSION` 控制演示数据版本迁移（FORCE_UPDATE_PATHS 强制覆盖核心演示文件）。
- **真实调试（默认）**：`npm run dev:repo` 启动 vite dev，默认即真实仓库——文件系统走 Vite Node 中间件（真实读取内容库），git 走真实 git CLI（child_process），面板/文本/渲染 diff、还原、分支切换全部基于真实仓库。设置页「数据源」可切换 Mock 演示；URL `?backend=mock` / `?backend=dev` 快速覆盖。
- 改内容库 → 跑 sync-demo → bump SEED_VERSION → 浏览器刷新即可看到新演示（mock 模式）。
