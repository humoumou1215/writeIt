# WriteIt v2 — UX_SPEC（界面与交互说明）

**Status: DRAFT BASELINE — 供用户持续确认**
**Audience: 产品所有者、Pi-Agent、开发者、测试者**

> 这份文档不要求你懂设计工具，也不要求你懂 CodeMirror、Vue 或编辑器内部实现。
>
> 你只需要判断四件事：
>
> 1. 页面是不是这样摆；
> 2. 按钮/菜单是不是应该这样出现；
> 3. 我点下去或按键后，是不是应该发生这些事；
> 4. Markdown 在编辑区里是不是应该这样显示。

如果这里写的体验与你想要的不一样，**优先改这份文档，再让 Pi 改代码**。这样可以避免每开发一个功能都重新争论界面。

---

## 1. 这份文档负责什么

`IMPLEMENTATION_SPEC.md` 主要管架构和任务边界，例如“表格不能成为第二份文档数据”。

本文件只管用户体验：

- 主页面怎么布局；
- 哪些按钮长期显示，哪些只在需要时出现；
- 鼠标、键盘、右键怎么操作；
- Live Preview（实时预览）怎么显示 Markdown；
- 表格、引用、Embed、批注、Git Diff 等功能在页面里怎么进入、怎么退出；
- 出错、文件丢失、引用断开时用户应该看到什么。

### 1.1 本文中的几个英文词

为了方便和代码、Pi 任务对应，少量英文保留，但第一次出现都解释：

- **Raw Source（源码模式）**：完整显示 Markdown 原始符号，例如 `#`、`**`、`[[ ]]`。
- **Live Preview（实时预览）**：仍然直接编辑 Markdown，但不需要时隐藏部分符号，让正文更接近最终阅读效果。
- **Widget（编辑控件）**：编辑区里替代部分 Markdown 的可交互显示，例如表格、Mermaid 图、Embed 卡片。
- **Popup（浮动小窗）**：跟着光标出现的小菜单，例如 `@` 引用联想。
- **Hover（鼠标悬停）**：鼠标停在某个位置但还没点击。
- **IME（输入法组合输入）**：中文输入法还在拼字、候选阶段，文字尚未正式提交。
- **Screenshot baseline（截图基线）**：保存一张“正确界面长这样”的测试截图，防止以后界面无意漂移。

---

## 2. UX 的优先级

当几个目标发生冲突时，优先顺序如下：

1. **不能丢 Markdown 数据。**
2. **不能让用户以为保存成功，实际没有保存。**
3. **不能让一个操作产生难以理解的副作用。**
4. **常用操作要快。**
5. **页面要干净，不因为功能多就堆满按钮。**
6. **视觉效果再精致，也不能破坏键盘、复制粘贴、中文输入、撤销等基础行为。**

---

## 3. 主页面布局基线

> 本节是“建议默认布局”。在你正式确认前，它是可以调整的；Pi 不应把临时尺寸写死成不可改变规则。

### 3.1 页面主要区域

WriteIt 的主界面不强制只有“三栏”。为了允许同时看文件、大纲、正文和批注，推荐采用可以独立开关的区域：

```text
┌──────────────────────────────────────────────────────────────────────┐
│ 顶部：工作区 / 标签页 / 少量全局入口                              │
├──────────────┬──────────────┬──────────────────────────┬────────────┤
│ 左侧主栏     │ 左侧大纲     │        中央编辑区        │ 右侧批注等 │
│ File/Search  │ 可独立开关   │ 可单栏或分屏             │ 按需出现   │
│ Git          │ 可独立调宽   │                          │            │
├──────────────┴──────────────┴──────────────────────────┴────────────┤
│ 底部状态栏：字数、引用等用户真正需要长期看到的信息                │
└──────────────────────────────────────────────────────────────────────┘
```

不是每个区域都要同时打开。重点是：**Outline（大纲）不能因为 Annotation（批注）也在右侧就被迫二选一。**

### 3.2 左侧栏

左侧主栏主要承担“找到东西”和“工作区操作”的职责：

- File Tree（文件树）；
- Search（全文搜索）；
- Git 工作区；
- 后续其他导航入口。

规则：

- 可折叠；
- 可拖动调整宽度；
- 支持“自动收纳”，但**默认关闭自动收纳**；
- 自动收纳必须有一个容易理解、状态明显的图标开关，不能藏在深层 Settings；
- 自动收纳开启后，只在用户打开文件或把焦点移入中央编辑区后收起；切换 File/Search/Git、拖动宽度、右键菜单和弹窗交互本身不触发收起；收起后保留明显的展开按钮；
- “定位当前文件”入口容易找到；
- 当前正在查看的文件，在 File Tree 中默认就有持续、但不过分刺眼的突出显示；
- 当前正在查看的文件，如果也出现在 Git changed-files 列表中，Git 列表也默认突出显示；
- Search/Git 只是切换左侧工具，**不能把中央正在编辑的文档关掉或重新创建**。

最后一句的口语解释：

> 例如你正在编辑 `A.md`，然后点左侧 Git 看改动。中央的 `A.md` 仍然保持原来的光标、撤销记录和未保存内容；再切回 File Tree 时，不应该像“重新打开一次 A.md”。

File Tree 的创建、重命名、删除等低频操作优先放右键菜单和局部按钮，不在每一行长期摆很多图标。

### 3.3 顶部 / 标签页

标签页主要表示当前打开的文档：

- 显示文件名；
- dirty（有未保存修改）状态明显但不要喧宾夺主；
- 当前标签清楚；
- 支持关闭按钮；
- **支持双击标签关闭**；
- 双击关闭 dirty 标签时仍然必须出现 Save / Discard / Cancel，不能因为双击而绕过保护；
- 多标签时仍能知道哪个是当前文件；
- next/previous tab、next/previous file 可以用快捷键，不要求长期显示两个大按钮。

不要把大量编辑命令塞进顶部栏。

### 3.4 中央编辑区

这是 WriteIt 最重要的区域。

原则：

- 正文占据最大空间；
- 常用格式不需要一排传统 Word 工具栏；
- `/`、右键、快捷键、局部浮动控件承担大部分命令；
- 编辑 Markdown 时尽量减少“页面在动”“按钮突然挤开正文”；
- 内部 Reference / Embed 跳转支持两种打开方式：
  1. **普通打开**：在当前编辑区域新建或激活一个标签页；
  2. **分屏打开**：保留当前文档，同时在旁边增加一个编辑区域显示目标文档。
- 默认内部跳转方式是普通标签打开；用户可以在 Settings 改为分屏，右键菜单或修饰键必须能临时选择另一种方式。
- 分屏不是复制 Document；同一文档在两个区域打开时仍然共享同一份正文数据。

### 3.5 Outline、右侧面板与并行查看

Outline（大纲）作为独立能力优先放在左侧，可与 File Tree 主栏分别开关、分别调整宽度。

这样用户可以同时看到：

```text
文件树 + 大纲 + 正文 + 批注
```

而不是因为大纲和批注都想占右侧，只能二选一。

Outline 的体验要求：

- hover（鼠标悬停）某个标题时，有轻量突出显示；
- 当前所在标题与普通 hover 状态要能区分；
- 用户滚动正文时，大纲跟随当前文章位置，并自动滚动自身列表，使当前标题尽量保持可见；
- 点击标题后，正文使用自然滚动到合适位置，而不是突然把标题顶到窗口最上沿；
- 自动滚动不能抢用户正在手动滚动大纲的操作；
- Embed 中实际显示出来的标题也应进入“用户看到的大纲”，详见第 9 节组合内容规则。

右侧面板主要承载：

- Annotation（批注详情）；
- Backlinks（反向引用）；
- Diagnostics（诊断）；
- 某些 Git/Review 详情。

规则：

- 按需打开；
- 可以调整宽度；
- 关闭后不改变文档内容；
- 面板打开时中央编辑区应该缩小，而不是盖住到无法输入；
- 右侧能力需要并排时允许后续扩展，但首版不要用“大纲/批注只能二选一”来解决布局冲突。

### 3.6 底部状态栏

底部状态栏可以长期显示真正有用的文档信息，例如：

- 当前文档字数；
- Reference（引用链接）数量；
- Embed 数量；
- 保存中 / 保存失败；
- 当前 Git 分支（启用 Git 时）；
- 重要诊断异常。

这里的“字数、标题、引用数量”不能只统计当前 Markdown 文件的裸源码，而要尽量接近用户实际看到的组合文档。

例如 A.md 中嵌入 B.md：

```text
A.md 正文
![[B.md]]
```

如果 B.md 的正文在当前页面实际显示出来，那么：

- 字数默认包含 B.md 的可见正文；
- B.md 中的标题默认进入 A.md 当前页面的大纲；
- B.md 内继续嵌入 C.md 时可以继续计算；
- 循环嵌入在检测到循环处停止，不无限统计；
- 同一个文件被嵌入两次，用户实际看到两份内容时，统计也按两次计算。

这类“按用户实际看到内容计算”的规则，后文称为 **组合内容**。它只是计算结果，不会把 Embed 内容复制进 A.md 保存。

不要把普通 debug 数据长期显示给用户。

## 4. 按钮、菜单和操作入口的统一规则

## 4. 按钮、菜单和操作入口的统一规则

### 4.1 哪些按钮应该长期显示

只长期显示满足以下至少一条的操作：

- 用户非常频繁使用；
- 不显示就难以发现；
- 当前状态必须一眼可见。

其他操作优先放：

- 右键菜单；
- `/` 快速插入；
- 局部 hover 控件；
- 更多菜单 `...`；
- 快捷键。

### 4.2 图标按钮

图标不应该要求用户猜。

- 第一次不容易理解的图标必须有 tooltip（鼠标停上去显示文字）；
- 危险操作不能只有“垃圾桶图标”且无确认；
- 同一个命令在不同位置尽量使用同一个图标/名称。

### 4.3 右键菜单

右键适合“和当前对象有关”的操作。

例如：

- 文件：rename、delete、copy reference、reveal；
- Reference：open、copy syntax、切换 link/embed 类型；
- Table：添加/删除行列；
- Editor gutter：Git blame；
- Image：preview、copy、reveal。

右键菜单不要混入与当前对象无关的全局功能。

### 4.4 危险操作

以下操作需要特别保护：

- 删除 dirty 文件；
- 删除包含 dirty 子文件的目录；
- 覆盖外部文件修改；
- Git discard/revert；
- 批量 replace；
- 大范围 rename linkage。

用户应该明确知道：

- 会影响什么；
- 可以 Cancel；
- 哪些已经成功，哪些失败。

---

## 5. Raw Source 与 Live Preview

### 5.1 总体原则

`Ctrl+E`（若快捷键最终仍采用该默认值）在同一个编辑器中切换：

```text
Raw Source（完整 Markdown 符号）
        ↕
Live Preview（实时预览）
```

不能创建第二个 textarea 或第二份 Markdown。

用户切换后：

- 内容不变；
- 撤销历史不断；
- 当前大致位置不乱跳；
- selection 尽量保留；
- 不因为切换而保存文件。

### 5.2 Live Preview 的基本显示规则

建议采用一句简单规则：

> **平时尽量像阅读；光标进入正在编辑的结构时，恢复必要的 Markdown 符号。**

这比“永远隐藏所有 Markdown”更适合编辑。

### 5.3 Heading（标题）

建议默认：

源码：

```md
## 项目目标
```

Live Preview，光标不在标题中：

```text
项目目标     ← 按 H2 样式显示，隐藏 ##
```

光标进入该标题：

```md
## 项目目标
```

规则：

- 不因为标题样式改变 Markdown；
- H1/H2/H3 有清楚但不过度夸张的层级；
- 光标进入时符号恢复不能导致整页明显跳动。

### 5.4 Bold / Italic / Strike

例如：

```md
**重点**
*强调*
~~删除~~
```

非编辑状态显示格式效果，可隐藏外围符号。

光标进入具体格式区域时，可以恢复对应符号，让用户知道源文本是什么。

### 5.5 Inline Code（行内代码）

```md
`DocumentStore`
```

Live Preview 显示为明显但克制的 code 样式。

光标进入时允许看见反引号。

### 5.6 Link（普通链接）

```md
[OpenAI](https://example.com)
```

非编辑状态：

- 主要显示 `OpenAI`；
- 可有链接视觉提示；
- hover 显示目标地址；
- 点击行为需要区分“编辑文字”和“打开链接”，避免用户只是放光标却被浏览器打开。

建议：普通单击优先定位/编辑，`Ctrl/Cmd + Click` 或明确动作打开外部链接。最终快捷方式可在实现前确认。

### 5.7 Reference（引用）

```md
[[A.md]]
[[A.md#Heading]]
```

非编辑状态建议显示为紧凑引用样式：

```text
A.md ①
A.md › Heading ②
```

其中 `①`、`②` 是 **显示出来的小角标**，不是写入 Markdown 的字符。

规则：

- 同一个文档中每一个 Reference occurrence（每一次具体出现）都能得到独立角标；
- A.md 两次引用 B.md 时，这两次必须可以分别定位，不能因为目标相同就合并成一个位置；
- Backlinks 页面按来源文件分组时，也要显示这些角标入口，例如 `A.md  ① ②`；
- 点击 Backlinks 中的 `①` 或 `②`，打开 A.md 并自然滚动到对应的那一次 Reference；
- 角标只是从当前文档位置计算出的显示结果，文本增删后可以重新编号，不进入 Markdown source；
- 能看出 Reference 不是普通正文；
- broken reference（断开的引用）明确标红/警告，但不要把原 Markdown 改掉；
- hover 能看到路径/状态；
- 点击按照“普通打开 / 分屏打开”的导航规则打开；
- 进入编辑时可以看到真实 `[[...]]` source。

### 5.8 Editable / Readonly Embed

Embed 应尽量像 Markdown 自己的 blockquote（`>` 引用块），而不是厚重的独立卡片。

例如源码是：

```md
![[doc/A.md]]
```

Live Preview 可以呈现为类似：

```text
> ![[doc/A.md]]
> A 文档第一段……
> A 文档第二段……
```

这里的 `>` 只是视觉层级提示，**绝不能真的把 `>` 写回 Markdown source**。

要求：

- 第一行始终显示真实来源引用，例如 `![[doc/A.md]]`；
- readonly embed 在第一行同时清楚显示 Readonly / 只读状态；如果项目最终有专门的 readonly source syntax，应优先显示真实 syntax，而不是伪造一套 Markdown；
- editable embed 可以直接编辑；readonly embed 明确不可编辑；
- Embed 内容滚动经过窗口顶部时，第一行来源引用使用 sticky（吸顶）效果暂时保留在编辑区顶部，直到整个 Embed 离开当前范围；体验类似 IDE 编辑器显示当前代码结构；
- sticky 第一行只属于显示效果，不改变滚动位置和 Markdown；
- 右键或 `...` 提供 Open source / Open in split / Copy reference / Switch mode。

多层嵌套时，视觉上增加 `>` 层级：

```text
> ![[A.md]]
> A 的内容
> > ![[B.md]]
> > B 的内容
> > > ![[C.md]]
> > > C 的内容
```

同样，这些 `>` 都只是 Live Preview 的视觉表达。

循环嵌套：

```text
> ![[A.md]]
> Circular embed detected / 检测到循环嵌套，已停止继续展开
```

规则：

- 第一行来源链接仍然正常显示和可打开；
- 第二行明确说明循环；
- 到这里停止继续渲染；
- 不假装内容为空，也不无限递归；
- 组合字数、组合大纲等统计也在这里停止向下展开。

### 5.9 List / Task

列表要保持“像 Markdown 文档”，不要过度变成独立组件。

Task checkbox 可以直接点击，但点击结果必须是修改 Markdown 中的 `[ ]` / `[x]`。

### 5.10 Blockquote

用简单竖线/缩进区分，不需要大卡片。

光标进入时必要时恢复 `>` source marker。

### 5.11 Code Fence

普通 fenced code block：

- 清楚显示语言；
- 编辑时仍然是代码 source；
- 不为了漂亮把代码变成不可编辑 HTML；
- fence 错误时回 source。

### 5.12 Image

Live Preview：

- 显示图片；
- 图片加载失败时显示路径和错误，不删除/修改 Markdown path；
- **单击图片本身不直接打开 Preview**；
- hover 图片时显示一组轻量按钮，其中包含明确的 Preview 图标入口；
- 后续可包含 copy / reveal 等按钮；
- 单击图片本身只做轻量 focus/光斑反馈，让用户知道点中了当前图片，不弹大窗口；
- 进入 source editing 时能看见真实 Markdown 图片语法。

### 5.13 Table

Table 的详细规则见第 10 节。

总体上：

- 正常表格 → Live Preview 显示可编辑二维表格；
- 错误/半写完表格 → 不强行修复，安全显示源码；
- Raw Source 始终可以直接编辑 Markdown。

### 5.14 Mermaid

Live Preview 状态下，Mermaid **默认始终显示渲染图**，而不是默认整块显示源码。

同时保留一个折叠的源码编辑区：

- 默认收纳；
- 点击明确入口可展开；
- 再次点击可折叠；
- 展开编辑 source 时，渲染图继续存在并根据编辑结果实时刷新；
- 快速连续输入时允许短暂 debounce（稍等几十/几百毫秒再渲染），但旧渲染结果不能覆盖新 source；
- render error 时保留当前 source，并显示可理解的错误。

与 Image 类似：

- hover 渲染图时显示轻量操作按钮；
- 单击非链接区域只做轻量 focus/光斑反馈；
- 不因为普通单击直接切换成源码。

Mermaid 图中的 WriteIt 内部 Reference / Embed 链接必须保持可点击：

- 点击内部链接按照“普通打开 / 分屏打开”规则导航；
- 链接目标无法解析时显示 broken 状态或提示；
- 不能因为 Mermaid 已经渲染成 SVG/图形，就失去原来的 Reference 语义。

### 5.15 Annotation（批注标记）

正文内主要通过颜色显示批注范围：

- 不改变 source；
- 当前批注颜色可以更明显；
- 非当前批注保持克制；
- 批注详情主要显示在右侧可收纳面板，而不是在正文旁堆很多大卡片；
- 正文批注范围与右侧对应批注卡片之间显示正确的连线；
- 滚动、窗口 resize、正文变化后连线要重新定位；
- 无法可靠定位时宁可显示“无法定位”，不能把线连到错误文字；
- 点击右侧批注卡片，正文自然滚动到对应范围，并短暂突出该范围。

## 6. Popup：`/`、`@`、`[[`、`![[` 联想

## 6. Popup：`/`、`@`、`[[`、`![[` 联想

这些小窗应该有统一体验。

### 6.1 打开

- 跟随光标位置；
- 不挡住当前输入文字；
- IME 组合输入期间不误触发；
- 如果空间不足，允许显示在光标上方；
- Raw Source（源码模式）和 Live Preview 两种模式都必须支持 popup；
- popup **只因为用户刚刚输入触发字符而出现**，不能仅因为光标移动到旧字符旁边就弹出。

明确例子：

- 文档里早就有一个 `@`，用户只是用方向键把光标移动到 `@` 后面：**不触发**；
- 文档里已经存在 `[[a.md]]`，用户只是把光标移进这个链接：**不触发新的 completion popup**；
- 用户此刻真实输入新的 `@`、`[[`、`![[`：正常触发；
- 用户正在一个已存在 Reference 内正常修改文字时，应进入“编辑当前 Reference”的逻辑，而不是重新假装刚输入了 trigger。

### 6.2 键盘

统一支持：

- Up / Down：在当前列表中选择；
- Enter：确认；
- Escape：关闭；
- 继续输入：过滤；
- 鼠标也可以选择。

当 popup 正在浏览文件夹层级时，还支持：

- Right：进入当前选中的文件夹；
- Left：返回刚才进入这个文件夹之前的上一层；
- 返回必须保留真实浏览路径历史，不能简单按字符串猜“父目录”；
- 返回上一层后，尽量恢复之前选中的那个文件夹位置，方便连续键盘浏览。

### 6.3 关闭以后

关闭 popup 不应该：

- 删除用户刚输入的普通文字；
- 意外执行第一个选项；
- 抢走编辑器焦点。

### 6.4 `@` / Reference

候选列表应该让用户看懂：

- 文件名；
- 必要时路径；
- 是 file、heading 还是 object；
- broken/不可用候选不伪装成正常结果。

---

## 7. File Tree 与 Workspace 交互

### 7.1 打开文件

- 单击默认打开；
- 当前文件默认持续突出显示；
- 已经打开的文件不要重复创建另一份 Document；
- reveal current file（定位当前文件）有明显入口；
- Git changed-files 列表中若存在当前文件，也同步用轻量高亮表示“当前正在查看”。

### 7.2 Rename / Move

用户看到一次 rename/move 成功时，应该理解为整个应用都已经承认新路径，而不是“文件树改了，编辑器还记着旧地址”。

因此 UI 成功提示必须建立在 application transaction 完成之后。

### 7.3 Delete

如果文件/目录包含 dirty 文档：

```text
Save / Discard / Cancel
```

必须先处理。

不允许“文件树已经消失，但 tab 还开着一个幽灵文档”。

### 7.4 Drag（拖拽）

File Tree / Workspace 至少支持：

- 拖动文件到另一个目录；
- 拖动目录到另一个目录；
- 拖动经过折叠目录时，可在短暂停留后自动展开目标目录；
- 长列表拖动到边缘时可以自动滚动；
- 不允许拖入自己的子目录形成非法路径；
- move 最终仍走统一 Workspace move 逻辑，不能因为是拖拽就绕过 rename/reference/persistence 处理。

“从文件树直接拖进正文自动创建 Reference/Embed”暂不在这里默认规定，后续如需要再单独确认。

### 7.5 Clipboard

应用内复制文件用于粘贴 Reference 时，不能覆盖用户后来从其他应用复制的普通文字。

普通文本 paste 永远应该保持普通文本，除非能够确认 clipboard 仍然是 WriteIt Reference payload。

## 8. Tabs 与保存状态

## 8. Tabs 与保存状态

### 8.1 Dirty

dirty 状态要一眼可见，但无需使用夸张红色。

### 8.2 Saving / Saved

正常保存成功不需要频繁弹 toast。

建议：

- 保存中：轻量状态；
- 已保存：可短暂显示或通过 dirty 消失表达；
- 保存失败：必须明显并持续到用户注意；
- 外部冲突：必须明确告诉用户，不能静默覆盖。

### 8.3 Close

关闭 dirty tab：Save / Discard / Cancel。

File Tree 删除同样遵守，不允许形成两个不同规则。

---

## 9. Outline / Annotation / Backlinks 与“组合内容”

### 9.1 Outline（大纲）

大纲是左侧独立能力，不和右侧批注强制共用一个位置。

必须支持：

- heading hierarchy（标题层级）；
- hover 突出；
- 当前标题突出；
- 正文滚动时 active heading 跟随；
- 大纲列表自动滚动，使 active heading 尽量保持可见；
- 点击标题后正文自然滚动到合适位置；
- 用户正在手动滚动大纲时，短时间内不要被自动跟随强行抢回位置。

### 9.2 组合大纲

如果当前 A.md 显示了 B.md 的 Embed，而 B.md 中有标题，这些标题也要在 A.md 当前页面的大纲里体现。

建议视觉上保留来源层级，例如：

```text
A 的 H1
  A 的 H2
  ↳ B.md
      B 的 H1
      B 的 H2
```

这里的 `↳ B.md` 是显示层提示，不写进 Markdown。

规则：

- 嵌套 Embed 继续体现层级；
- circular embed 到循环提示处停止；
- 同一文件被嵌入两次时，大纲也保留两次实际出现位置，因为用户页面上确实看到两份；
- 点击嵌入标题时，滚动到当前页面里那一次 Embed 的对应标题，而不是直接跳到另一个错误实例。

### 9.3 Annotation（批注）

批注详情在右侧收纳面板；正文颜色标记与右侧卡片通过连线保持对应。详见第 11 节。

### 9.4 Backlinks（反向引用）

Backlinks 与 Reference 是同一套关系的反向视图。

例如 A.md 中两次引用 B.md：

```text
A.md: ... [[B.md]] ... [[B.md]] ...
```

B.md 的 Backlinks 应至少能显示：

```text
A.md   ① ②
```

点击 `①` 和 `②` 必须分别打开 A.md 并滚动到正确的那一次引用。

不能只保存“某文件引用过我”这一层信息，而丢失具体 occurrence（出现位置）。

## 10. Table UX Baseline

> 这是 P5-00 的直接输入。实现前你可以重点审这一节。

### 10.1 目标

表格应该比现在的普通 Markdown 文本更容易操作，但仍然让用户知道它最终是 Markdown。

### 10.2 Live Preview 显示

正常 Markdown table 在 Live Preview 中显示为二维表格。

建议：

- 默认不显示 `| --- |` 等结构行；
- 表格边框轻，不做 Excel 风格的重 UI；
- hover 当前 cell 时可以有轻量边界；
- 当前编辑 cell 清楚突出；
- 不长期显示每一行每一列的大按钮。

### 10.3 单击 / 双击：两种状态

Table cell 有两种明确状态。

**单击：选中 cell（无光标）**

- cell 整体被选中；
- 不显示文字光标；
- 用户直接输入文字时，覆盖当前 cell 原内容；
- 适合快速填写表格，体验接近 spreadsheet（电子表格）。

**双击：进入 cell 编辑（有光标）**

- 显示正常文字光标；
- 用户可以在已有内容中移动光标、追加、删除和选择文本；
- 输入不会自动把整个 cell 原内容覆盖掉。

单击和双击状态必须在视觉上容易区分，但不要使用过重边框。

### 10.4 键盘规则

**cell 处于“选中、无光标”状态时：**

- `Tab`：下一个 cell；
- `Shift+Tab`：上一个 cell；
- `Enter`：移动到下一行的对应 cell；
- 直接输入：覆盖当前 cell 内容并进入适当编辑状态；
- Arrow keys：在 cell 之间移动选择。

**cell 处于“编辑、有光标”状态时：**

- 普通文字键：正常编辑；
- `Enter`：在当前 cell 中插入一个“显示换行”；
- `Tab`：提交当前 cell 编辑并移动到下一个 cell；`Shift+Tab` 提交并移动到上一个 cell；即使 cell 含显示换行也不改变该行为；IME composition 期间不得提交或移动。

### 表格 cell 内换行如何保存

用户在界面中看到的 cell 可以是真正多行：

```text
请求参数说明第一行
第二行补充说明
```

但标准 Markdown table 不能直接把一个 cell 拆成物理上的两行，否则会破坏表格结构。

P5-00 采用 `<br>` 作为“cell 内显示换行”的持久化表示：

```md
请求参数说明第一行<br>第二行补充说明
```

也就是：

- 界面显示多行；
- Markdown 文件仍然是一行 table row；
- `<br>` 表示 cell 内换行；
- Raw Source 中用户能明确看到这个表示方式；
- Agent 不得自行发明隐藏二进制格式或把换行状态存在 DOM 中。

P5-00 必须用实际 Markdown renderer 与 legacy fixture 验证 `<br>` 的兼容性。如果证据证明不可兼容，可在不改变 Markdown-first 原则的前提下选择另一种可见 Markdown/HTML 表示，并在 Task Contract 与 `DECISIONS.md` 记录理由，不需要暂停整个 Goal。

### 10.5 多 cell 选择

建议支持：

- 鼠标拖选矩形；
- Shift 扩大选择；
- 当前选择区域有统一背景提示；
- Copy 输出 TSV，同时可带 HTML clipboard；
- Paste 多 cell 数据按左上角开始填充。

### 10.6 添加/删除行列

建议不要长期占据工具栏。

首选入口：

- 右键当前 cell；
- hover 表格边缘出现轻量 `+`；
- `/` 或命令系统；
- 可配置快捷键。

P5-00 已确认并实现：表格 hover/focus 时显示轻量 contextual controls；活动 cell 的命令菜单提供 insert-before/after、delete 与 move；工具栏仅在表格上下文出现，命令系统提供相同 command id。row/column grip 也可直接进入整行/整列选择。

### 10.7 Resize / Reorder

这两项现在是 **Table 最终必须具备的能力**，不再标记为可永久延后：

- column resize（拖动调整列显示宽度）；
- row reorder（拖动行排序）；
- column reorder（拖动列排序）。

规则：

- row/column reorder 会改变 Markdown 内容，必须通过 Table Core → DocumentStore 正常修改，并支持 undo/redo；
- column resize 首先是显示层宽度，不得为了视觉宽度无意义改写 Markdown；
- 首版列宽只保存在当前运行时的视图/工作区 UI 状态，不跨应用重启持久化，也不得写入 Markdown；长期保存列宽如未来需要，必须单独设计；
- 拖拽过程中要有清楚的插入位置提示；
- 表格内容很多时仍应能横向查看/调整，不能因为强行平均列宽导致文字完全不可读。

具体键盘、矩形选择、clipboard MIME、IME 与 malformed fallback 合同见 [P5-00 Table UX & Behavior Contract](./P5_00_TABLE_UX_CONTRACT.md)。

### 10.8 错误表格

如果用户正在输入：

```md
| a | b
| ---
```

这种半成品，不应该自动“修好”或删内容。

建议直接降级为源码编辑，等语法重新有效后再恢复 Table Live Preview。

### 10.9 Raw / Live 切换

切回 Raw Source 时必须看到真实 Markdown。

再切回 Live Preview：

- 内容不变；
- undo history 不断；
- 大致编辑位置保持。

---

## 11. Annotation UX Baseline

要求：

- 正文通过颜色标记批注范围；
- 批注详情统一显示在右侧可收纳面板；
- 右侧批注面板默认宽度为 `360px`，可拖动调整；窄窗口下应受可用空间约束，不能覆盖到正文无法编辑；
- 当前 active annotation 卡片突出；
- 每个可定位批注卡片与正文 anchor 之间显示正确连线；
- 页面滚动、panel resize、窗口 resize 后连线重新计算；
- 点击卡片，正文自然滚动到合适位置，并短暂突出目标范围；
- 点击正文批注范围，右侧对应卡片也应进入 active 状态并滚入可见区域；
- 回复框 Enter 发送，Shift+Enter 换行（除非用户后续修改）；
- resolve 后默认弱化/隐藏，但可重新查看；
- anchor 失效时显示“无法可靠定位”，不能把线或卡片指向看似接近但错误的文字。

P6-00 已冻结入口与交互细节：选区通过 context action 创建，右侧 drawer 默认 `360px` 且可收纳/resize；回复 `Enter` 发送、`Shift+Enter` 换行；Resolve/Unresolve 只改变 sidecar review data；正文 mark 与卡片由当前 anchor 几何重新连线，无法唯一重定位时显示“无法可靠定位”。详见 [P6-00 contract](./P6_00_ANNOTATION_MERMAID_UX_CONTRACT.md)。

## 12. Mermaid UX Baseline

### 12.1 Live Preview

- Live Preview 默认始终显示渲染图；
- source 编辑区默认折叠；
- 点击明确入口展开/折叠 source；
- source 展开编辑时渲染图实时更新；
- render error 不隐藏 source；
- hover 图时显示轻量按钮；
- 单击非链接区域只做 focus/光斑反馈；
- `/` 可以插入常用 Mermaid 模板；

P6-00 已确认 Mermaid fenced source 的 renderer lifecycle：图默认显示、source 默认折叠；loading/error 均保留可见 source；关闭或新 revision 到达后旧 render 结果不得覆盖；内部 Reference 继续按普通 tab/split 策略导航。详见 [P6-00 contract](./P6_00_ANNOTATION_MERMAID_UX_CONTRACT.md)。
- fenced block 内 `@` 引用继续使用统一 Reference popup。

### 12.2 Mermaid 中的 Reference

Mermaid source 中使用 WriteIt Reference 的能力必须保留到渲染图：

- 渲染出来的对应节点/链接可以点击；
- 点击按普通打开/分屏打开策略导航；
- broken reference 有明确反馈；
- 渲染只是显示层，ReferenceGraph 仍来自 Markdown source。

### 12.3 Git Diff 中的 Mermaid 图变化

Mermaid Diff 不能只显示“两张图不一样”，用户期望直接看出图中哪些结构新增、哪些删除。

首选视觉语义：

- **绿色**：新增节点/连线；
- **红色**：删除节点/连线；
- 对“修改”可以表现成旧结构红色 + 新结构绿色；如果未来增加第三种颜色，必须先在 UX_SPEC 说明。

例如一个流程图：

```text
before: A → B → C
after : A → D → C
```

Rich Diff（图形增强 Diff）应能表达：

```text
B = removed / 红
D = added   / 绿
相关 edge 也按新增/删除区分
```

关键规则：

- 语义匹配有把握时才画红绿图形；
- 不确定某节点是不是“同一个对象”时，宁可降级为源码 Diff 或 before/after 对照，不允许猜；
- 无论 Mermaid 图形 Diff 成功与否，Raw Source Diff 必须始终完整存在；
- 不同 Mermaid 图类型需要明确 support matrix（支持表），不能宣称“Mermaid Diff 已完成”但实际上只对一个简单 flowchart 有效。

## 13. Git / Diff / Blame UX Baseline

### 13.1 Git 工作台

用户至少可以找到：

- 当前 branch；
- changed files；
- history；
- commit detail；
- compare target。

### 13.2 Diff

首版应同时支持：

- split（左右对比）；
- unified（上下单列）；
- next/previous hunk；
- raw source fallback。

默认显示 unified；工具栏提供 split/unified 切换，并记住当前工作区会话内的选择。

富 Table/Mermaid diff 是增强，不是唯一显示方式。

### 13.3 Blame

用户在编辑区右键可以：

```text
Show Git Blame / Annotate
```

打开以后：

- 行旁紧凑显示作者短名 + 相对日期；
- hover/click 看 commit 信息；
- hover/click 中显示完整作者、精确日期时间、commit id 和 subject；
- 本地未提交行显示 Local/Uncommitted；
- 不确定时显示 Unknown，而不是猜一个旧作者；
- 关闭 Blame 不修改 Markdown。

---

## 14. Search / Replace UX Baseline

建议：

- Search 放左侧主入口；
- 结果按文件分组；
- 单击结果打开文件并定位高亮；
- 当前命中与其他命中区分；
- Replace All 之前清楚说明范围；
- dirty/conflict 文件不能偷偷跳过；
- 批量操作结束后显示成功/失败摘要。

---

## 15. Settings UX Baseline

Settings 不要成为“所有实现细节的垃圾桶”。

建议分组：

```text
Appearance（外观）
Editor（编辑）
Workspace（工作区）
Shortcuts（快捷键）
Images / Attachments（图片）
Annotations（批注）
Git / Review
Advanced / Diagnostics（高级/诊断）
```

Workspace（工作区）至少应包含：

- 左侧栏自动收纳开关，默认关闭；
- 默认内部文档打开方式：普通标签（可改为分屏）；
- Outline 的显示开关或默认状态；
- sidebar / Outline / Annotation 面板宽度等纯 UI 状态。

快捷键页面应支持：

- 搜索 command；
- 录制按键；
- 冲突提示；
- 恢复默认。

---

## 16. 错误与空状态

尽量告诉用户：

```text
发生了什么
是否影响数据
接下来能做什么
```

不要只显示：

```text
Error 500
Unknown error
```

示例：

> 无法保存 `a.md`：磁盘文件已被其他程序修改。你的编辑仍保留在 WriteIt 中。请选择重新加载、另存或比较差异。

比：

> Save failed

更有用。

---

## 17. Visual Style（视觉风格）如何推进

目前**不要急着冻结颜色、圆角、阴影、每个 icon 的最终样式**。

先冻结：

- 页面结构；
- 元素出现的位置；
- 状态；
- 操作方式；
- Live Preview 显示规则。

后续再统一：

- 字号层级；
- spacing（间距）；
- 圆角；
- border；
- theme；
- icon set；
- 动画。

为了避免 Pi 每个功能自己发明一种样式，后续建议维护少量统一规则，例如：

```text
普通按钮高度
输入框高度
菜单 item 高度
panel header 高度
正文最大宽度/内边距
heading 字号层级
error / warning / dirty 状态
```

这些可以以后通过 CSS variables（统一样式变量）实现，但你不需要理解实现细节。

---

## 18. Screenshot Baseline（截图验收）

建议只保留少量关键截图：

1. 默认 Workspace（含当前文件高亮）；
2. Workspace + 左侧 Outline + 右侧 Annotation 同时打开；
3. Raw Source；
4. Live Preview 常见 Markdown；
5. Reference popup（含文件夹层级）；
6. Editable + readonly + nested Embed；
7. Table cell-selected / text-editing 两种状态；
8. Table resize / reorder 状态；
9. Mermaid preview + source expanded；
10. Annotation drawer + 正文连线；
11. Git split/unified diff；
12. Mermaid red/green rich diff；
13. Settings / shortcuts。

它们的目的不是要求像素永远不变，而是提醒：

> “这次代码改动是不是把按钮挤乱了、正文变窄了、Live Preview 突然变成另一套风格？”

---

## 19. Figma：你不需要先学会设计软件

Figma 对这个项目是**可选辅助工具**。

最重要的一点：

> **`UX_SPEC.md` 才是你和 Pi 都必须能读懂的产品规则；Figma 主要用来解决‘我用文字说不清这个按钮应该放哪里/这个面板应该多宽’。**

### 19.1 你只需要会三件事

如果以后我给你一个 Figma 链接，你只需要：

1. **打开页面看画面**；
2. **点 Prototype/播放，看点击后的页面怎么变化**；
3. **在不满意的位置留言**，例如：
   - “这个按钮不要一直显示”；
   - “右侧太宽”；
   - “这里我希望右键操作”；
   - “标题的 `##` 不应该一直出现”。

你不需要自己画组件、做 Auto Layout、建变量。

### 19.2 Figma 在 WriteIt 中的正确位置

推荐流程：

```text
UX_SPEC 写清楚行为
        ↓
复杂页面/交互需要时做 Figma 原型
        ↓
你只负责看、点、评论
        ↓
确认后的 Frame/页面链接写回 UX_SPEC
        ↓
Pi 按 UX_SPEC + Figma 实现
        ↓
Playwright 截图/交互测试验收
```

### 19.3 哪些功能值得做 Figma

值得：

- 整体 Workspace 布局；
- Table hover/selection/row-column controls；
- Annotation drawer；
- Git Diff / Commit / Blame；
- Settings；
- 多 panel 组合。

不值得专门先画：

- parser；
- DocumentStore；
- 文件冲突算法；
- 一个简单 popup 的细小逻辑；
- 纯后台诊断数据结构。

### 19.4 Figma 不是强制 Gate

如果某个任务通过这份 UX_SPEC + 现有页面截图已经足够明确，就直接开发。

只有当你说：

> “这个交互我还是想象不出来”

或者我们发现：

> “Pi 可能有三种合理实现，但你明显会偏好其中一种”

再做 Figma。

---

## 20. 以后你怎么审 UX_SPEC

你不用逐字审技术部分。

重点看每个功能下面这些句子：

```text
默认显示什么？
我点哪里？
右键有什么？
按 Enter/Tab/Escape 怎么样？
失败时看见什么？
会不会突然出现很多按钮？
会不会挡住正文？
```

你可以直接用很口语的话改，例如：

> “这里不要右侧栏，我希望点引用以后直接在编辑区弹一个小卡片。”

这种反馈就是有效的产品规则，我可以再帮你转换成 Pi 能执行的 Task/验收条件。

---

## 21. 当前已经确认的 UX 决策

以下由用户在 2026-09-08 明确确认，后续 Pi 不应再自行反向设计：

- [x] 左侧栏可折叠、可调整宽度；自动收纳可关闭且默认关闭，开关必须明显。
- [x] Search/Git 不销毁或重建当前编辑器。
- [x] “定位当前文件”容易找到；当前文件在 File Tree / Git 中默认轻量突出。
- [x] 标签页可关闭，并支持双击关闭；dirty 保护不能绕过。
- [x] Outline 独立放左侧，不和右侧 Annotation 强制冲突；支持 hover、active、自动跟随、自然滚动。
- [x] 状态栏显示字数、引用等；统计/大纲需要考虑 Embed 组合内容。
- [x] 内部导航支持普通标签打开与分屏打开两种模式。
- [x] Image preview 通过 hover 图标进入，普通单击不直接 preview。
- [x] Mermaid Live Preview 默认显示渲染图，source 默认折叠，可展开编辑并实时刷新。
- [x] Mermaid 渲染图中的内部 Reference 可点击导航。
- [x] Mermaid Rich Diff 使用红/绿表达删除/新增，并始终保留 Raw Diff 保底。
- [x] Embed 视觉接近 Markdown blockquote；第一行显示来源；支持 sticky 第一行、多层 `>` 视觉、循环停止提示。
- [x] Annotation 详情在右侧，正文颜色标记并与卡片正确连线。
- [x] Popup 支持 Left/Right 文件夹导航；只在真实输入 trigger 时触发；Raw Source 也支持。
- [x] File Tree 支持目录/文件拖拽移动等基础拖拽交互。
- [x] Reference 每个具体出现位置有独立 ①② 角标；Backlinks 可按角标准确跳回对应 occurrence。
- [x] Table 单击选 cell 无光标、输入覆盖；双击进入有光标编辑。
- [x] Table Enter：选中状态移动下一行；编辑状态插入 cell 内换行。
- [x] Table Resize / Reorder 是最终必须能力，不再作为可永久延后的项目。

## 22. Goal 前置 UX 决策（2026-09-08）

以下细节已作为 Codex Goal 的默认产品合同，不再要求在对应 Phase 前停下来询问：

- [x] 自动收纳只在打开文件或焦点进入中央编辑区后触发，并保留明显展开入口。
- [x] 普通内部 Reference 默认用普通标签打开；Settings、右键或修饰键可选择分屏。
- [x] Table 编辑状态下 Tab / Shift+Tab 提交当前 cell 并前后移动，IME composition 期间不触发。
- [x] Table cell 内换行默认保存为 `<br>`，实现前以 renderer/legacy fixture 验证。
- [x] Table column resize 首版不跨重启持久化，且永不写入 Markdown。
- [x] Annotation drawer 默认 `360px`，可 resize。
- [x] Git Diff 默认 unified，可切换 split。
- [x] Git blame gutter 显示作者短名 + 相对日期，完整信息放 hover/click 详情。

如果实现证据要求调整非架构细节，按 `DECISIONS.md` 的适配规则记录后继续；涉及核心操作方式或 Accepted ADR 才暂停 Goal。
