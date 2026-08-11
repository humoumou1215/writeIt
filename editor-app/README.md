# Milkdown Note

基于 **Tauri 2 + Vue 3 + Vite + @milkdown/crepe** 的 Markdown 编辑器。
打开本地目录 → 文件树（完整 CRUD）→ 多标签页编辑 → Ctrl+S / 自动保存。

```
┌────────────────────────────────────────────────────────┐
│ 顶栏: 打开目录 · 保存 · 上/下文件 · 设置(主题/自动保存)  │
├──────────┬─────────────────────────────────────────────┤
│ 文件树    │ 标签栏 (多标签 · 脏标记 ●)                   │
│ (CRUD)   │ ┌──────────────────────────────────────┐   │
│          │ │ Crepe 编辑器 (每个标签独立实例)        │   │
│          │ └──────────────────────────────────────┘   │
├──────────┴─────────────────────────────────────────────┤
│ 状态栏: 标签数 · 当前文件 · 保存模式                     │
└────────────────────────────────────────────────────────┘
```

## 目录结构

```
editor-app/
├── src/
│   ├── main.ts              # 入口
│   ├── App.vue              # 布局：顶栏 + 文件树 + 标签 + 编辑器
│   ├── editor/manager.ts    # 多标签 Crepe 实例管理（核心）
│   ├── fs/                  # 文件系统抽象
│   │   ├── types.ts         #   FileSystem 接口
│   │   ├── mock.ts          #   浏览器 localStorage 模拟（Demo）
│   │   ├── web.ts           #   File System Access API（Chrome）
│   │   └── tauri.ts         #   Tauri IPC（独立应用）
│   ├── state/               # 全局状态 / 设置 / 文件树操作
│   └── components/          # FileTree / TabBar / EditorPane / 设置 / 弹窗
├── src-tauri/               # Tauri 壳（Rust）
│   ├── src/lib.rs           # 文件系统命令（read_tree / read_file / …）
│   ├── tauri.conf.json      # 窗口 / 打包配置（Windows NSIS）
│   └── capabilities/        # 权限
└── vite.config.ts           # 固定端口 5173（Tauri 依赖）
```

## 快速开始

```bash
# 浏览器模式（Vue + Vite 调试，无需 Rust）
npm install
npm run dev          # http://localhost:5173
# 默认 mock 文件系统（localStorage 示例工作区）
# Chrome/Edge 可在设置里用 File System Access API 打开真实目录

# Tauri 模式（Windows / Linux 桌面应用）
npm install
npm run tauri dev    # 需要 Rust 工具链
```

## 文件系统三层实现

| 实现 | 场景 | 说明 |
|---|---|---|
| `mock` | 浏览器调试 | localStorage 持久化 + 示例工作区，开箱即用 |
| `web` | Chrome/Edge 调试 | File System Access API，可打开真实目录 |
| `tauri` | 打包应用 | Rust 命令读写，完整 Node/Rust 文件能力 |

前端通过 `fs` 接口统一访问，三种实现可无缝切换（`src/fs/index.ts` 自动探测）。

## 多标签页设计（重点）

- 每个打开的标签持有**独立的 Crepe 实例**：各自的撤销历史、光标、滚动位置互不影响
- 切换标签只切换容器可见性，**不重建编辑器**（`display:none` 切换）
- 关闭标签才销毁实例；有未保存修改时弹确认框
- 数据流单向：文件内容只经 `getMarkdown()` 取出、`replaceAll()` 注入

## Mermaid 图表（自 editor/ 子项目移植）

与 `editor/` 子项目能力对齐，已集成到多标签架构：

- **代码块预览**：任意 ```` ```mermaid ```` 代码块点击右上角 👁 按钮，经 `mermaid.render` 渲染 SVG（含 loading 与错误提示）
- **斜杠命令**：`/` 菜单新增「Mermaid」分组，精选 8 种模板（Flowchart/Sequence/State/Class/Mindmap/ER/C4/Gantt），选中即插入带示例的代码块
- **图表集**：示例工作区内置 `Mermaid 图表集.md`（全部 30 种图表类型，逐一可预览）
- 实现：`src/editor/mermaid.ts`（feature 配置工厂，每个 Crepe 实例应用）+ `src/editor/mermaid-diagrams.ts`（30 种图表数据源）
- 注意：CodeMirror 代码块为 **IntersectionObserver 懒加载**，滚动到可视区才会初始化

> 代码块语言按钮等细节来自 `editor/` 子项目的验证结论：必须用本地 Vite 构建（esm.sh CDN 有 `basicSetup` 导出丢失与 CSS 404 问题），本项目本身就是本地构建，无此问题。

## 保存策略

- **手动**：`Ctrl+S` 保存当前标签
- **脏标记**：标签圆点 ● + 状态栏提示；关闭/切换前询问
- **自动保存**：设置里开启，可选 1/2/5/10 秒延迟（按最后修改时间防抖）

## 主题

6 套 Crepe 主题（Frame / Classic / Nord × 浅色/深色）以 `?raw` 打包进应用，**离线可用**。
应用外壳（文件树/标签栏/工具栏）通过读取 `.milkdown` 计算样式自动同步配色。

## Windows 打包

```bash
# 在 Windows 机器上执行（Tauri 不支持交叉编译 Windows 包）
npm run tauri build
# 产物: src-tauri/target/release/bundle/nsis/*-setup.exe
```

> 跨平台构建说明：`tauri build` 打的是**当前系统**的包，无法从 Linux 交叉编译
> Windows 安装包（NSIS/MSI 依赖 Windows 工具链）。两种做法：
> 1. Windows 机器上直接 `npm run tauri build`
> 2. GitHub Actions 配 `windows-latest` runner
>
> `tauri.conf.json` 的 `bundle.targets` 当前为 `["nsis"]`（Windows 专属）。
> 在 Linux 上该 target 会被**静默跳过**，需用 CLI 显式指定：
> `npm run tauri build -- --bundles deb`（产物 `bundle/deb/*.deb`）
> 或 `--bundles appimage`。

## 已知限制 / 后续路线

- [ ] 文件变更外部监听（fs.watch 自动刷新树）
- [ ] 二进制文件预览（图片等）
- [ ] 全局搜索
- [ ] CrepeBuilder 按需加载减小包体（当前主包 ~1.5MB gzip 484KB）
- [ ] AI 功能（streaming + diff，需 BYOK 或后端代理，勿在前端写 API key）
