# Mermaid 图表（M9）

> 核心代码：`editor-app/src/editor/mermaid.ts`（feature 配置工厂）+ `mermaid-diagrams.ts`（图表数据源）+ `mermaid-ref.ts`（图表内引用）+ `mermaid-zoom.ts`（放大灯箱）。
> 设计文档：`editor-app/docs/design.md` §Mermaid。

## 1. 三个能力

### ① 代码块预览

任意 ```` ```mermaid ```` 代码块右上角 👁 按钮 → `mermaid.render` 渲染 SVG（loading → 结果 / 错误提示）。

- 实现：`Crepe.Feature.CodeMirror` 的 `renderPreview` 钩子——返回 `undefined` 先显示 loading，异步渲染完成后 `applyPreview(svg)`。
- `mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })` **全局只初始化一次**（多标签共享）。
- **懒加载**：CodeMirror 代码块为 IntersectionObserver 懒加载——滚动到可视区才初始化编辑器，未显示时只渲染 placeholder（正常行为）。
- 放大灯箱：预览 SVG 悬停显示 🔍 按钮，点击 Lightbox 放大查看，ESC 关闭（`mermaid-zoom.ts`）。

### ② 斜杠命令

`/` 菜单新增「Mermaid」分组，精选 8 种模板（Flowchart / Sequence / State / Class / Mindmap / ER / C4 / Gantt），选中即插入带示例的代码块。

### ③ 图表内引用（M9/M10）

- **代码块内 `@` / `[[` 联想**：mermaid 代码块内输入触发词 → 复用 ref 菜单内核（core.ts）+ RefMenu.vue 三级菜单——数据源/树缓存/实体加载/导航状态机全部共享，不重复实现（`mermaidRefMenuExtension`，CodeMirror ViewPlugin）。
- **渲染文本链接化**：SVG 内 `[[path#frag]]` 文本 → 可点击 `<a class="mmd-text-ref">`（去 `[[ ]]` 显示路径），覆盖：
  - foreignObject 内的文本节点；
  - `<text>` 内的文本（用 `<tspan>`，sequenceDiagram 消息等）；
- **裸 `[[` 解析兜底**：mermaid 语法中节点 label 里未加引号的 `[[..]]` 会被解析成"子程序节点形状"导致 parse error → 渲染前把内联 `[[path#frag]]` 替换为占位符 `mmdref<n>`（前置字符是 `[A-Za-z0-9_]` 时视为原生子程序节点 `A[[x]]`，不替换），渲染后按序还原成 `<a>`；全角 `＃` 还原为 `#`。
- **点击跳转**：`a.mmd-text-ref` 点击 → 复用 `handleOpenRef`（打开目标 + # 片段滚动）。

## 2. 使用说明（用户视角）

1. 写一个 ```` ```mermaid ```` 代码块，点 👁 预览；或 `/` 菜单「Mermaid」选模板插入。
2. 图里要引用别的文档：直接在节点 label 里写 `[[路径#标题]]`，渲染后可点击跳转（鼠标悬停显示路径）。
3. 预览后点 🔍 放大查看。
4. 内置示例：工作区示例里有「Mermaid 图表集.md」（数据源 `mermaid-diagrams.ts` 共 36 种图表类型，逐一可预览）。

## 3. 关键文件

| 文件 | 职责 |
|---|---|
| `mermaid.ts` | `mermaidFeatureConfigs()`：renderPreview + buildMenu 组合 |
| `mermaid-diagrams.ts` | 30 种图表数据源 + 8 种斜杠模板 |
| `mermaid-ref.ts` | 代码块 @/[[ 联想 + SVG 链接化 + 占位符兜底（复用 ref core） |
| `mermaid-zoom.ts` / `mermaid-zoom.css` | 放大灯箱 |
| `mermaid-ref.ts` 依赖注册 | `registerMermaidRefDeps`（manager 装配：cfg + 打开回调） |
