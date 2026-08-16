# 批注与评论（M6）

> 核心代码：`editor-app/src/annotations/`（service.ts / nodes.ts / plugin.ts / remark-annotation.ts / card.ts / user-name.ts / card-color.ts）+ `components/AnnotationDrawer.vue`。
> 设计文档：`editor-app/docs/design.md` §M6（v3 抽屉模式起为最终形态）。
> 一句话：**给文档加"评论线程"**——选中文字打批注，像 PR review 一样回复、标记已解决；校验违规以只读批注形态复用同一抽屉。

## 1. 两种批注

| 类型 | persist | 来源 | 表现 |
|---|---|---|---|
| 运行时批注 | `false` | 校验违规等动态场景（`setRuntimeAnnotations` 整体替换） | 只读卡，无回复/删除，不落盘 |
| 人工批注 | `true` | 用户添加（Toolbar / Ctrl+R） | `<mark data-note>` 节点，随保存序列化到 md |

## 2. 语法：`<mark data-note>`

```markdown
这段文字<mark data-note="[{&quot;a&quot;:&quot;张三&quot;,&quot;c&quot;:&quot;这里要改&quot;,&quot;t&quot;:1750000000000}]">需要批注</mark>。
```

- `data-note` 存**评论线程 JSON**（短字段压缩）：

| 字段 | 含义 |
|---|---|
| `a` | author 用户名 |
| `c` | content 评论内容（纯文本，不做 markdown 渲染） |
| `t` | createdAt 时间戳 |
| `r` / `rt` / `rb` | resolved / resolvedAt / resolvedBy |

- remark 路径的 note 值含 HTML 实体（`&quot;` 等）→ `parseThread` 先 unescape 再 JSON.parse；**兼容旧版纯文本 note**（无 JSON 时按单条评论处理）。
- round-trip 已验证：节点随保存序列化进 md，重新打开还原成批注。

## 3. 使用说明（用户视角）

### 添加批注

- **选中文本 → 工具条「添加批注」**（与加粗/标黄并列）→ 输入浮窗 → 回车（Ctrl+Enter）提交。
- **Ctrl+R**：选中文字后快速弹出评论输入浮窗（document keydown capture + preventDefault，绕过浏览器刷新）。

### 批注抽屉（AnnotationDrawer）

- 固定右侧，默认宽 300px，可拖拽调整（50–480px，宽度存设置）；头部可整体折叠（折叠为窄把手）。
- 头部计数：error / warning / comment 三类。
- **人工批注卡**：锚定文本预览 + 评论线程列表 + 回复输入框 + 状态圆。
- **校验违规卡**：只读（错误红/警告橙），点击定位到文档位置；无位置的整体违规（`from=-1`）仅展示。
- **评论线程规则**：
  - 评论**不可删除**（线程保留）；
  - 回复：Enter 换行 / **Ctrl+Enter（Cmd+Enter）提交** / **ESC 清空草稿**（显式 @keydown，不依赖 Vue 修饰符）；
  - **已解决**：评论人-时间行右侧空圆 ○ = 未解决，点击变 ✔ 绿圆 = 已解决；**仅创建人（用户名匹配）可点**，非创建人圆淡化不可点；再点可重新打开。
- **连线**：抽屉左边缘 → 激活批注锚点（默认淡化 0.22，悬停卡或锚点突出 0.95）；点击批注卡 = 定位 + 激活（连线跟随）+ 展开/折叠。
- 折叠态仍显示评论列表，只隐藏输入框和发送按钮。

### 用户名

- Tauri 下目录是 git 仓库 → Rust 命令 `git_user_name`（`git config user.name`）。
- web/mock → 设置「批注用户名」（默认「我」）。

## 4. 主要实现方式

### 节点与解析

- `nodes.ts`：`$nodeSchema('annotation')`——inline 容器，`content: 'text*'`，attrs `{ note }`，渲染为高亮 mark；`remark-annotation.ts` 把 `<mark data-note>` 合并为 annotation mdast。
- schema marks 名称是 `emphasis` / `inlineCode` 而非 `em` / `code`（M6 踩坑）。

### 运行时批注（decorations）

- `plugin.ts`：非空范围 inline 高亮；**空范围降级锚定行**（violationAt 空范围 → 所在 block 容器 tr/段落整块高亮）。
- `service.ts` `setRuntimeAnnotations(tabId, list, editor)`：整体替换 + 空事务 `setMeta('annotationRefresh')` 触发重算。
- 定位：`posAtDOM` 对 inline 节点返回内容位置（偏移 1）→ 减 1 找 annotation 节点（M6 踩坑）。

### 服务操作

| 函数 | 作用 |
|---|---|
| `addAnnotation(editor, from, to, content, author)` | 选区替换为 annotation 节点（创建首条评论） |
| `addComment(editor, pos, content, author)` | 追加回复 |
| `setCommentResolved(editor, pos, commentId, resolved, by)` | 标记已解决/重开（仅创建人） |
| `removeAnnotationNode(editor, pos)` | 删除整个批注（保留锚定文本） |
| `getAllAnnotations(doc, tabId)` | 运行时 + 持久化合并（抽屉数据源） |

- 激活状态（抽屉 + 连线）：`setActiveAnnotation(tabId, id)`，订阅广播。
- 切标签时 `setAnnotationCardContext` 跟随活动编辑器（Ctrl+R/批注卡作用于当前编辑器）。

### 校验集成

`validate/service.ts` 把违规映射为运行时批注：`{ id: ruleId-pos-i, from, to, anchorText:'', level, thread:[{author:'校验', content:message}], persist:false }`——替换了原 validate/plugin.ts 的 decorations 通道。

## 5. 关键文件

| 文件 | 职责 |
|---|---|
| `service.ts` | 批注 CRUD / 线程序列化 / 运行时批注 / 激活状态 |
| `nodes.ts` | annotation 节点 schema |
| `remark-annotation.ts` | `<mark data-note>` mdast 解析 |
| `plugin.ts` | 运行时批注 decorations（高亮/锚定行） |
| `card.ts` | 批注卡上下文 / 添加批注输入浮窗（showAnnotationInput） |
| `user-name.ts` / `card-color.ts` | 用户名解析 / 级别配色 |
| `components/AnnotationDrawer.vue` | 抽屉 UI（650 行） |
| `editor/features.ts` | Toolbar「添加批注」入口 |
