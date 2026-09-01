// 临时调研：mermaid sequenceDiagram 消息级 class 标注可行性（方案选型用）
// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest'
import mermaid from 'mermaid'

beforeAll(() => {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
})

describe('sequence 消息 class 支持调研', () => {
  it('消息行能否被 class 声明作用（classDef 是否落到消息 text）', async () => {
    const src = `sequenceDiagram
  participant A as 客户
  participant B as 路由系统
  classDef diffAdd fill:#e8f5e9,stroke:#2e7d32,color:#1b5e20
  A->>B: 提交申请
  A->>B: 补充资料
  B-->>A: 受理完成通知
  class A,B diffAdd
`
    const { svg } = await mermaid.render('s1', src)
    const hasDiffAdd = svg.includes('diffAdd')
    console.log('HAS_DIFFADD=', hasDiffAdd)
    console.log('SVG_LEN=', svg.length)
    const idx = svg.indexOf('提交申请')
    console.log('MSG_IDX=', idx)
    if (idx > 0) {
      console.log('MSG_CONTEXT=', svg.slice(idx - 400, idx + 200))
    }
    expect(svg.length).toBeGreaterThan(0)
  })

  it('classDef 放参与者之前是否能渲染（验证位置要求）', async () => {
    const src = `sequenceDiagram
  classDef diffAdd fill:#e8f5e9,stroke:#2e7d32,color:#1b5e20
  participant A as 客户
  participant B as 路由系统
  A->>B: 提交申请
  class A,B diffAdd
`
    const { svg } = await mermaid.render('s2', src)
    console.log('S2_OK len=', svg.length)
    console.log('S2_has=', svg.includes('diffAdd'))
    expect(svg.length).toBeGreaterThan(0)
  })

  it('渲染后消息文本的 DOM 结构（判断 DOM 手术可行性）', async () => {
    const src = `sequenceDiagram
  participant A as 客户
  participant B as 路由系统
  A->>B: 提交申请
  A->>B: 补充资料
  B-->>A: 受理完成通知
`
    const { svg } = await mermaid.render('s3', src)
    // 定位消息文本周边结构
    const idx = svg.indexOf('补充资料')
    console.log('S3_MSG_IDX=', idx)
    if (idx > 0) {
      console.log('S3_CTX=', svg.slice(idx - 500, idx + 120))
    }
    expect(svg.length).toBeGreaterThan(0)
  })
})
