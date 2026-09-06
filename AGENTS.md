# Agent.md — WriteIt 工作区操作手册

> 本文件定义**整个项目**的结构、权限与约定，Pi 照此执行；仅在用户明确要求时更新规范。
> 项目主线是 `editor-app/` 编辑器应用的开发；`raw/` + `wiki/` 知识库只是信息参考（操作手册在 `KB.md`，仅按需阅读）。

---

## 1. 目录结构与权限（全项目）

```
writeIt/
├── editor-app/        # 主应用（Vue3 + Vite + Tauri + @milkdown/crepe）——开发主线
│   ├── src/           #   editor/ fs/ annotations/ validate/ template/ git/ search/ export/ diagnostics/ components/ state/
│   ├── src-tauri/     #   Tauri Rust 壳（目标平台 Windows / NSIS）
│   ├── tests/         #   e2e（ego-browser 驱动）/ unit
│   ├── scripts/  vite-plugins/   # 构建/脚本/插件
│   └── package.json / vite.config.ts / dist/
├── doc/               # 顶层功能文档（历史文档，即将清理）
├── raw/               # 知识库源语料。只读。用法见 KB.md
├── wiki/              # 知识库生成层。可读写。用法见 KB.md
├── README.md
├── Agent.md           # 本文件（项目操作手册）
└── KB.md              # 知识库操作手册（仅按需阅读）
```

**权限（硬规则）**
- `editor-app/` → **开发主线**。Pi 可在 human 要求下修改代码 / 依赖 / 构建 / 打包 / 测试。
- `raw/` → **只读**，绝不写 / 改名 / 删。
- `wiki/` → 可读写（仅在处理知识库时）。
- `doc/` 与 `editor-app/docs/` → **历史文档，即将删除。不要引用或依赖其内容**；等清理后删除。
- `AGENTS.md` / `KB.md` → 默认不修改；用户明确要求时可更新 `AGENTS.md`，`KB.md` 仍需人工维护。

## 2. 知识库（索引）

知识库只是信息参考，操作手册见 **`KB.md`**。需要维护或查询知识库时再读它，主线上无需关注。核心一句话：`raw/` 只读、`wiki/` 维护 `index.md`/`log.md`、用 `[[wikilinks]]`。

## 3. 约定（全项目通用）

- 与用户全程**中文**交流；重大改动**先讨论方案再实现**（用户多次强调）。
- **安全**：浏览器 bundle **绝不内嵌 LLM API key**（BYOK `dangerouslyAllowBrowser:true` 或后端代理）。
- 改代码/改依赖后 `npm run build` 验证。

## 4. 研发经验速览（editor-app）

### 架构要点
- FS 抽象为 `FileSystem` 接口（mock / web / tauri 三实现，可切换代理）。
- 多标签 = 每标签独立 Crepe 实例（独立撤销历史，切标签只切容器可见性）；内容只经 `getMarkdown()` 取、`replaceAll()` 注入。
- CodeMirror 代码块为 **IntersectionObserver 懒加载**：滚动到可视区才初始化，未显示只渲染 placeholder，属正常。
- Mermaid：`renderPreview` 钩子（mermaid 代码块预览）+ `buildMenu` slash 命令（见 `src/editor/mermaid.ts`）。
- Tauri 目标平台为 **Windows**（NSIS）；本环境是 Linux，Rust 壳仅 `cargo check` 验证，打包在 Windows 上做。

### 测试（改代码后必跑）
- 驱动仅用 ego-lite（ego-browser），严禁引入 Playwright。套件位于 `editor-app/tests/e2e/`，需 Vite :5173。
- 全量：`npm run test:e2e`；单套件：`node tests/e2e/_run-one.js <name>`；共享库：`_egolite-lib.js`。全量必须保留所有案例，优化只改等待、隔离和调度。
- 组合键走 `L.press('Control+e')`；实体级菜单用 `ArrowRight`。跨套件用 `L.freshApp()`。
- 等待优先 `L.waitFor(predicate, timeout)`，只对动画/渲染保留短暂固定等待；断言应等待状态而非等待时间。

### ego-lite 资源使用规范（必守）
> task space 同时占用浏览器上下文和渲染资源。关闭最后标签或 `completeTaskSpace(...,{keep:false})` 会触发“删除这个空间？”原生弹窗；弹窗堆积会阻塞 ego-lite。
- harness 固定复用有限 lane：每个 lane 只保留一个 task space，套件结束不删空间、不关闭最后标签；不要在脚本中调用 `completeTaskSpace(...,{keep:false})`。
- `run-all.js` 使用有界微批和固定 lane；不要并行启动多个独立 runner，也不要手写长期驻留的 ego-browser 进程。
- 发现“人工接管”、`Task space not found`、CDP/`reload` 超时或 `Unexpected token 'import'`，先视为环境假象：停止当前批次，重启 ego-lite 后重跑失败批次；不要删测试案例或修改产物来规避。
- 重跑前确认没有遗留的独立 runner；正常全量以“全部案例通过、无页面错误、无删除弹窗、总耗时 ≤300 秒”为门禁。

### 调试钩子（window 上）
`__editorDebug()` / `__editorGetMarkdown()` / `__editorGoEnd()` / `__editorSetRefPath(old,new)` / `__editorSelectCodeBlock()` / `__refMenuState` / `__refMenuPerf` / `__mockFsDebug()`。

### 关键踩坑速查
1. walk 未命中返回 `[]` 是真值 → 返回 `null` + `found !== null`
2. 插入后位置漂移 → 用 ProseMirror 节点对象引用定位新节点
3. flip 中间件测 0 高（异步渲染）→ 树加载后手动 computePosition（fixed 策略），别用 provider.update（会 onShow 递归）
4. 滚动：`inst.el` 是 `.editor-pane` 自身；scrollIntoView 在嵌套容器不可靠 → 手动算 scrollTop（标题偏上 15%）
5. 编辑器挂载异步 → 打开文件后 waitForInstance 再操作
6. IME：组合文本用 beforeinput 跟踪；全角符号（＠！【）归一化再匹配
7. 多标签共享 window keydown → 用 hasFocus + data-show 守卫防 Enter 双重触发
8. esbuild-wasm 初始化+首次 transform 各 ~450ms → 启动后台预热
9. mock 示例升级：SEED_VERSION 版本化 + FORCE_UPDATE_PATHS 强制覆盖；`seededVersion` 与「模板缺失」双条件兜底

### 开发约定
- 触发词匹配：`matchTrigger` 取「终点离光标最近」的候选（段落旧 `[[` 不抢占）。
- 实体级 = 文件本身 +（suggest 对象 / Obsidian 标题）；`![[` 嵌入与断链替换不进实体级。
- 引用 chip 显示完整路径；悬停用自定义 tooltip（`ref-tooltip.ts`），不用原生 title。
