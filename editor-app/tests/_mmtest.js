const mermaid = require('mermaid')
// mermaid 需要 DOM；用最小 jsdom 或全局 document。先直接试
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<!DOCTYPE html><body></body>')
global.window = dom.window
global.document = dom.window.document
global.navigator = dom.window.navigator
// mermaid 可能需要更多全局
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })

async function run() {
  const src = `sequenceDiagram
  participant A as 客户
  participant B as 路由系统
  classDef diffAdd fill:#e8f5e9,stroke:#2e7d32,color:#1b5e20
  classDef diffDel fill:#fdecea,stroke:#c62828,color:#8e0000
  A->>B: 提交申请
  A->>B: 补充资料
  B-->>A: 受理完成通知
  class A,B diffAdd
`
  try {
    const { svg } = await mermaid.render('tt1', src)
    console.log('RENDER OK len=', svg.length)
    console.log('has diffAdd=', svg.includes('diffAdd'))
    console.log(svg.slice(0,1500))
  } catch (e) {
    console.log('FAIL', e.message)
  }
}
run()
