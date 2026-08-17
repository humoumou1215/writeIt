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
  /** 变更消息文本（sequence DOM 操作用，M16：仅增/删二元） */
  messages?: Array<{ kind: 'add' | 'del'; text: string }>
}

export function detectMermaidType(src: string): MermaidNodeDiff['type'] {
  if (/^\s*(graph|flowchart)\s+(TD|LR|RL|BT|TB)\b/m.test(src)) return 'flowchart'
  if (/^\s*sequenceDiagram\b/m.test(src)) return 'sequence'
  if (/^\s*stateDiagram(-v2)?\b/m.test(src)) return 'state'
  return 'unknown'
}

// M13：mermaid 节点级 diff——flowchart / sequenceDiagram / stateDiagram
// M14：不再用 classDef/id:::class 标注源码（用户拍板）——
//   合并源码 = 新版本源码 + 删除节点加回（原样语法），差异改由渲染后 DOM 标注（applyMermaidAnnotations）

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
 *  支持带边标签的行（B -- 是 --> C[...] / A -->|label| B）——M14 修复：
 *  按边分隔符拆段逐段解析；有形状的节点定义优先，裸 id 不覆盖已有形状定义。 */
export function extractFlowchartNodes(src: string): Map<string, FcNodeInfo> {
  const nodes = new Map<string, FcNodeInfo>()
  for (const line of src.split('\n')) {
    const t = line.trim()
    if (!t || FC_KEYWORDS.has(t.split(/\s+/)[0])) continue
    for (let seg of t.split(EDGE_SEP_RE)) {
      // 去掉边的 |label| 前缀（A -->|label| B）——注意真实语法是 |label|，
      // 旧正则 ^\|\[[^|]*\]\| 误匹配带方括号的内容；改为 ^\|[^|]*\|
      seg = seg.replace(/^\|[^|]*\|/, '').trim()
      if (!seg) continue
      const m = FC_NODE_RE.exec(seg)
      if (m && !FC_KEYWORDS.has(m[1])) {
        const info = nodes.get(m[1])
        if (info && info.hasShape) continue // 已有形状定义，裸后现不覆盖
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
    // M16b：同 id 标签变化（两侧都有真实形状）→ mod（渲染：绿新 + 红旧划线附加；统计算 删+增 各 1）
    else if (old.hasShape && info.hasShape && old.label !== info.label) {
      mod.push({ id, old: old.label, new: info.label })
    }
  }
  for (const id of oldNodes.keys()) {
    if (!newNodes.has(id)) del.push(id)
  }
  const merged = mergeFlowchart(newSrc, oldNodes, { add, del, mod })
  return { type: 'flowchart', add, del, mod, merged }
}

function mergeFlowchart(
  newSrc: string,
  oldNodes: Map<string, FcNodeInfo>,
  diff: { add: string[]; del: string[]; mod: MermaidMod[] }
): string {
  const out = newSrc.split('\n')
  // 删除节点加回（原定义行含边，保持可见；渲染后 DOM 标注红标）——不带任何标注语法（M14）
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

/** 简单 LCS 文本序列 diff（按序标记增删；M16：去掉 mod 配对——修改视为删+增二元）
 *  steps：每一步的对齐决策（ctx/del/add + 两侧索引），供按序重建 merged（删除消息插回原位） */
interface SeqStep {
  kind: 'ctx' | 'del' | 'add'
  oldIdx: number
  newIdx: number
}

function diffTextSeq(oldSeq: string[], newSeq: string[]): {
  add: string[]
  del: string[]
  mod: MermaidMod[]
  messages: Array<{ kind: 'add' | 'del'; text: string }>
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
  const messages: Array<{ kind: 'add' | 'del'; text: string }> = []
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
      messages.push({ kind: 'del', text: oldSeq[i] })
      steps.push({ kind: 'del', oldIdx: i, newIdx: -1 })
      i++
    } else {
      add.push(newSeq[j])
      messages.push({ kind: 'add', text: newSeq[j] })
      steps.push({ kind: 'add', oldIdx: -1, newIdx: j })
      j++
    }
  }
  while (i < n) {
    del.push(oldSeq[i])
    messages.push({ kind: 'del', text: oldSeq[i] })
    steps.push({ kind: 'del', oldIdx: i, newIdx: -1 })
    i++
  }
  while (j < m) {
    add.push(newSeq[j])
    messages.push({ kind: 'add', text: newSeq[j] })
    steps.push({ kind: 'add', oldIdx: -1, newIdx: j })
    j++
  }
  return { add, del, mod: [], messages, steps }
}

function diffSequence(oldSrc: string, newSrc: string): MermaidNodeDiff {
  const oldRows = extractSequenceRows(oldSrc)
  const newRows = extractSequenceRows(newSrc)
  const r = diffTextSeq(
    oldRows.map((x) => x.msg),
    newRows.map((x) => x.msg)
  )
  // M16b：删除消息按 LCS 对齐步骤插回原位（先删旧线、再增新线，保持时序顺序），非消息行原位保留
  const seqLines: string[] = r.steps.map((s) =>
    s.kind === 'del' ? oldRows[s.oldIdx].line : newRows[s.newIdx].line
  )
  const newLines = newSrc.split('\n')
  let si = 0
  const mergedLines: string[] = []
  for (const ln of newLines) {
    if (SEQ_MSG_RE.test(ln.trim())) {
      mergedLines.push(si < seqLines.length ? seqLines[si++] : ln)
    } else {
      mergedLines.push(ln)
    }
  }
  while (si < seqLines.length) mergedLines.push(seqLines[si++])
  // M16b：participant 参与者行增删标注（新增绿 / 删除红）——删除行加回 merged
  const messages = [...r.messages]
  const oldParts = extractPartRows(oldSrc)
  const newParts = extractPartRows(newSrc)
  const delParts = oldParts.filter((p) => !newParts.some((n) => n.id === p.id))
  const addParts = newParts.filter((p) => !oldParts.some((n) => n.id === p.id))
  for (const p of delParts) {
    messages.push({ kind: 'del', text: p.label })
    mergedLines.push(p.line)
  }
  for (const p of addParts) messages.push({ kind: 'add', text: p.label })
  return {
    type: 'sequence',
    add: [...r.add, ...addParts.map((p) => p.label)],
    del: [...r.del, ...delParts.map((p) => p.label)],
    mod: r.mod,
    merged: mergedLines.join('\n'),
    messages,
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
    // M16b：同 id 标签变化 → mod（渲染：绿新 + 红旧划线附加）
    else if (oldStates.get(id)!.label !== info.label) mod.push({ id, old: oldStates.get(id)!.label, new: info.label })
  }
  for (const id of oldStates.keys()) if (!newStates.has(id)) del.push(id)
  const merged = mergeState(newSrc, oldStates, oldSrc.split('\n'), { add, del, mod })
  return { type: 'state', add, del, mod, merged }
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
  return { type: 'unknown', add: [], del: [], mod: [], merged: newSrc }
}
