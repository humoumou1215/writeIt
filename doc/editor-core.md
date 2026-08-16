# 编辑器核心（多标签 / 保存 / 脏检测 / 源码模式）

> 核心代码：`editor-app/src/editor/manager.ts`（约 1100 行）+ `components/EditorPane.vue` + `components/TabBar.vue`。
> 这是全应用的心脏：标签生命周期、保存事务、脏检测、文件树联动、自动保存都在这里。

## 1. 多标签：每个标签一个独立编辑器

### 生命周期

```
打开文件 openTab(path)
  ├─ 已存在同 path 标签 → 直接 activateTab（不重复打开）
  ├─ fs.readFile → 建 Tab 记录（savedContent = 磁盘内容）
  └─ push 进 state.tabs → EditorPane.vue mount → mountEditor(tabId, container)
       ├─ 等 templateService.ready()（斜杠菜单「模板」组依赖）
       ├─ 组装 refCfg（fs/toast/模板服务/回调注入）
       ├─ new Crepe({ root, defaultValue, features, featureConfigs })
       ├─ use(refPlugin / annotationPlugin / validatePlugin)
       ├─ create() → 异步 resolveRefs（物化引用）+ refreshBrokenState + 打开时静默校验
       └─ 记录 blockSnapshot（脏检测第二条件基准）+ userEditedAt = 0

切标签 activateTab(id)      → 只切容器 display:none↔block，实例不动
关闭标签 closeTab(tabId)     → 脏则确认 → unmountEditor（destroy + 清理校验/批注）→ 激活邻居
```

- **为什么独立实例**：每标签各自的撤销历史、光标、滚动位置互不影响——这是多标签编辑的核心体验。
- 打开文件后侧边栏**自动收纳**（除非已 📌 固定）。

### 容器

`EditorPane.vue` 的根元素 `class="editor-pane"` 就是滚动容器（`overflow:auto`）。注意：**`inst.el` 自身就是 `.editor-pane`**，`querySelector('.editor-pane')` 查不到自己——代码里用 `classList.contains` 判断自身，这是滚动定位的关键坑。

## 2. 保存流程（`saveTab`）

```
saveTab(tabId)
  ├─ 源码模式 → ensureDocSynced()（textarea 最新内容 replaceAll 回 doc）
  ├─ 校验新鲜化（silent）+ strict 门禁：有 error 违规 → ConfirmDialog「仍然保存？」
  ├─ IME 防御：view.composing 时先 blur→focus 强制上屏（防组合文本丢失）
  ├─ §6.7 写回事务：writeBackBlocks() —— 把可编辑嵌入块内容写回源文件（差异才写）
  ├─ fs.writeFile(tab.path, getMarkdown())     ← 唯一写盘出口
  ├─ suppressing=true → savedContent=md · blockSnapshot 重录 · dirty=false
  └─ 广播：
       ├─ 写回的源文件 → 源标签（若打开且无用户编辑）刷新 + 脏灭
       └─ 本文件是某嵌入块的源 → 其他标签 block 物化刷新 + 块快照同步
```

### strict 门禁

`mode: 'strict'` 的模板 + 存在 error 级违规 → 弹出确认框（可取消/仍然保存）。hint 模式不阻止。见 [校验机制](validation.md)。

### 保存失败的降级

- `fs.writeFile` 失败 → toast「保存失败」并返回 false（**不**清脏标记）。
- 写回块失败 → toast 降级，不阻断主文件保存。

## 3. 脏检测（双条件）

```
dirty = (getMarkdown() !== savedContent) || hasBlockChanges(editor, blockSnapshot)
```

- **条件一**：Markdown 规范化内容 ≠ 保存基准。
- **条件二（§6.7）**：任一可编辑嵌入块的内容 ≠ 保存时快照——解决"只编辑嵌入块、宿主文档文本没变"时脏灯不亮的问题。

### suppressing 机制

打开、保存、联动刷新等**程序化操作**会把 `inst.suppressing` 置 true，期间 `markdownUpdated` 回调直接 return，避免把程序性 dispatch 误判为用户编辑。解除在 `setTimeout(0)` 后，等一帧。

### 用户输入时间戳模型（§6.7）

- DOM `input` 事件（键盘/粘贴/IME 上屏）→ `userEditedAt = Date.now()`。
- 联动/写回刷新 → `lastExternalSyncAt`。
- 判断"源标签是否有用户编辑"用 **`userEditedAt <= lastExternalSyncAt`**（时间戳），而不是字符串比较——round-trip 差异会坑掉内容比较。

## 4. 源码模式（M7，`Ctrl+E`）

每标签独立视图模式开关：所见即所得（Crepe）↔ Markdown 源码（textarea 覆盖层）。

```
进入源码：textarea.value = getMarkdown() · 隐藏 .milkdown · 光标置末尾
退出源码：ensureDocSynced() → 显示 .milkdown → 焦点还给编辑器
```

- **textarea 懒创建**（`ensureSourceTa`），Tab 键插入两空格。
- 源码编辑**不经过 ProseMirror doc**，因此不触发 `markdownUpdated`——脏标记由 textarea 的 input 事件自行维护（对比 `savedContent`）。
- 保存/校验/定位等**读 doc 的操作前必调 `ensureDocSynced`**：把 textarea 最新内容 `replaceAll` 回 doc（不切换模式）。
- 源码模式下 Ctrl+S 等全局快捷键放行（`data-source-ta` 属性特判）。
- inline-code 快捷键让位：`Mod-e` 改绑 `Mod-Shift-e`（源码模式 Ctrl+E 冲突）。

## 5. 自动保存

`ensureAutoSaveLoop()`：500ms 定时器，对每个 `dirty && 距上次修改 >= autoSaveDelay && 实例存在` 的标签调用 `saveTab`。延迟可在设置里选 1/2/5/10 秒（按最后修改时间防抖）。

## 6. 引用相关联动（挂在 manager）

| 场景 | 行为 |
|---|---|
| 重命名文件/目录 | `updateRefsAfterRename`：遍历所有打开文档，更新 `file_ref/object_ref/file_block` 节点的 path 属性（只读嵌入块跳过，自然断链提示重选）；已打开的同路径标签同步改名（`onFileRenamed`） |
| 删除文件 | `onFileDeleted`：关闭受影响标签；`refreshBrokenAll` 重扫断链 |
| 嵌入块编辑 | `scheduleExternalSync`（600ms 防抖）→ 源标签（打开且无自身编辑）实时刷新内容 |
| 文件树变化 | `refreshTree` 后自动 `templateService.rescan()`（模板热扫描） |

## 7. 调试钩子（window 上）

测试与排障常用（详见 [测试体系](testing.md)）：

- `__editorDebug()` 活动编辑器 · `__editorGetMarkdown()` 当前 md · `__editorGoEnd()` 光标到文档末尾
- `__editorSetRefPath(old,new)` · `__editorOpenPath(p)` · `__writebackDiag()` 写回状态机诊断
- `__mockFsDebug()` mock 数据摘要（seededVersion / 模板文件清单）
