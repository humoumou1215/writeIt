// M13：mermaid 节点级 diff——flowchart / sequenceDiagram / stateDiagram
// M18（§4.8）：
//   · flowchart & state：合并源码 = 新为底 + 删除节点加回 + **classDef/class 声明**（mermaid 原生渲染图内红绿）
//     ——不再依赖渲染后 DOM 手术（DOM class 手术降为 fallback）。
//   · sequence：SVG 内不再标注（最脆匹配路径删除）；删除/新增消息由保证层源码逐行红绿卡承载，
//     merged 保序保拓扑（删除消息按 LCS 插回原位，规则 5 表达位置改变）。
//   · 置信度门槛：零节点提取 / 无法归类的语法 → 该 fence 整体降级 fence 级（type='unknown'，
//     merged=新源码原样；保证层卡附新旧源码对比），不静默错标。

export interface MermaidMod {
  id: string
  old: string
  new: string
}

export interface MermaidNodeDiff {
  type: 'flowchart' | 'sequence' | 'state' | 'unknown'
  /** 新增节点/消息（文本或 id） */
  add: string[]
  /** 删除节点/消息 */
  del: string[]
  /** 修改（标签/文本变化） */
  mod: MermaidMod[]
  /** 合并后的源码（fence 渲染用；flowchart/state 尾部带 classDef/class 声明） */
  merged: string
  /** 解析置信度：0.5 以下视作 fence 级降级依据（保证层卡）；固定输出字符串供契约断言 */
  confidence?: number
  /** 降级原因（置信度不足时的 token/行号） */
  degradeReason?: string
}

export function detectMermaidType(src: string): MermaidNodeDiff['type'] {
  if (/^\s*(graph|flowchart)\s+(TD|LR|RL|BT|TB)\b/m.test(src)) return 'flowchart'
  if (/^\s*sequenceDiagram\b/m.test(src)) return 'sequence'
  if (/^\s*stateDiagram(-v2)?\b/m.test(src)) return 'state'
  return 'unknown'
}

// ---------- classDef/class 声明（§4.8 主路径：mermaid 原生渲染图内红绿；CSS 与 diff.css 同源） ----------

export const DEFAULT_CLASS_DEF = `classDef diffAdd fill:#e8f5e9,stroke:#2e7d32,color:#1b5e20,stroke-width:2px;
classDef diffDel fill:#fdecea,stroke:#c62828,color:#8e0000,stroke-width:2px,stroke-dasharray:4 3;
`

/** 追加 classDef 定义 + class 声明（追加到源码尾部；不逐行 ::: 注入，避免边引用裸 id 的语法坑） */
export function appendMermaidClasses(
  mergedSrc: string,
  addIds: string[],
  delIds: string[]
): string {
  const cls: string[] = []
  if (addIds.length) cls.push(`class ${addIds.join(',')} diffAdd`)
  if (delIds.length) cls.push(`class ${delIds.join(',')} diffDel`)
  if (!cls.length) return mergedSrc
  return `${mergedSrc}\n${DEFAULT_CLASS_DEF}\n${cls.join('\n')}`
}

// ---------- flowchart ----------

const FC_NODE_RE = /^\s*([A-Za-z0-9_]+)\s*(\[[^\]]*\]|\{[^}]*\}|\(\([^)]*\)\)|\(\[[^\]]*\]\)|\[\[[^\]]*\]\]|\([^)]*\))/
const EDGE_SEP_RE = /(-->|---|==>|-.->)/
const FC_KEYWORDS = new Set([
  'graph', 'flowchart', 'end', 'subgraph', 'direction', 'classDef', 'click', 'style', 'linkStyle',
])

interface FcNodeInfo {
  label: string
  /** 节点首次定义行（合并源码加回删除节点时用整行，保留边） */
  line: string
  /** 有形状定义（id[形状]）才算真实 label——裸 id 出现不视为修改 */
  hasShape: boolean
}

/** 提取 flowchart 节点（id → label + 定义行）。
 *  支持带边标签的行（B -- 是 --> C[...] / A -->|label| B）：按边分隔符拆段逐段解析；
 *  有形状的节点定义优先，裸 id 不覆盖已有形状定义。 */
export function extractFlowchartNodes(src: string): Map<string, FcNodeInfo> {
  const nodes = new Map<string, FcNodeInfo>()
  for (const line of src.split('\n')) {
    const t = line.trim()
    if (!t || FC_KEYWORDS.has(t.split(/\s+/)[0])) continue
    for (let seg of t.split(EDGE_SEP_RE)) {
      seg = seg.replace(/^\|[^|]*\|/, '').trim()
      if (!seg) continue
      const m = FC_NODE_RE.exec(seg)
      if (m && !FC_KEYWORDS.has(m[1])) {
        const info = nodes.get(m[1])
        if (info && info.hasShape) continue
        nodes.set(m[1], { label: m[2].slice(1, -1).trim(), line, hasShape: true })
        continue
      }
      const idm = /^([A-Za-z0-9_]+)/.exec(seg)
      if (idm && !FC_KEYWORDS.has(idm[1]) && !nodes.has(idm[1])) {
        nodes.set(idm[1], { label: idm[1], line, hasShape: false })
      }
    }
  }
  return nodes
}

function diffFlowchart(oldSrc: string, newSrc: string): MermaidNodeDiff {
  const oldNodes = extractFlowchartNodes(oldSrc)
  const newNodes = extractFlowchartNodes(newSrc)
  const add: string[] = []
  const del: string[] = []
  const mod: MermaidMod[] = []
  for (const [id, info] of newNodes) {
    const old = oldNodes.get(id)
    if (!old) add.push(id)
    else if (old.hasShape && info.hasShape && old.label !== info.label) {
      mod.push({ id, old: old.label, new: info.label })
    }
  }
  for (const id of oldNodes.keys()) {
    if (!newNodes.has(id)) del.push(id)
  }
  let merged = mergeFlowchart(newSrc, oldNodes, { add, del, mod })
  let confidence = 1
  let degradeReason: string | undefined
  // 置信度门槛（§4.8）：非空 flowchart body 但零节点提取 → 解析面不足，降级 fence 级
  const bodyHasContent = newSrc.split('\n').some((l) => l.trim() && !/^(graph|flowchart|end|subgraph|direction|%%)/.test(l.trim()))
  if (bodyHasContent && newNodes.size === 0) {
    confidence = 0.2
    degradeReason = 'flowchart 无法归类的 token（零节点提取）'
    merged = newSrc
  }
  if (confidence >= 0.5 && (add.length || del.length || mod.length)) {
    merged = appendMermaidClasses(merged, mod ? [...add, ...mod.map((m) => m.id)] : add, del)
  }
  return { type: 'flowchart', add, del, mod, merged, confidence, degradeReason }
}

function mergeFlowchart(
  newSrc: string,
  oldNodes: Map<string, FcNodeInfo>,
  diff: { add: string[]; del: string[]; mod: MermaidMod[] }
): string {
  const out = newSrc.split('\n')
  // 删除节点加回（原定义行含边，保持可见；class 标注红）——不带任何逐行标注语法
  const addedLines = new Set<string>()
  for (const id of diff.del) {
    const info = oldNodes.get(id)
    if (info && !addedLines.has(info.line)) {
      out.push(info.line)
      addedLines.add(info.line)
    }
  }
  return out.join('\n')
}

// ---------- sequence ----------

const SEQ_MSG_RE = /^\s*([A-Za-z0-9_]+)\s*(->>|-->>|->|-->|-)>\s*([A-Za-z0-9_]+)\s*:\s*(.*)$/
const SEQ_PART_RE = /^\s*participant\s+([A-Za-z0-9_]+)(?:\s+as\s+(.+))?$/

/** 参与者行（含原文） */
interface SeqPartRow {
  id: string
  label: string
  line: string
}

function extractPartRows(src: string): SeqPartRow[] {
  const rows: SeqPartRow[] = []
  for (const line of src.split('\n')) {
    const m = SEQ_PART_RE.exec(line)
    if (m) rows.push({ id: m[1], label: (m[2] || m[1]).trim(), line })
  }
  return rows
}

/** 消息行（含原文，供删除消息加回渲染） */
interface SeqMsgRow {
  msg: string
  line: string
}

export function extractSequenceMessages(src: string): string[] {
  return extractSequenceRows(src).map((r) => r.msg)
}

function extractSequenceRows(src: string): SeqMsgRow[] {
  const rows: SeqMsgRow[] = []
  for (const line of src.split('\n')) {
    const m = SEQ_MSG_RE.exec(line)
    if (m) rows.push({ msg: m[4].trim(), line })
  }
  return rows
}

/** 简单 LCS 文本序列 diff（按序标记增删；M16：去掉 mod 配对——修改视为删+增二元） */
interface SeqStep {
  kind: 'ctx' | 'del' | 'add'
  oldIdx: number
  newIdx: number
}

function diffTextSeq(oldSeq: string[], newSeq: string[]): {
  add: string[]
  del: string[]
  steps: SeqStep[]
} {
  const n = oldSeq.length
  const m = newSeq.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] =
        oldSeq[i] === newSeq[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const add: string[] = []
  const del: string[] = []
  const steps: SeqStep[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (oldSeq[i] === newSeq[j]) {
      steps.push({ kind: 'ctx', oldIdx: i, newIdx: j })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      del.push(oldSeq[i])
      steps.push({ kind: 'del', oldIdx: i, newIdx: -1 })
      i++
    } else {
      add.push(newSeq[j])
      steps.push({ kind: 'add', oldIdx: -1, newIdx: j })
      j++
    }
  }
  while (i < n) {
    del.push(oldSeq[i])
    steps.push({ kind: 'del', oldIdx: i, newIdx: -1 })
    i++
  }
  while (j < m) {
    add.push(newSeq[j])
    steps.push({ kind: 'add', oldIdx: -1, newIdx: j })
    j++
  }
  return { add, del, steps }
}

function diffSequence(oldSrc: string, newSrc: string): MermaidNodeDiff {
  const oldRows = extractSequenceRows(oldSrc)
  const newRows = extractSequenceRows(newSrc)
  const r = diffTextSeq(
    oldRows.map((x) => x.msg),
    newRows.map((x) => x.msg)
  )
  // M18 §4.8（契约规则 5 修订）：SVG 内不再标注——图渲染新版本原样；
  // 删除消息/参与者由保证层源码逐行红绿卡承载（保序语义不变，表达位置改变）。
  const oldParts = extractPartRows(oldSrc)
  const newParts = extractPartRows(newSrc)
  const delParts = oldParts.filter((p) => !newParts.some((n) => n.id === p.id))
  const addParts = newParts.filter((p) => !oldParts.some((n) => n.id === p.id))
  return {
    type: 'sequence',
    add: [...r.add, ...addParts.map((p) => p.label)],
    del: [...r.del, ...delParts.map((p) => p.label)],
    mod: [],
    merged: newSrc,
    confidence: 1,
    // 保证层：删除消息的旧值（卡片红行预览）
  }
}

// ---------- state ----------

const ST_RE = /^\s*state\s+(?:"([^"]*)"\s+as\s+)?(\w+)/

interface StNodeInfo {
  label: string
  line: string
}

export function extractStates(src: string): Map<string, StNodeInfo> {
  const states = new Map<string, StNodeInfo>()
  for (const line of src.split('\n')) {
    const m = ST_RE.exec(line)
    if (m) states.set(m[2], { label: m[1] ?? m[2], line })
  }
  return states
}

function diffState(oldSrc: string, newSrc: string): MermaidNodeDiff {
  const oldStates = extractStates(oldSrc)
  const newStates = extractStates(newSrc)
  const add: string[] = []
  const del: string[] = []
  const mod: MermaidMod[] = []
  for (const [id, info] of newStates) {
    if (!oldStates.has(id)) add.push(id)
    else if (oldStates.get(id)!.label !== info.label) mod.push({ id, old: oldStates.get(id)!.label, new: info.label })
  }
  for (const id of oldStates.keys()) if (!newStates.has(id)) del.push(id)
  let merged = mergeState(newSrc, oldStates, oldSrc.split('\n'), { add, del, mod })
  let confidence = 1
  let degradeReason: string | undefined
  const bodyHasContent = newSrc.split('\n').some(
    (l) => l.trim() && !/^(stateDiagram|stateDiagram-v2|end|note|direction|%%)/.test(l.trim())
  )
  if (bodyHasContent && newStates.size === 0) {
    confidence = 0.2
    degradeReason = 'stateDiagram 无法归类的 token（零状态提取）'
    merged = newSrc
  }
  if (confidence >= 0.5 && (add.length || del.length)) {
    merged = appendMermaidClasses(merged, add, del)
  }
  return { type: 'state', add, del, mod, merged, confidence, degradeReason }
}

function mergeState(
  newSrc: string,
  oldStates: Map<string, StNodeInfo>,
  oldSrcLines: string[],
  diff: { add: string[]; del: string[]; mod: MermaidMod[] }
): string {
  const out = newSrc.split('\n')
  const addedLines = new Set<string>()
  for (const id of diff.del) {
    const info = oldStates.get(id)
    if (!info) continue
    // M16b：删除状态加回「定义行 + 所有含该 id 的过渡行」（WAIT --> ROUTED / ROUTED --> LENDING），
    //   否则删除状态孤立、过渡线丢失（红标应同时覆盖节点与边）
    for (const line of oldSrcLines) {
      const t = line.trim()
      if (addedLines.has(line)) continue
      const isDef = t === info.line.trim()
      const isTransition = /\s*\w+\s*-->\s*\w+\s*$/.test(t) && t.includes(id)
      if (isDef || isTransition) {
        out.push(line)
        addedLines.add(line)
      }
    }
  }
  return out.join('\n')
}

// ---------- 入口 ----------

export function diffMermaid(oldSrc: string, newSrc: string): MermaidNodeDiff {
  const type = detectMermaidType(newSrc)
  if (type === 'flowchart') return diffFlowchart(oldSrc, newSrc)
  if (type === 'sequence') return diffSequence(oldSrc, newSrc)
  if (type === 'state') return diffState(oldSrc, newSrc)
  return {
    type: 'unknown',
    add: [],
    del: [],
    mod: [],
    merged: newSrc,
    confidence: 0.1,
    degradeReason: '无法识别的 mermaid 图类型',
  }
}