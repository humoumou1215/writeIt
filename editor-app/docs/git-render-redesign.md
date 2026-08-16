# Git 渲染模式重构（M13）— 单 Crepe + 组合 md 方案

> 状态：**设计待对齐（2026-08-16 用户提出方向）**
> 目标：替代 M11c 的「双 readonly Crepe + DOM 提取融合」——改为**单 Crepe 渲染一份组合 md**（diff 标注内嵌），实现：
>   ① 行内词级修改 → 删除词红底划线 + 新增词绿底 + 右侧连线批注卡（如「修改"放款"为"授信"」）
>   ② mermaid 图内节点级标注（修改节点划线/新增节点绿底）
> 原则：**渲染主体始终是编辑器同款 Crepe**（同一 featureConfigs / 主题 / 节点），diff 只改变「注入的内容」。

---

## 1. 方案总览

```
git diff（Rust：行级 hunks + 词级 words + 新旧全文）
        │
        ▼
组合器（前端，内存中）——解析 diff 结果 → 生成「组合 md」
        │  （原内容 + 差异标记 + 删除内容 + mermaid 合并源码）
        ▼
单 readonly Crepe（+ diff 节点插件）直接渲染组合 md
        │
        ▼
渲染：删除红底划线 / 新增绿底 / mermaid 节点级标注 / 右侧批注卡（自动生成 + 连线）
```

- 只保留 **1 个 Crepe 实例**（替代 M11c 的双实例 + DOM 提取）；性能与内存减半
- 组合 md 是唯一渲染输入——**渲染器不感知 diff 逻辑**，只渲染「带标记的 md」
- 批注卡由渲染层**自动生成**（不写进 md）：解析组合 md 的修改对 → 右侧卡片 + 锚点连线

## 2. 组合 md 语法（diff 标记扩展）

### 2.1 内联（行内词级）

| 语法 | 语义 | 渲染 |
|---|---|---|
| `{--删除词--}` | diff-del 内联节点 | 红底 + 划线 |
| `{++新增词++}` | diff-ins 内联节点 | 绿底 |
| 相邻 `{--A--}{++B++}` | 修改对 | del 红底划线 + ins 绿底；**自动批注卡**「修改"A"为"B"」 |

- 转义：`\{--` / `\{++` 输出字面（代码块 / 行内代码内不解析）
- 来源：Rust 词级 words（M11b 已有）——del 词 → `{----}`，add 词 → `{++ ++}`，ctx 词原样

### 2.2 块级容器（directive）

| 语法 | 语义 | 渲染 |
|---|---|---|
| `::: diff-add` 内容 `:::` | 整块新增 | 绿底 + 左侧绿条 |
| `::: diff-del` 内容 `:::` | 整块删除（内容 = 旧版本块） | 红底 + 划线 |
| `::: diff-mod` 旧行 `---` 新行 `:::` | 块级修改 | 旧段红底划线 + 新段绿底（上下拼接） |

- 内容用标准 md（解析器照常渲染块内内容）
- 来源：行级 diff——纯 add 段 → diff-add；纯 del 段 → diff-del；相邻 del+add 整块结构差异 → diff-mod

### 2.3 mermaid（节点级）

fence 用**合并源码**（以新版本为基础）：

```
```mermaid
graph TD
  classDef diffAdd fill:#dff0d8,stroke:#3c763d
  classDef diffDel fill:#f2dede,stroke:#a94442
  classDef diffMod fill:#fdf6e3,stroke:#b58900
  A[开始] --> B{有余额?}
  B -- 是 --> C[授信成功]:::diffMod   ← 标签变化（原"放款成功"）
  B -- 否 --> D[余额不足]:::diffAdd    ← 新增节点
  E[旧节点已删除]:::diffDel             ← 删除节点加回 + 标注
```
```

- **合并规则**（flowchart）：解析新旧源码的节点/边 → 新有旧无 = add；旧有新无 = del（加回合并源码）；标签变 = mod；相同 = 原样
- 用 mermaid 原生 `classDef` + `id:::class` 标注（mermaid 自行渲染样式，无需操作 SVG）
- 其他图类型（sequence/timeline 等）：v1 降级为「整图标注」（fence 外包 diff-mod 容器）+ 提示；v1.5 按类型扩展

### 2.4 批注卡（不写 md，渲染层自动生成）

组合 md 里每处「修改对」（内联 del+ins / 块级 diff-mod）→ 渲染层生成右侧卡片：

```
┌─────────── 右侧批注栏 ───────────┐
│ 📌 修改"放款"为"授信"             │  ← 卡片（自动）
│    锚点：接口说明 第2行           │
│ ⠶ 连线（卡左缘 → 锚点）           │
└──────────────────────────────────┘
```

- 复用现有批注抽屉的连线实现（`annotation-connector` SVG + 激活状态）
- 卡片只读（diff 是快照，不是可回复评论）
- 点击卡片 → 滚动到锚点 + 高亮

## 3. diff → 组合 md 组合规则（核心映射）

输入：Rust `git_diff_file` 的 hunks（行级）+ words（词级）+ 新旧全文（showFile/readWorktree）。

对每个 hunk 的行序列：

| diff 行 | 组合规则 |
|---|---|
| ctx 行 | 原样（新版本内容） |
| add 行（后无配 del） | 原样加入；**外层包 `::: diff-add`**（若连续 add 段） |
| del 行（后无配 add） | 内容 = 旧版本行；**包 `::: diff-del`** |
| 相邻 del+add 修改对 | ① 行级词 diff（words）→ 相同 ctx 原样 + del 词 `{----}` + add 词 `{++ ++}`（**行内修改**）<br>② 若词级无共同部分（整行重写）→ `::: diff-mod` 旧行 `---` 新行 `:::` |
| fence 块（mermaid） | 新版本源码 + 节点级合并标注（§2.3） |
| fence 块（其他代码） | 行级 diff（逐行 del/add 标注，包容器） |
| 表格 | v1 行级（容器内行标注）；v1.5 单元格级 |
| 嵌入 `![[path]]` | 卡片内容变化 → v1 卡片整体标注（内容 diff 折叠）；v1.5 卡内行级 |
| 新增/删除文件 | 全文 diff-add / diff-del |

**组合 md 的非 diff 部分 = 新版本内容**（用户看到的是「新版本 + 标注」）。

## 4. 渲染管线

1. `openGitDiff`（不变）→ 拉 diff 数据
2. **组合器**（新模块 `src/editor/diff-compose.ts`）：
   - 输入：hunks + words + oldMd + newMd
   - 输出：`{ composedMd: string, diffNotes: Array<{ text, anchorBlock }> }`（md + 批注卡数据）
   - mermaid 合并（`src/editor/mermaid-diff.ts`）：flowchart 解析/合并/标注
3. **单 Crepe** 渲染 composedMd（readonly + `registerRefStringify` + refPlugin + **diff 节点插件**）
   - diff 插件：`{-- --}`/`{++ ++}` → inline 节点（高亮 mark）；`::: diff-*` → 块级容器 NodeView（底色/划线）；渲染后扫描修改对 → 生成批注卡（右侧 + 连线）
4. 批注栏：复用 AnnotationDrawer 的连线/卡片视觉，只读模式

## 5. 与现有能力的复用

- **渲染引擎**：Crepe + featureConfigs（mermaid renderPreview / ref 插件 / 主题）——同 M11c，但只 1 实例
- **词级数据**：M11b 的 `words`（Rust porcelain 合并）
- **新旧全文**：M11c 的 `showFile`/`readWorktreeFile`
- **批注连线**：M6 AnnotationDrawer 的 `annotation-connector` + 激活模式
- **降级链**：diff 节点插件解析失败 → 组合 md 原样渲染（标记退化为文本，可读）→ 文本模式

## 6. 场景演示（对齐材料）

见对话正文（示例 1-6：行内修改 / mermaid 节点 / 整行删除 / 整块新增 / 块级修改 / 表格）。

## 7. 边界与降级

| 场景 | 处理 |
|---|---|
| `{--` 出现在正文/代码块 | 代码块不解析；正文 `\{--` 转义 |
| mermaid 语法无法解析（非 flowchart） | 整图 diff-mod 容器 + 提示 |
| 大文件 | 组合 md 截断提示（沿用文本模式阈值） |
| 嵌套列表/复杂表格 块序不稳 | 组合器按 hunk 行号锚定，不依赖块序（优于 M11c 的 DOM 对齐） |
| 词级无可合并部分 | 降级块级 diff-mod |
| 批注卡太多 | 右侧栏滚动 + 计数徽标 |

## 8. 里程碑拆解

```
M13a  组合器 diff-compose.ts：行级/词级/容器规则 + 单 Crepe 渲染管线（diff 节点插件）
M13b  批注卡（自动生成 + 连线，复用 AnnotationDrawer 模式）+ 交互（点击滚动）
M13c  mermaid 节点级：flowchart 解析/合并/classDef 标注 + 其他图类型降级
M13d  表格单元格级 + 嵌入卡片内容标注 + 边界打磨
```

## 9. 测试计划

- diff-compose 单测（Rust words + 组合器规则矩阵：行内/整行/块/连续/转义/mermaid）
- e2e：行内修改渲染（del 划线 + ins 绿底 + 批注卡文本）、mermaid classDef 节点标注、块级容器、降级链
- 回归：git-m11a-e2e 的渲染断言迁移到新方案

## 10. 待拍板

1. **内联语法**：`{-- --}`/`{++ ++}`（pandoc 风格）是否接受？（备选：`~~del~~`/`==ins==`——但与现有语法/主题冲突风险）
2. **块级容器**：`::: diff-*` directive 是否接受？（备选：HTML 注释 `<!--diff:add-->`）
3. **mermaid**：classDef 合并源码方案（flowchart 优先）确认？是否 v1 就要支持 flowchart 之外的图类型？
4. **批注卡**：自动生成（渲染层推导）确认？卡片文案规则（「修改"A"为"B"」）？
5. **表格单元格级**：进 v1 还是 v1.5？
6. **删除块内容源**：组合 md 包含旧版本内容（红底划线）确认——即 md 不再是「纯新版本」，而是新旧混合。
