# WriteIt Legacy Editor — Agent Instructions

本目录是 WriteIt v1 legacy 实现，技术栈为 Vue 3 + Vite + Tauri + Milkdown/Crepe。它不是 v2 的开发主线，除非用户明确指定，否则不要在这里实现新架构或新功能。

## 适用范围

- 这里的规则只适用于 `editor-app/`。
- v2 任务应改动 `writeit-v2/`，并遵循根目录 `AGENTS.md` 与 `writeit-v2/docs/IMPLEMENTATION_SPEC.md`。
- 允许读取本目录作为行为、fixture、测试和边界案例参考。
- 禁止从 `writeit-v2/` runtime import 本目录。

## 架构参考

- FS 抽象为 `FileSystem` 接口（mock / web / tauri 三实现，可切换代理）。
- 多标签使用每标签独立 Crepe 实例；切标签只切容器可见性；内容通过 `getMarkdown()` 读取、`replaceAll()` 注入。
- CodeMirror 代码块使用 IntersectionObserver 懒加载；未进入可视区显示 placeholder 属于正常行为。
- Mermaid 使用 `renderPreview` 钩子和 `buildMenu` slash 命令（见 `src/editor/mermaid.ts`）。
- Tauri 目标平台为 Windows（NSIS）；本环境仅以 `cargo check` 验证 Rust 壳，打包在 Windows 上完成。

## 测试

- E2E 驱动使用 ego-lite（ego-browser），不要引入 Playwright。
- 套件位于 `tests/e2e/`，需要 Vite `:5173`。
- 全量：`npm run test:e2e`；单套件：`node tests/e2e/_run-one.js <name>`。
- 组合键使用 `L.press('Control+e')`；实体级菜单使用 `ArrowRight`；跨套件使用 `L.freshApp()`。
- 等待优先使用 `L.waitFor(predicate, timeout)`；只对动画或渲染保留短暂固定等待，不能用等待掩盖状态问题。
- harness 复用有限 lane；不要删除最后一个 task space、调用 `completeTaskSpace(...,{keep:false})`，或启动多个独立长期 runner。
- 若出现人工接管、`Task space not found`、CDP/reload 超时或 `Unexpected token 'import'`，先按环境故障处理，重启 ego-lite 后重跑，不得删除测试案例或修改产物规避。

## 调试钩子

现有 legacy 调试钩子包括：

`__editorDebug()` / `__editorGetMarkdown()` / `__editorGoEnd()` / `__editorSetRefPath(old,new)` / `__editorSelectCodeBlock()` / `__refMenuState` / `__refMenuPerf` / `__mockFsDebug()`。

这些钩子和 `.pi/skills/writeit-debug` 的协议仅服务 legacy，不得作为 v2 的架构接口。

## Legacy 经验

1. walk 未命中返回 `[]` 是真值；需要区分时返回 `null` 并检查 `found !== null`。
2. 插入后位置可能漂移；用 ProseMirror 节点对象引用定位新节点。
3. flip 中间件测得 0 高时，树加载后手动用 fixed 策略 `computePosition`，不要用会递归 `onShow` 的 `provider.update`。
4. `inst.el` 是 `.editor-pane` 自身；嵌套容器中滚动时手动计算 `scrollTop`，标题置于上方约 15%。
5. 编辑器挂载是异步的；打开文件后等待 `waitForInstance` 再操作。
6. IME 组合文本用 `beforeinput` 跟踪；全角符号（＠！【）先归一化再匹配。
7. 多标签共享 `window` keydown 时用 `hasFocus` 和 `data-show` 守卫，防止 Enter 双重触发。
8. esbuild-wasm 初始化和首次 transform 各约 450ms；可在启动时后台预热。
9. mock 示例升级使用 `SEED_VERSION` 和 `FORCE_UPDATE_PATHS`；以 `seededVersion` 与模板缺失双条件兜底。

触发词匹配取终点离光标最近的候选，避免段落旧 `[[` 抢占。实体级包括文件本身、suggest 对象和 Obsidian 标题；`![[` 嵌入与断链替换不进实体级。引用 chip 显示完整路径，悬停使用自定义 tooltip，不用原生 `title`。
