// M18 §4.3 AnchorResolver 纯逻辑单测 + §4.1.3 settle 编排（fake timer）
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { proseRect, diagramRect, createAnchorResolver, type ProseAnchorSource } from '../../../src/editor/diff/anchor'
import { SettleCollector } from '../../../src/editor/diff/nodeview'

describe('proseRect（§4.3：coordsAtPos 为主 + data-dnote DOM 校验兜底）', () => {
  it('coordsAtPos 命中 → rect', () => {
    const src: ProseAnchorSource = {
      coordsAtPos: () => ({ left: 10, top: 20, right: 110, bottom: 40 }),
      docSize: () => 100,
      posOf: (id) => (id === 'n1' ? 50 : null),
      domAt: () => null,
    }
    const r = proseRect(src, 'n1', null)
    expect(r?.left).toBe(10)
    expect(r?.width).toBe(100)
  })

  it('data-dnote DOM 命中且非零宽 → DOM rect 优先（覆盖 coords 退化）', () => {
    const el = { getBoundingClientRect: () => ({ left: 5, right: 55, top: 6, bottom: 26, width: 50, height: 20 }) } as unknown as HTMLElement
    const src: ProseAnchorSource = {
      coordsAtPos: () => ({ left: 0, top: 0, right: 0, bottom: 0 }),
      docSize: () => 100,
      posOf: () => 50,
      domAt: (id) => (id === 'n1' ? el : null),
    }
    const r = proseRect(src, 'n1', null)
    expect(r?.left).toBe(5)
  })

  it('找不到 id → null（连线隐藏）', () => {
    const src: ProseAnchorSource = {
      coordsAtPos: () => ({ left: 0, top: 0, right: 0, bottom: 0 }),
      docSize: () => 100,
      posOf: () => null,
      domAt: () => null,
    }
    expect(proseRect(src, 'missing', null)).toBeNull()
  })
})

describe('diagramRect（§4.3：data-fence-id scoped 到 NodeView 子树）', () => {
  function hostWithFence(fenceId: string, nodeIds: string[]): HTMLElement {
    const host = document.createElement('div')
    const fence = document.createElement('div')
    fence.setAttribute('data-fence-id', fenceId)
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    for (const id of nodeIds) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
      g.setAttribute('id', `flowchart-${id}-123`)
      g.setAttribute('class', 'node default') // mermaid 渲染的节点 <g class="node">
      g.getBoundingClientRect = () => ({ left: 1, right: 2, top: 1, bottom: 2, width: 1, height: 1, x: 1, y: 1, toJSON: () => ({}) }) as DOMRect
      svg.appendChild(g)
    }
    fence.appendChild(svg)
    host.appendChild(fence)
    return host
  }

  it('在具体 NodeView 子树内按节点 id 找 SVG 元素（跨图隔离）', () => {
    const host = hostWithFence('fence-aaa', ['A', 'B'])
    // 另一张图的节点（应永不被命中）
    hostWithFence('fence-bbb', ['A'])
    const r = diagramRect(host, 'fence-aaa', 'A')
    expect(r?.left).toBe(1)
  })

  it('fence 不存在 → null', () => {
    expect(diagramRect(document.createElement('div'), 'fence-xxx', 'A')).toBeNull()
  })
})

describe('createAnchorResolver（resolvePos / resolveRect 统一入口）', () => {
  it('resolvePos 走 posOf；resolveRect 走 proseRect', () => {
    const src: ProseAnchorSource = {
      coordsAtPos: () => ({ left: 0, top: 0, right: 10, bottom: 10 }),
      docSize: () => 100,
      posOf: (id) => (id === 'n1' ? 30 : null),
      domAt: () => null,
    }
    const r = createAnchorResolver(src)
    expect(r.resolvePos({ noteId: 'n1' })).toBe(30)
    expect(r.resolvePos({ noteId: 'nope' })).toBeNull()
    const rect = r.resolveRect(document.createElement('div'), { noteId: 'n1' })
    expect(rect?.right).toBe(10)
  })
})

describe('SettleCollector（§4.1.3：Promise.allSettled + 5s 兜底）', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('全部成功 → 结果数组 ok', async () => {
    const c = new SettleCollector()
    c.add('f1', Promise.resolve({ fenceId: 'f1', ok: true }))
    c.add('f2', Promise.resolve({ fenceId: 'f2', ok: true }))
    const p = c.settle(5000)
    const r = await p
    expect(r.every((x) => x.ok)).toBe(true)
  })

  it('部分失败 → 归因 reason（degraded 语义，不抛）', async () => {
    const c = new SettleCollector()
    c.add('f1', Promise.resolve({ fenceId: 'f1', ok: false, reason: 'parse-error' }))
    c.add('f2', Promise.resolve({ fenceId: 'f2', ok: true }))
    const r = await c.settle(5000)
    expect(r.find((x) => x.fenceId === 'f1')?.ok).toBe(false)
    expect(r.find((x) => x.fenceId === 'f1')?.reason).toBe('parse-error')
  })

  it('超时兜底：未完成单元按 degraded + reason=settle-timeout 归因', async () => {
    const c = new SettleCollector()
    c.add('slow', new Promise<never>(() => {})) // 永远 pending
    const p = c.settle(100)
    vi.advanceTimersByTime(150)
    const r = await p
    expect(r[0].ok).toBe(false)
    expect(r[0].reason).toBe('settle-timeout')
  })

  it('空收集器 → 立即 []（不挂起）', async () => {
    const c = new SettleCollector()
    expect(await c.settle(100)).toEqual([])
  })
})