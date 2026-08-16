# 设置 / 主题 / 快捷键

> 核心代码：`editor-app/src/state/settings.ts` + `components/SettingsModal.vue` + `App.vue`（侧边栏/状态栏）。
> 入口：⚙️ 图标 或 `Ctrl+,`。三个页签：常规 / 快捷键 / **导出**。

## 1. 设置项（设置弹窗「常规」页签）

| 设置 | 默认 | 说明 |
|---|---|---|
| 主题 | Frame 浅色 | 6 套：Frame / Classic / Nord × 浅色/深色 |
| 自动保存 | 关 | 开启后可选延迟 1 / 2 / 5 / 10 秒（按最后修改时间防抖） |
| 显示所有文件 | 关 | 文件树是否显示非 Markdown 文件（如 .ts / .json） |
| 固定侧边栏 | 关 | 固定后打开文件不自动收纳内容列 |
| 全局模板目录 | 空 | 工作区外模板目录（v1 仅 Tauri 生效；结构：`template/<名称>/<名称>.md` 首行 doctype） |
| 文件系统 | （自动） | 只读展示当前后端：mock / web / tauri |
| 批注抽屉宽度 | 300px | 可在抽屉边缘拖拽（50–480px） |

> 注：批注用户名（`settings.annotationUsername`，默认「我」）存在于设置对象中但**暂无设置 UI**——Tauri 下自动取 `git user.name`，web/mock 使用默认值（代码见 `annotations/user-name.ts`）。

- 所有设置存 localStorage（key `milkdown-note-settings-v1`），改完即保存。

## 2. 快捷键（设置弹窗「快捷键」页签）

11 个动作，全部可自定义：

| 动作 | 默认 | 动作 | 默认 |
|---|---|---|---|
| 保存当前文件 | `Ctrl+S` | 下一个/上一个标签 | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| 打开目录 | `Ctrl+O` | 下一个/上一个文件 | `Alt+↓` / `Alt+↑` |
| 新建文件 | `Ctrl+N` | 收纳/展开侧边栏 | `Ctrl+B` |
| 关闭当前标签 | `Ctrl+W` | 切换源码/编辑模式 | `Ctrl+E` |
| 打开设置 | `Ctrl+,` | | |

- **录制**：点击某项 → 按下新组合键即绑定。
- **冲突检测**：新组合键已被占用 → toast 提示「已用于 xxx」，不覆盖。
- **恢复默认**：一键还原全部。
- 组合键格式 `Ctrl+Shift+X`；`formatCombo` / `parseCombo` / `comboMatches` 实现解析与匹配（Ctrl 与 Cmd 等价）。
- 输入框/下拉框聚焦时全局快捷键不触发（源码模式 textarea 特判放行）。

## 3. 主题注入与外壳配色同步

```
THEMES = [frame, frame-dark, classic, classic-dark, nord, nord-dark]
每套 crepe 主题 CSS 以 ?raw 打包进应用（离线可用）
applyTheme(theme)
  ├─ 注入 <style data-theme-style>（替换内容，不重建）
  └─ syncChromeTheme()
```

**外壳配色同步**（关键设计）：文件树/标签栏/工具栏等应用壳不用自己的颜色，而是——

1. 离屏探针元素（`.milkdown` class）读取主题计算样式；
2. 把 crepe 变量映射到 `:root` 的 `--chrome-*` 变量：

```
--chrome-background ← --crepe-color-background
--chrome-primary    ← --crepe-color-primary
--chrome-border     ← --crepe-color-outline + '55'（派生透明度）
--chrome-warning    ← --crepe-color-on-surface-variant
…（约 30 个基础 + 派生映射，含字体与阴影）
```

这样换主题时整个应用壳自动同步配色，观感与编辑器一致。

## 4. 导出（独立弹窗，图标列 📤）

- 图标列「📤 导出」按钮 → **独立导出弹窗**（ExportModal，不占用设置弹窗）。
- 显示当前活动文件（路径 + doctype；模板有 `export.ts` 时显示徽标）。
- 格式选择：自动 / PDF / DOCX / Markdown；点「📤 导出」执行。
- 「自动」= 跟随模板 export.ts；无则默认 PDF。PDF 内置思源黑体子集，离线可用。
- **嵌入块 `![[path]]` 的内容会展开进导出文件**（三种格式均含）。
- 详细实现见 [导出功能](export.md)。

## 5. 侧边栏交互

| 交互 | 行为 |
|---|---|
| 📁 图标 | 收纳/展开内容列（`Ctrl+B`） |
| 📌 固定 | 固定后打开文件不自动收纳；未固定时点击编辑区自动收纳 |
| 拖拽 | 内容列边缘拖拽调整宽度（160–420px，持久化） |
| 🎯 定位 | 在文件树中定位当前激活文件（展开目录 + 平滑滚动 + 高亮） |
| ＋文件 / ＋目录 / ⟳ | 根目录新建 / 刷新 |

## 6. 状态栏

左：标签数 · 当前文件路径（脏时 ● 未保存）｜右：源码模式徽标 · 自动保存状态 · 后端类型（fsName）· 根目录名。
