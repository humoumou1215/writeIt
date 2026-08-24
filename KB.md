# KB.md — 知识库操作手册（raw/ + wiki/）

> 知识库 = `raw/`（只读源语料）+ `wiki/`（Agent 维护的生成层）。它只是**信息参考**，不是本项目主线（主线是 `editor-app/` 开发）。
> **仅当需要维护或查询知识库时才读本文件**；本文件由人维护，Agent 不修改。

---

## 1. 知识库结构

```
writeIt/
├── raw/        # 不可变源文档。只读，绝不写/改/删。
│   ├── milkdown-docs/   # 官方文档语料
│   └── milkdown-srouce/ # milkdown 源码语料（注意拼写 "srouce"）
└── wiki/       # 生成层。可读写。
    ├── index.md   # 主目录，每页一行
    ├── log.md     # 只追加的活动时间线
    └── concepts/ entities/ sources/ syntheses/
```

**KB 硬规则**
- `raw/` → **只读**。wiki 页错了就改 wiki，绝不碰源。
- `wiki/` → Agent 可建/更新页面、`index.md`、`log.md`。
- `log.md` → 只追加，永不删除既有条目。
- 源头文件错误绝不回写语料；不确定就明说不确定。

## 2. Wiki 约定

- **Frontmatter**（每页）：`title` / `type`（concept|entity|source|synthesis|index）/ `tags` / `source` / `updated: YYYY-MM-DD`。
- **链接**：Obsidian 式 `[[Page Title]]`，标题须与目标页 `title:` 完全一致；具体↔一般双向互链，构建**网络**而非树；首次有意义提及处即链。
- **命名**：文件名 `kebab-case.md`；页面 title 用 `Title Case`。一页一概念（原子化）。
- **准确性**：每条非显而易见的主张须可溯源到 `raw/`；源是构建产物（导出清单）时要**综合**，别整段贴 `@Symbol` 列表。

## 3. Index 格式（`wiki/index.md`）

每页一行，按类型分组（Start here / Concepts / Entities / Sources / Syntheses）：

```
- [Page Title](relative/path.md) — 一句话摘要。
```

- 每个新页**恰好**新增一行；摘要一句话（此文件扫描用，不深读）；维护 **Raw module map** 表以便溯源。

## 4. Log 格式（`wiki/log.md`）

只追加、带日期、每操作一行、绝不改写历史：

```
## YYYY-MM-DD
- HH:MM 做了 X（用 [[…]] 链相关页）。
```

## 5. 工作流

**A. Ingest（`raw/` 新增源）**：① 读 `index.md` 看已有 → ② 读新文件提取未收录概念/实体 → ③ 建/更新页并双向加链 → ④ 向 `index.md` 追加行 + 更新 Raw module map → ⑤ 追加 `log.md` → ⑥ 被引用却缺页的概念先建 **stub**（title + 一行 + `source:`），不留死链。

**B. Query（作答）**：① **先读 `index.md`** → ② 定位 2–3 个相关页，只读这些 → ③ 依据 wiki 作答并以 `[[…]]` 引用 → ④ 高价值且尚无页的答案，提议归档回 wiki（走 Ingest）。

**C. Lint（被要求或每 ~10 次 ingest）**：读完所有 wiki 页后——标注**矛盾**（双方加 `> [LINT]`）；补**缺失反链**；标**孤儿页**与**死链**（`[[…]]` 无目标）；为被引却缺页的概念建 stub；把 Lint 摘要追加 `log.md`。

## 6. Milkdown 领域要点（由 raw 抽象出的知识）

- Markdown 是真相源，ProseMirror 是引擎，Milkdown 加 Markdown+插件层。两个层级：底层 `Editor.make().use(...)` vs 高层 `Crepe` / `CrepeBuilder`。
- 语料中最关键的坑：**浏览器 bundle 绝不内嵌 LLM API key**（BYOK `dangerouslyAllowBrowser:true` 或后端代理，见 `[[AI Feature]]`）。
