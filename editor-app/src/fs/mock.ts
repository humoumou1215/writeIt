// localStorage 模拟文件系统 —— 无需任何宿主即可在浏览器里完整体验
// 数据结构：{ files: { [path]: content }, dirs: string[] }
import type { FileSystem, FsEntry, FsBackendKind } from './types'
import { shouldShowInTree, dirName, baseName } from './types'
import demoMd from '../editor/demo.md?raw'
import mermaidMd from '../editor/mermaid.md?raw'

const KEY = 'milkdown-note-mock-fs-v2'

const SAMPLE: Record<string, string> = {
  'README.md': demoMd,
  'Mermaid 图表集.md': mermaidMd,
  '笔记/会议记录.md': `# 会议记录

## 2026-08-11 周会

- [x] 讨论编辑器方案：确定 Tauri + Vue + Crepe
- [ ] 搭建文件树 CRUD
- [ ] 多标签页编辑
- [ ] Windows 打包

| 事项 | 负责人 | 状态 |
| --- | --- | --- |
| 前端 Demo | Pi | ✅ |
| Tauri 壳 | Pi | 🚧 |
| 安装包 | 待定 | ⏳ |

\`\`\`js
// 代码块支持语言选择（CodeMirror）
console.log('hello milkdown note')
\`\`\`

行内公式 $E = mc^2$，以及块级公式：

\`\`\`latex
\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}
\`\`\``,
  '笔记/待办清单.md': `# 待办清单

- [ ] 支持自动保存
- [ ] 文件树右键菜单
- [ ] 多标签页
- [ ] 主题适配
- [x] 搭建工程`,
  '数据/原始数据.txt': `这是一段纯文本文件（.txt）。

Milkdown 也能编辑 txt，以 Markdown 语法渲染。

2026-08-11 00:00`,
  'template/demo/demo.md': `doctype:demo

# 周报模板

{{title}}

## 本周进展

- 

## 下周计划

- 

## 版本

v0.1.0

## 需求

| 前置 | 后置 |
| --- | --- |
| A | B |
`,
  'template/demo/demo.rules.ts': `import type { ValidationContext, Rule } from '@milkdown-note/validate'

// 校验模式：hint = 仅提示标注不阻止保存（默认）；strict = 保存前校验失败需确认
export const mode: 'hint' | 'strict' = 'hint'

// 报告落盘（§5.2 通道③）：每次校验后写 markdown 报告
export const report = { enabled: true, path: '.validate/report.md' }

export const rules: Rule[] = [
  {
    id: 'table-acceptance',
    label: '需求表：前置列非空则后置列必填',
    run(ctx: ValidationContext) {
      const table = ctx.findTableAfterHeading('## 需求')
      if (!table) return ctx.violation('缺少「需求」表格')
      // 逐行检查：前置已填而后置为空 → 在该单元格位置标注（decorations 通道）
      table.dataRows().forEach((row, i) => {
        const prev = row.cell(0).text().trim()
        const next = row.cell(1).text().trim()
        if (prev && !next) {
          ctx.violationAt(
            row.cell(1).pos,
            \`第 \${i + 1} 行：前置已填写「\${prev}」，后置不能为空\`,
            'warning'
          )
        }
      })
    },
  },
  {
    id: 'require-version',
    label: '必须存在「## 版本」章节',
    run(ctx: ValidationContext) {
      const v = ctx.findHeading('## 版本')
      if (!v) return ctx.violation('缺少「## 版本」章节（版本号应记录在模板约定位置）', 'error')
      const line = ctx.findText(/^v\\d/)
      if (!line) ctx.violation('「## 版本」后缺少版本号（形如 v0.1.0）', 'warning')
    },
  },
]
`,
  'template/demo/demo.suggest.ts': `import type { SuggestContext, SuggestObject } from '@milkdown-note/suggest'

// 模板对象：可被 [[path#对象id]] 引用；名字（label）与展示内容（resolve）完全在 TS 中自定义
export const objects: SuggestObject[] = [
  {
    id: 'greeting',
    label: '问候语',
    resolve(ctx: SuggestContext): string | null {
      return ctx.findText(/^你好/)?.[0] ?? null
    },
  },
  {
    id: 'version',
    label: '版本号',
    // 点击引用时跳转到 ## 版本 标题
    fragment: '版本',
    resolve(ctx: SuggestContext) {
      // 取「## 版本」标题后的段落文本（如 v0.2.1）
      return ctx.paragraphAfterHeading(2, /^版本/) ?? null
    },
  },
  {
    id: 'todo-count',
    label: '待办数量',
    resolve(ctx: SuggestContext) {
      return ctx.taskCount() ?? null
    },
  },
  {
    id: 'progress',
    label: '待办完成率',
    resolve(ctx: SuggestContext) {
      // 动态统计：2/5 这种
      return ctx.taskProgress() ?? null
    },
  },
  {
    id: 'first-task',
    label: '首个待办',
    resolve(ctx: SuggestContext) {
      return ctx.firstTask() ?? null
    },
  },
]
`,
  '笔记/周报.md': `doctype:demo

# 周报

你好，本周完成了引用机制的三块里程碑，下一步推进模板服务。

## 版本

v0.2.1

## 待办

- [x] 引用语法与节点
- [x] 触发菜单
- [x] 文件树联动
- [ ] 模板机制
- [ ] 校验服务
`,
  '引用演示.md': `doctype:demo

# 引用机制演示（里程碑 1）

本页演示自定义节点的解析、渲染与序列化。

## 文件名链接

- [[README.md]] 是文件名链接
- [[笔记/会议记录]] 点击可打开
- [[笔记/会议记录#2026-08-11 周会]] 带 # 片段（点击平滑滚动到对应标题）

## 块嵌入

待办清单嵌入如下：

![[笔记/待办清单]]

## 只读嵌入

![[README.md|ro]]

## 模板对象引用（M4）

周报问候语：[[笔记/周报#greeting]]

周报版本号：[[笔记/周报#version]]

周报待办数：[[笔记/周报#todo-count]]

周报完成率：[[笔记/周报#progress]]

首个待办：[[笔记/周报#first-task]]

## 字面量转义

下面这行是转义后的字面量（序列化器自动转义）：

文本里的 \[\[ 不应被解析为引用。
`,

  'template/接口文档/接口文档.md': `doctype:接口文档

# {{接口名称}}（本系统提供）

> 本模板由「消金业务合作平台」定义。每个 .md 文件描述**一个接口**。
> 字段名即对象引用 id（如 \`[[接口文档/助贷/助贷接口#amount]]\`），请用英文标识符或无空格中文，避免 \`#\` / 空格破坏引用语法。

## 基本信息

| 项 | 值 | 备注 |
| --- | --- | :--- |
| 方法 | {{GET/POST/PUT/DELETE/PATCH}} | |
| 路径 | {{/api/xxx}} | 以 \`/\` 开头 |
| 版本号 | {{v1.0.0}} | 格式 \`vX.Y.Z\` |
| 是否关键接口 | {{是/否}} | 满足任意 1 条即为「是」：①涉及资金交易 ②涉及短信发送（不含工作平台通知）③涉及监管报送或内部结算 ④包含高风险字段 |
| 该接口涉及的业务范围 | {{业务范围}} | 穷举所有涉及产品；不接受「标准化的所有产品」这类含糊描述 |
| 会调用该接口的系统 | {{系统全称}} | 会调用该接口的系统全称 |
| 预计接口并发量 | {{TPS 及评估依据}} | 说明预估并发量及评估依据 |
| 幂等规则 | {{[[#幂等字段]]}} | 说明使用的幂等规则，引用下方高风险字段中的幂等字段 |
| 涉及调用外部接口 | {{[[后端接口/...]]}} | 罗列该接口涉及调用的所有外部接口 |
| 防止重复调用外部接口的机制 | {{[[数据库/...]]}} | 发送外部接口前更新交易记录状态（记录是否发送外部），并通过乐观锁避免重复调用 |
| 是否涉及分页，分页必须搭配排序 | {{[[数据库/...]]}} | 说明是否涉及分页查询及搭配的排序机制 |
| 交易状态判断 | {{[[#状态字段]]}} | 准则：明确失败才是失败，明确成功才是成功，其他应作为处理中 |

## 接口详情

### {{子接口名}}

字段说明：

| 字段 | 类型 | 长度 | 是否高风险字段 | 高风险字段类型 | 数据来源 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| {{field}} | {{bigint}} | {{20}} | {{是/否}} | {{金额/本金/利息/罚息/总额/单位/精度/四舍五入/还款方式/期次/业务状态/响应结果判断/发送前状态更新/幂等/防重/征信}} | {{[[数据库/...]] 或 [[后端接口/...]]}} | {{字段用途}} |

> 高风险字段（「是否高风险字段=是」）必须填写「数据来源」：来自 XX 表的 XX 字段、或 XX 系统 XX 接口的 XX 字段响应，使用 \`[[wikilink]]\` 引用。

请求示例：

\`\`\`json
{
  "{{field}}": 0
}
\`\`\`

响应示例：

\`\`\`json
{
  "code": 0,
  "msg": "success"
}
\`\`\`

## 变更记录

| 版本 | 日期 | 变更说明 |
| --- | --- | --- |
| v1.0.0 | {{2026-08-06}} | {{初版}} |
`,
  'template/接口文档/接口文档.rules.ts': `// 接口文档校验规则（mode=hint，不阻止保存；违规写入 .validate/report.md）
// 规则 9「请求/响应示例字段一致性」依赖 ValidationContext.findCodeBlocks（M7 新增）
import type { ValidationContext, Rule } from '@milkdown-note/validate'

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
const HIGH_RISK_TYPES = ['金额', '本金', '利息', '罚息', '总额', '单位', '精度', '四舍五入', '还款方式', '期次', '业务状态', '响应结果判断', '发送前状态更新', '幂等', '防重', '征信']
/** 通用响应包装字段（非业务字段；规则 9 跳过其「出现未声明」检查） */
const WRAPPER_FIELDS = new Set(['code', 'msg', 'message', 'data', 'success', 'requestId', 'traceId', 'timestamp'])

/** 递归收集 JSON 对象所有 key（含嵌套/数组） */
function collectKeys(obj: unknown, out: Set<string>): void {
  if (!obj || typeof obj !== 'object') return
  if (Array.isArray(obj)) {
    for (const v of obj) collectKeys(v, out)
    return
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out.add(k)
    collectKeys(v, out)
  }
}

/** 基本信息表「项」列匹配 key 的「值」列文本 */
function basicInfo(ctx: ValidationContext, key: string): string | null {
  const t = ctx.findTableAfterHeading('## 基本信息')
  if (!t) return null
  for (const row of t.rows()) {
    if (row.cell(0).text().trim() === key) return row.cell(1).text().trim()
  }
  return null
}

export const mode = 'hint' as const
export const report = { enabled: true, path: '.validate/report.md' }

export const rules: Rule[] = [
  {
    id: 'sections-required',
    label: '必备章节齐全',
    run(ctx) {
      for (const h of ['## 基本信息', '## 接口详情', '## 变更记录']) {
        if (!ctx.findHeading(h)) ctx.violation(\`缺少必备章节「\${h}」\`, 'error')
      }
    },
  },
  {
    id: 'basic-info-table',
    label: '基本信息表存在',
    run(ctx) {
      const t = ctx.findTableAfterHeading('## 基本信息')
      if (!t) { ctx.violation('缺少「基本信息」表格', 'error'); return }
      const h = t.headerRow()
      if (!h || !/项/.test(h.cell(0).text()) || !/值/.test(h.cell(1).text())) {
        ctx.violation('基本信息表表头应为「项 | 值 | 备注」', 'error')
      }
    },
  },
  {
    id: 'method-valid',
    label: '方法合法',
    run(ctx) {
      const m = basicInfo(ctx, '方法')
      if (m && !METHODS.includes(m.toUpperCase())) {
        ctx.violation(\`方法「\${m}」不在合法集合 {\${METHODS.join(',')}}\`, 'warning')
      }
    },
  },
  {
    id: 'path-format',
    label: '路径格式',
    run(ctx) {
      const p = basicInfo(ctx, '路径')
      if (p && !p.startsWith('/')) ctx.violation(\`路径「\${p}」应以 / 开头\`, 'warning')
    },
  },
  {
    id: 'version-format',
    label: '版本号格式',
    run(ctx) {
      const v = basicInfo(ctx, '版本号')
      if (v && !/^v\\d+\\.\\d+\\.\\d+$/.test(v)) ctx.violation(\`版本号「\${v}」应为 vX.Y.Z\`, 'warning')
    },
  },
  {
    id: 'critical-enum',
    label: '是否关键接口枚举',
    run(ctx) {
      const c = basicInfo(ctx, '是否关键接口')
      if (c && c !== '是' && c !== '否') ctx.violation('「是否关键接口」应为 是/否', 'warning')
    },
  },
  {
    id: 'field-spec-table',
    label: '字段说明表存在',
    run(ctx) {
      const t = ctx.findTableAfterHeading('## 接口详情')
      if (!t) { ctx.violation('「接口详情」下缺少字段说明表', 'error'); return }
      const h = t.headerRow()
      if (!h) { ctx.violation('字段说明表缺少表头', 'error'); return }
      const cols = h.cells().map((c) => c.text())
      if (!cols.some((c) => /字段/.test(c))) ctx.violation('字段说明表缺少「字段」列', 'error')
      if (!cols.some((c) => /是否高风险/.test(c))) ctx.violation('字段说明表缺少「是否高风险字段」列', 'error')
    },
  },
  {
    id: 'high-risk-source',
    label: '高风险字段必填数据来源',
    run(ctx) {
      const t = ctx.findTableAfterHeading('## 接口详情')
      if (!t) return
      const h = t.headerRow()
      if (!h) return
      const cols = h.cells().map((c) => c.text())
      const cField = cols.findIndex((c) => /字段/.test(c))
      const cRisk = cols.findIndex((c) => /是否高风险/.test(c))
      const cSrc = cols.findIndex((c) => /数据来源/.test(c))
      if (cRisk < 0 || cSrc < 0) return
      for (const row of t.dataRows()) {
        if (row.cell(cRisk).text().trim() !== '是') continue
        const src = row.cell(cSrc).text().trim()
        const field = cField >= 0 ? row.cell(cField).text().trim() : ''
        if (!src || src === '<br />' || /^\\{\\{.*\\}\\}$/.test(src)) {
          ctx.violation(\`高风险字段「\${field}」未填写数据来源\`, 'warning')
        }
      }
    },
  },
  {
    id: 'req-resp-field-consistency',
    label: '请求/响应示例字段与字段说明一致',
    run(ctx) {
      const t = ctx.findTableAfterHeading('## 接口详情')
      if (!t) return
      const h = t.headerRow()
      if (!h) return
      const cols = h.cells().map((c) => c.text())
      const cField = cols.findIndex((c) => /字段/.test(c))
      if (cField < 0) return
      const declared = new Set<string>()
      for (const row of t.dataRows()) {
        const f = row.cell(cField).text().trim()
        if (f && !/^\\{\\{.*\\}\\}$/.test(f)) declared.add(f)
      }
      const blocks = ctx.findCodeBlocks(/^json$/i) ?? []
      const sample = new Set<string>()
      for (const b of blocks) {
        try { collectKeys(JSON.parse(b.content), sample) } catch { /* 非 JSON 跳过 */ }
      }
      if (sample.size === 0) return // 无可解析 JSON 示例则跳过
      for (const f of declared) {
        if (!sample.has(f)) ctx.violation(\`字段「\${f}」在字段说明中登记，但请求/响应示例中未出现\`, 'warning')
      }
      for (const f of sample) {
        // 通用响应包装字段（code/msg/data 等）非业务字段，跳过「出现未声明」
        if (WRAPPER_FIELDS.has(f)) continue
        if (!declared.has(f)) ctx.violation(\`字段「\${f}」在请求/响应示例中出现，但字段说明中未登记\`, 'warning')
      }
    },
  },
]
`,
  'template/接口文档/接口文档.suggest.ts': `// 接口文档 suggest：动态对象生成器
// 从「接口详情」下字段说明表提取每个字段为可引用对象。
// 用法：在设计文档写「放款金额取自 [[接口文档/助贷/助贷接口#amount]]」
//   resolve 出「类型:bigint 高风险:是 来源:[[数据库/loan/表结构#amount]]」
import type { SuggestContext, SuggestObject } from '@milkdown-note/suggest'

export function objectsFor(ctx: SuggestContext): SuggestObject[] {
  const rows = ctx.tableAfterHeading('## 接口详情')
  if (!rows || rows.length < 2) return []
  const header = rows[0]
  const cField = header.findIndex((h) => /字段/.test(h))
  const cType = header.findIndex((h) => /^类型$/.test(h))
  const cRisk = header.findIndex((h) => /是否高风险/.test(h))
  const cSrc = header.findIndex((h) => /数据来源/.test(h))
  if (cField < 0) return []
  return rows
    .slice(1)
    .filter((r) => r[cField]?.trim() && !/^\\{\\{.*\\}\\}$/.test(r[cField].trim()))
    .map((r) => {
      const name = r[cField].trim()
      return {
        id: name,
        label: name,
        fragment: '接口详情',
        resolve(ctx: SuggestContext): string | null {
          const rs = ctx.tableAfterHeading('## 接口详情') ?? []
          const row = rs.find((x) => x[cField]?.trim() === name)
          if (!row) return null
          const parts = [
            cType >= 0 && row[cType] && \`类型:\${row[cType]}\`,
            cRisk >= 0 && row[cRisk] && \`高风险:\${row[cRisk]}\`,
            cSrc >= 0 && row[cSrc] && \`来源:\${row[cSrc]}\`,
          ].filter(Boolean)
          return parts.length ? parts.join(' ') : null
        },
      }
    })
}
`,
  '接口文档/助贷/助贷接口.md': `doctype:接口文档

# 助贷放款申请接口（本系统提供）

## 基本信息

| 项 | 值 | 备注 |
| --- | --- | :--- |
| 方法 | POST | |
| 路径 | /api/loan/apply | |
| 版本号 | v1.0.0 | |
| 是否关键接口 | 是 | 涉及资金交易；包含高风险字段（金额/期次/还款方式/业务状态） |
| 该接口涉及的业务范围 | 助贷放款：合作机构A放款、合作机构B放款 | 穷举所有涉及产品 |
| 会调用该接口的系统 | 消金自营系统、消金业务管理系统 | |
| 预计接口并发量 | TPS ≤ 5 | 2026-08-14 商务XXX与外部约定 TPS 控制在 5 以内 |
| 幂等规则 | [[#applyNo]] | 以申请号 applyNo 作幂等键，重复请求返回原结果 |
| 涉及调用外部接口 | [[后端接口/资金方-XX银行/放款接口]] | 申请受理后调资金方放款接口 |
| 防止重复调用外部接口的机制 | [[数据库/loan/表结构#status]] | 发送外部前更新 loan.status=SENDING（乐观锁），防止重复发起放款 |
| 是否涉及分页，分页必须搭配排序 | 否 | 单笔申请，无分页 |
| 交易状态判断 | [[#status]] | 明确成功=SUCCESS、明确失败=FAIL，其余=PROCESSING 视为处理中 |

## 接口详情

### 助贷放款申请

字段说明：

| 字段 | 类型 | 长度 | 是否高风险字段 | 高风险字段类型 | 数据来源 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| applyNo | string | 32 | 是 | 幂等 | [[数据库/loan/表结构#apply_no]] | 放款申请号，幂等键 |
| customerId | bigint | 20 | 否 |  | [[数据库/customer/表结构#id]] | 客户ID |
| amount | bigint | 20 | 是 | 金额 | [[数据库/loan/表结构#amount]] | 放款金额（单位：分） |
| term | int | 4 | 是 | 期次 | [[数据库/loan/表结构#term]] | 期数 |
| repaymentMethod | string | 16 | 是 | 还款方式 | [[数据库/loan/表结构#repayment_method]] | 还款方式（等额本息/等额本金/先息后本） |
| applyDate | date | 10 | 否 |  | [[数据库/loan/表结构#apply_date]] | 申请日期 |
| status | string | 16 | 是 | 业务状态 | [[数据库/loan/表结构#status]] | 交易状态：PROCESSING/SUCCESS/FAIL |

请求示例：

\`\`\`json
{
  "applyNo": "APL20260806001",
  "customerId": 100200300,
  "amount": 5000000,
  "term": 12,
  "repaymentMethod": "EQUAL_INSTALLMENT",
  "applyDate": "2026-08-06"
}
\`\`\`

响应示例：

\`\`\`json
{
  "code": 0,
  "msg": "success",
  "data": {
    "applyNo": "APL20260806001",
    "status": "PROCESSING"
  }
}
\`\`\`

## 变更记录

| 版本 | 日期 | 变更说明 |
| --- | --- | --- |
| v1.0.0 | 2026-08-06 | 初版 |
`,
  '接口文档/助贷/助贷接口-违规.md': `doctype:接口文档

# 助贷放款申请接口（违规示例）

> ⚠️ 本文件故意违反多条校验规则，用于演示 \`接口文档.rules.ts\` 的违规检出能力。请勿作为真实接口文档使用。

## 基本信息

| 项 | 值 | 备注 |
| --- | --- | :--- |
| 方法 | POST | |
| 路径 | api/loan/apply | 故意缺少前导 \`/\`（违反「路径格式」） |
| 版本号 | 1.0 | 故意非 \`vX.Y.Z\`（违反「版本号格式」） |
| 是否关键接口 | Y | 故意非 是/否（违反「是否关键接口枚举」） |
| 该接口涉及的业务范围 | 助贷放款 | |
| 会调用该接口的系统 | 消金自营系统 | |
| 预计接口并发量 | TPS ≤ 5 | |
| 幂等规则 | [[#applyNo]] | |
| 涉及调用外部接口 | [[后端接口/资金方-XX银行/放款接口]] | |
| 防止重复调用外部接口的机制 | [[数据库/loan/表结构#status]] | |
| 是否涉及分页，分页必须搭配排序 | 否 | |
| 交易状态判断 | [[#status]] | |

## 接口详情

### 助贷放款申请

字段说明：

| 字段 | 类型 | 长度 | 是否高风险字段 | 高风险字段类型 | 数据来源 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| applyNo | string | 32 | 是 | 幂等 | [[数据库/loan/表结构#apply_no]] | 放款申请号 |
| amount | bigint | 20 | 是 | 金额 |  | 故意不填数据来源（违反「高风险字段必填数据来源」） |
| status | string | 16 | 是 | 业务状态 | [[数据库/loan/表结构#status]] | 交易状态 |

请求示例：

\`\`\`json
{
  "applyNo": "APL20260806001",
  "amount": 5000000,
  "extraField": "故意多一个未登记字段"
}
\`\`\`

> 上面 \`extraField\` 故意未在字段说明登记（违反「请求/响应示例字段一致性」）。

响应示例：

\`\`\`json
{
  "code": 0,
  "msg": "success",
  "data": {
    "applyNo": "APL20260806001"
  }
}
\`\`\`

> 上面 \`status\` 在字段说明登记但响应示例未出现（违反「请求/响应示例字段一致性」）。

## 变更记录

| 版本 | 日期 | 变更说明 |
| --- | --- | --- |
| 1.0 | 2026-08-06 | 初版 |
`,
  '接口字段引用.md': `doctype:demo

# 接口字段引用演示

本页演示对接口文档字段的动态对象引用（M7 objectsFor）。

放款金额取自 [[接口文档/助贷/助贷接口#amount]]。

放款申请号取自 [[接口文档/助贷/助贷接口#applyNo]]。
`,
  'template/数据库/数据库.md': `doctype:数据库

# {{schema}}（schema 表结构）

> 本模板由「消金业务合作平台」定义。每个 .md 文件描述**一个数据库 schema** 的表结构。
> 字段名即对象引用 id（如 \`[[数据库/loan/表结构#amount]]\`），请用英文标识符（下划线风格），避免 \`#\` / 空格破坏引用语法。

## 基本信息

| 项 | 值 | 备注 |
| --- | --- | :--- |
| schema | {{loan}} | schema 名 |
| 版本号 | {{v0.1.0}} | 格式 \`vX.Y.Z\` |

## 表清单

| 表名 | 中文名 | 说明 |
| --- | --- | --- |
| {{loan_apply}} | {{放款申请表}} | {{助贷放款申请记录}} |

## {{loan_apply}} {{放款申请表}}

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| {{id}} | {{bigint}} | {{PK 自增}} | {{主键}} |

> 每张表一个 \`## 表名 中文名\` 章节；表清单中的表名必须有对应的字段表章节。
> 字段名请用英文标识符（如 \`apply_no\`），接口文档的数据来源列会以 \`[[数据库/{{schema}}/表结构#{{字段名}}]]\` 引用。

## 索引

| 索引名 | 字段 | 类型 | 说明 |
| --- | --- | --- | --- |
| {{uk_apply_no}} | {{apply_no}} | {{唯一}} | {{幂等去重}} |

## 变更记录

| 日期 | 变更内容 |
| --- | --- |
| {{2026-08-06}} | {{初版}} |
`,
  'template/数据库/数据库.rules.ts': `// 数据库表结构校验规则（mode=hint，不阻止保存；违规写入 .validate/report.md）
// 「表清单 ↔ 字段表章节」一致性：表清单声明的每个表名必须有「## 表名」标题下的字段表
import type { ValidationContext, Rule } from '@milkdown-note/validate'

/** 表清单「表名」列集合 */
function tableNames(ctx: ValidationContext): string[] {
  const t = ctx.findTableAfterHeading('## 表清单')
  if (!t) return []
  const h = t.headerRow()
  if (!h) return []
  const cols = h.cells().map((c) => c.text())
  const cTable = cols.findIndex((c) => /表名/.test(c))
  if (cTable < 0) return []
  return t
    .dataRows()
    .map((r) => r.cell(cTable).text().trim())
    .filter((n) => n && !/待补充/.test(n))
}

function esc(s: string): string {
  return s.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&')
}

export const mode = 'hint' as const
export const report = { enabled: true, path: '.validate/report.md' }

export const rules: Rule[] = [
  {
    id: 'sections-required',
    label: '必备章节齐全',
    run(ctx) {
      for (const h of ['## 基本信息', '## 表清单', '## 变更记录']) {
        if (!ctx.findHeading(h)) ctx.violation(\`缺少必备章节「\${h}」\`, 'error')
      }
    },
  },
  {
    id: 'basic-info-table',
    label: '基本信息表存在',
    run(ctx) {
      const t = ctx.findTableAfterHeading('## 基本信息')
      if (!t) { ctx.violation('缺少「基本信息」表格', 'error'); return }
      const h = t.headerRow()
      if (!h || !/项/.test(h.cell(0).text()) || !/值/.test(h.cell(1).text())) {
        ctx.violation('基本信息表表头应为「项 | 值 | 备注」', 'error')
      }
    },
  },
  {
    id: 'version-format',
    label: '版本号格式',
    run(ctx) {
      const t = ctx.findTableAfterHeading('## 基本信息')
      if (!t) return
      for (const row of t.dataRows()) {
        if (row.cell(0).text().trim() !== '版本号') continue
        const v = row.cell(1).text().trim()
        if (v && !/^v\\d+\\.\\d+\\.\\d+$/.test(v)) ctx.violation(\`版本号「\${v}」应为 vX.Y.Z\`, 'warning')
      }
    },
  },
  {
    id: 'table-list',
    label: '表清单存在且有表',
    run(ctx) {
      if (tableNames(ctx).length === 0) ctx.violation('表清单为空或缺少「表名」列', 'error')
    },
  },
  {
    id: 'table-field-consistency',
    label: '表清单与字段表章节一致',
    run(ctx) {
      for (const t of tableNames(ctx)) {
        const sec = ctx.findHeading(new RegExp('^' + esc(t)))
        if (!sec) {
          ctx.violation(\`表「\${t}」在表清单中声明，但缺少「## \${t}」字段表章节\`, 'warning')
          continue
        }
        const ft = ctx.findTableAfterHeading(new RegExp('^' + esc(t)))
        if (!ft || ft.dataRows().length === 0) {
          ctx.violation(\`表「\${t}」缺少字段说明表或字段表为空\`, 'warning')
        }
      }
    },
  },
  {
    id: 'field-table-cols',
    label: '字段表列齐全',
    run(ctx) {
      for (const t of tableNames(ctx)) {
        const ft = ctx.findTableAfterHeading(new RegExp('^' + esc(t)))
        if (!ft) continue
        const h = ft.headerRow()
        if (!h) continue
        const cols = h.cells().map((c) => c.text())
        if (!cols.some((c) => /字段/.test(c))) ctx.violation(\`表「\${t}」字段表缺少「字段」列\`, 'error')
        if (!cols.some((c) => /^类型$/.test(c))) ctx.violation(\`表「\${t}」字段表缺少「类型」列\`, 'error')
        if (!cols.some((c) => /约束/.test(c))) ctx.violation(\`表「\${t}」字段表缺少「约束」列\`, 'warning')
        if (!cols.some((c) => /^说明$/.test(c))) ctx.violation(\`表「\${t}」字段表缺少「说明」列\`, 'warning')
      }
    },
  },
  {
    id: 'field-name-format',
    label: '字段名格式',
    run(ctx) {
      for (const t of tableNames(ctx)) {
        const ft = ctx.findTableAfterHeading(new RegExp('^' + esc(t)))
        if (!ft) continue
        const h = ft.headerRow()
        if (!h) continue
        const cols = h.cells().map((c) => c.text())
        const cField = cols.findIndex((c) => /字段/.test(c))
        if (cField < 0) continue
        for (const row of ft.dataRows()) {
          const f = row.cell(cField).text().trim()
          if (!f || /^\\{\\{.*\\}\\}$/.test(f)) continue
          // 英文标识符或中文（无空格）；禁止空格/特殊字符（会破坏 wikilink 引用语法）
          if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(f) && !/^[\\u4e00-\\u9fa5]+$/.test(f)) {
            ctx.violation(\`字段「\${f}」应为英文标识符或无空格中文（当前含空格/特殊字符，无法被 wikilink 引用）\`, 'warning')
          }
        }
      }
    },
  },
  {
    id: 'pk-exists',
    label: '每表主键',
    run(ctx) {
      for (const t of tableNames(ctx)) {
        const ft = ctx.findTableAfterHeading(new RegExp('^' + esc(t)))
        if (!ft) continue
        const h = ft.headerRow()
        if (!h) continue
        const cols = h.cells().map((c) => c.text())
        const cCons = cols.findIndex((c) => /约束/.test(c))
        if (cCons < 0) continue
        const hasPk = ft.dataRows().some((r) => /PK/i.test(r.cell(cCons).text()))
        if (!hasPk) ctx.violation(\`表「\${t}」字段表缺少主键（约束列应含 PK）\`, 'warning')
      }
    },
  },
  {
    id: 'change-log',
    label: '变更记录非空',
    run(ctx) {
      const t = ctx.findTableAfterHeading('## 变更记录')
      if (!t) { ctx.violation('缺少「变更记录」表格', 'warning'); return }
      if (t.dataRows().length === 0) ctx.violation('变更记录为空', 'warning')
    },
  },
]
`,
  'template/数据库/数据库.suggest.ts': `// 数据库表结构 suggest：动态对象生成器
// 从「表清单」读表名 → 每个表章节的字段表提取字段为可引用对象。
// 用法：在接口文档「数据来源」列写「[[数据库/loan/表结构#amount]]」
//   resolve 出「类型:decimal(18,2) 约束:非空 说明:放款金额（元）」
import type { SuggestContext, SuggestObject } from '@milkdown-note/suggest'

function esc(s: string): string {
  return s.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&')
}

export function objectsFor(ctx: SuggestContext): SuggestObject[] {
  const list = ctx.tableAfterHeading('## 表清单')
  if (!list || list.length < 2) return []
  const cTable = list[0].findIndex((h) => /表名/.test(h))
  if (cTable < 0) return []
  const out: SuggestObject[] = []
  for (const r of list.slice(1)) {
    const t = r[cTable]?.trim()
    if (!t || /待补充/.test(t)) continue
    const rows = ctx.tableAfterHeading(new RegExp('^' + esc(t)))
    if (!rows || rows.length < 2) continue
    const h = rows[0]
    const cField = h.findIndex((x) => /字段/.test(x))
    const cType = h.findIndex((x) => /^类型$/.test(x))
    const cCons = h.findIndex((x) => /约束/.test(x))
    const cDesc = h.findIndex((x) => /^说明$/.test(x))
    if (cField < 0) continue
    for (const row of rows.slice(1)) {
      const name = row[cField]?.trim()
      if (!name || /^\\{\\{.*\\}\\}$/.test(name)) continue
      const type = cType >= 0 ? (row[cType] ?? '') : ''
      const cons = cCons >= 0 ? (row[cCons] ?? '') : ''
      const desc = cDesc >= 0 ? (row[cDesc] ?? '') : ''
      out.push({
        id: name,
        label: name,
        fragment: t,
        resolve(): string | null {
          const parts = [type && \`类型:\${type}\`, cons && \`约束:\${cons}\`, desc && \`说明:\${desc}\`].filter(Boolean)
          return parts.length ? parts.join(' ') : null
        },
      })
    }
  }
  return out
}
`,
  '数据库/loan/表结构.md': `doctype:数据库

# 表结构：loan（schema）

## 基本信息

| 项 | 值 | 备注 |
| --- | --- | :--- |
| schema | loan | 放款业务 schema |
| 版本号 | v0.1.0 | 表结构版本 |

## 表清单

| 表名 | 中文名 | 说明 |
| --- | --- | --- |
| loan_apply | 放款申请表 | 助贷放款申请记录 |

## loan_apply 放款申请表

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| id | bigint | PK 自增 | 主键 |
| apply_no | varchar(32) | 非空 唯一 | 放款申请号（幂等键） |
| customer_id | bigint | 非空 | 客户ID |
| amount | decimal(18,2) | 非空 | 放款金额（元） |
| term | int | 非空 | 期数 |
| repayment_method | varchar(16) | 非空 | 还款方式：等额本息/等额本金/先息后本 |
| apply_date | date | 非空 | 申请日期 |
| status | varchar(16) | 非空 | 交易状态：PROCESSING/SUCCESS/FAIL |
| create_time | datetime | 非空 | 创建时间 |
| update_time | datetime | 可空 | 更新时间 |

## 索引

| 索引名 | 字段 | 类型 | 说明 |
| --- | --- | --- | --- |
| uk_apply_no | apply_no | 唯一 | 幂等去重 |

## 变更记录

| 日期 | 变更内容 |
| --- | --- |
| 2026-08-06 | 初版：助贷放款申请建表 |
`,
  '数据库/loan/表结构-违规.md': `doctype:数据库

# 表结构：loan（schema）

## 基本信息

| 项 | 值 |
| --- | --- |
| schema | loan |
| 版本号 | 1.0 |

## 表清单

| 表名 | 中文名 | 说明 |
| --- | --- | --- |
| loan_apply | 放款申请表 | 助贷放款申请记录 |
| loan_settle | 还款结清表 | 结清记录 |

## loan_apply 放款申请表

| 字段 | 约束 | 说明 |
| --- | --- | --- |
| apply no | 非空 | 申请号（字段名含空格） |
| 放款金额 | 非空 | 金额（中文名） |

## 变更记录

| 日期 | 变更内容 |
| --- | --- |
| 2026-08-06 | 初版 |
`,
  '数据库/customer/表结构.md': `doctype:数据库

# 表结构：customer（schema）

## 基本信息

| 项 | 值 |
| --- | --- |
| schema | customer |
| 版本号 | v0.1.0 |

## 表清单

| 表名 | 中文名 | 说明 |
| --- | --- | --- |
| customer_info | 客户信息表 | 意向贷款客户主档 |
| （待补充） | | |

## customer_info 客户信息表

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| id | bigint | PK 自增 | 主键 |
| name | varchar(64) | 非空 | 客户姓名 |
| （待补充） | | | |

## 索引

（待补充）

## 变更记录

（待补充）
`,
  '数据库字段引用.md': `doctype:demo

# 数据库字段引用演示

本页演示对数据库表结构字段的动态对象引用（M8 objectsFor）。

放款金额取自 [[数据库/loan/表结构#amount]]。

申请号取自 [[数据库/loan/表结构#apply_no]]。

客户ID取自 [[数据库/customer/表结构#id]]。
`,}

const SAMPLE_DIRS = ['笔记', '数据', 'template/demo', '接口文档/助贷', 'template/接口文档', 'template/数据库']

/** 全局模板域示例（mock 模拟；真实文件系统外部目录 v1.5 缺口） */
const GLOBAL_SAMPLE: Record<string, string> = {
  'template/邮件/邮件.md': `doctype:mail

# 邮件模板

{{subject}}

您好：

{{body}}

此致
`,
  'template/邮件/邮件.suggest.ts': `import type { SuggestContext, SuggestObject } from '@milkdown-note/suggest'

export const objects: SuggestObject[] = [
  {
    id: 'subject',
    label: '主题',
    resolve(ctx: SuggestContext): string | null {
      return ctx.headingText(1, /^邮件模板/) ?? null
    },
  },
]
`,

}

/** 全局模板域树（只含 template/ 结构，路径带 template/ 前缀与内容一致） */
export function mockGlobalTemplates(): FsEntry[] {
  const children: FsEntry[] = []
  for (const path of Object.keys(GLOBAL_SAMPLE)) {
    const parts = path.split('/')
    const dirPath = parts.slice(0, 2).join('/')
    const dirName = parts[1]
    const fileName = parts[2]
    let dir = children.find((c) => c.name === dirName)
    if (!dir) {
      dir = { name: dirName, path: dirPath, kind: 'dir', children: [] }
      children.push(dir)
    }
    dir.children!.push({ name: fileName, path, kind: 'file' })
  }
  const tpl = { name: 'template', path: 'template', kind: 'dir' as const, children }
  return [tpl]
}

/** 全局域文件读取（mock：内置示例；真实文件系统：外部目录 v1.5 缺口） */
export async function mockGlobalReadFile(path: string): Promise<string> {
  const content = GLOBAL_SAMPLE[path]
  if (content === undefined) throw new Error(`全局模板文件不存在: ${path}`)
  return content
}

interface MockData {
  files: Record<string, string>
  dirs: string[]
  /** 是否已完成示例合并（防止删除的示例文件被重复恢复） */
  seeded?: boolean
  /** 示例合并版本：新版本会把新增示例文件补进旧快照 */
  seededVersion?: number
}

const SEED_VERSION = 5

/**
 * 版本 4：新增「接口文档」模板（接口文档.md / rules.ts / suggest.ts）+ 助贷样例（合规/违规）
 * + 接口字段引用演示页，验证 M7 动态对象 objectsFor + findCodeBlocks 能力。
 * 版本 3：演示核心文件（模板 suggest 样例 / 周报数据 / 引用演示页）强制更新，
 * 让旧数据也能体验新样例。这些是演示基础设施；用户改过会被覆盖（可接受）。
 */
const FORCE_UPDATE_PATHS = [
  'template/demo/demo.suggest.ts',
  '笔记/周报.md',
  '引用演示.md',
  'template/demo/demo.md',
  'template/接口文档/接口文档.md',
  'template/接口文档/接口文档.rules.ts',
  'template/接口文档/接口文档.suggest.ts',
  '接口文档/助贷/助贷接口.md',
  '接口文档/助贷/助贷接口-违规.md',
  '接口字段引用.md',
  'template/数据库/数据库.md',
  'template/数据库/数据库.rules.ts',
  'template/数据库/数据库.suggest.ts',
  '数据库/loan/表结构.md',
  '数据库/loan/表结构-违规.md',
  '数据库字段引用.md',
]

function load(): MockData {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const data = JSON.parse(raw) as MockData
      // 版本旧 或 模板示例缺失 → 补缺（仅补缺失文件，不覆盖用户改动）。
      // 兜底条件加「模板 demo.md 不存在」：防止旧数据（seededVersion=2 但缺模板）一直缺模板
      const needMerge =
        (data.seededVersion ?? 1) < SEED_VERSION ||
        !('template/demo/demo.md' in (data.files ?? {}))
      if (needMerge) {
        const prev = data.seededVersion ?? 1
        for (const [path, content] of Object.entries(SAMPLE)) {
          if (!(path in data.files)) data.files[path] = content
          // 演示核心文件：跨版本强制覆盖（suggest 样例等）
          else if (prev < SEED_VERSION && FORCE_UPDATE_PATHS.includes(path)) {
            data.files[path] = content
          }
        }
        for (const dir of SAMPLE_DIRS) {
          if (!data.dirs.includes(dir)) data.dirs.push(dir)
        }
        data.seeded = true
        data.seededVersion = SEED_VERSION
        persist(data)
      }
      return data
    }
  } catch {
    /* ignore */
  }
  const data: MockData = {
    files: { ...SAMPLE },
    dirs: [...SAMPLE_DIRS],
    seeded: true,
    seededVersion: SEED_VERSION,
  }
  persist(data)
  return data
}

function persist(data: MockData) {
  localStorage.setItem(KEY, JSON.stringify(data))
}

/** 诊断钩子（用户反馈 template 目录空时，可复制 console 输出提供） */
;(window as unknown as { __mockFsDebug?: unknown }).__mockFsDebug = () => {
  const data = load()
  const tplFiles = Object.keys(data.files).filter((p) => p.startsWith('template/'))
  const dirs = data.dirs.filter((d) => d.startsWith('template'))
  console.log('[mock-fs] seededVersion=', data.seededVersion, 'dirs(template)=', JSON.stringify(dirs))
  console.log('[mock-fs] 模板文件数=', tplFiles.length, '→', JSON.stringify(tplFiles.slice(0, 10)))
  console.log('[mock-fs] 总文件数=', Object.keys(data.files).length)
  return {
    seededVersion: data.seededVersion,
    templateFiles: tplFiles,
    templateDirs: dirs,
    totalFiles: Object.keys(data.files).length,
  }
}

function buildTree(data: MockData, showAll: boolean): FsEntry[] {
  const root: FsEntry[] = []
  const dirMap = new Map<string, FsEntry>()
  const rootNode: FsEntry = { name: '', path: '', kind: 'dir', children: root }
  const ensureDir = (path: string): FsEntry => {
    if (path === '') return rootNode
    if (dirMap.has(path)) return dirMap.get(path)!
    const node: FsEntry = { name: baseName(path), path, kind: 'dir', children: [] }
    dirMap.set(path, node)
    const parent = ensureDir(dirName(path))
    parent.children!.push(node)
    return node
  }
  for (const dir of data.dirs) ensureDir(dir)
  for (const path of Object.keys(data.files)) {
    if (!shouldShowInTree(path, baseName(path), showAll)) continue
    const parent = ensureDir(dirName(path))
    parent.children!.push({ name: baseName(path), path, kind: 'file' })
  }
  const sort = (list: FsEntry[]) => {
    list.sort((a, b) =>
      a.kind === b.kind
        ? a.name.localeCompare(b.name, 'zh-Hans-CN')
        : a.kind === 'dir'
          ? -1
          : 1
    )
    list.forEach((n) => n.children && sort(n.children))
  }
  sort(root)
  return root
}

export const mockFs: FileSystem = {
  kind: 'mock',
  rootName: '示例工作区',

  async openDirectory() {
    // mock 模式没有"打开目录"，直接返回（可改为恢复示例）
    return false
  },

  async readTree(showAll) {
    return buildTree(load(), showAll)
  },

  async readFile(path) {
    const data = load()
    if (!(path in data.files)) throw new Error(`文件不存在: ${path}`)
    return data.files[path]
  },

  async writeFile(path, content) {
    const data = load()
    data.files[path] = content
    persist(data)
  },

  async createFile(path) {
    const data = load()
    if (path in data.files) throw new Error(`文件已存在: ${path}`)
    data.files[path] = ''
    persist(data)
  },

  async createDir(path) {
    const data = load()
    if (data.dirs.includes(path)) throw new Error(`目录已存在: ${path}`)
    data.dirs.push(path)
    persist(data)
  },

  async rename(oldPath, newPath) {
    const data = load()
    if (oldPath === newPath) return
    if (newPath in data.files || data.dirs.includes(newPath)) {
      throw new Error(`目标已存在: ${newPath}`)
    }
    if (oldPath in data.files) {
      const content = data.files[oldPath]
      delete data.files[oldPath]
      data.files[newPath] = content
    } else if (data.dirs.includes(oldPath)) {
      data.dirs = data.dirs.map((d) =>
        d === oldPath || d.startsWith(oldPath + '/')
          ? newPath + d.slice(oldPath.length)
          : d
      )
      // 目录内的文件路径整体迁移
      for (const [p, c] of Object.entries(data.files)) {
        if (p === oldPath || p.startsWith(oldPath + '/')) {
          const rel = p.slice(oldPath.length)
          delete data.files[p]
          data.files[newPath + rel] = c
        }
      }
    } else {
      throw new Error(`不存在: ${oldPath}`)
    }
    persist(data)
  },

  async remove(path) {
    const data = load()
    if (path in data.files) {
      delete data.files[path]
    } else if (data.dirs.includes(path)) {
      data.dirs = data.dirs.filter((d) => d !== path)
      for (const p of Object.keys(data.files)) {
        if (p === path || p.startsWith(path + '/')) delete data.files[p]
      }
    } else {
      throw new Error(`不存在: ${path}`)
    }
    persist(data)
  },
}

export type { FsBackendKind }
