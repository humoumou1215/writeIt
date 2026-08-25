# 批注 v8（方案A：node→mark）手动复测清单

> 目标：在真实 vite 环境（`npm run dev` → http://localhost:5173，已登录/mock 均可）手动复测
> 批注的「重叠 / 同文多条 / 跨行 / 持久化 / 旧文件兼容」能力。每例 ①操作 → ②预期。

## 准备
1. `cd editor-app && npm run dev`（或确认 :5173 已在跑），浏览器打开 `http://localhost:5173/?backend=mock`
2. 打开任意可编辑 .md（侧边栏导航），或新建文件粘贴：`12345678` 并回车

---

### 案例 1：创建一条批注（基础）
① 用鼠标选中「12345678」→ 工具条出现 → 点「添加批注」→ 浮窗输入 `批注A` → Enter
② 文本变为黄色高亮；右侧抽屉出现 1 张「批注」卡（锚文本=12345678，内容=批注A）

### 案例 2：重叠批注（子集 ⊂ 整体）
① 再选中整段「12345678」（已带批注A）→ 添加批注，输入 `批注B`
② 文本仍是高亮；抽屉出现第 2 张卡（批注B）；**A、B 都还保留**（不再互相覆盖/吞并）

### 案例 3：同一文本第三条批注（同文多条）
① 又一次选中「12345678」→ 添加批注，输入 `批注C`
② 抽屉共 3 张卡，互不干扰

### 案例 4：重叠处点击 → 选择气泡
① 点击正文高亮区域（该处同时有 A/B/C）→ 弹出「该处有 3 条批注」气泡，列出三条
② 点选「批注B」→ 抽屉展开且 B 卡激活（连线指向正文）

### 案例 5：回复（追加评论）
① 点开 B 卡头部（展开）→ 输入框输入 `回复B` → Enter（或 Ctrl+Enter）
② B 卡评论数变 2 条（原评论 + 回复）；刷新前内容仍在

### 案例 6：保存 → 刷新 → 持久化（round-trip）
① 等自动保存（或 Ctrl+S）→ 浏览器刷新（F5）→ 重新打开该文件
② 高亮、3 张卡、回复内容全部保留
③ （可选）用任意 md 编辑器打开源文件查看格式：
   `<mark data-note='[{...}]' data-a='a-xxx'>12345678</mark>` —— 多条批注 = 嵌套 mark 标签

### 案例 7：源码模式查看（Ctrl+E）
① Ctrl+E 切源码 → 看到上面格式的 `<mark data-note='…' data-a='…'>`
② 源码里点击 mark 内文本 → 批注激活 + 定位滚动；再 Ctrl+E 切回所见即所得

### 案例 8：旧文件兼容（无 data-a 的旧格式）
① 新建文件粘贴（旧格式，双引号 + &quot; 实体）：
   `<mark data-note="{&quot;a&quot;:&quot;我&quot;,&quot;c&quot;:&quot;老批注&quot;}">锚定文字</mark> 结束。`
② 打开后「锚定文字」高亮；抽屉卡显示「老批注」；保存后自动补 `data-a='…'`

### 案例 9：删除一条批注（其他批注与文本不受影响）
- UI 暂未提供删除按钮（既有决策：评论不可删除）；可验证源码模式：把某条 `<mark …>` 标签改为纯文本
  （例如把 `批注A` 的 `data-note='…'` 开标签与 `</mark>` 去掉）→ 保存
② 该批注高亮与卡消失；「12345678」文本完整保留；B/C 仍正常

### 案例 10：跨行批注（批注内软换行）
① 新建文件粘贴（Markdown 硬换行 = 行尾 `\` + 回车）：
   `<mark data-note='[{&quot;a&quot;:&quot;我&quot;,&quot;c&quot;:&quot;跨行批注&quot;}]' data-a='c1'>第一行\
第二行</mark> 后文`
② 打开后两行文本一个高亮；抽屉 1 张卡，锚文本含两行；round-trip 后标签仍在 mark 内跨行

---

### 案例 11：跨嵌入块选区的批注 → 提示不支持
① 打开 `引用演示.md`（或在文件里放入 `![[某文件]]` 嵌入块）；
   Ctrl/Cmd+A 全选（选区必然包含整个嵌入块）→ Ctrl+R 或工具栏「添加批注」
② 不弹批注输入浮窗，toast 提示「暂不支持跨越嵌入块选区的批注」；
   在嵌入块内部单独选中文字时则正常降级（可批注，写回源文件，见 m6d 语义）

> 说明：这是方案 A 的防御性边界——mark 无法跨越嵌入块节点且批注不应污染被嵌入的源文件，
> 故对「选区跨越嵌入块」直接提示不支持；「完全在嵌入块内」的批注仍保留。

## 自动化回归命令（ego-lite 驱动真实 Chromium，需 :5173）
```bash
cd editor-app
node tests/e2e/_run-one.js annotations-overlap-e2e    # 重叠/同文/跨行/旧文件兼容（21 项断言）
node tests/e2e/_run-one.js annotation-recheck-e2e     # 真实 UI 全流程（创建→重叠→气泡→回复→刷新持久化）
node tests/e2e/_run-one.js m6-e2e                     # 基础持久化 round-trip + 动态批注
node tests/e2e/_run-one.js m6-toolbar                 # 工具栏/Ctrl+R 创建 + 回复
node tests/e2e/_run-one.js m6c-e2e                    # 抽屉全套（线程/解决/连线/拖拽）
node tests/e2e/_run-one.js m6e-e2e                    # 代码块整块批注（变体 D）
node tests/e2e/_run-one.js m6d-e2e                    # 嵌入块内批注写回
node tests/e2e/_run-one.js git-m18-fixture-e2e        # diff 批注实体
node tests/e2e/_run-one.js embed-cross-e2e             # 跨嵌入块选区拦截（9 项断言）
```
> 若遇 `Runtime.evaluate timed out` / `Task space not found` = 空间堆积信号，
> 先跑 `ego-browser nodejs < tests/e2e/_cleanup-spaces.ego.js` 清场再继续。