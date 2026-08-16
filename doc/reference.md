# 引用机制（M1-M3）

> 核心代码：`editor-app/src/editor/ref/`（nodes.ts / remark-ref.ts / resolve.ts / writeback.ts / app-plugin.ts / menu/ / ref-tooltip.ts / stringify.ts / config.ts / styles.css）。
> 里程碑：M1 语法与节点 → M2 触发菜单 → M3 文件树联动。
> 设计文档：`editor-app/docs/design.md` §6。

## 1. 语法表

| 语法 | 含义 | 渲染 |
|---|---|---|
| `doctype:value`（首行） | 声明文档类型（模板关联键） | 弱化只读行 |
| `[[path]]` | 文件链接 | chip（📄 完整路径） |
| `[[path#fragment]]` | 标题 / 对象引用（# 消歧） | chip（📄 path#frag），命中模板对象时升级为 object_ref |
| `![[path]]` | 整文件嵌入（可编辑） | 卡片 NodeView，内容物化 |
| `![[path\|ro]]` | 只读嵌入 | 卡片 NodeView，只读守卫 |

- 全角符号（＠！【】）自动归一化触发。
- Obsidian 风格路径补全：`path` → 依次尝试 `path` / `path.md` / `.markdown` / `.txt`；无目录前缀时全工作区按文件名搜索。

## 2. 节点设计（`nodes.ts`，§6.3）

4 个自定义 ProseMirror 节点，均经 `$nodeSchema` 注册并带 parseMarkdown / toMarkdown：

| 节点 | group | 关键 attrs | 说明 |
|---|---|---|---|
| `doctype` | block, atom | `value` | 首行 `doctype:x`，弱化渲染 |
| `file_ref` | inline, atom | `path`, `fragment` | `[[path]]` / `[[path#frag]]` |
| `object_ref` | inline, atom | `path`, `object`, `resolvedText`, `label`, `fragment` | 由 resolve 阶段从 file_ref 消歧生成；`parseMarkdown: () => false`（不直接从 md 解析） |
| `file_block` | block, `content: 'block+'` | `path`, `readonly` | `![[path]]`；解析时为空容器，内容由 resolve 物化；序列化**只输出标记行**（单一真相源） |

关键点：
- **stringify 防转义**（`stringify.ts`）：toMarkdown 输出自定义 mdast 节点（`fileRef` / `fileBlockMarker` / `objectRef`），由注册的 handler **原样写出**，避免 `[[` 被 markdown 转义。
- **file_block 只读守卫**（`app-plugin.ts` 的 `readonlyGuardPlugin`）：过滤一切"选区在只读容器内且触碰容器范围"的事务；程序化物化等事务放行。
- 嵌入块 NodeView（`file-block-view.ts`）：头部徽标（📄 路径 + 🔒/✏️）+ 内容区；点击块任意部分强制聚焦编辑器并移入光标。

## 3. 两段式解析（`resolve.ts`，§6.4）

```
解析阶段（同步，remark-ref.ts）
  [[…]] / ![[…]] / doctype: → 生成暂态节点（file_block 容器为空）
resolve 阶段（异步，打开文档 / 插入后调用 resolveRefs）
  1. file_block 物化：readRefFile(源) → parser → replaceWith 填入容器
       · 倒序处理（避免位置漂移）；深度 > 3 截断提示
       · 物化后强制重建视图（domObserver.forceFlush）——否则块内输入失效
  2. file_ref#fragment 消歧：读目标 → doctype → 模板 suggest 对象命中？
       · 命中 → 替换为 object_ref（resolvedText = suggest.resolve(ctx)）
       · 未命中 → 保持 Obsidian 标题链接
  3. object_ref 定型：运行 suggest.resolve(ctx) 填充 resolvedText
容错：任何失败只标记/提示，绝不中断编辑器（§7.1）
```

- 源内容缓存：`contentCache`（上限 60 条，LRU 近似），保存后 `cacheRefFileContent` 更新。
- `resolveRefs` 在打开文档、插入引用、模板插入后、源码模式同步后调用。

## 4. 触发菜单（M2，`menu/`）

基于 `slashFactory + SlashProvider`（Crepe 斜杠菜单同款范式），输入 `@` / `[[` / `![[` 浮出**三级递进菜单**：

```
第一级  模式选择器（link / embed / embed-ro）
第二级  文件树逐级发现（当前目录 + 子目录 + 文件，过滤 . 开头隐藏目录）
第三级  实体级（选中文件后懒加载）：
          · 有 suggest.ts → 模板对象实体（◆ 图标）
          · 无 → Obsidian 标题实体（# 图标）
          · 首项恒为文件本身（📄）
```

- **触发检测**（`core.ts` `matchTrigger`）：收集全部候选（`![[` / `[[` / 边界感知的 `@`），取**终点离光标最近**者——段落里更早的旧 `[[` 不抢占新输入。
- **recentTyped**：beforeinput（insertCompositionText）跟踪，验证触发词是刚输入的（IME 组合文本 keydown 记不到）。
- **triggerKind**：仅触发词变化时重置模式，不覆盖用户手动切换。
- **菜单导航**：Tab 切模式 / ← 返回上级或清过滤 / → 进入目录或文件实体级 / Enter 选中 / Backspace 返回上级；← 返回恢复到进入前 hover 的目录/文件。
- **插入**：直接建节点（非文本）——file_ref 插入节点、file_block 自动劈分段落（非空段落 `split`，空段落整段替换）；插入后按**节点对象引用**重定位新块（位置会漂移，不能按 pos 猜）。
- 多标签下多个菜单实例共享 window keydown → `hasFocus + data-show` 双守卫，防 Enter 双重触发。
- 菜单状态调试钩子：`__refMenuState` / `__refMenuPerf`（打开耗时）。
- 菜单内核（`core.ts`）同时被 **mermaid 代码块 @ 联想**复用（见 [Mermaid 图表](mermaid.md)）。

## 5. 文件树联动（M3）

| 能力 | 实现 |
|---|---|
| chip 点击跳转 | `createRefClickPlugin`：`a.ref-file` 点击 → `cfg.openFile(path, fragment)` → openTab + scrollToHeading（# 片段平滑滚动，手动算 scrollTop，标题在可视区顶部下方 15% 处） |
| object_ref 点击 | `span.ref-object` → 打开目标 + 按 fragment 跳转 |
| 断链检测 | `brokenRefPlugin`：decorations 红色警告态 + title 提示；`refreshBrokenState` 异步重扫（存在性缓存） |
| 断链重选 | 断链 chip 点击 → `reSelect` 回调 → `openReplaceMenu`（替换模式，选中后原地替换节点） |
| 重命名联动 | `updateRefsAfterRename`：遍历所有打开文档更新引用节点 path（目录前缀匹配 `startsWith(old + '/')`）；只读嵌入块跳过 |
| 悬停浮窗 | `ref-tooltip.ts`：自定义 tooltip（📄 路径 — 点击打开 / 🔗 对象名（路径）/ ⚠️ 文件不存在），替代原生 title |

## 6. 嵌入块写回事务（§6.7，`writeback.ts`）

保存 = **提交宿主文档 + 全部被引用文件变更（原子）**：

```
saveTab
  ├─ collectBlockContentsSync：序列化所有可编辑 file_block 内容
  │    · 不用 getMarkdown(range)（slice 在嵌套上下文会输出标记行）
  │    · 直接取 file_block 的 content 包成临时 doc 序列化，并做 round-trip 稳定化
  ├─ writeBackBlocks：与源文件对比（读缓存），仅写差异；按真实路径写（补扩展名）
  ├─ 更新内容缓存 + 广播 broadcastBlockRefresh：其他打开该源文件的标签重新物化
  └─ 源标签（打开且无用户编辑 userEditedAt<=lastExternalSyncAt）→ 刷新 + 脏灭
```

- **只读变体不参与写回**；同源多处引用以最后一处为准（内容一致时无差异）。
- 双向：本文件是某嵌入块的源文件 → 保存后其他标签的块刷新物化。
- 编辑嵌入块时的**实时联动**：600ms 防抖 → 源标签（无自身编辑）内容即时刷新。

## 7. 使用说明（用户视角）

1. 输入 `@` 或 `[[` 选择文件 → 生成链接 chip；`![[` 生成嵌入块。
2. 选中文件后按 `→`（或点击）进入实体级：有模板建议选「对象」（自动解析填充值），否则选「标题」。
3. 点击 chip 跳转目标文件（# 锚点平滑滚动）；断链 chip 显示红色，点击重新选择。
4. 嵌入块可直接编辑内容，保存时自动写回源文件；`|ro` 后缀生成只读嵌入。
5. 重命名/删除文件时，所有打开文档的引用自动联动；`🎯 定位` 在文件树中高亮当前文件。

## 8. 关键文件

| 文件 | 职责 |
|---|---|
| `nodes.ts` | 4 个自定义节点 schema |
| `remark-ref.ts` | mdast 解析（`[[`/`![[`/doctype → 节点） |
| `stringify.ts` | 防转义序列化 handler |
| `resolve.ts` | 两段式物化 + 对象消歧 |
| `writeback.ts` | 写回事务 + 双向广播 + 块快照脏检测 |
| `app-plugin.ts` | 点击跳转 / 只读守卫 / 断链装饰 |
| `menu/core.ts` | 触发检测 / 树缓存 / 实体加载 / 导航状态机（共享内核） |
| `menu/index.ts` + `RefMenu.vue` | 正文触发菜单 |
| `ref-tooltip.ts` | 自定义悬停浮窗 |
| `config.ts` | refConfigCtx 依赖注入定义 |
