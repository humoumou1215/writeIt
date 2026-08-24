# WriteIt

基于 **Tauri 2 + Vue 3 + Vite + @milkdown/crepe** 的 Markdown 内容工程桌面编辑器，以及与开发过程伴生的 **Milkdown 知识库**（`raw/` 源语料 + `wiki/` 生成层）。

```
┌──────────────────────────────────────────────────────┐
│ 顶栏: 打开目录 · 保存 · 上/下文件 · 设置(主题/自动保存)   │
├──────────┬───────────────────────────────────────────┤
│ 文件树    │ 标签栏 (多标签 · 脏标记 ●)                   │
│ (CRUD)   │ ┌──────────────────────────────────────┐ │
│          │ │ Crepe 编辑器 (每个标签独立实例)          │ │
│          │ └──────────────────────────────────────┘ │
├──────────┴───────────────────────────────────────────┤
│ 状态栏: 标签数 · 当前文件 · 保存模式 · 分支徽标           │
└──────────────────────────────────────────────────────┘
```

## 仓库结构

```
writeIt/
├── editor-app/        # ★ 主应用：Markdown 编辑器（Vue3 + Vite + Tauri + @milkdown/crepe）
│   ├── src/           #   editor/ fs/ annotations/ validate/ template/ git/ search/ export/ diagnostics/ table/ components/ state/
│   ├── src-tauri/     #   Tauri Rust 壳（文件系统 + git CLI 命令、打包配置）
│   ├── tests/         #   e2e（ego-browser 驱动）/ unit
│   ├── scripts/ vite-plugins/   # 构建 / 脚本 / Vite 插件
│   └── README.md      #   ★ 应用级详细文档（架构 / 功能 / 快捷键 / 打包）
├── raw/               # 知识库源语料（只读）：官方文档 + 源码语料
├── wiki/              # 知识库生成层（可读写）：concepts/ entities/ sources/ syntheses/ + index & log
├── AGENT.md           # 项目操作手册（Pi 工作区约定，不随代码修改）
├── KB.md              # 知识库操作手册
└── .github/           # CI：GitHub Actions 自动三平台构建
```

> `raw/` 只读、`wiki/` 维护约定详见 `KB.md`；`AGENT.md` 定义整个工作区的结构、权限与约定。

## 特性速览

主应用（详细见 [`editor-app/README.md`](editor-app/README.md)）提供一整套 Markdown 内容工程能力：

- **文件系统**：打开本地目录 → 文件树完整 CRUD；`mock / web / tauri` 三层实现可无缝切换（浏览器调试 / Chrome File System Access / 桌面应用）。
- **多标签编辑**：每个标签独立 Crepe 实例（独立撤销历史、光标、滚动），切标签只切容器可见性不重建，Ctrl+S / 自动保存 + 脏标记。
- **引用机制**：`[[路径]]` / `[[路径#锚点]]` / `![[路径]]`（可编辑/只读嵌入）三级触发，点击跳转、断链标红、重命名联动、复制粘贴即引用。
- **模板机制**：`.template/` 目录 + `doctype:` 声明，可配 `rules.ts`（校验）与 `suggest.ts`，`/` 菜单插入。
- **批注评论**：选中文本添加批注线程（回复 / 标记已解决），违规进批注抽屉。
- **文档校验**：按模板规则自动检查，strict 模式保存前把关。
- **Git 工作台**：分支徽标 / 提交历史 / 工作区改动，文本（分栏/统一）与渲染（组合 md + mermaid 节点级）双模式 diff，F7 逐处导航、单段还原。
- **Mermaid 图表**：代码块预览 + `/` 菜单 8 种精选模板，30 种图表类型示例一键演示。
- **嵌入多层/引用**：多层块嵌入、文件底部「引用了 / 被引用」展示区、表格增强、大纲面板。
- **全文搜索**：遍历文件树逐行匹配，搜索序号防乱序，点击结果精确定位。
- **导出**：PDF（内置中文字体）/ DOCX / Markdown，模板 `export.ts` 可定制，单文件与批量。
- **诊断分析**：包内上报（版本 + 构建时间），收集运行时异常生成诊断报告。
- **6 套主题**：Frame / Classic / Nord × 浅/深，`?raw` 离线打包，外壳自动同步配色。

## 快速开始

```bash
cd editor-app

# 浏览器模式（Vue + Vite 调试，无需 Rust 工具链）
npm install
npm run dev           # http://localhost:5173
# 默认使用 mock 文件系统（localStorage 示例工作区）
# Chrome/Edge 可在设置里用 File System Access API 打开真实目录

# 桌面模式（需要 Rust 工具链）
npm install
npm run tauri dev     # 或 npm run build 后用 tauri dev
```

**开发模式说明**：`npm run dev` 前的 `predev` 会自动执行 `sync:demo` 同步演示数据。
前端通过 `src/fs` 的 `FileSystem` 接口统一访问，`mock / web / tauri` 三种实现共存、可探测切换。

## 测试

```bash
cd editor-app
npm run test:unit     # 单元测试
npm run test:e2e      # 端到端回归（ego-browser 驱动真实 Chromium，需 dev server :5173）
```

> e2e 一律使用项目 harness（`npm run test:e2e` 或 `node tests/e2e/_run-one.js <name>`），
> **严禁使用 playwright**；浏览器驱动唯一允许 ego-lite / ego-browser。

## 构建与打包

| 平台 | 方式 | 产物 |
|---|---|---|
| Windows | `npm run tauri build -- --bundles nsis` | `*.-setup.exe` 安装包 + 便携版 |
| macOS | `npm run tauri build -- --bundles app,dmg` | `.app` + `.dmg` |
| Linux | `npm run tauri build -- --bundles deb` / `appimage` | `.deb` / `.AppImage` |

Tauri 只打**当前系统**的包（无法交叉编译）；`.github/workflows/build.yml` 在 tag 触发时自动三平台构建并发布 Release。

## 相关文档

- [`editor-app/README.md`](editor-app/README.md) — 应用级完整文档（布局 / 快捷键 / 多标签设计 / Git 工作台 / 打包细节）
- `KB.md` — 知识库操作手册（`raw/` 只读、`wiki/` 维护约定）
- `AGENT.md` — 项目操作手册（Pi 工作区结构 / 权限 / 约定）

## 许可

私有 / 未指定开源许可。
