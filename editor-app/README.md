# Milkdown Note

> 📖 仓库级完整文档在 [`../doc/`](../doc/README.md)（架构 / 各功能板块实现与使用），里程碑设计见 [`docs/design.md`](docs/design.md)。本文件为快速上手。

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

## 布局与交互

```
┌────┬──────────────┬──────────────────────────────┐
│ 📁 │ 内容列(可收纳) │ 标签栏 (多标签 · 脏标记 ●)      │
│ ⚙️ │ 根目录名 + 📌 │ ┌──────────────────────────┐ │
│图标│ 📂打开目录     │ │ Crepe 编辑器（每标签独立实例）│ │
│列  │ ＋文件＋目录 ⟳ │ └──────────────────────────┘ │
│    │ 文件树 (CRUD)  │                              │
├────┴──────────────┴──────────────────────────────┤
│ 状态栏: 标签数 · 当前文件 · 保存模式               │
└──────────────────────────────────────────────────┘
```

- **图标列**（46px 固定）：📁 文件目录（收纳/展开内容列）、⚙️ 设置（弹窗）
- **内容列**：**点击编辑区自动收纳**（打开文件不收纳，便于在文件树连续打开多个文件）、**固定**（📌，点击编辑区也不收纳）、**拖拽调整宽度**（160–420px，持久化）
- **设置弹窗**：两个页签 —— 常规（主题/自动保存/显示全部/固定侧边栏/文件系统）与**快捷键**（可点击录制、冲突检测、恢复默认）
- 顶栏已移除：打开目录移到侧边栏；保存/上一下文件改为快捷键

## 快捷键（可在设置中自定义）

| 功能 | 默认 |
|---|---|
| 保存当前文件 | Ctrl+S |
| 打开目录 | Ctrl+O |
| 新建文件 | Ctrl+N |
| 关闭当前标签 | Ctrl+W |
| 下一个/上一个标签 | Ctrl+Tab / Ctrl+Shift+Tab |
| 下一个/上一个文件（按树序） | Alt+↓ / Alt+↑ |
| 收纳/展开侧边栏 | Ctrl+B |
| 切换源码/编辑模式 | Ctrl+E |
| 打开设置 | Ctrl+, |

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
│   ├── tauri.conf.json      # 窗口 / 打包配置（Windows NSIS + 便携版 / macOS .app + DMG）
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

## 打包（Windows / macOS）

Tauri 打的是**当前系统**的包，无法交叉编译：

- **Windows**（NSIS 安装包 + 免安装便携版）：
  ```bash
  npm run tauri build -- --bundles nsis
  # 安装包: src-tauri/target/release/bundle/nsis/*-setup.exe
  # 便携版: 直接压缩 src-tauri/target/release/milkdown-note.exe（单文件，免安装）
  ```
- **macOS**（.app + DMG，x64 / arm64）：
  ```bash
  npm run tauri build -- --bundles app,dmg
  # 产物: src-tauri/target/release/bundle/macos/*.app、bundle/dmg/*.dmg
  ```

> GitHub Actions（`.github/workflows/build.yml`）自动构建三平台：
> `windows-latest`（NSIS + 便携 zip）、`macos-13`（Intel x64）、`macos-14`（Apple Silicon）。
> 产物上传 Artifacts；推送 `v*` 标签时自动发布 GitHub Release（含全部平台产物）。
>
> `tauri.conf.json` 的 `bundle.targets` 为 `["nsis", "app", "dmg"]`（跨平台列表，
> 非当前平台的目标会被静默跳过），也可用 `--bundles` 显式指定：
> `npm run tauri build -- --bundles deb`（Linux 产物 `bundle/deb/*.deb`）
> 或 `--bundles appimage`。

## 已知限制 / 后续路线

- [ ] 文件变更外部监听（fs.watch 自动刷新树）
- [ ] 二进制文件预览（图片等）
- [ ] 全局搜索
- [ ] CrepeBuilder 按需加载减小包体（当前主包 ~1.5MB gzip 484KB）
- [ ] AI 功能（streaming + diff，需 BYOK 或后端代理，勿在前端写 API key）
