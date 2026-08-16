# 架构总览

> WriteIt 应用本体位于 `editor-app/`：Vue 3 壳 + @milkdown/crepe 编辑器 + 多层服务。
> 本篇回答三个问题：**代码怎么分层、数据怎么流动、插件怎么挂进编辑器**。

## 1. 分层结构

```
┌─────────────────────────────────────────────────────────────┐
│ UI 组件层   App.vue · FileTree · TabBar · EditorPane ·        │
│             SettingsModal · AnnotationDrawer · ContextMenu   │
│             TemplatePicker · ConfirmDialog · NewInput        │
├─────────────────────────────────────────────────────────────┤
│ 状态层      state/store.ts（tabs/tree/…reactive）            │
│             state/settings.ts（主题/快捷键/自动保存）          │
│             state/treeOps.ts（文件树 CRUD + 拖拽）            │
├─────────────────────────────────────────────────────────────┤
│ 服务层      editor/manager.ts（多标签生命周期 · 核心）         │
│             editor/features.ts（Crepe feature 组合工厂）       │
│             template/service.ts（模板注册表）                 │
│             validate/service.ts（校验执行）                   │
│             annotations/service.ts（批注服务）                │
├─────────────────────────────────────────────────────────────┤
│ 编辑器层    @milkdown/crepe（Crepe 实例 × N 标签）            │
│             └ 插件：refPlugin / annotationPlugin / validatePlugin
├─────────────────────────────────────────────────────────────┤
│ 宿主层      fs/ 抽象（FileSystem 接口）                      │
│             ├ mock.ts   localStorage 模拟（浏览器 Demo）      │
│             ├ web.ts    File System Access API（Chrome）      │
│             └ tauri.ts  Tauri IPC → Rust 命令                 │
└─────────────────────────────────────────────────────────────┘
```

### 依赖方向（自上而下单向）

- **UI 层**只依赖状态层与服务层的公开函数，不直接操作编辑器内核。
- **服务层**通过 `fs` 接口访问文件，通过 Crepe 的 `editor.action(ctx => …)` 访问编辑器内部。
- **插件包**（`editor/ref/`、`annotations/`、`validate/plugin.ts`）**不 import 任何 app 模块**——fs、toast、回调全部经 **ctx 依赖注入**（`refConfigCtx` / `annotationConfigCtx` / `validateConfigCtx`），保证插件可独立复用、可测试。

## 2. 数据流（核心不变式）

> **文件内容只从 `getMarkdown()` 出来、经 `replaceAll()` 进去，绝不旁路 DOM。**

```
磁盘/存储 ──readFile──▶ 标签 savedContent ──▶ Crepe defaultValue
                                                │ 用户编辑
                                                ▼
                  保存  ◀── getMarkdown() ◀── ProseMirror doc
                  │           │
                  ▼           ▼
              fs.writeFile   （保存后 savedContent = 规范化内容，脏灭）
```

- 每次 `saveTab` 的产物是 `crepe.getMarkdown()` 的**规范化 Markdown**（round-trip 稳定值），因此"打开即脏"被消除——打开后立即用规范化结果覆盖 `savedContent` 基准。
- 引用物化、校验标注等**程序化 dispatch 不经过 DOM input 事件**，不会误标"用户编辑"。

## 3. 编辑器实例与多标签

- 每个打开的标签持有**独立 Crepe 实例**（`editor/manager.ts` 中 `instances: Map<tabId, Instance>`）。
- 切换标签只切换容器 `display`（`EditorPane.vue`），**不销毁不重建**——撤销历史、光标、滚动位置各自保留。
- 关闭标签才 `crepe.destroy()`；打开/保存期间的内部操作用 `inst.suppressing` 标志抑制脏标记误报。

详见 [编辑器核心](editor-core.md)。

## 4. 插件体系（Milkdown 侧）

每个 Crepe 实例在 `create()` 之前挂载：

| 插件 | 组成 | 职责 |
|---|---|---|
| `refPlugin`（M1-M3） | `$nodeSchema`×4 + `$view` + `$remark` + `$prose`×3 + slash 菜单 | doctype/file_ref/object_ref/file_block 节点、NodeView、解析、点击/断链/只读守卫 |
| `annotationPlugin`（M6） | `$nodeSchema`（annotation）+ `$prose`（decorations） | `<mark data-note>` 节点、运行时批注高亮 |
| `validatePlugin`（M5） | `$prose`（编辑防抖监听 + decorations） | 监听 `markdownUpdated`，防抖触发校验 |

配置注入（P0/P1 依赖净化）——`mountEditor` 里：

```ts
crepe.editor.config((ctx) => {
  ctx.set(refConfigCtx.key, refCfg)              // fs/toast/模板服务/打开与重选回调
  ctx.set(annotationConfigCtx.key, { tabId, getRuntimeAnnotations })
  ctx.set(validateConfigCtx.key, { tabId, run, shouldSkip })
})
crepe.editor.use(refPlugin)
crepe.editor.use(annotationPlugin)
crepe.editor.use(validatePlugin)
```

## 5. 异步容错原则（贯穿全应用）

> 所有"旁路"服务（模板扫描、引用物化、校验、批注、写回、报告落盘）**失败只降级，绝不中断编辑器主流程**。

- 模板扫描失败 → 空注册表 + `console.warn`。
- 引用物化失败 → toast 提示，编辑器照常可用。
- 校验规则抛异常 → 记一条 warning 违规；单条规则超 2s → 标记 stale 并告警。
- 写回事务失败 → toast 降级，不阻断保存。
- 打开文档时的校验是 `void validateEditor(...)`（fire-and-forget）。

## 6. 关键目录速查

| 目录 | 内容 |
|---|---|
| `src/editor/` | `manager.ts`（核心）、`features.ts`（feature 组合）、`mermaid*.ts`、`ref/`（引用插件包） |
| `src/editor/ref/` | `nodes.ts`（schema）、`remark-ref.ts`（mdast）、`resolve.ts`（物化）、`writeback.ts`（写回）、`app-plugin.ts`（点击/断链/守卫）、`menu/`（触发菜单）、`ref-tooltip.ts` |
| `src/template/` | `service.ts`、`ts-loader.ts`（esbuild-wasm）、`suggest-context.ts`、`types.ts` |
| `src/validate/` | `service.ts`、`plugin.ts`、`validate-context.ts` |
| `src/annotations/` | `service.ts`、`nodes.ts`、`plugin.ts`、`remark-annotation.ts`、`card.ts`、`user-name.ts`、`card-color.ts` |
| `src/fs/` | `types.ts`、`index.ts`（代理）、`mock.ts`、`web.ts`、`tauri.ts`、`mock-samples.generated.ts` |
| `src/state/` | `store.ts`、`settings.ts`、`treeOps.ts` |
| `src/components/` | 全部 Vue 组件 |
| `src-tauri/src/lib.rs` | Rust 文件系统命令 + git 用户名 |
