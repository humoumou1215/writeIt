# 校验机制（M5）

> 核心代码：`editor-app/src/validate/`（service.ts / plugin.ts / validate-context.ts）。
> 设计文档：`editor-app/docs/design.md` §5。
> 一句话：**按模板 rules 自动检查文档结构，违规进批注体系呈现，strict 模式保存前把关**。

## 1. 规则来源：模板的 rules.ts

校验规则随模板走：文档首行 `doctype:x` → 找到模板 → 加载 `<名称>.rules.ts`（esbuild-wasm 转译，见 [模板机制](template.md)）。

```ts
import type { ValidationContext, Rule } from '@milkdown-note/validate'

export const mode: 'hint' | 'strict' = 'hint'    // 严格度
export const report = { enabled: true, path: '.validate/report.md' }  // 报告落盘（可选）
export const rules: Rule[] = [ { id, label, run(ctx) { … } } ]
```

### ValidationContext API（doc → 结构查询）

| 方法 | 作用 |
|---|---|
| `findTableAfterHeading(heading)` | 标题后的第一个表格（TableContext：headerRow/rows/dataRows/cell） |
| `findHeading(heading)` | 标题位置（level/text/pos） |
| `findText(re)` | 第一个匹配段落纯文本 |
| `allText()` | 文档纯文本（不含代码块） |
| `findCodeBlocks(languageRe?)` | 代码块列表（fence：content/language/pos，可解析 JSON/YAML） |
| `violation(msg, level)` | 无位置的整体违规（如"缺少需求表"） |
| `violationAt(pos, msg, level)` | 带位置违规（文档内高亮） |

### 规则示例（demo.rules.ts 摘）

- 需求表前置/后置联动：`violationAt` 单元格级标注（A 前置、B 后置缺一）。
- 必须存在版本章节：`findHeading(/^## 版本/)` 未命中 → error 级违规。
- 表格单元格位置计算坑：`pos + 2 + rowOff + cellOff`（cell 相对 row 还有一层边界，少加 1 会标到前一格）。

## 2. 三通道呈现

M6 之后校验违规**并入批注体系**（原 ValidatePanel 已移除），三通道为：

| 通道 | 形式 | 说明 |
|---|---|---|
| ① 文档内标注 | 运行时批注 decorations | `violationAt` 有位置的违规：非空范围 inline 高亮 / 空范围（如空单元格）降级锚定所在行/块整块高亮 |
| ② 批注抽屉 | 只读卡 | 全部违规（含 `from=-1` 无位置的整体违规）进右侧抽屉，error 红 / warning 橙；点击跳转定位 |
| ③ 报告落盘 | markdown 报告 | `report.enabled` 时每次校验后写 `report.path`（默认 `.validate/report.md`），含文件/模板/模式/时间/违规清单 |

- 违规 → `setRuntimeAnnotations(tabId, anns, editor)`：**persist=false，不落盘**，保存即消失。
- 校验本身不写入 doc：decorations 用空事务 `setMeta('validateRefresh')` 触发重算。

## 3. 触发时机

| 时机 | 方式 |
|---|---|
| 打开文档 | mountEditor 后 `validateEditor(..., { silent: true })` |
| 编辑防抖 | `validatePlugin` 的 `$prose` 监听 `markdownUpdated` → 1.5s 防抖（默认关闭开关 v1 内置） |
| 保存前 | saveTab 先静默重校验，保证结果新鲜 |

## 4. strict 门禁

```
saveTab → validateEditor（silent）
  → hasStrictBlock(result)？  （mode === 'strict' && 存在 error 违规）
      → ConfirmDialog「校验失败，确定保存？」（可取消 / 仍然保存）
```

- hint 模式不阻止保存。
- 校验服务异常（rules 加载失败等）→ `failed: true` → 不构成阻断，toast 降级提示。

## 5. 主要实现方式

- **执行**（`service.ts` `validateEditor`）：doc → `doctypeFromDoc`（注意：首行 doctype 被 M1 自定义节点解析，值在 `node.attrs.value`，不能从 textContent 取）→ 模板 rules → 逐条 `rule.run(ctx)`。
- **超时防护**：单条规则 > 2s 标记 `stale`（同步 run 无法中断，仅告警跳过结果归属）。
- **订阅广播**：`subscribeValidation`（抽屉/状态订阅）；结果缓存 `Map<tabId, ValidationResult>`。
- **错误容错**：单条规则异常 → 记一条 warning 违规（「规则执行异常」），不中断其余规则。
- **引用交互**（§5.4）：collect() 跳过 file_block 物化内容（源文件按自己 doctype 校验）；object_ref 不参与实时校验。

## 6. 使用说明（用户视角）

1. 给文档写首行 `doctype:接口文档`（或从模板新建），确保 `.template/接口文档/接口文档.rules.ts` 存在。
2. 编辑过程中违规自动出现：正文高亮（⚠️ 图标）+ 右侧抽屉计数。
3. 点击抽屉违规项 → 定位到文档位置。
4. 若模板声明 `report`，每次校验后 `.validate/report.md` 自动更新（可归档/CI 用）。
5. strict 模板保存时若还有 error 违规 → 弹确认框。

## 7. 关键文件

| 文件 | 职责 |
|---|---|
| `service.ts` | 校验执行 / 结果缓存 / 订阅广播 / 报告落盘 / strict 门禁判断 |
| `plugin.ts` | 编辑防抖监听 + decorations 刷新（$prose 包装） |
| `validate-context.ts` | ValidationContext 实现（结构查询 + 单元格级定位） |
| `template/service.ts` | `ensureRules` 惰性加载 rules 模块 |
