import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
globalThis.window = dom.window
globalThis.document = dom.window.document
try { globalThis.navigator = dom.window.navigator } catch { Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true }) }
// mermaid needs these globals (they may be undefined in jsdom)
globalThis.Node = dom.window.Node
globalThis.SVGElement = dom.window.SVGElement
globalThis.DOMPurify = undefined

// mermaid needs CSSStyleSheet & related CSSOM; jsdom in node doesn't provide it.
if (!globalThis.CSSStyleSheet) {
  class CSSStyleSheetStub {
    constructor() {
      this.cssRules = []
      this.disabled = false
      this.href = null
      this.ownerNode = null
      this.parentStyleSheet = null
      this.title = null
      this.media = { mediaText: 'all' }
      this.type = 'text/css'
      this.cssText = ''
    }
    insertRule(rule, index = 0) {
      this.cssRules.splice(index, 0, rule)
      return index
    }
    deleteRule(index) {
      this.cssRules.splice(index, 1)
    }
    replaceSync(cssText) {
      this.cssText = cssText
      this.cssRules = cssText
        .split('}')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((x) => x + '}')
      return this
    }
  }
  globalThis.CSSStyleSheet = CSSStyleSheetStub
}
if (!globalThis.ShadowRoot) globalThis.ShadowRoot = dom.window.ShadowRoot || class {}
if (!globalThis.HTMLElement) globalThis.HTMLElement = dom.window.HTMLElement

const mermaid = (await import('mermaid')).default
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })

async function render(label, src) {
  try {
    const { svg } = await mermaid.render('id-' + Math.random().toString(36).slice(2), src)
    console.log(`\n=== [${label}] RENDER OK, len=${svg.length} ===`)
    return svg
  } catch (e) {
    console.log(`\n=== [${label}] FAIL: ${e.message} ===`)
    return null
  }
}

async function inspect(label, src, probe) {
  const svg = await render(label, src)
  if (svg === null) return
  console.log(`-- ${label} probes --`)
  for (const p of probe) {
    const hits = []
    for (const m of svg.matchAll(p)) hits.push(m[0])
    console.log(` ${p}: ${hits.length} ->`, hits.slice(0, 3))
  }
}

// 1) Ghost 节点：把旧节点改 id 为 X_del，独立红节点，能否渲染？
await inspect('ghost-node', `flowchart TD
  A[进件] --> B{黑名单}
  B -->|命中| X[直接拒绝]
  X_del[拒绝]
  classDef diffAdd fill:#e8f5e9,stroke:#2e7d32,color:#1b5e20
  classDef diffDel fill:#fdecea,stroke:#c62828,color:#8e0000,stroke-dasharray:4 3
  class X_del diffDel
`, [/class="[^"]*diffDel[^"]*"/g, /diffDel/g])

// 2) subgraph 上 class：`subgraph 贷后` + `class 贷后 diffAdd`
await inspect('subgraph-title-class', `flowchart TD
  subgraph 贷后
    E --> J[贷后监控]
    J --> K[逾期预警]
  end
  classDef diffAdd fill:#e8f5e9,stroke:#2e7d32,color:#1b5e20
  class 贷后 diffAdd
`, [/class="[^"]*diffAdd[^"]*"/g, /cluster/g, /diffAdd/g])

// 3) subgraph 给显式 id 再 class
await inspect('subgraph-explicit-id', `flowchart TD
  subgraph sg_daihou[贷后]
    E --> J[贷后监控]
    J --> K[逾期预警]
  end
  classDef diffAdd fill:#e8f5e9,stroke:#2e7d32,color:#1b5e20
  class sg_daihou diffAdd
`, [/class="[^"]*diffAdd[^"]*"/g, /cluster/g, /diffAdd/g])

// 4) 完整 merged（现状）+ 观察 subgraph 贷后 是否渲染成 cluster，J/K 是否 green
const merged = `flowchart TD
  subgraph 贷前
    A[接收进件] --> B{黑名单}
    B -->|命中| X[直接拒绝]
  end
  subgraph 贷中
    E --> G([完成])
  end
  subgraph 贷后
    E --> J[贷后监控]
    J --> K[逾期预警]
  end
  classDef diffAdd fill:#e8f5e9,stroke:#2e7d32,color:#1b5e20
  classDef diffDel fill:#fdecea,stroke:#c62828,color:#8e0000,stroke-dasharray:4 3
  class J,K diffAdd
`
await inspect('merged-current', merged, [/class="[^"]*diffAdd[^"]*"/g, /cluster/g, /diffAdd/g, /贷后/g])
