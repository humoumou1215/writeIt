// M14：Git 演示仓库数据（真实 git diff 生成——tests/scratch/gen-mock-git.js 重新生成）
// 演示仓库：README.md（mermaid/嵌入/词级/纯删除）+ 会议记录（嵌入块内容调整）+ 需求表（表格单元格级）
// 数据为真实 git 仓库（三文件两提交 + 工作区改动）的 unified + word-diff=porcelain 解析产物
import type { GitBranch, GitCommit, GitCommitFile, GitDiffResult, GitFileStatus } from './types'

// ---------- 版本内容 ----------
// ---------- 版本内容 ----------
export const README_V1 = `# 演示笔记

本仓库演示 Git 工作台的全部效果：

- 打开工作区文件查看未提交改动
- 切「文本」模式查看分栏与词级高亮

## 需求清单

- 需求一：登录模块
- 需求二：支付模块

## 流程图

\`\`\`mermaid
graph TD
  A[开始] --> B{是否有余额}
  B -- 是 --> C[支付成功]
  B -- 否 --> D[余额不足]
  D --> E[引导充值]
\`\`\`

## 嵌入笔记

![[Git演示/笔记/会议纪要.md]]
`
export const README_V2 = `# 演示笔记

> 旧版本说明：这段提醒只存在于 HEAD，工作区版本中已删除（展示纯删除块的红底划线效果）。

本仓库演示 Git 工作台的全部效果：

- 打开工作区文件查看未提交改动（默认渲染模式：mermaid 图/嵌入卡片真实对比）
- 切「文本」模式查看分栏与词级高亮
- 历史区点提交查看 commit diff；Shift+点击两提交做范围对比
- 工具栏「还原…」可还原整文件或单段改动

## 需求清单

- 需求一：登录模块
- 需求二：支付模块
- 需求三：报表模块

## 流程图

\`\`\`mermaid
graph TD
  A[开始] --> B{是否有余额}
  B -- 是 --> C[支付成功]
  B -- 否 --> D[余额不足]
  D --> E[引导充值]
  G[余额查询] --> B
\`\`\`

## 嵌入笔记

![[Git演示/笔记/会议纪要.md]]

## 数据表

![[Git演示/数据/需求表.md]]

## 相关引用

- 参见 [[Git演示/笔记/会议纪要.md#议题]]
- 参见 [[README#需求清单]]
`
export const README_WORKTREE = `# 演示笔记

本仓库演示 Git 工作台的全部效果：

- 打开工作区文件查看未提交改动（默认渲染模式：mermaid 图/嵌入卡片真实对比 + 批注连线）
- 切「文本」模式查看分栏与**词级**高亮
- 历史区点提交查看 commit diff；Shift+点击两提交做范围对比
- 工具栏「还原…」可还原整文件或单段改动

## 需求清单

- 需求一：登录与权限模块
- 需求二：支付与退款模块
- 需求三：报表与统计模块
- 需求四：消息通知模块

## 流程图

\`\`\`mermaid
graph TD
  A[开始] --> B{是否有余额}
  B -- 是 --> C[授信成功]
  B -- 否 --> D[余额不足]
  D --> E[引导充值]
  F[额度查询] --> D
\`\`\`

## 嵌入笔记

![[Git演示/笔记/会议纪要.md]]

## 数据表

![[Git演示/数据/需求表.md]]

## 相关引用

- 参见 [[Git演示/笔记/会议纪要.md#议题]]
- 参见 [[README#需求清单]]
`
export const MEETING_V1 = `# 会议记录

## 议题

1. 支付流程评审

> 备注：本期只做支付，不做退款。
`
export const MEETING_V2 = `# 会议记录

## 议题

1. 支付流程评审
2. 报表口径确认

> 备注：本期只做支付，不做退款。
`
export const MEETING_WORKTREE = `# 会议记录

## 议题

1. 支付流程评审
2. 报表口径确认
3. 消息通知需求收集

> 备注：本期只做支付，退款下期排期。
`
export const TABLE_V1 = `# 需求表

| 模块 | 状态 | 优先级 |
| --- | --- | --- |
| 登录 | 开发中 | P1 |
| 支付 | 待评审 | P2 |
`
export const TABLE_V2 = `# 需求表

| 模块 | 状态 | 优先级 |
| --- | --- | --- |
| 登录 | 开发中 | P1 |
| 支付 | 待评审 | P2 |
| 报表 | 未开始 | P3 |
`
export const TABLE_WORKTREE = `# 需求表

| 模块 | 状态 | 优先级 |
| --- | --- | --- |
| 登录 | 开发中 | P1 |
| 支付 | 评审中 | P2 |
| 报表 | 未开始 | P3 |
| 消息通知 | 未开始 | P2 |
`
export const FEATURE_README = `# 演示笔记（feature 分支版本）

功能分支：仅演示切换分支后内容与 diff 状态变化。
`

// ---------- 工作区 vs HEAD hunks ----------
export const README_HUNKS: GitDiffResult['hunks'] = [
  {
    oldStart: 1,
    oldLines: 29,
    newStart: 1,
    newLines: 28,
    lines: [
      {
        kind: "ctx",
        text: "# 演示笔记",
        words: [
          {
            kind: "ctx",
            text: "# 演示笔记"
          }
        ]
      },
      {
        kind: "ctx",
        text: "",
        words: [
          {
            kind: "ctx",
            text: ""
          }
        ]
      },
      {
        kind: "del",
        text: "> 旧版本说明：这段提醒只存在于 HEAD，工作区版本中已删除（展示纯删除块的红底划线效果）。",
        words: [
          {
            kind: "del",
            text: "> 旧版本说明：这段提醒只存在于 HEAD，工作区版本中已删除（展示纯删除块的红底划线效果）。"
          }
        ]
      },
      {
        kind: "del",
        text: "",
        words: null
      },
      {
        kind: "ctx",
        text: "本仓库演示 Git 工作台的全部效果：",
        words: [
          {
            kind: "ctx",
            text: "本仓库演示 Git 工作台的全部效果："
          }
        ]
      },
      {
        kind: "ctx",
        text: "",
        words: [
          {
            kind: "ctx",
            text: ""
          }
        ]
      },
      {
        kind: "del",
        text: "- 打开工作区文件查看未提交改动（默认渲染模式：mermaid 图/嵌入卡片真实对比）",
        words: [
          {
            kind: "ctx",
            text: "- 打开工作区文件查看未提交改动（默认渲染模式：mermaid "
          },
          {
            kind: "del",
            text: "图/嵌入卡片真实对比）"
          }
        ]
      },
      {
        kind: "del",
        text: "- 切「文本」模式查看分栏与词级高亮",
        words: [
          {
            kind: "ctx",
            text: "- "
          },
          {
            kind: "del",
            text: "切「文本」模式查看分栏与词级高亮"
          }
        ]
      },
      {
        kind: "add",
        text: "- 打开工作区文件查看未提交改动（默认渲染模式：mermaid 图/嵌入卡片真实对比 + 批注连线）",
        words: [
          {
            kind: "ctx",
            text: "- 打开工作区文件查看未提交改动（默认渲染模式：mermaid "
          },
          {
            kind: "add",
            text: "图/嵌入卡片真实对比 + 批注连线）"
          }
        ]
      },
      {
        kind: "add",
        text: "- 切「文本」模式查看分栏与**词级**高亮",
        words: [
          {
            kind: "ctx",
            text: "- "
          },
          {
            kind: "add",
            text: "切「文本」模式查看分栏与**词级**高亮"
          }
        ]
      },
      {
        kind: "ctx",
        text: "- 历史区点提交查看 commit diff；Shift+点击两提交做范围对比",
        words: [
          {
            kind: "ctx",
            text: "- 历史区点提交查看 commit diff；Shift+点击两提交做范围对比"
          }
        ]
      },
      {
        kind: "ctx",
        text: "- 工具栏「还原…」可还原整文件或单段改动",
        words: [
          {
            kind: "ctx",
            text: "- 工具栏「还原…」可还原整文件或单段改动"
          }
        ]
      },
      {
        kind: "ctx",
        text: "",
        words: [
          {
            kind: "ctx",
            text: ""
          }
        ]
      },
      {
        kind: "ctx",
        text: "## 需求清单",
        words: [
          {
            kind: "ctx",
            text: "## 需求清单"
          }
        ]
      },
      {
        kind: "ctx",
        text: "",
        words: [
          {
            kind: "ctx",
            text: ""
          }
        ]
      },
      {
        kind: "del",
        text: "- 需求一：登录模块",
        words: [
          {
            kind: "ctx",
            text: "- "
          },
          {
            kind: "del",
            text: "需求一：登录模块"
          }
        ]
      },
      {
        kind: "del",
        text: "- 需求二：支付模块",
        words: [
          {
            kind: "ctx",
            text: "- "
          },
          {
            kind: "del",
            text: "需求二：支付模块"
          }
        ]
      },
      {
        kind: "del",
        text: "- 需求三：报表模块",
        words: [
          {
            kind: "ctx",
            text: "- "
          },
          {
            kind: "del",
            text: "需求三：报表模块"
          }
        ]
      },
      {
        kind: "add",
        text: "- 需求一：登录与权限模块",
        words: [
          {
            kind: "ctx",
            text: "- "
          },
          {
            kind: "add",
            text: "需求一：登录与权限模块"
          }
        ]
      },
      {
        kind: "add",
        text: "- 需求二：支付与退款模块",
        words: [
          {
            kind: "ctx",
            text: "- "
          },
          {
            kind: "add",
            text: "需求二：支付与退款模块"
          }
        ]
      },
      {
        kind: "add",
        text: "- 需求三：报表与统计模块",
        words: [
          {
            kind: "ctx",
            text: "- "
          },
          {
            kind: "add",
            text: "需求三：报表与统计模块"
          }
        ]
      },
      {
        kind: "add",
        text: "- 需求四：消息通知模块",
        words: [
          {
            kind: "add",
            text: "- 需求四：消息通知模块"
          }
        ]
      },
      {
        kind: "ctx",
        text: "",
        words: [
          {
            kind: "ctx",
            text: ""
          }
        ]
      },
      {
        kind: "ctx",
        text: "## 流程图",
        words: [
          {
            kind: "ctx",
            text: "## 流程图"
          }
        ]
      },
      {
        kind: "ctx",
        text: "",
        words: [
          {
            kind: "ctx",
            text: ""
          }
        ]
      },
      {
        kind: "ctx",
        text: "```mermaid",
        words: [
          {
            kind: "ctx",
            text: "```mermaid"
          }
        ]
      },
      {
        kind: "ctx",
        text: "graph TD",
        words: [
          {
            kind: "ctx",
            text: "graph TD"
          }
        ]
      },
      {
        kind: "ctx",
        text: "  A[开始] --> B{是否有余额}",
        words: [
          {
            kind: "ctx",
            text: "  A[开始] --> B{是否有余额}"
          }
        ]
      },
      {
        kind: "del",
        text: "  B -- 是 --> C[支付成功]",
        words: [
          {
            kind: "ctx",
            text: "  B -- 是 --> "
          },
          {
            kind: "del",
            text: "C[支付成功]"
          }
        ]
      },
      {
        kind: "add",
        text: "  B -- 是 --> C[授信成功]",
        words: [
          {
            kind: "ctx",
            text: "  B -- 是 --> "
          },
          {
            kind: "add",
            text: "C[授信成功]"
          }
        ]
      },
      {
        kind: "ctx",
        text: "  B -- 否 --> D[余额不足]",
        words: [
          {
            kind: "ctx",
            text: "  B -- 否 --> D[余额不足]"
          }
        ]
      },
      {
        kind: "ctx",
        text: "  D --> E[引导充值]",
        words: [
          {
            kind: "ctx",
            text: "  D --> E[引导充值]"
          }
        ]
      },
      {
        kind: "del",
        text: "  G[余额查询] --> B",
        words: [
          {
            kind: "ctx",
            text: "  "
          },
          {
            kind: "del",
            text: "G[余额查询]"
          },
          {
            kind: "ctx",
            text: " --> "
          },
          {
            kind: "del",
            text: "B"
          }
        ]
      },
      {
        kind: "add",
        text: "  F[额度查询] --> D",
        words: [
          {
            kind: "ctx",
            text: "  "
          },
          {
            kind: "add",
            text: "F[额度查询]"
          },
          {
            kind: "ctx",
            text: " --> "
          },
          {
            kind: "add",
            text: "D"
          }
        ]
      },
      {
        kind: "ctx",
        text: "```",
        words: [
          {
            kind: "ctx",
            text: "```"
          }
        ]
      },
      {
        kind: "ctx",
        text: "",
        words: [
          {
            kind: "ctx",
            text: ""
          }
        ]
      },
      {
        kind: "ctx",
        text: "## 嵌入笔记",
        words: [
          {
            kind: "ctx",
            text: "## 嵌入笔记"
          }
        ]
      }
    ]
  }
]
// README 工作区 vs HEAD: +8 -9
export const MEETING_HUNKS: GitDiffResult['hunks'] = [
  {
    oldStart: 4,
    oldLines: 5,
    newStart: 4,
    newLines: 6,
    lines: [
      {
        kind: "ctx",
        text: "",
        words: [
          {
            kind: "ctx",
            text: ""
          }
        ]
      },
      {
        kind: "ctx",
        text: "1. 支付流程评审",
        words: [
          {
            kind: "ctx",
            text: "1. 支付流程评审"
          }
        ]
      },
      {
        kind: "ctx",
        text: "2. 报表口径确认",
        words: [
          {
            kind: "ctx",
            text: "2. 报表口径确认"
          }
        ]
      },
      {
        kind: "add",
        text: "3. 消息通知需求收集",
        words: [
          {
            kind: "add",
            text: "3. 消息通知需求收集"
          }
        ]
      },
      {
        kind: "ctx",
        text: "",
        words: [
          {
            kind: "ctx",
            text: ""
          }
        ]
      },
      {
        kind: "del",
        text: "> 备注：本期只做支付，不做退款。",
        words: [
          {
            kind: "ctx",
            text: "> "
          },
          {
            kind: "del",
            text: "备注：本期只做支付，不做退款。"
          }
        ]
      },
      {
        kind: "add",
        text: "> 备注：本期只做支付，退款下期排期。",
        words: [
          {
            kind: "ctx",
            text: "> "
          },
          {
            kind: "add",
            text: "备注：本期只做支付，退款下期排期。"
          }
        ]
      }
    ]
  }
]
// 会议纪要: +2 -1
export const TABLE_HUNKS: GitDiffResult['hunks'] = [
  {
    oldStart: 3,
    oldLines: 5,
    newStart: 3,
    newLines: 6,
    lines: [
      {
        kind: "ctx",
        text: "| 模块 | 状态 | 优先级 |",
        words: [
          {
            kind: "ctx",
            text: "| 模块 | 状态 | 优先级 |"
          }
        ]
      },
      {
        kind: "ctx",
        text: "| --- | --- | --- |",
        words: [
          {
            kind: "ctx",
            text: "| --- | --- | --- |"
          }
        ]
      },
      {
        kind: "ctx",
        text: "| 登录 | 开发中 | P1 |",
        words: [
          {
            kind: "ctx",
            text: "| 登录 | 开发中 | P1 |"
          }
        ]
      },
      {
        kind: "del",
        text: "| 支付 | 待评审 | P2 |",
        words: [
          {
            kind: "ctx",
            text: "| 支付 | "
          },
          {
            kind: "del",
            text: "待评审"
          },
          {
            kind: "ctx",
            text: " | P2 |"
          }
        ]
      },
      {
        kind: "add",
        text: "| 支付 | 评审中 | P2 |",
        words: [
          {
            kind: "ctx",
            text: "| 支付 | "
          },
          {
            kind: "add",
            text: "评审中"
          },
          {
            kind: "ctx",
            text: " | P2 |"
          }
        ]
      },
      {
        kind: "ctx",
        text: "| 报表 | 未开始 | P3 |",
        words: [
          {
            kind: "ctx",
            text: "| 报表 | 未开始 | P3 |"
          }
        ]
      },
      {
        kind: "add",
        text: "| 消息通知 | 未开始 | P2 |",
        words: [
          {
            kind: "add",
            text: "| 消息通知 | 未开始 | P2 |"
          }
        ]
      }
    ]
  }
]
// 需求表: +2 -1

// ---------- commit diff（提交2 vs 提交1）README ----------
export const README_COMMIT_HUNKS: GitDiffResult['hunks'] = [
  {
    oldStart: 1,
    oldLines: 14,
    newStart: 1,
    newLines: 19,
    lines: [
      {
        kind: "ctx",
        text: "# 演示笔记",
        words: [
          {
            kind: "ctx",
            text: "# 演示笔记"
          }
        ]
      },
      {
        kind: "ctx",
        text: "",
        words: [
          {
            kind: "ctx",
            text: ""
          }
        ]
      },
      {
        kind: "add",
        text: "> 旧版本说明：这段提醒只存在于 HEAD，工作区版本中已删除（展示纯删除块的红底划线效果）。",
        words: [
          {
            kind: "add",
            text: "> 旧版本说明：这段提醒只存在于 HEAD，工作区版本中已删除（展示纯删除块的红底划线效果）。"
          }
        ]
      },
      {
        kind: "add",
        text: "",
        words: null
      },
      {
        kind: "ctx",
        text: "本仓库演示 Git 工作台的全部效果：",
        words: [
          {
            kind: "ctx",
            text: "本仓库演示 Git 工作台的全部效果："
          }
        ]
      },
      {
        kind: "ctx",
        text: "",
        words: [
          {
            kind: "ctx",
            text: ""
          }
        ]
      },
      {
        kind: "del",
        text: "- 打开工作区文件查看未提交改动",
        words: [
          {
            kind: "ctx",
            text: "- "
          },
          {
            kind: "del",
            text: "打开工作区文件查看未提交改动"
          }
        ]
      },
      {
        kind: "add",
        text: "- 打开工作区文件查看未提交改动（默认渲染模式：mermaid 图/嵌入卡片真实对比）",
        words: [
          {
            kind: "ctx",
            text: "- "
          },
          {
            kind: "add",
            text: "打开工作区文件查看未提交改动（默认渲染模式：mermaid 图/嵌入卡片真实对比）"
          }
        ]
      },
      {
        kind: "ctx",
        text: "- 切「文本」模式查看分栏与词级高亮",
        words: [
          {
            kind: "ctx",
            text: "- 切「文本」模式查看分栏与词级高亮"
          }
        ]
      },
      {
        kind: "add",
        text: "- 历史区点提交查看 commit diff；Shift+点击两提交做范围对比",
        words: [
          {
            kind: "add",
            text: "- 历史区点提交查看 commit diff；Shift+点击两提交做范围对比"
          }
        ]
      },
      {
        kind: "add",
        text: "- 工具栏「还原…」可还原整文件或单段改动",
        words: [
          {
            kind: "add",
            text: "- 工具栏「还原…」可还原整文件或单段改动"
          }
        ]
      },
      {
        kind: "ctx",
        text: "",
        words: [
          {
            kind: "ctx",
            text: ""
          }
        ]
      },
      {
        kind: "ctx",
        text: "## 需求清单",
        words: [
          {
            kind: "ctx",
            text: "## 需求清单"
          }
        ]
      },
      {
        kind: "ctx",
        text: "",
        words: [
          {
            kind: "ctx",
            text: ""
          }
        ]
      },
      {
        kind: "ctx",
        text: "- 需求一：登录模块",
        words: [
          {
            kind: "ctx",
            text: "- 需求一：登录模块"
          }
        ]
      },
      {
        kind: "ctx",
        text: "- 需求二：支付模块",
        words: [
          {
            kind: "ctx",
            text: "- 需求二：支付模块"
          }
        ]
      },
      {
        kind: "add",
        text: "- 需求三：报表模块",
        words: [
          {
            kind: "add",
            text: "- 需求三：报表模块"
          }
        ]
      },
      {
        kind: "ctx",
        text: "",
        words: [
          {
            kind: "ctx",
            text: ""
          }
        ]
      },
      {
        kind: "ctx",
        text: "## 流程图",
        words: [
          {
            kind: "ctx",
            text: "## 流程图"
          }
        ]
      },
      {
        kind: "ctx",
        text: "",
        words: [
          {
            kind: "ctx",
            text: ""
          }
        ]
      }
    ]
  },
  {
    oldStart: 18,
    oldLines: 8,
    newStart: 23,
    newLines: 18,
    lines: [
      {
        kind: "ctx",
        text: "  B -- 是 --> C[支付成功]",
        words: [
          {
            kind: "ctx",
            text: "  B -- 是 --> C[支付成功]"
          }
        ]
      },
      {
        kind: "ctx",
        text: "  B -- 否 --> D[余额不足]",
        words: [
          {
            kind: "ctx",
            text: "  B -- 否 --> D[余额不足]"
          }
        ]
      },
      {
        kind: "ctx",
        text: "  D --> E[引导充值]",
        words: [
          {
            kind: "ctx",
            text: "  D --> E[引导充值]"
          }
        ]
      },
      {
        kind: "add",
        text: "  G[余额查询] --> B",
        words: [
          {
            kind: "ctx",
            text: "  "
          },
          {
            kind: "add",
            text: "G[余额查询] --> B"
          }
        ]
      },
      {
        kind: "ctx",
        text: "```",
        words: [
          {
            kind: "ctx",
            text: "```"
          }
        ]
      },
      {
        kind: "ctx",
        text: "",
        words: [
          {
            kind: "ctx",
            text: ""
          }
        ]
      },
      {
        kind: "ctx",
        text: "## 嵌入笔记",
        words: [
          {
            kind: "ctx",
            text: "## 嵌入笔记"
          }
        ]
      },
      {
        kind: "ctx",
        text: "",
        words: [
          {
            kind: "ctx",
            text: ""
          }
        ]
      },
      {
        kind: "ctx",
        text: "![[Git演示/笔记/会议纪要.md]]",
        words: [
          {
            kind: "ctx",
            text: "![[Git演示/笔记/会议纪要.md]]"
          }
        ]
      },
      {
        kind: "add",
        text: "",
        words: null
      },
      {
        kind: "add",
        text: "## 数据表",
        words: [
          {
            kind: "add",
            text: "## 数据表"
          }
        ]
      },
      {
        kind: "add",
        text: "",
        words: null
      },
      {
        kind: "add",
        text: "![[Git演示/数据/需求表.md]]",
        words: [
          {
            kind: "add",
            text: "![[Git演示/数据/需求表.md]]"
          }
        ]
      },
      {
        kind: "add",
        text: "",
        words: null
      },
      {
        kind: "add",
        text: "## 相关引用",
        words: [
          {
            kind: "add",
            text: "## 相关引用"
          }
        ]
      },
      {
        kind: "add",
        text: "",
        words: null
      },
      {
        kind: "add",
        text: "- 参见 [[Git演示/笔记/会议纪要.md#议题]]",
        words: [
          {
            kind: "add",
            text: "- 参见 [[Git演示/笔记/会议纪要.md#议题]]"
          }
        ]
      },
      {
        kind: "add",
        text: "- 参见 [[README#需求清单]]",
        words: [
          {
            kind: "add",
            text: "- 参见 [[README#需求清单]]"
          }
        ]
      }
    ]
  }
]
// README commit: +16 -1

// ---------- 仓库元信息 ----------
// ---------- 仓库元信息 ----------
export const DEMO_REPO = { isRepo: true, branch: 'main', headHash: '1e7728bb136ba3bf7ab287f07399c7f7bea1b63f' } as const

export const DEMO_STATUS: GitFileStatus[] = [
  { path: 'Git演示/README.md', status: 'M', added: 8, deleted: 9 },
  { path: 'Git演示/数据/需求表.md', status: 'M', added: 2, deleted: 1 },
  { path: 'Git演示/笔记/会议纪要.md', status: 'M', added: 2, deleted: 1 },
]

export const DEMO_LOG: GitCommit[] = [
  {
    hash: '1e7728bb136ba3bf7ab287f07399c7f7bea1b63f',
    parents: ['0fa9c81177aa44bb55cc66dd77ee88ff9900aa11', '4d2e1f9ab8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3'],
    author: 'Alice',
    date: Math.floor(Date.now() / 1000) - 86400 * 2,
    message: '优化流程图与需求清单（合并 feature/图表优化）',
  },
  {
    hash: '0fa9c81177aa44bb55cc66dd77ee88ff9900aa11',
    parents: ['c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7'],
    author: 'Bob',
    date: Math.floor(Date.now() / 1000) - 86400 * 4,
    message: '补充需求表与会议纪要',
  },
  {
    hash: '4d2e1f9ab8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3',
    parents: ['c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7'],
    author: 'Carol',
    date: Math.floor(Date.now() / 1000) - 86400 * 3,
    message: '图表优化：mermaid 节点级标注',
  },
  {
    hash: 'c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7',
    parents: [],
    author: 'Bob',
    date: Math.floor(Date.now() / 1000) - 86400 * 6,
    message: '初始提交：演示笔记骨架',
  },
]

export const DEMO_SHOW_COMMIT = {
  hash: '1e7728bb136ba3bf7ab287f07399c7f7bea1b63f',
  author: 'Alice',
  date: Math.floor(Date.now() / 1000) - 86400 * 2,
  message: '优化流程图与需求清单',
  files: [
    { path: 'Git演示/README.md', status: 'M', added: 16, deleted: 1 },
    { path: 'Git演示/数据/需求表.md', status: 'M', added: 1, deleted: 0 },
    { path: 'Git演示/笔记/会议纪要.md', status: 'M', added: 1, deleted: 0 },
  ] as GitCommitFile[],
}

export const DEMO_BRANCHES: GitBranch[] = [
  { name: 'main', isCurrent: true, remote: null, aheadBehind: null },
  { name: 'feature/图表优化', isCurrent: false, remote: null, aheadBehind: null },
]
