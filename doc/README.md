# WriteIt（Milkdown Note）文档

> 本目录按**功能板块**组织应用文档，每篇包含：功能概述、使用说明、主要实现方式、关键文件。
> 配套阅读：[README](../README.md)（快速开始）· [`editor-app/docs/design.md`](../editor-app/docs/design.md)（里程碑设计文档，含踩坑记录）。

## 文档地图

### 基础篇

- [架构总览](architecture.md) —— 分层结构、数据流、插件体系、异步容错原则
- [编辑器核心](editor-core.md) —— 多标签管理、保存流程、脏检测、源码模式
- [文件系统抽象](filesystem.md) —— mock / web / tauri 三实现与切换
- [设置 / 主题 / 快捷键](settings.md) —— 设置项、6 套主题、快捷键录制与冲突检测

### 功能板块（M 里程碑）

- [引用机制](reference.md) —— M1-M3：`[[` / `![[` 语法、节点、两段式解析、三级触发菜单、文件树联动、写回事务
- [模板机制](template.md) —— M4：`.template` 模板域、doctype、rules.ts / suggest.ts、esbuild-wasm、斜杠菜单
- [校验机制](validation.md) —— M5：规则执行、三通道呈现、strict 门禁
- [批注与评论](annotation.md) —— M6：`<mark data-note>`、评论线程、批注抽屉、权限模型（M6 v7 代码块整块批注见 `editor-app/docs/design.md` §11）
- [Mermaid 图表](mermaid.md) —— M9：代码块预览、斜杠模板、图表内引用
- [Git 工作台](git.md) —— M11-M14：面板三区块、文本/渲染双模式 diff、mermaid 节点级、批注复用、还原/分支、浏览器演示模式
- [导出功能](export.md) —— M10：PDF/DOCX/Markdown 导出、模板 export.ts、内置中文字体

### 工程篇

- [打包与发布](packaging.md) —— Tauri 构建、Windows/macOS 产物、GitHub Actions
- [测试体系](testing.md) —— Playwright e2e 套件、调试钩子
- [演示工作区](demo-workspace.md) —— `demo/消金业务合作` 示例内容与目录约定

## 快速索引

| 想了解 | 看哪篇 |
|---|---|
| 启动 / 安装 / 打包 | [README](../README.md) 快速开始 + [打包与发布](packaging.md) |
| 数据是怎么从磁盘到编辑器再回去的 | [文件系统抽象](filesystem.md) + [编辑器核心](editor-core.md) |
| `[[xx]]` 是怎么变成可点击 chip 的 | [引用机制](reference.md) |
| 怎么给一个目录定义"模板 + 校验规则" | [模板机制](template.md) + [校验机制](validation.md) |
| 怎么给文档加评论 | [批注与评论](annotation.md) |
| Mermaid 图怎么画 / 怎么引用 | [Mermaid 图表](mermaid.md) |
| Git 分支/历史/改动怎么看 | [Git 工作台](git.md) |
| 怎么把文档导成 PDF / Word | [导出功能](export.md) |
| 改完代码怎么验证 | [测试体系](testing.md) |
