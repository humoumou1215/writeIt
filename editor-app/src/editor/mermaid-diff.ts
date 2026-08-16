// M13：mermaid 节点级 diff——flowchart / sequenceDiagram / stateDiagram
// flowchart & state：合并源码（新为底 + 删除节点加回 + classDef + id:::class 标注）
// sequence：新源码渲染 + 渲染后 DOM 操作（变更消息文本加 class）；删除消息进批注卡

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
  /** 合并后的源码（fence 渲染用；sequence = 新源码原样） */
  merged: string
  /** 变更消息文本（sequence DOM 操作用） */
  messages?: Array<{ kind: 'add' | 'mod'; text: string }>
}

export function detectMermaidType(src: string): MermaidNodeDiff['type'] {
  if (/^\s*(graph|flowchart)\s+(TD|LR|RL|BT|TB)\b/m.test(src)) return 'flowchart'
  if (/^\s*sequenceDiagram\b/m.test(src)) return 'sequence'
  if (/^\s*stateDiagram(-v2)?\b/m.test(src)) return 'state'
  return 'unknown'
}

// ---------- flowchart ----------

const FC_NODE_RE = /^\s*([A-Za-z0-9_]+)\s*(\[[^\]]*\]|\{[^}]*\}|\(\([^)]*\)\)|\(\[[^\]]*\]\)|\[\[[^\]]*\]\]|\([^)]*\))/
const FC_EDGE_RE = /^\s*([A-Za-z0-9_]+)\s*(-->|---|==>|-.->)\s*(.*)$/
const FC_KEYWORDS = new Set([
  'graph', 'flowchart', 'end', 'subgraph', 'direction', 'classDef', 'click', 'style', 'linkStyle',
])

function extractFlowchartNodes(src: string): Map<string, string> {
  const nodes = new Map<string, string>()
  for (const line of src.split('\n')) {
    const m = FC_NODE_RE.exec(line)
    if (m && !FC_KEYWORDS.has(m[1])) {
      nodes.set(m[1], m[2].slice(1, -1).trim())
      continue
    }
    // 边行：A --> B / A -->|label| B（无形状节点也定义节点）
    const em = FC_EDGE_RE.exec(line)
    if (em && !FC_KEYWORDS.has(em[1])) {
      nodes.set(em[1], em[1])
      const tm = /^(?:\|[^|]*\|)?\s*([A-Za-z0-9_]+)/.exec(em[3])
      if (tm && !FC_KEYWORDS.has(tm[1])) nodes.set(tm[1], tm[1])
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
  for (const [id, label] of newNodes) {
    if (!oldNodes.has(id)) add.push(id)
    else if (oldNodes.get(id) !== label) mod.push({ id, old: oldNodes.get(id)!, new: label })
  }
  for (const id of oldNodes.keys()) {
    if (!newNodes.has(id)) del.push(id)
  }
  const merged = mergeFlowchart(newSrc, oldNodes, { add, del, mod })
  return { type: 'flowchart', add, del, mod, merged }
}

function mergeFlowchart(
  newSrc: string,
  oldNodes: Map<string, string>,
  diff: { add: string[]; del: string[]; mod: MermaidMod[] }
): string {
  const out: string[] = [
    'classDef diffAdd fill:#dff0d8,stroke:#3c763d,color:#2e5d2e',
    'classDef diffDel fill:#f2dede,stroke:#a94442,color:#7a2a2a',
    'classDef diffMod fill:#fdf6e3,stroke:#b58900,color:#7a5c00',
  ]
  const isChanged = (id: string) => diff.add.includes(id) || diff.mod.some((x) => x.id === id)
  const cls = (id: string) =>
    diff.add.includes(id) ? ':::diffAdd' : diff.mod.some((x) => x.id === id) ? ':::diffMod' : ''
  for (const line of newSrc.split('\n')) {
    const m = FC_NODE_RE.exec(line)
    if (m && isChanged(m[1])) {
      out.push(`${line}${cls(m[1])}`)
      continue
    }
    // 边行：目标节点标注（A --> B:::diffAdd）
    const em = FC_EDGE_RE.exec(line)
    if (em) {
      const tm = /^(?:\|[^|]*\|)?\s*([A-Za-z0-9_]+)/.exec(em[3])
      if (tm && isChanged(tm[1])) {
        out.push(`${line}${cls(tm[1])}`)
        continue
      }
    }
    out.push(line)
  }
  // 删除节点加回（保持可见，红底划线）
  for (const id of diff.del) {
    const label = oldNodes.get(id)
    if (label !== undefined) out.push(`${id}[${label}]:::diffDel`)
  }
  return out.join('\n')
}

// ---------- sequence ----------

const SEQ_MSG_RE = /^\s*([A-Za-z0-9_]+)\s*(->>|-->>|->|-->|-)>\s*([A-Za-z0-9_]+)\s*:\s*(.*)$/

function extractSequenceMessages(src: string): string[] {
  const msgs: string[] = []
  for (const line of src.split('\n')) {
    const m = SEQ_MSG_RE.exec(line)
    if (m) msgs.push(m[4].trim())
  }
  return msgs
}

/** 简单 LCS 文本序列 diff（按序标记增删改） */
function diffTextSeq(oldSeq: string[], newSeq: string[]): {
  add: string[]
  del: string[]
  mod: MermaidMod[]
  messages: Array<{ kind: 'add' | 'mod'; text: string }>
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
  const mod: MermaidMod[] = []
  const messages: Array<{ kind: 'add' | 'mod'; text: string }> = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (oldSeq[i] === newSeq[j]) {
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      del.push(oldSeq[i])
      i++
    } else {
      // 尝试与后续 del 配对为 mod（同位置修改）
      if (i < n && oldSeq[i] !== newSeq[j]) {
        mod.push({ id: `s${i}`, old: oldSeq[i], new: newSeq[j] })
        messages.push({ kind: 'mod', text: newSeq[j] })
        i++
        j++
      } else {
        add.push(newSeq[j])
        messages.push({ kind: 'add', text: newSeq[j] })
        j++
      }
    }
  }
  while (i < n) del.push(oldSeq[i++])
  while (j < m) {
    add.push(newSeq[j])
    messages.push({ kind: 'add', text: newSeq[j] })
    j++
  }
  return { add, del, mod, messages }
}

function diffSequence(oldSrc: string, newSrc: string): MermaidNodeDiff {
  const oldMsgs = extractSequenceMessages(oldSrc)
  const newMsgs = extractSequenceMessages(newSrc)
  const r = diffTextSeq(oldMsgs, newMsgs)
  return {
    type: 'sequence',
    add: r.add,
    del: r.del,
    mod: r.mod,
    merged: newSrc, // 新源码原样（删除消息无法加回，进批注卡）
    messages: r.messages,
  }
}

// ---------- state ----------

const ST_RE = /^\s*state\s+(?:"([^"]*)"\s+as\s+)?(\w+)/

function extractStates(src: string): Map<string, string> {
  const states = new Map<string, string>()
  for (const line of src.split('\n')) {
    const m = ST_RE.exec(line)
    if (m) states.set(m[2], m[1] ?? m[2])
  }
  return states
}

function diffState(oldSrc: string, newSrc: string): MermaidNodeDiff {
  const oldStates = extractStates(oldSrc)
  const newStates = extractStates(newSrc)
  const add: string[] = []
  const del: string[] = []
  const mod: MermaidMod[] = []
  for (const [id, label] of newStates) {
    if (!oldStates.has(id)) add.push(id)
    else if (oldStates.get(id) !== label) mod.push({ id, old: oldStates.get(id)!, new: label })
  }
  for (const id of oldStates.keys()) if (!newStates.has(id)) del.push(id)
  const merged = mergeState(newSrc, oldStates, { add, del, mod })
  return { type: 'state', add, del, mod, merged }
}

function mergeState(
  newSrc: string,
  oldStates: Map<string, string>,
  diff: { add: string[]; del: string[]; mod: MermaidMod[] }
): string {
  const out: string[] = [
    'classDef diffAdd fill:#dff0d8,stroke:#3c763d,color:#2e5d2e',
    'classDef diffDel fill:#f2dede,stroke:#a94442,color:#7a2a2a',
    'classDef diffMod fill:#fdf6e3,stroke:#b58900,color:#7a5c00',
  ]
  for (const line of newSrc.split('\n')) {
    const m = ST_RE.exec(line)
    if (m && diff.add.includes(m[2])) out.push(line + ':::diffAdd')
    else if (m && diff.mod.some((x) => x.id === m[2])) out.push(line + ':::diffMod')
    else out.push(line)
  }
  for (const id of diff.del) {
    const label = oldStates.get(id)
    if (label !== undefined) out.push(`state "${label}" as ${id}:::diffDel`)
  }
  return out.join('\n')
}

// ---------- 入口 ----------

export function diffMermaid(oldSrc: string, newSrc: string): MermaidNodeDiff {
  const type = detectMermaidType(newSrc)
  if (type === 'flowchart') return diffFlowchart(oldSrc, newSrc)
  if (type === 'sequence') return diffSequence(oldSrc, newSrc)
  if (type === 'state') return diffState(oldSrc, newSrc)
  return { type: 'unknown', add: [], del: [], mod: [], merged: newSrc }
}
