# WriteIt（Milkdown Note）

> 面向**文档结构化与内容治理**的 Markdown 编辑器 —— 基于 **Tauri 2 + Vue 3 + Vite + @milkdown/crepe**。
> 打开本地目录 → 文件树管理 → 多标签编辑，内置**引用机制、模板机制、文档校验、批注评论、Git 工作台、Mermaid 图表**等一整套内容工程能力。

| | |
|---|---|
| 技术栈 | Vue 3 · Vite 7 · TypeScript · Tauri 2 · @milkdown/crepe 7.22 |
| 编辑器内核 | [Milkdown](https://milkdown.dev/)（ProseMirror 之上的 Markdown 编辑器框架） |
| 目标平台 | Windows（NSIS 安装包 + 便携版）· macOS（.app + DMG）· 浏览器调试 |
| 代码目录 | [`editor-app/`](editor-app/)（应用本体） · [`demo/`](demo/)（演示工作区） · [`raw/`](raw/)（milkdown 源码语料，只读） · [`wiki/`](wiki/)（知识库） |

---

## 一、这是什么

WriteIt 是一个**把 Markdown 笔记当成工程资产来管理**的桌面编辑器。除了常规的所见即所得编辑，它还提供：

- **引用机制**：`[[路径]]` 链接、`[[路径#锚点]]` 对象/标题引用、`![[路径]]` 整文件嵌入（可编辑/只读），引用即点击跳转，断链自动标红提示。
- **模板机制**：`.template/` 目录定义文档模板，首行 `doctype:` 声明类型，可配套 **TypeScript 规则文件**（`*.rules.ts` / `*.suggest.ts`）——运行时用 esbuild-wasm 转译执行，实现「结构查询 + 对象引用 + 自动校验」。
- **文档校验**：按模板规则自动检查（如"需求表必须存在"、"版本章节必填"），违规在文档内高亮、汇总进右侧抽屉、可落盘报告；strict 模式下保存前强制把关。
- **批注与评论**：选中文本加批注，形成评论线程，支持回复、标记已解决；与校验违规共用同一抽屉。
- **Git 工作台**：侧边栏面板（分支/工作区/历史 + 范围对比）+ 编辑区 diff 视图（**文本**：分栏/统一/词级高亮；**渲染**：mermaid 节点级标注、嵌入卡片角标、改动批注卡）；支持还原（整文件/单段）、分支切换；浏览器 mock 演示仓库基于**真实 git diff 数据**。
- **Mermaid 图表**：代码块一键预览 SVG、斜杠菜单插入 8 种图表模板、图表内可写 `[[引用]]` 并点击跳转。
- **多标签编辑**：每个标签独立编辑器实例（撤销历史/光标互不影响），切标签不重建。
- **三种运行形态**：浏览器 Demo（mock 文件系统）→ 浏览器真实目录（File System Access API）→ Tauri 桌面应用，同一套代码无缝切换。

## 二、快速开始

### 浏览器模式（无需 Rust，最快体验）

```bash
cd editor-app
npm install
npm run dev          # http://localhost:5173
```

- 默认使用 **mock 文件系统**（localStorage 模拟，内置示例工作区），开箱即用。
- 在设置里点「📂 打开本地目录…」，Chrome/Edge 可用 File System Access API 打开真实目录。

### 桌面应用模式（Tauri）

```bash
cd editor-app
npm install
npm run tauri dev    # 需要 Rust 工具链（cargo）
```

### 构建 / 测试 / 打包

```bash
cd editor-app
npm run build        # 前端产物（dist/）
npm run test:e2e     # ego-lite（ego-browser）端到端全量回归（需先启动 dev server :5173）
npm run tauri build  # 打包桌面安装包（当前系统平台）
```

> 详细打包方式见 [doc/packaging.md](doc/packaging.md)，测试说明见 [doc/testing.md](doc/testing.md)。

## 三、功能速览

| 功能 | 入口 / 快捷键 | 说明 |
|---|---|---|
| 保存 | `Ctrl+S`（可自定义） | 手动保存；可选自动保存（1/2/5/10 秒防抖） |
| 打开目录 | `Ctrl+O` / 侧边栏「📂」 | 浏览器切真实目录 / Tauri 原生目录选择 |
| 新建文件/目录 | `Ctrl+N` / 侧边栏按钮 / 右键菜单 | 支持「基于模板新建」 |
| 文件树 | 侧边栏 | 完整 CRUD：右键菜单、拖拽移动、重命名引用联动、🎯 定位当前文件 |
| 多标签 | `Ctrl+Tab` / `Ctrl+W` / 中键关闭 | 每标签独立撤销历史；脏标记 ● |
| 引用菜单 | 输入 `@` / `[[` / `![[` | 三级递进：模式 → 文件树 → 实体级（对象/标题） |
| 源码模式 | `Ctrl+E` | 所见即所得 ↔ Markdown 源码（textarea）切换 |
| Mermaid | ` ```mermaid ` 代码块 👁 / `/` 菜单「Mermaid」 | 预览 SVG、插入模板、图表内引用跳转 |
| 模板 | `/` 菜单「模板」组 | 插入模板内容；右键目录「新建自模板」 |
| 校验 | 打开/编辑自动运行 | 违规进右侧抽屉；strict 模式保存前确认 |
| 批注 | 选中文本 → 工具条「添加批注」/ `Ctrl+R` | 评论线程、回复、标记已解决；代码块内批注自动升级为整块批注 |
| 全局搜索 | 图标列 🔍 / `Ctrl+Shift+F` | 全文搜索 + 替换：结果按文件分组、点击/Enter 精确跳转定位 + 编辑器内命中高亮、↑↓ 键盘导航、大小写开关；见 [doc/search.md](doc/search.md) |
| Git 工作台 | 图标列 🔀 / `Ctrl+Shift+D` / 右键「Git 改动」 | 分支/工作区/历史面板；文本+渲染双模式 diff；还原/分支切换；浏览器 mock 演示 |
| 导出 | 图标列「📤」独立按钮 | 当前文档导出 PDF / DOCX / Markdown；嵌入块内容展开；模板 `export.ts` 可自定义 |
| 设置 | `Ctrl+,` / ⚙️ | 主题（6 套）、快捷键录制、自动保存等 |

完整快捷键表与设置说明见 [doc/settings.md](doc/settings.md)。

## 四、仓库结构

```
writeIt/
├── README.md           # 本文件
├── doc/                # 📖 功能板块详细文档（主要实现 + 使用说明）
├── editor-app/         # 应用本体（Vue + Vite + Tauri + @milkdown/crepe）
│   ├── src/
│   │   ├── editor/     #   多标签管理 + 引用机制 + Git diff 组合/渲染 + Mermaid + 源码模式
│   │   ├── template/   #   模板机制（doctype / rules.ts / suggest.ts / esbuild-wasm）
│   │   ├── validate/   #   校验服务（三通道 + strict 门禁）
│   │   ├── annotations/#   批注插件（<mark data-note> + 评论线程 + 抽屉）
│   │   ├── git/        #   Git 工作台数据层（mock 演示后端 + 真实 diff 数据）
│   │   ├── fs/         #   文件系统抽象（mock / web / tauri）
│   │   ├── state/      #   全局状态 / 设置 / 文件树操作
│   │   ├── components/ #   FileTree / TabBar / EditorPane / GitPanel / DiffView / 抽屉…
│   │   └── App.vue     #   布局：侧边栏 + 标签栏 + 编辑器 + 状态栏
│   ├── src-tauri/      #   Rust 壳（文件系统 + git CLI 命令 / 窗口 / 打包配置）
│   ├── tests/e2e/      #   ego-lite 端到端回归套件（禁 playwright）
│   └── docs/design.md  #   里程碑设计文档（M1-M14 完整实现记录）
├── demo/               # （已迁出）演示内容库 → /Users/huyongsheng/project/消金业务合作平台（独立 git 仓库）
├── raw/                # milkdown 官方源码语料（只读，供知识库引用）
└── wiki/               # milkdown 知识库（Agent.md 管理）
```

## 五、文档导航（doc/）

| 文档 | 内容 |
|---|---|
| [doc/architecture.md](doc/architecture.md) | 总体架构：分层、数据流、插件体系、异步容错原则 |
| [doc/editor-core.md](doc/editor-core.md) | 编辑器核心：多标签管理、保存流程、脏检测、源码模式 |
| [doc/filesystem.md](doc/filesystem.md) | 文件系统抽象：mock / web / tauri 三实现与切换 |
| [doc/reference.md](doc/reference.md) | 引用机制：语法、节点、两段式解析、触发菜单、写回事务 |
| [doc/template.md](doc/template.md) | 模板机制：模板域、doctype、rules/suggest TS、斜杠菜单 |
| [doc/validation.md](doc/validation.md) | 校验机制：规则执行、三通道呈现、strict 门禁 |
| [doc/annotation.md](doc/annotation.md) | 批注与评论：语法、线程、抽屉、权限 |
| [doc/mermaid.md](doc/mermaid.md) | Mermaid 图表：预览、模板、图表内引用 |
| [doc/git.md](doc/git.md) | Git 工作台：面板、文本/渲染 diff、mermaid 节点级、还原/分支、mock 演示 |
| [doc/settings.md](doc/settings.md) | 设置 / 主题 / 快捷键 |
| [doc/packaging.md](doc/packaging.md) | Tauri 打包与 CI 发布 |
| [doc/testing.md](doc/testing.md) | 测试体系与调试钩子 |
| [doc/demo-workspace.md](doc/demo-workspace.md) | 演示内容库「消金业务合作平台」（独立仓库 + mock 同步 + 真实调试） |

## 六、给开发者

- 开发前先读 [`editor-app/docs/design.md`](editor-app/docs/design.md)（§11 有里程碑状态与踩坑记录）。
- 改代码后必跑回归：`npm run test:e2e`（ego-lite/ego-browser 驱动，需 dev server :5173；**本项目禁止 playwright**），完成后 `npm run build` 验证。
- 与用户交流全程中文；重大改动先讨论方案再实现。
- **禁止在浏览器包里嵌入 LLM API key**（BYOK / 后端代理）。
