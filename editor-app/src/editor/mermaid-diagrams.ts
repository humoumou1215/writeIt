/**
 * Mermaid 图表类型清单（mermaid@11.16.1）
 *
 * 每种图表的示例内容均基于 mermaid 官方文档（docs/syntax/*.md）精简，
 * 保证语法正确、可直接渲染。beta 图（标注 β）需要对应前缀触发。
 */

export interface MermaidDiagramItem {
  /** 唯一 key */
  key: string
  /** 菜单显示名 */
  label: string
  /** 图表 DSL 首行（用于识别与标注） */
  lang: string
  /** 插入代码块的默认示例内容（不含 ```mermaid 包裹） */
  example: string
}

export interface MermaidDiagramGroup {
  key: string
  label: string
  items: MermaidDiagramItem[]
}

export const MERMAID_GROUPS: MermaidDiagramGroup[] = [
  {
    key: 'mermaid-flow',
    label: '流程 & 结构',
    items: [
      {
        key: 'flowchart',
        label: 'Flowchart 流程图',
        lang: 'graph',
        example: `graph TD
  A[开始] --> B{有权限?}
  B -->|是| C[处理请求]
  B -->|否| D[拒绝访问]
  C --> E[结束]`,
      },
      {
        key: 'sequence',
        label: 'Sequence 时序图',
        lang: 'sequenceDiagram',
        example: `sequenceDiagram
  participant U as 用户
  participant S as 服务端
  U->>S: 登录请求
  S-->>U: 返回令牌
  U->>S: 携带令牌访问
  S-->>U: 业务数据`,
      },
      {
        key: 'state',
        label: 'State 状态图',
        lang: 'stateDiagram-v2',
        example: `stateDiagram-v2
  [*] --> 待机
  待机 --> 运行: 启动
  运行 --> 待机: 停止
  运行 --> 故障: 异常
  故障 --> 待机: 恢复
  运行 --> [*]`,
      },
      {
        key: 'class',
        label: 'Class 类图',
        lang: 'classDiagram',
        example: `classDiagram
  class Animal {
    +String name
    +move() void
  }
  class Dog {
    +bark() void
  }
  class Cat {
    +meow() void
  }
  Animal <|-- Dog
  Animal <|-- Cat`,
      },
      {
        key: 'block',
        label: 'Block 块图 β',
        lang: 'block-beta',
        example: `block-beta
  columns 3
  A["用户"] B["服务"] C["数据库"]
  A --> B
  B --> C`,
      },
      {
        key: 'mindmap',
        label: 'Mindmap 思维导图',
        lang: 'mindmap',
        example: `mindmap
  root((Milkdown))
    编辑器
      所见即所得
      Markdown 优先
    插件体系
      Crepe
      Kit`,
      },
      {
        key: 'timeline',
        label: 'Timeline 时间线',
        lang: 'timeline',
        example: `timeline
  title 项目里程碑
  2026 Q1: 需求分析: 原型设计
  2026 Q2: 开发: 测试
  2026 Q3: 发布上线`,
      },
      {
        key: 'git',
        label: 'Git 分支图',
        lang: 'gitGraph',
        example: `gitGraph
  commit id: "初始提交"
  branch feature
  checkout feature
  commit id: "功能开发"
  commit id: "联调修复"
  checkout main
  commit id: "主线更新"
  merge feature
  commit id: "发布"`,
      },
    ],
  },
  {
    key: 'mermaid-model',
    label: '建模 & 关系',
    items: [
      {
        key: 'er',
        label: 'ER 实体关系图',
        lang: 'erDiagram',
        example: `erDiagram
  USER ||--o{ ORDER : 下单
  ORDER ||--|{ ORDER_ITEM : 包含
  USER {
    string name
    string email
  }
  ORDER {
    int id
    string status
  }`,
      },
      {
        key: 'c4',
        label: 'C4 系统架构图',
        lang: 'C4Context',
        example: `C4Context
  title System Context
  Person(user, "用户", "系统的使用者")
  System(biz, "业务系统", "核心业务功能")
  System_Ext(ext, "外部服务", "第三方依赖")
  Rel(user, biz, "使用")
  Rel(biz, ext, "依赖")`,
      },
      {
        key: 'architecture',
        label: 'Architecture 架构图 β',
        lang: 'architecture-beta',
        example: `architecture-beta
  group api(cloud)[API]
  service web(server)[Web Server] in api
  service db(database)[Database]
  web:R -- L:db`,
      },
      {
        key: 'kanban',
        label: 'Kanban 看板',
        lang: 'kanban',
        example: `kanban
  Todo[待办]
    t1[需求分析]
    t2[原型设计]
  Doing[进行中]
    t3[编码实现]
  Done[已完成]
    t4[需求调研]`,
      },
      {
        key: 'requirement',
        label: 'Requirement 需求图',
        lang: 'requirementDiagram',
        example: `requirementDiagram
  requirement login_req {
    id: 1
    text: User can login to the system
    risk: high
    verifymethod: test
  }
  element login_module {
    type: system
  }
  login_module - satisfies -> login_req`,
      },
      {
        key: 'eventmodeling',
        label: 'Event Modeling 事件建模',
        lang: 'eventmodeling',
        example: `eventmodeling
tf 01 ui CartUI
tf 02 cmd AddItem
tf 03 evt ItemAdded`,
      },
      {
        key: 'cynefin',
        label: 'Cynefin 认知框架 β',
        lang: 'cynefin-beta',
        example: `cynefin-beta
  title 故障响应
  clear
    "重启服务"
  complicated
    "分析性能日志"
  complex
    "实验验证假设"
  chaotic
    "立即联系值班"`,
      },
    ],
  },
  {
    key: 'mermaid-data',
    label: '数据 & 统计',
    items: [
      {
        key: 'pie',
        label: 'Pie 饼图',
        lang: 'pie',
        example: `pie title 浏览器市场份额
  "Chrome" : 65
  "Firefox" : 15
  "Safari" : 12
  "其他" : 8`,
      },
      {
        key: 'xychart',
        label: 'XY Chart 柱线图',
        lang: 'xychart',
        example: `xychart
  title "月度销售额"
  x-axis [Jan, Feb, Mar, Apr]
  y-axis "销售额" 0 --> 100
  bar [40, 70, 90, 60]
  line [30, 55, 80, 70]`,
      },
      {
        key: 'quadrant',
        label: 'Quadrant 象限图',
        lang: 'quadrantChart',
        example: `quadrantChart
  title 优先级矩阵
  x-axis 低影响 --> 高影响
  y-axis 低紧急 --> 高紧急
  quadrant-1 立即做
  quadrant-2 计划做
  quadrant-3 以后做
  quadrant-4 授权做
  任务A: [0.3, 0.7]
  任务B: [0.8, 0.8]`,
      },
      {
        key: 'sankey',
        label: 'Sankey 桑基图 β',
        lang: 'sankey-beta',
        example: `sankey-beta
Solar, Electricity, 100
Wind, Electricity, 80
Electricity, Grid, 180
Grid, Users, 170`,
      },
      {
        key: 'radar',
        label: 'Radar 雷达图 β',
        lang: 'radar-beta',
        example: `radar-beta
  axis math["Math"], sci["Science"], eng["English"]
  axis his["History"], geo["Geography"], art["Art"]
  curve ClassA{85, 90, 80, 70, 75, 90}
  curve ClassB{70, 75, 85, 80, 90, 85}
  max 100
  min 0`,
      },
      {
        key: 'venn',
        label: 'Venn 韦恩图 β',
        lang: 'venn-beta',
        example: `venn-beta
  title 技术栈交集
  set Frontend
  set Backend
  union Frontend,Backend["全栈"]`,
      },
      {
        key: 'treemap',
        label: 'Treemap 矩形树图 β',
        lang: 'treemap-beta',
        example: `treemap-beta
"前端"
    "HTML": 30
    "CSS": 25
    "JavaScript": 45
"后端"
    "Node.js": 60
    "Go": 40`,
      },
      {
        key: 'info',
        label: 'Info 信息图',
        lang: 'info',
        example: `info`,
      },
    ],
  },
  {
    key: 'mermaid-mgmt',
    label: '管理 & 分析',
    items: [
      {
        key: 'gantt',
        label: 'Gantt 甘特图',
        lang: 'gantt',
        example: `gantt
  title 项目计划
  dateFormat YYYY-MM-DD
  section 需求
    需求分析: a1, 2026-01-05, 7d
  section 开发
    编码实现: after a1, 14d
  section 测试
    测试验收: after a1, 7d`,
      },
      {
        key: 'journey',
        label: 'Journey 用户旅程',
        lang: 'journey',
        example: `journey
  title 我的工作日
  section 上午
    起床: 5: 我
    通勤: 3: 我
    工作: 4: 我
  section 下午
    会议: 3: 我
    下班: 5: 我`,
      },
      {
        key: 'ishikawa',
        label: 'Ishikawa 鱼骨图 β',
        lang: 'ishikawa-beta',
        example: `ishikawa-beta
    产品质量问题
    人员
        技能不足
        疲劳作业
    设备
        老化
        未校准
    流程
        缺少质检
        规范不清`,
      },
      {
        key: 'wardley',
        label: 'Wardley 价值链 β',
        lang: 'wardley-beta',
        example: `wardley-beta
  title Tea Shop Value Chain
  anchor business [0.95, 0.63]
  component tea [0.79, 0.61]
  component leaf [0.63, 0.81]
  component water [0.52, 0.80]
  business -> tea
  tea -> leaf
  tea -> water`,
      },
      {
        key: 'treeView',
        label: 'Tree View 目录树 β',
        lang: 'treeView-beta',
        example: `treeView-beta
├── src/
│   ├── main.ts
│   └── demo.md
├── index.html
└── package.json`,
      },
      {
        key: 'packet',
        label: 'Packet 数据包图 β',
        lang: 'packet-beta',
        example: `packet-beta
0-15: "源端口"
16-31: "目的端口"
32-63: "序号"
64-95: "确认号"
96-99: "数据偏移"
100-105: "保留"
106: "URG"
107: "ACK"
108: "PSH"`,
      },
      {
        key: 'railroad',
        label: 'Railroad 铁路图 β',
        lang: 'railroad-ebnf-beta',
        example: `railroad-ebnf-beta
title "数字定义"
digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" ;`,
      },
    ],
  },
]

/** 全部图表类型（扁平） */
export const MERMAID_DIAGRAMS: MermaidDiagramItem[] = MERMAID_GROUPS.flatMap(
  (g) => g.items
)

export const MERMAID_COUNT = MERMAID_DIAGRAMS.length

/**
 * slash 菜单精选模板（单 group，8 种常用类型）。
 * 注意：这只是菜单快捷模板；渲染能力对所有 30 种类型都可用
 * （手写任意 ```mermaid 代码块或从「图表集」载入均可渲染）。
 */
export const MERMAID_SLASH_SELECTION = [
  'flowchart',
  'sequence',
  'state',
  'class',
  'mindmap',
  'er',
  'c4',
  'gantt',
]

/** slash 菜单实际展示的条目（保持数据源顺序） */
export const MERMAID_SLASH_ITEMS: MermaidDiagramItem[] =
  MERMAID_DIAGRAMS.filter((d) => MERMAID_SLASH_SELECTION.includes(d.key))
