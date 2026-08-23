// 表格增强插件——按内容动态分配列宽 + 手动拖调整列宽（需求4）
// 目标：
//  - 自动分配：按各列内容长度（汉字加权）比例分配 → 字多列更宽、减少折行；**用百分比渲染，绝不超出页宽/横向滚动**。
//  - 手动调整：拖拽列边界可微调某列宽；拖完把 px 宽写回表头 colwidth 并标记手动 → 自动分配不再覆盖。
// 策略：自动分配仅在「表格新建/载入/结构变化且尚未有 colwidth」时执行；已有 colwidth（含手动）则保留。
import { $prose } from '@milkdown/kit/utils'
import type { EditorView } from '@milkdown/kit/prose/view'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { TableMap } from '@milkdown/kit/prose/tables'
import { getTableConfig } from './config'

const MIN_COLUMN_FR = 0.05 // 单列最小占比（5%），防止拖窄消失

/** 字符宽度权重：汉字/全角按 1，其余按 0.5（更贴合「减少折行」） */
function charWidth(ch: string): number {
  const code = ch.charCodeAt(0)
  if (code >= 0x2e80 && code <= 0x9fff) return 1 // CJK
  if (code >= 0xff00 && code <= 0xffef) return 1 // 全角
  return 0.5
}

function cellTextLength(cell: { content: { forEach: (fn: (n: { isText?: boolean; text?: string; type?: { name: string }; textContent?: string }) => void) => void } }): number {
  let len = 0
  cell.content.forEach((n) => {
    const node = n as { isText?: boolean; text?: string; type?: { name: string }; textContent?: string }
    if (node.isText) for (const ch of node.text ?? '') len += charWidth(ch)
    else if (node.type?.name === 'hardbreak') len += 2
    else for (const ch of node.textContent ?? '') len += charWidth(ch)
  })
  return len
}

/** 计算各列像素宽（按内容长度比例分配到 availWidth；仅作内部权重，最终渲染归一为百分比） */
function computeColWidths(table: { nodeAt?: (p: number) => ({ attrs: { colspan?: number } }) | null }, availWidth: number): number[] | null {
  const map = TableMap.get(table as never)
  const w = map.width
  const h = map.height
  if (w <= 1 || h <= 0) return null
  const lens: number[] = new Array(w).fill(0)
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const idx = r * w + c
      const pos = map.map[idx]
      const cell = table.nodeAt?.(pos)
      if (!cell) continue
      if (c > 0 && map.map[idx] === map.map[idx - 1]) continue // colspan 前序列已计入
      const colspan = cell.attrs.colspan || 1
      const weight = (r === 0 ? 1.3 : 1) * Math.max(cellTextLength(cell as never), 4)
      for (let cc = c; cc < c + colspan && cc < w; cc++) lens[cc] += weight
    }
  }
  const total = lens.reduce((a, b) => a + b, 0)
  if (total <= 0) return null
  const MIN_ABS = 46
  const widths = lens.map((l) => Math.max(MIN_ABS, Math.round((l / total) * availWidth)))
  const sum = widths.reduce((a, b) => a + b, 0)
  const diff = availWidth - sum
  if (diff !== 0) {
    const order = lens.map((_, i) => i).sort((a, b) => lens[b] - lens[a])
    let rem = diff
    let k = 0
    while (rem !== 0 && k < widths.length * 20) {
      const col = order[k % order.length]
      const sign = rem > 0 ? 1 : -1
      if (sign > 0 || widths[col] > MIN_ABS) {
        widths[col] += sign
        rem -= sign
      }
      k++
    }
  }
  return widths
}

/** 把列宽(px)写入表头行各单元格 colwidth attr */
function applyColWidths(
  tr: { setNodeMarkup: (pos: number, type?: unknown, attrs?: unknown) => void },
  tablePos: number,
  table: { firstChild: { forEach: (fn: (cell: { attrs: { colspan?: number } }, off: number, i: number) => void) => void } | null },
  widths: number[]
): void {
  const headerRow = table.firstChild
  if (!headerRow) return
  let col = 0
  let p = tablePos + 2
  headerRow.forEach((cell) => {
    const colspan = cell.attrs.colspan || 1
    const cellWidths = widths.slice(col, col + colspan)
    if (cellWidths.length > 0) {
      tr.setNodeMarkup(p, undefined, { ...(cell as { attrs: Record<string, unknown> }).attrs, colwidth: cellWidths })
    }
    p += (cell as { nodeSize: number }).nodeSize
    col += colspan
  })
}

/** 表头行首格是否已有 colwidth */
function hasColWidth(headers: { attrs?: { colwidth?: unknown } }[] | null): boolean {
  if (!headers || !headers.length) return false
  return !!headers[0]?.attrs?.colwidth
}

/** 从表头行 data-colwidth 提取各列宽(px)；无则 null */
function readHeaderWidths(tableEl: HTMLTableElement): number[] | null {
  const firstRow = tableEl.rows[0]
  if (!firstRow) return null
  const widths: number[] = []
  let has = false
  for (const cell of Array.from(firstRow.cells)) {
    const raw = cell.getAttribute('data-colwidth')
    if (raw) {
      has = true
      for (const w of raw.split(',')) {
        const n = parseInt(w, 10)
        if (!Number.isNaN(n)) widths.push(n)
      }
    }
  }
  return has ? widths : null
}

/** 当前列宽分数（依据实际渲染宽度归一化） */
function currentFractions(tableEl: HTMLTableElement): number[] {
  const row0 = tableEl.rows[0]
  if (!row0) return []
  const w = tableEl.getBoundingClientRect().width || 1
  return Array.from(row0.cells).map((c) => Math.max(0, c.getBoundingClientRect().width) / w)
}

/** 渲染 <colgroup>：列宽统一为【百分比】，绝不超页宽（配合 table.css 的 table-layout:fixed + width:100%） */
function renderColgroup(tableEl: HTMLTableElement): void {
  const widths = readHeaderWidths(tableEl)
  let colgroup = tableEl.querySelector(':scope > colgroup') as HTMLTableColElement | null
  if (!widths || widths.length === 0) {
    colgroup?.remove()
    return
  }
  if (!colgroup) {
    colgroup = document.createElement('colgroup')
    tableEl.insertBefore(colgroup, tableEl.firstChild)
  }
  const total = widths.reduce((a, b) => a + b, 0) || 1
  // 已存在且列数一致 → 就地更新 width（触发 CSS transition 平滑过渡），不重建（重建会打断动画）
  const cols = Array.from(colgroup.querySelectorAll('col'))
  if (cols.length === widths.length) {
    let same = true
    cols.forEach((col, i) => {
      const want = (widths[i] / total) * 100
      const cur = parseFloat(col.style.width)
      if (Math.abs(cur - want) > 0.01) {
        same = false
        col.style.width = want + '%'
      }
    })
    if (same) return
  } else {
    // 列数变化（结构增删列）→ 重建
    while (colgroup.firstChild) colgroup.removeChild(colgroup.firstChild)
    for (const w of widths) {
      const col = document.createElement('col')
      col.style.width = (w / total) * 100 + '%'
      colgroup.appendChild(col)
    }
  }
}

/** 手动拖拽持久化：把当前分数写回表头 colwidth(px)，并防止自动覆盖 */
function persistManualWidths(view: EditorView, tableEl: HTMLTableElement, fr: number[]): void {
  const rect = tableEl.getBoundingClientRect()
  const px = fr.map((f) => Math.max(20, Math.round(f * rect.width)))
  let tablePos = -1
  try {
    const p = view.posAtDOM(tableEl, 2)
    const $p = view.state.doc.resolve(p)
    // 向上找 table 起点
    let d = $p.depth
    while (d > 0 && ($p.node(d).type as { name?: string }).name !== 'table') d--
    const node = d > 0 ? $p.node(d) : null
    tablePos = $p.before(d)
    if (!node || (node.type as { name?: string }).name !== 'table') return
    const tr = view.state.tr
    applyColWidths(tr, tablePos, node as never, px)
    view.dispatch(tr)
  } catch {
    /* ignore */
  }
}

/** 手动触发自动列宽：按内容重新计算该表各列宽并写回（覆盖手动），供悬浮按钮调用 */
function autoWidthTable(view: EditorView, tableEl: HTMLTableElement): void {
  try {
    const p = view.posAtDOM(tableEl, 2)
    const $p = view.state.doc.resolve(p)
    let d = $p.depth
    while (d > 0 && ($p.node(d).type as { name?: string }).name !== 'table') d--
    const node = d > 0 ? $p.node(d) : null
    const tablePos = $p.before(d)
    if (!node || (node.type as { name?: string }).name !== 'table') return
    const avail = view.dom.clientWidth ? view.dom.clientWidth - 40 : 760
    const widths = computeColWidths(node as never, Math.max(avail, 200))
    if (!widths) return
    const tr = view.state.tr
    applyColWidths(tr, tablePos, node as never, widths)
    view.dispatch(tr)
  } catch {
    /* ignore */
  }
}

/** $prose：自动分配列宽 + 手动拖拽调整 */
export const columnWidthPlugin = (getCfg: (ctx: unknown) => ReturnType<typeof getTableConfig>) =>
  $prose((ctx) => {
    let view: EditorView | null = null
    /** 初始 / 兜底：为尚无 colwidth 的表格计算并写入 */
    const applyMissing = () => {
      if (!view) return
      const avail = view.dom.clientWidth ? view.dom.clientWidth - 40 : 760
      const tr = view.state.tr
      let changed = false
      let late = false
      view.state.doc.descendants((node, pos) => {
        if ((node.type as { name: string }).name !== 'table') return true
        if ((node as { firstChild?: unknown }).firstChild == null) {
          late = true
          return false
        }
        const headers: { attrs?: { colwidth?: unknown } }[] = []
        const headerRow = (node as { firstChild?: { forEach: (fn: (c: { attrs?: { colwidth?: unknown } }) => void) => void } | null }).firstChild
        if (headerRow) headerRow.forEach((c) => headers.push(c))
        if (hasColWidth(headers)) return false // 已分配（含手动）
        const widths = computeColWidths(node as never, Math.max(avail, 200))
        if (widths) {
          applyColWidths(tr, pos, node as never, widths)
          changed = true
        } else {
          late = true
        }
        return false
      })
      if (changed) {
        try {
          view.dispatch(tr)
        } catch {
          /* 视图可能已销毁 */
        }
      }
      if (late) requestAnimationFrame(applyMissing)
    }
    /** 渲染所有表格的 colgroup（幂等） */
    const renderAll = (v: EditorView) => {
      v.dom.querySelectorAll<HTMLTableElement>('table').forEach((t) => renderColgroup(t))
    }
    let syncPending = false
    const scheduleRender = () => {
      if (drag) return // 拖拽期间暂停自动渲染，避免把交互宽度弹回
      if (syncPending) return
      syncPending = true
      requestAnimationFrame(() => {
        syncPending = false
        if (view) renderAll(view)
      })
    }

    // ---- 手动拖拽列宽 + 悬浮自动列宽按钮 ----
    const HIT = 10 // 边界命中容差（px）
    let drag: { table: HTMLTableElement; col: number; startX: number; fr: number[]; tableW: number } | null = null
    /** 返回表头格右缘 x（绝对坐标）；索引 i 表示「第 i 列与第 i+1 列」之间的边界 */
    const boundaryXs = (tableEl: HTMLTableElement): number[] => {
      const row0 = tableEl.rows[0]
      if (!row0) return []
      return Array.from(row0.cells).map((c) => c.getBoundingClientRect().right)
    }
    /** 找 x 附近的列边界（返回边界索引 = 左侧列号） */
    const hitBorder = (tableEl: HTMLTableElement, x: number): number | null => {
      const xs = boundaryXs(tableEl)
      for (let i = 0; i < xs.length - 1; i++) {
        if (Math.abs(x - xs[i]) < HIT) return i
      }
      return null
    }
    /** 渲染列宽（百分比）；就地更新 col 宽度（不重建，避免重排跳变），拖拽中临时关闭动画以跟手 */
    const applyFr = (tableEl: HTMLTableElement, fr: number[], animate = true) => {
      let g = tableEl.querySelector(':scope > colgroup') as HTMLTableColElement | null
      if (!g) {
        g = document.createElement('colgroup')
        tableEl.insertBefore(g, tableEl.firstChild)
        fr.forEach((f) => {
          const col = document.createElement('col')
          col.style.width = f * 100 + '%'
          g!.appendChild(col)
        })
        return
      }
      const cols = g.querySelectorAll('col')
      if (cols.length !== fr.length) {
        while (g.firstChild) g.removeChild(g.firstChild)
        fr.forEach((f) => {
          const col = document.createElement('col')
          col.style.width = f * 100 + '%'
          g!.appendChild(col)
        })
        return
      }
      fr.forEach((f, i) => {
        cols[i].style.width = f * 100 + '%'
        cols[i].style.transition = animate ? '' : 'none'
      })
      if (!animate) tableEl.style.transition = 'none'
    }
    const onMouseMove = (x: number) => {
      if (!drag) return
      const dx = (x - drag.startX) / (drag.tableW || 1)
      const fr = drag.fr.slice()
      const delta = Math.min(dx, fr[drag.col] - MIN_COLUMN_FR, fr[drag.col + 1] - MIN_COLUMN_FR)
      fr[drag.col] += delta
      fr[drag.col + 1] -= delta
      applyFr(drag.table, fr, false)
      drag.fr = fr
      // 指示条实时跟随鼠标
      const rect = drag.table.getBoundingClientRect()
      resizeHandle.style.display = 'block'
      resizeHandle.style.top = rect.top + 'px'
      resizeHandle.style.height = rect.height + 'px'
      resizeHandle.style.left = x + 'px'
    }
    // 拖拽过程中的竖向指示条
    const resizeHandle = document.createElement('div')
    resizeHandle.className = 'tb-resize-handle'
    resizeHandle.style.display = 'none'
    const onMouseMoveHover = (e: MouseEvent) => {
      if (drag) return
      const target = e.target as HTMLElement
      const tableEl = target.closest('table') as HTMLTableElement | null
      if (!tableEl || tableEl.rows.length === 0) {
        resizeHandle.style.display = 'none'
        return
      }
      const hit = hitBorder(tableEl, e.clientX)
      if (hit != null && boundaryXs(tableEl)[hit] != null) {
        const xs = boundaryXs(tableEl)
        resizeHandle.style.display = 'block'
        resizeHandle.style.top = tableEl.getBoundingClientRect().top + 'px'
        resizeHandle.style.height = tableEl.getBoundingClientRect().height + 'px'
        resizeHandle.style.left = xs[hit] + 'px'
        tableEl.style.cursor = 'col-resize'
      } else {
        resizeHandle.style.display = 'none'
        tableEl.style.cursor = ''
      }
    }
    const endDrag = () => {
      if (!drag) return
      const tableEl = drag.table
      const fr = drag.fr
      tableEl.style.removeProperty('transition')
      tableEl.style.removeProperty('cursor')
      tableEl.querySelectorAll(':scope > colgroup col').forEach((c) => ((c as HTMLElement).style.transition = ''))
      document.body.style.removeProperty('cursor')
      document.body.style.removeProperty('userSelect')
      drag = null
      resizeHandle.style.display = 'none'
      window.removeEventListener('mousemove', onWinMove)
      window.removeEventListener('mouseup', onWinUp)
      if (tableEl && fr.length) {
        persistManualWidths(view as EditorView, tableEl, fr)
        scheduleRender()
        // 结束后按持久化的新 colwidth 重新渲染（看是否超宽）
        requestAnimationFrame(() => view && renderAll(view))
      }
    }
    function onWinMove(e: MouseEvent) {
      onMouseMove(e.clientX)
    }
    function onWinUp() {
      endDrag()
    }

    return new Plugin({
      key: new PluginKey('WRITEIT_TABLE_COLWIDTH'),
      view(v: EditorView) {
        view = v
        requestAnimationFrame(() => {
          applyMissing()
          renderAll(v)
        })
        const dom = v.dom as HTMLElement
        // ---- 悬浮「自动调整列宽」按钮（表右上角，hover 出现）----
        const autoBtn = document.createElement('button')
        autoBtn.className = 'tb-auto-width'
        autoBtn.title = '自动调整列宽'
        autoBtn.innerHTML = '⇄'
        autoBtn.style.display = 'none'
        let hoveredTable: HTMLTableElement | null = null
        autoBtn.addEventListener('click', (e) => {
          e.preventDefault()
          e.stopPropagation()
          if (hoveredTable) autoWidthTable(view as EditorView, hoveredTable)
        })
        document.body.appendChild(autoBtn)
        document.body.appendChild(resizeHandle)

        const onMouseDown = (e: MouseEvent) => {
          const target = e.target as HTMLElement
          const tableEl = target.closest('table') as HTMLTableElement | null
          if (!tableEl || tableEl.rows.length === 0) return
          const hit = hitBorder(tableEl, e.clientX)
          if (hit == null) return
          // 捕获：阻止表格自带的「列边界加列」等默认操作，避免冲突
          e.preventDefault()
          e.stopPropagation()
          const fr = currentFractions(tableEl)
          if (fr.length < 2) return
          drag = {
            table: tableEl,
            col: hit,
            startX: e.clientX,
            fr,
            tableW: tableEl.getBoundingClientRect().width,
          }
          tableEl.style.transition = 'none'
          document.body.style.cursor = 'col-resize'
          document.body.style.userSelect = 'none'
          // 指示条保留并跟随（不隐藏）
          window.addEventListener('mousemove', onWinMove)
          window.addEventListener('mouseup', onWinUp)
        }
        dom.addEventListener('mousedown', onMouseDown, true) // 捕获阶段
        dom.addEventListener('mousemove', onMouseMoveHover)
        // ---- 悬浮「自动列宽」按钮：基于 document mousemove + elementFromPoint，规则唯一、不闪烁 ----
        // 「鼠标下最上层元素」是表格 → 显示按钮；是按钮/指示条自身 → 保持；是其它 → 隐藏。
        let lastTable: HTMLTableElement | null = null
        const positionAutoBtn = (t: HTMLTableElement) => {
          const r = t.getBoundingClientRect()
          autoBtn.style.display = 'block'
          autoBtn.style.left = r.right - 24 + 'px'
          autoBtn.style.top = r.top + 4 + 'px'
        }
        const onDocMove = (e: MouseEvent) => {
          if (drag) return
          const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
          const isOurUI = el && el.closest('.tb-auto-width,.tb-resize-handle')
          const tableEl = el?.closest('table') as HTMLTableElement | null
          if (tableEl && !isOurUI) {
            hoveredTable = tableEl
            if (tableEl !== lastTable) {
              lastTable = tableEl
              positionAutoBtn(tableEl)
            }
            autoBtn.style.display = 'block' // 保险：跨表时保证显示
          } else if (!isOurUI) {
            // 不在表格、也不在按钮/指示条上 → 隐藏
            lastTable = null
            hoveredTable = null
            autoBtn.style.display = 'none'
          }
          // 若 hoveredTable 仍在但鼠标不在其上（e.g. 移到了按钮），保持显示
        }
        document.addEventListener('mousemove', onDocMove)
        return {
          update(v2) {
            if (!drag) scheduleRender()
          },
          destroy() {
            dom.removeEventListener('mousedown', onMouseDown, true)
            dom.removeEventListener('mousemove', onMouseMoveHover)
            document.removeEventListener('mousemove', onDocMove)
            if (drag) endDrag()
            autoBtn.remove()
            resizeHandle.remove()
          },
        }
      },
      appendTransaction: (_trs, oldState, state) => {
        const cfg = getCfg(ctx)
        if (cfg && cfg.dynamicColumnWidth === false) return null
        if (!_trs.some((t) => t.docChanged)) return null
        let tr: ReturnType<typeof state.tr> | null = null
        state.doc.descendants((node, pos) => {
          if ((node.type as { name: string }).name !== 'table') return true
          if (hasColWidth(collectHeaders(node))) return false // 已有 colwidth（含手动）→ 不覆盖
          const map = TableMap.get(node as never)
          const w = map.width
          const h = map.height
          let oldNode = null
          try {
            oldNode = oldState.doc.nodeAt(pos)
          } catch {
            oldNode = null
          }
          const sameStructure =
            oldNode != null &&
            (oldNode.type as { name: string }).name === 'table' &&
            (() => { try { const om = TableMap.get(oldNode as never); return om.width === w && om.height === h } catch { return true } })()
          if (sameStructure) return false
          const avail = view && view.dom.clientWidth ? view.dom.clientWidth - 40 : 760
          const widths = computeColWidths(node as never, Math.max(avail, 200))
          if (widths) {
            if (!tr) tr = state.tr
            applyColWidths(tr, pos, node as never, widths)
          }
          return false
        })
        if (tr) scheduleRender()
        return tr
      },
    })
  })

function collectHeaders(node: { firstChild?: { forEach: (fn: (c: { attrs?: { colwidth?: unknown } }) => void) => void } | null }): { attrs?: { colwidth?: unknown } }[] {
  const headers: { attrs?: { colwidth?: unknown } }[] = []
  const headerRow = node.firstChild
  if (headerRow) headerRow.forEach((c) => headers.push(c as { attrs?: { colwidth?: unknown } }))
  return headers
}

/** 供装配层注入 ctx 的包装（见 index.ts） */
export const tableColumnWidthPlugin = columnWidthPlugin((ctx) => {
  try {
    return getTableConfig(ctx as never)
  } catch {
    return { addRowBelowShortcut: 'Shift-Enter', dynamicColumnWidth: true }
  }
})
