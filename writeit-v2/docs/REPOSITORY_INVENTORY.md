# WriteIt v2 Repository Inventory

> P0-01 只做仓库调查，不移动、删除或重命名代码。以下内容以当前工作树为准，并同时标注 Git 中的跟踪状态。

## 分类说明

- `ACTIVE-V2`：WriteIt v2 当前主线，可正常修改。
- `LEGACY`：旧版应用，仅用于行为、测试、fixture 和边界案例参考。
- `REFERENCE`：实验、报告或设计资料，不是运行时依赖。
- `TOOLING`：开发、CI、Agent 或仓库辅助工具。
- `KNOWLEDGE`：只读源语料或知识库生成层。
- `GENERATED`：构建、系统或运行时生成物。
- `CANDIDATE-REMOVE`：发现可能是临时/废弃内容，但在确认用途前保留。

## 顶层目录与文件

| 路径 | 当前状态 | 分类 | 事实与边界 |
|---|---|---|---|
| `.git/` | 存在，仓库元数据 | `TOOLING` | Git 内部目录，不属于应用内容。 |
| `.github/` | 已跟踪 | `TOOLING` | 含 GitHub Actions；当前 workflow 主要构建 `editor-app/`。 |
| `.gitignore` | 已跟踪 | `TOOLING` | 忽略依赖、构建产物、系统文件及 `.workbuddy` 本地记忆/临时目录。 |
| `.DS_Store` | 未跟踪、被忽略 | `GENERATED` | macOS 系统文件，不纳入项目。 |
| `.pi/` | 已跟踪 | `TOOLING` | Pi extension/skill；当前 `writeit-debug` 面向 legacy，并引用 `editor-app/`，不能直接视为 v2 诊断协议。 |
| `.workbuddy/` | skill 已跟踪 | `TOOLING` | 含 legacy 调试 skill 的薄包装；本地 `memory/`、`tmp/` 按规则忽略。 |
| `AGENTS.md` | 已跟踪，工作树已修改 | `TOOLING` | 当前根规则已将 `writeit-v2/` 定为主线，并规定 legacy 边界。修改不是本任务产生的。 |
| `KB.md` | 已跟踪 | `KNOWLEDGE` | `raw/` 与 `wiki/` 的操作手册；其中仍有旧版主线描述，后续需单独评估。 |
| `README.md` | HEAD 中已跟踪，当前工作树为删除状态 | `REFERENCE` | 根 README 已由用户手动删除；后续补充新的 v1/v2 landing README，本任务不恢复或重写。 |
| `editor-app/` | 已跟踪，含本地未跟踪/忽略内容 | `LEGACY` | 旧版 Vue/Vite/Tauri/Milkdown 应用。保留原位，不作为 v2 runtime dependency。 |
| `experiments/` | 未跟踪 | `REFERENCE` | 当前含 `cm6-spike/`，包括 spike report 和可运行实验；用于 CM6 架构证据，不直接并入 v2。 |
| `fromChatgptWeb.md` | 未跟踪、用户创建 | `REFERENCE` | 独立的大型 ChatGPT 设计稿副本；当前未发现项目引用。用户要求暂时保留，不作为运行时依赖。 |
| `raw/` | 已跟踪 | `KNOWLEDGE` | `milkdown-docs/` 与 `milkdown-srouce/` 只读源语料；禁止为 v2 修改。 |
| `wiki/` | 已跟踪 | `KNOWLEDGE` | 基于 `raw/` 的知识库生成层；只在知识库任务中维护。 |
| `writeit-v2/` | 工作树存在，当前未跟踪 | `ACTIVE-V2` | 当前只有 `docs/IMPLEMENTATION_SPEC.md`、`docs/STATUS.md` 及本清单；产品骨架属于后续 P0-07。 |

## 重要子目录调查

### `editor-app/`（`LEGACY`）

当前直接子项包括：

- `src/`、`src-tauri/`：旧版前端与 Tauri 壳
- `tests/`、`specs/`：测试与规格/回归资料
- `scripts/`、`vite-plugins/`：脚本和构建支持
- `package.json`、`package-lock.json`、`tsconfig.json`、`vite.config.ts`、`vitest.config.ts`
- `README.md`、`AGENTS.md`、`index.html`
- `_mmrender_probe.html`、`icon-preview.html`：旧版探针/预览资料
- `node_modules/`、`dist/`、`demo-shots/`：本地依赖或生成内容，按规则忽略

`editor-app/AGENTS.md` 当前是工作树中的未跟踪文件，属于旧版专用操作规则；它不是 v2 runtime 依赖。

### `experiments/cm6-spike/`（`REFERENCE`）

包含 `README.md`、`SPIKE-REPORT.md`、Vite/TypeScript/Vitest 配置和 `src/`。这是 CM6 Architecture Spike 的实验资料，结论已记录为 GO；正式实现仍应在 `writeit-v2/` 重新归属并测试。

### `.pi/` 与 `.workbuddy/`（`TOOLING`）

两套 `writeit-debug` 资源目前服务 legacy 调试链路，协议实现位于 `editor-app/scripts/`。它们不是 v2 的诊断 API；后续应按 SPEC 的 Phase 10 重新设计或建立 v2 语义接口，而不是直接搬运旧协议。

## 工作树基线

调查时已有的修改如下，P0-01 未覆盖、未回滚、未恢复：

```text
 M .pi/skills/writeit-debug/SKILL.md
 M AGENTS.md
 D README.md
 M editor-app/tests/e2e/embed-topbar-e2e.js
?? editor-app/AGENTS.md
?? experiments/
?? fromChatgptWeb.md
?? writeit-v2/
```

其中 `README.md` 的删除、`AGENTS.md` 及其他 legacy/实验文件修改均视为既有工作树状态。后续任务不得把这些变更误判为 P0-01 产生的清理结果。

## 初步边界结论

1. `writeit-v2/` 是唯一的 v2 实现主线；当前尚未有可运行产品代码。
2. `editor-app/`、`.pi/`、`.workbuddy/` 中的 legacy 资源可以研究，但 v2 禁止 runtime import `editor-app/`。
3. `raw/` 保持只读；`wiki/` 不属于 v2 产品代码。
4. CI、根 README、KB 旧描述和 legacy 调试工具存在后续一致性工作，但不在 P0-01 中直接清理。
5. 生成物和疑似临时文件先保留并标记；删除需在 P0-05 按 `rg`、引用检查和 `git log -- <path>` 再确认。

## P0-05 清理复核

- 删除根 `.gitignore` 中指向已退役 `editor/` 目录的 `editor/dist/` 规则；`git log` 显示该目录已在 `a603778` 退役，当前仓库也没有该路径或其他引用。
- 修正 `editor-app/README.md` 中指向已在 `bd72851` 删除的 `doc/` 与 `editor-app/docs/` 的失效链接，并明确其 v1 legacy 边界；未移动 `editor-app/`。
- 保留 `.pi` / `.workbuddy` 的两套 `writeit-debug` 资源：它们分别服务 Pi 与 WorkBuddy，且均有实现或文档引用，不属于可确认删除的重复工具。
- 删除已跟踪的 `editor-app/tests/unit/.cache/embed-chain.cjs`：`tests/unit/run-unit.cjs` 会在运行测试前从 `src/editor/ref/embed-chain.ts` 重新生成它，且 Vitest 不直接纳入该 `.cjs` 测试；同时将 `tests/unit/.cache/` 加入 `editor-app/.gitignore`，避免缓存重新入库。
- 保留忽略的 `node_modules/`、`dist/`、`demo-shots/` 与 `.DS_Store`，不把本地生成物纳入清理变更。
- 保留用户创建的 `fromChatgptWeb.md`（暂作为参考资料），以及用户手动删除的根 `README.md`；后续另行补充新的 v1/v2 landing README。

## 调查依据

本清单基于以下检查生成：

- `git status --short` / `git status --short --ignored`
- `git ls-files` 与 `git ls-tree --name-only HEAD`
- 顶层及关键目录的直接子项扫描
- 非 legacy 目录中的 `git grep` / `rg` 引用检查
- 对候选文档的 `git log -- <path>` 历史检查
