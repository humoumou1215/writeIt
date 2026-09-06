# WriteIt Legacy Feature Map

> P0-04 产物。本文把 `editor-app/` 中已存在的能力映射到 v2 的目标边界。
> `editor-app/` 仅是行为、fixture、测试和纯算法的参考实现；`writeit-v2/` 禁止对其建立 runtime import。
>
> `Strategy` 使用本任务允许的五种分类：`KEEP BEHAVIOR`、`COPY PURE CODE`、`REWRITE`、`DROP`、`DEFER`。这是迁移策略，不是 Phase 12 的最终 parity 状态。当前没有足够证据主动将任何能力归为 `DROP`。

## Strategy meanings

- **KEEP BEHAVIOR**：保留已验证的用户可见语义和边界，但在 v2 的新依赖方向中重新实现适配器或 projection。
- **COPY PURE CODE**：只可提取与 UI、DOM、CodeMirror、Vue、Tauri 无关的纯算法；必须在 v2 中重新归属并补充测试，不能跨目录 import。
- **REWRITE**：旧版状态模型、所有权或 UI 耦合不符合 v2 不变量，按 v2 owner 重新设计。
- **DROP**：明确不再提供的能力。当前没有项目级确认项。
- **DEFER**：保留为候选能力，等对应 Phase / Feature Parity Review 再决定；不表示已经删除。

## Capability map

| Capability | Legacy Location | v2 Owner | Strategy | Migration notes / evidence |
|---|---|---|---|---|
| FileSystem | `editor-app/src/fs/{types,index,dev,mock,web,tauri}.ts`；`src/state/treeOps.ts` | `platform/filesystem` | `KEEP BEHAVIOR` | 保留 mock/web/Tauri adapter 的可替换边界和文件树语义；v2 先定义 `FileSystemPort`，Core 不依赖具体平台。可参考旧版 `fs` 接口，但不复制 Tauri/DOM 实现。 |
| Document state | `editor-app/src/editor/docstore/{model,serialize,posmap,store,bridge}.ts`；`src/editor/manager.ts` | `core/document` | `REWRITE` | 旧版 docstore 和 manager 是重要行为证据，但 v2 必须以单一 `DocumentStore`、Markdown authority、revision 和 persisted revision 为准。相关 runtime-layer 规格与测试仅作迁移输入。 |
| Multi tabs | `editor-app/src/state/store.ts`；`src/editor/manager.ts`；`src/components/{TabBar,TabContextMenu,EditorPane}.vue` | `application` + `ui/workspace` | `REWRITE` | 旧版每标签 Crepe 实例和可见性切换可作为 UX 参考；v2 tab 是 Document/Projection 的工作区编排，不得产生第二份 Document 内容 authority。 |
| References | `editor-app/src/editor/ref/`；`src/editor/manager.ts`；`src/components/RefEditorMenu.vue` | `core/reference` | `REWRITE` | 参考 `remark-ref.ts`、`resolve.ts`、`stringify.ts`、`nodes.ts` 和相关嵌套/循环 fixture；v2 重新实现 `ReferenceParser`、`ReferenceIndex`、`ReferenceGraph`。 |
| Editable Embed | `editor-app/src/editor/ref/{file-block-view,embed-chain,writeback,app-plugin}.ts`；`src/editor/docstore/` | `editor/cm6/projection` + `application` | `REWRITE` | 旧版可编辑嵌入、嵌套、写回和同步测试是行为参考；v2 Embed 是 source Document 的 projection，编辑必须通过 DocumentStore，不得持有副本。 |
| Table | `editor-app/src/editor/table/{schema,command,keymap,clipboard,column-width,config,index}.ts`；`tests/e2e/table-*.js` | `core/table` + `editor/cm6/widgets/table` | `COPY PURE CODE` | 仅提取 parser/serializer、selection 和局部操作等纯算法思路；CM6 widget、clipboard 和生命周期全部在 v2 重新实现。编辑限制在当前 table region，不能重写整个文件。 |
| Annotation | `editor-app/src/annotations/`；`src/components/AnnotationDrawer.vue`；`src/editor/ref/` 中的嵌入定位逻辑 | `core/annotation` + `ui/review` | `REWRITE` | 旧版 annotation mark、thread/card、嵌入定位和 diff/validation 卡片可作为 fixture；v2 以 `Annotation`、`Thread`、`RangeAnchor`、`ResolvedState` 为 domain，Decoration 只是 projection。 |
| Mermaid | `editor-app/src/editor/{mermaid,mermaid-diagrams,mermaid-diff,mermaid-ref,mermaid-zoom}.ts`；`src/components/RenderDiff.vue` | `editor/cm6/widgets/mermaid` | `KEEP BEHAVIOR` | 保留 Markdown fence、预览、缩放、引用/差异场景和 renderer failure fallback 的产品语义；渲染 widget 与 DOM 生命周期在 v2 重写，源码始终是 authority。 |
| Diff | `editor-app/src/editor/diff/`；`src/editor/{diff-deco,render-diff}.ts`；`src/components/{DiffView,RenderDiff}.vue` | `core/diff` + `ui/review` | `REWRITE` | 旧版 anchor/fence/semantic renderer 和 fixtures 只提供场景证据；v2 强制 `Raw Diff → Semantic Enhancement → Renderer`，semantic 失败不能吞掉 Markdown raw change。 |
| Git | `editor-app/src/git/`；`src/components/{GitPanel,GitChangeTree,GitFileContextMenu,BranchPicker,ScmFileRow}.vue`；`src/vite-plugins/dev-repo.ts` | `platform/git` | `KEEP BEHAVIOR` | 保留 status、branch、history、range diff 和 mock repository 的用户语义；v2 重新定义 Git port/adapter，raw source diff 是保证层，不能让 UI renderer 成为数据来源。 |
| Validation | `editor-app/src/validate/`；`src/annotations/service.ts`；`tests/e2e/m5-*.js` | `core/validation` | `COPY PURE CODE` | 可提取规则匹配、报告模型等纯逻辑；插件、DOM 标记、annotation drawer 和落盘适配在 v2 重写，并作为 Document 的派生结果。 |
| Template | `editor-app/src/template/`；`src/components/TemplatePicker.vue`；`src/state/settings.ts` | `application` + `ui/components` | `DEFER` | 旧版目录约定和 `TemplatePicker` 保留为需求/fixture 参考；等待模板规则进入 Phase 8 后再决定保留范围和 API。 |
| Search | `editor-app/src/search/index.ts`；`src/components/SearchPanel.vue` | `index/search` | `DEFER` | 旧版搜索 UI 和索引行为先保留为参考；v2 需在派生服务设计时决定索引生命周期，不能建立第二份 Document authority。 |
| Outline | `editor-app/src/editor/outline.ts`；`src/components/OutlinePanel.vue` | `index` | `REWRITE` | 旧版从编辑器结构生成 outline 的行为可参考；v2 由 Markdown/Document 派生索引生成，不依赖 CM6 实例作为唯一来源。 |
| Export | `editor-app/src/export/`；`src/components/ExportModal.vue` | `platform/export` | `DEFER` | 旧版 Markdown/MD AST、PDF、DOCX exporter 和导出 E2E 作为兼容性证据；按 Phase 9 重新定义 `DocumentSnapshot` + `ExportContext` 输入。 |
| Diagnostics | `editor-app/src/diagnostics/`；`src/debug/`；`.pi/skills/writeit-debug/`；`.workbuddy/` legacy wrapper | `observability` | `REWRITE` | 旧版 logger、probe、debug relay、CLI 和诊断包仅作问题场景参考；不得直接把 legacy 协议当成 v2 API。Phase 10 重新建立 document/projection/timeline/diff/reference diagnostics。 |
| Themes | `editor-app/src/style.css`；`src/state/settings.ts`；`src/components/SettingsModal.vue` | `ui` | `DEFER` | 保留视觉和设置需求作为 UI 参考；等 v2 UI 稳定后再决定 port 范围，不让主题实现影响 Core/domain 边界。 |

## Boundary and provenance rules

1. v2 代码只能把本表列出的 legacy 内容当作参考输入；禁止 `writeit-v2/` runtime import `editor-app/`。
2. 复制纯逻辑时，必须在 v2 中说明新的 owner，并用 v2 的 unit/integration tests 证明行为；不得携带旧 manager、Crepe、Vue、DOM 或 Tauri 的隐式状态。
3. Markdown source、Document revision、persisted revision 和 dirty state 的最终所有权属于 v2 `DocumentStore`；任何 editor view、embed、table widget、preview 或 diff view 都只是 projection。
4. 未知 Markdown、preview/semantic diff/导出失败都不能修改或吞掉原始 Markdown。迁移 fixture 应优先覆盖 source fidelity、嵌套引用、表格局部编辑和 raw diff 保证。
5. `DEFER` 项在进入对应 Phase 前不提前实现，也不应被解释为 `DROP`。后续 Feature Parity Review 再将每项标记为 `MIGRATED`、`REDESIGNED`、`INTENTIONALLY DROPPED` 或 `DEFERRED`。

## Reference material

- Target boundary and phase ownership: `writeit-v2/docs/IMPLEMENTATION_SPEC.md`
- Current execution state: `writeit-v2/docs/STATUS.md`
- Repository classification: `writeit-v2/docs/REPOSITORY_INVENTORY.md`
- Legacy-only rules: `editor-app/AGENTS.md`
- Document synchronization behavior notes: `editor-app/specs/runtime-doc-layer.spec.md`
